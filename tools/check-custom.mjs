#!/usr/bin/env node
/**
 * 自定义配色的回归断言（反哺 A-3 的配套）。
 *
 * 起因：1.5.2 里"自定义"选中后滚动条不跟随取色 —— scrollbarTokens 收到的是
 * SCHEMES 里的占位 scheme（accentHue 恒为 60），而不是按三色派生出的参数。
 * 这类 bug 在截图里不明显，所以用数值断言钉住：
 *   1) 强调色不同 → 滚动条"强调"档的颜色必须不同
 *   2) 三组自选色下，正文/次级/三级对比度仍达下限
 *
 * 用法：node tools/check-custom.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'client.js'), 'utf8')

// 最小沙箱：只取引擎
const store = new Map()
const sandboxWindow = {
  __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
  __DSH_THEME_PALETTE_DEV__: (api) => { globalThis.__api = api },
  __DSH_THEME_PALETTE_DEV_REQUEST__: true,
}
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
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
const { buildTokens, SCHEMES, contrast, deltaE, deriveCustomFromAccent, toOklch, writeCustom } = globalThis.__api
const custom = SCHEMES.find((s) => s.id === 'custom')

const ACCENTS = ['#2f6fd0', '#a9683e', '#4f7a42']
const CUSTOM_KEY = 'dsh-theme-palette.custom.v1'
const rows = []
for (const accent of ACCENTS) {
  store.set(CUSTOM_KEY, JSON.stringify({ bg: '#f5efe6', text: '#1d1a17', accent }))
  const t = buildTokens(custom, 'deep', 'tinted', 'accent', 'accent', 'on', false)
  const g = (k) => t['--dsw-static-' + k].light
  rows.push({
    accent,
    scroll: t['--dsw-alias-scrollbar-hover-l1'].light,
    main: contrast(g('neutral-bluish-1000'), g('neutral-bluish-00')),
    secondary: contrast(g('neutral-bluish-700'), g('neutral-bluish-60')),
    tertiary: contrast(g('neutral-bluish-600'), g('neutral-bluish-60')),
  })
}

let failed = 0
const fail = (msg) => { failed++; console.log('  ✗ ' + msg) }
const ok = (msg) => console.log('  ✓ ' + msg)

const scrolls = new Set(rows.map((r) => r.scroll))
if (scrolls.size === ACCENTS.length) ok('滚动条跟随强调色：' + rows.map((r) => r.accent + '→' + r.scroll).join('  '))
else fail('滚动条没跟随强调色（%d 种强调只出 %d 种滚动条色）', ACCENTS.length, scrolls.size)

for (const r of rows) {
  const good = r.main >= 12 && r.secondary >= 6.1 && r.tertiary >= 4.6
  const line = `${r.accent} 正文 ${r.main.toFixed(2)} / 次文 ${r.secondary.toFixed(2)} / 三级 ${r.tertiary.toFixed(2)}`
  good ? ok('对比度达标：' + line) : fail('对比度低于下限：' + line)
}

console.log('\n单色派生（1.10.0，审计建议 4）：只给主色也能得到一整套过下限的配色')
{
  const probes = ['#a9683e', '#2f6fd0', '#4f7a42', '#ff00ff', '#000000', '#ffffff', '#808080']
  for (const accent of probes) {
    for (const pref of ['light', 'dark']) {
      const derived = deriveCustomFromAccent(accent, pref)
      if (!derived) { fail(`${accent}/${pref} 派生失败`); continue }
      writeCustom({ bg: derived.bg, text: derived.text, accent: derived.accent })
      const scheme = SCHEMES.find((s) => s.id === 'custom')
      const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
      const g = (k) => t[k].light
      const canvas = g('--dsw-static-neutral-bluish-00')
      const card = g('--dsw-static-neutral-bluish-60')
      const body = contrast(g('--dsw-static-neutral-bluish-1000'), canvas)
      const sec = contrast(g('--dsw-alias-label-secondary'), card)
      const ter = contrast(g('--dsw-alias-label-tertiary'), card)
      const link = contrast(g('--dsw-alias-link'), card)
      const good = body >= 12 && sec >= 6.2 && ter >= 4.8 && link >= 4.9
      good
        ? ok(`${accent}/${pref} → bg ${derived.bg} text ${derived.text}｜正文 ${body.toFixed(1)} 次 ${sec.toFixed(1)} 三 ${ter.toFixed(1)} 链 ${link.toFixed(1)}`)
        : fail(`${accent}/${pref} 派生后不达标：正文 ${body.toFixed(1)} 次 ${sec.toFixed(1)} 三 ${ter.toFixed(1)} 链 ${link.toFixed(1)}`)
    }
  }
  // 无彩色主色不该给出一套染色纸面（老问题：黑底白字黄强调 → 淡粉画布）
  const grey = deriveCustomFromAccent('#808080', 'light')
  const gBg = toOklch(grey.bg)
  gBg[1] < 0.004 ? ok(`无彩色主色派生中性纸面（C=${gBg[1].toFixed(4)}）`) : fail(`无彩色主色派生出染色纸面（C=${gBg[1].toFixed(4)}）`)
}

console.log('\n色觉缺陷提示（1.10.0，审计建议 1）：红绿对在 deutan 下塌陷、中性对不误报')
{
  // 红/绿在 deutan 下会掉到几乎同色 —— 这是提示存在的理由
  const risky = Math.min(deltaE('#a03a2f', '#3f7a34', 'deutan'), deltaE('#a03a2f', '#3f7a34', 'protan'))
  risky < 12 ? ok(`红绿对在红绿色盲下 ΔE ${risky.toFixed(1)} < 12 → 会提示`) : fail(`红绿对 ΔE ${risky.toFixed(1)} 没塌，提示失去意义`)
  // 正常的暖砂自定义配色不该被误报
  const safe = Math.min(deltaE('#a9683e', '#f5efe6', 'deutan'), deltaE('#a9683e', '#f5efe6', 'protan'), deltaE('#a9683e', '#f5efe6', 'tritan'))
  safe >= 12 ? ok(`暖砂强调 vs 底色 ΔE ${safe.toFixed(1)} ≥ 12 → 不提示`) : fail(`暖砂强调 vs 底色 ΔE ${safe.toFixed(1)} 太低，会被误报`)
  // 四种语言的文案都在（防止只加中文）
  const src = readFileSync(path.join(here, '..', 'client.js'), 'utf8')
  const n = (src.match(/explainCvd:/g) || []).length
  n === 4 ? ok('四语种都有 explainCvd 文案') : fail(`explainCvd 文案只有 ${n} 种语言`)
  src.includes('explain.cvdRisk') ? ok('设置页有渲染分支') : fail('设置页缺 cvdRisk 渲染分支')
  // 「由主色派生」会覆盖手动设置的底色与文字 —— 这句说明必须是可见文本，不能只放 title
  const notes = (src.match(/deriveNote:/g) || []).length
  notes === 4 ? ok('四语种都有「派生会覆盖」的说明') : fail(`deriveNote 只有 ${notes} 种语言`)
  src.includes("className: 'dsh-tp-custom-note'") ? ok('面板里有可见的说明节点（不只是 title）') : fail('说明只挂在 title 上，用户看不到')
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
