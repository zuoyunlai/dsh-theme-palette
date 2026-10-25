#!/usr/bin/env node
/**
 * 导出 `dsh-dream-skin/pack` 格式的主题包（竞品差距 R5，单向）。
 *
 * 为什么只导出、不导入：
 *   pack 的 `manifest.tokens` 是**单模式、单值**的原始 token 表，导入它等于绕过本插件的
 *   对比度求解器直接覆盖颜色——那会摧毁本插件唯一的承诺。所以这里只做"把我们算好的
 *   明暗两套结果交出去"，让对方插件/工具可以使用；反向导入不在范围内。
 *
 * 格式来源（已核实）：
 *   https://github.com/RevolutionLA/dsh-dream-skin/blob/main/docs/examples/sample-theme-pack.json
 *   { format: 'dsh-dream-skin/pack', version: 1, manifest: { id, name, nameZh, author,
 *     version, colorScheme: 'light'|'dark', accent, tokens: { '--dsw-*': '#rrggbb' } } }
 *
 * 用法：node tools/export-theme-pack.mjs [--out dist/theme-packs]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const oi = argv.indexOf('--out')
const outDir = path.resolve(root, oi >= 0 ? argv[oi + 1] : 'dist/theme-packs')

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

let engine = null
const win = {
  __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
  __DSH_THEME_PALETTE_DEV_REQUEST__: true,
  __DSH_THEME_PALETTE_DEV__: (api) => { engine = api },
}
new Function('window', 'localStorage', 'document', 'navigator', source)(
  win,
  { getItem: () => null, setItem: () => {} },
  { documentElement: { lang: 'zh-CN' } },
  { language: 'zh' },
)
globalThis.__def.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => 'mono' }))
if (!engine) throw new Error('生产引擎没有暴露 dev 钩子')

const { buildTokens, SCHEMES, contrast, floors } = engine
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i
const MODES = ['light', 'dark']

fs.mkdirSync(outDir, { recursive: true })
const written = []
let failed = 0

for (const scheme of SCHEMES) {
  if (!scheme.tinted) continue // 黑白 = 宿主原值，导出它没有意义
  const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
  for (const mode of MODES) {
    const tokens = {}
    for (const [k, pair] of Object.entries(t)) {
      // 只导出字面量颜色；var(...) / inherit 这类间接值对方无法直接消费
      const v = pair && pair[mode]
      if (typeof v === 'string' && HEX.test(v)) tokens[k] = v
    }
    const bg = tokens['--dsw-static-neutral-bluish-' + (mode === 'light' ? '00' : '950')]
    const fg = tokens['--dsw-static-neutral-bluish-' + (mode === 'light' ? '1000' : '50')]
    const ratio = bg && fg ? contrast(fg, bg) : 0
    const F = floors(false)
    if (!(ratio >= F.main - 0.02)) {
      console.error(`  ✗ ${scheme.id}/${mode}: 正文对画布 ${ratio.toFixed(2)} < ${F.main}`)
      failed++
      continue
    }
    const pack = {
      format: 'dsh-dream-skin/pack',
      version: 1,
      manifest: {
        id: `dsh-theme-palette-${scheme.id}-${mode}`,
        name: `dsh-theme-palette · ${scheme.id} · ${mode}`,
        nameZh: `dsh-theme-palette · ${scheme.label} · ${mode === 'light' ? '浅色' : '深色'}`,
        author: 'zuoyunlai',
        version: pkg.version,
        colorScheme: mode,
        accent: tokens['--dsw-alias-link'] || tokens['--dsw-static-deepseek-500'] || '#4176e6',
        tokens,
      },
    }
    const file = path.join(outDir, `${pack.manifest.id}.json`)
    fs.writeFileSync(file, JSON.stringify(pack, null, 2) + '\n')
    written.push({ file: path.relative(root, file), tokens: Object.keys(tokens).length, ratio: Number(ratio.toFixed(2)) })
  }
}

for (const w of written) console.log(`  ✓ ${w.file}（${w.tokens} tokens，正文/画布 ${w.ratio}:1）`)
console.log(failed === 0 ? `\n导出 ${written.length} 个主题包 → ${outDir}` : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)