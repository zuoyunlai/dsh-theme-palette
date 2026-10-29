#!/usr/bin/env node
/**
 * 色彩数学单测：把 OKLCH↔sRGB 往返、色域钳位、WCAG 亮度/对比度、alpha 合成、
 * 语义色调和的**不变量**钉住。与 check-audit 的集成断言互补——那边测「最终 token 对不对」，
 * 这边测「底层变换本身不退化」。
 *
 * 为什么单独一个脚本：这些纯函数是整个求解器的地基，历史上出过两类事故——
 *   1) fromOklch 硬钳通道导致暖砂气泡算出 #ffede0（R 顶满、色相被压扁），
 *      修成「二分收色度、保 L/h」后需要一条断言防止回退；
 *   2) 右栏清理时 client.js 被一次性替换脚本写坏过（全文 [ 变 '），
 *      语法检查救不了「能跑但数值错了」的情况。
 *
 * 用法：node tools/check-colormath.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'client.js'), 'utf8')

const store = new Map()
const sandboxWindow = {
  __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
  __DSH_THEME_PALETTE_DEV__: (api) => { globalThis.__api = api },
  __DSH_THEME_PALETTE_DEV_REQUEST__: true,
}
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
}
const documentStub = {
  head: { appendChild() {} },
  createElement: () => ({ dataset: {}, remove() {} }),
  querySelector: () => null,
  documentElement: { lang: 'zh' },
}
new Function('window', 'localStorage', 'document', 'navigator', src)(
  sandboxWindow, localStorage, documentStub, { language: 'zh' },
)
globalThis.__def.factory(() => ({
  createElement: () => null,
  useState: (v) => [v, () => {}],
  useSyncExternalStore: (s, g) => g(),
}))

const { toOklch, fromOklch, flatten, luminance, withAlpha, mixHex, harmonize, contrast } = globalThis.__api
for (const name of ['toOklch', 'fromOklch', 'flatten', 'luminance', 'withAlpha', 'mixHex', 'harmonize', 'contrast']) {
  if (typeof globalThis.__api[name] !== 'function') {
    console.error('✗ dev API 缺导出：' + name)
    process.exit(1)
  }
}

let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }
const near = (a, b, tol) => Math.abs(a - b) <= tol
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const channelsClose = (hex, rgb, tol = 1) => hexToRgb(hex).every((v, i) => Math.abs(v - rgb[i]) <= tol)

console.log('\n1) OKLab 锚点（黑白灰必须落格）')
{
  const [lw, cw] = toOklch('#ffffff')
  check(lw > 0.999 && cw < 0.001, `白：L=${lw.toFixed(4)} C=${cw.toFixed(5)}（应 L≈1、C≈0）`)
  const [lb, cb] = toOklch('#000000')
  check(lb < 0.001 && cb < 0.001, `黑：L=${lb.toFixed(4)} C=${cb.toFixed(5)}（应 L≈0、C≈0）`)
  const [lg, cg] = toOklch('#808080')
  check(cg < 0.001 && near(lg, 0.5969, 0.01), `中灰：L=${lg.toFixed(4)} C=${cg.toFixed(5)}（OKLab 中灰 L≈0.5969）`)
}

console.log('\n2) OKLCH↔hex 往返（8bit 量化内必须回到原色）')
for (const hex of ['#f8fafc', '#a9683e', '#4f7a42', '#151517', '#ff0000', '#00ff00', '#0000ff', '#e6c4a0', '#26211d']) {
  const back = fromOklch(...toOklch(hex))
  check(channelsClose(back, hexToRgb(hex)), `${hex} → ${back}（逐通道 ≤1/255）`)
}

console.log('\n3) 色域钳位：收色度、保明度与色相（防 #ffede0 事故回潮）')
for (const [L, C, h] of [[0.9, 0.3, 30], [0.95, 0.25, 140], [0.5, 0.4, 264], [0.25, 0.28, 20]]) {
  const out = fromOklch(L, C, h)
  const rgb = hexToRgb(out)
  const [L2, C2, h2] = toOklch(out)
  const inGamut = rgb.every((v) => v >= 0 && v <= 255)
  check(inGamut && near(L2, L, 0.01), `(${L},${C},${h}°) → ${out} 在色域内且 L 保持（${L2.toFixed(3)}）`)
  // 审计 2026-10-29 P3-2：这里原来还并着一个
  // `Math.abs(((h2-h+540)%360)-180-0) <= 180` —— 值域构造使然，恒真（永不可能失败）。
  // 真正守色相的是下一行 `dh <= 2.5`；恒真子句只会让人误以为这条断言管两件事。
  check(C2 <= C + 0.002 && C2 > 0, `(${L},${C},${h}°) 色度只减不增（${C2.toFixed(4)} ≤ ${C}）`)
  const dh = Math.abs(((h2 - h + 540) % 360) - 180)
  check(dh <= 2.5, `(${L},${C},${h}°) 色相保持（偏差 ${dh.toFixed(2)}°）`)
}

console.log('\n4) WCAG 亮度与对比度（拿公开样例值对表）')
{
  check(near(luminance('#ffffff'), 1, 1e-6), 'luminance(白) = 1')
  check(near(luminance('#000000'), 0, 1e-6), 'luminance(黑) = 0')
  const l76 = luminance('#767676')
  check(near(l76, 0.1812, 0.003), `luminance(#767676) ≈ 0.181（实得 ${l76.toFixed(4)}）`)
  check(near(contrast('#ffffff', '#000000'), 21, 0.01), 'contrast(白,黑) = 21')
  const c76 = contrast('#ffffff', '#767676')
  check(near(c76, 4.54, 0.03), `contrast(白,#767676) ≈ 4.54（实得 ${c76.toFixed(3)}，AA 参考灰）`)
  check(near(contrast('#336699', '#336699'), 1, 1e-9), 'contrast(同色) = 1')
  check(near(contrast('#336699', '#f8fafc'), contrast('#f8fafc', '#336699'), 1e-9), 'contrast 对称')
}

console.log('\n5) alpha 与线性混色')
{
  check(withAlpha('#ff0000', 0.5).toLowerCase() === '#ff000080', `withAlpha(#ff0000, .5) = ${withAlpha('#ff0000', 0.5)}`)
  check(channelsClose(flatten('#ff000080', '#000000'), [128, 0, 0]), `flatten(红 50%, 黑) ≈ #800000（实得 ${flatten('#ff000080', '#000000')}）`)
  check(channelsClose(flatten('#ff000080', '#ffffff'), [255, 128, 128]), `flatten(红 50%, 白) ≈ #ff8080（实得 ${flatten('#ff000080', '#ffffff')}）`)
  check(flatten('#ff0000', '#00ff00') === '#ff0000', 'flatten 不带 alpha 原样返回')
  check(channelsClose(mixHex('#000000', '#ffffff', 0.5), [128, 128, 128]), `mixHex(黑,白,.5) ≈ #808080（实得 ${mixHex('#000000', '#ffffff', 0.5)}）`)
  check(mixHex('#336699', '#336699', 0.3) === '#336699', 'mixHex 同色恒等')
  // alpha 合成的结合性：先 50% 压黑再压白 == 直接按 50% 与中间色混 —— 数值上用交换性近似钉住
  const a = flatten(withAlpha('#ff0000', 0.25), flatten(withAlpha('#ff0000', 0.5), '#ffffff'))
  const b = flatten(withAlpha('#ff0000', 0.5), flatten(withAlpha('#ff0000', 0.25), '#ffffff'))
  check(a === b, 'flatten 叠加次序无关（α 合成的交换性）')
}

console.log('\n6) 语义色调和（harmonize）不变量：保 L、色度按比例、色相朝目标走')
for (const [hex, target, pull, scale] of [['#2e7d32', 60, 0.2, 0.9], ['#b91c1c', 250, 0.15, 0.95], ['#0891b2', 30, 0.22, 0.8]]) {
  const [L, C, h] = toOklch(hex)
  const out = harmonize(hex, target, pull, scale)
  const [L2, C2, h2] = toOklch(out)
  check(near(L2, L, 0.005), `${hex} 调和后 L 保持（${L.toFixed(4)}→${L2.toFixed(4)}）`)
  check(C2 <= C * scale + 0.002, `${hex} 色度按 ${scale} 缩放（${C.toFixed(4)}→${C2.toFixed(4)}）`)
  const dh0 = ((target - h + 540) % 360) - 180
  const dh1 = ((h2 - h + 540) % 360) - 180
  check(Math.abs(dh1 - dh0 * pull) <= 2,
    `${hex} 色相朝 ${target}° 恰好移动 ${pull * 100}%（期望 ${dh0.toFixed(1)}×${pull}=${(dh0 * pull).toFixed(1)}°，实得 ${dh1.toFixed(1)}°）`)
}

console.log(failed === 0 ? '\n色彩数学单测通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
