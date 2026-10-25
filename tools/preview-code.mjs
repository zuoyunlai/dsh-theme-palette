#!/usr/bin/env node
/**
 * 语法高亮预览：用生产 buildTokens 生成 `--shiki-token-*`，渲染一段真实代码。
 *
 * 目的：在发版前肉眼确认"四个色族是否分得开、在代码块底上是否刺眼"。
 * 输出 tools/preview-code.html，随后可交给 tools/shoot-html.mjs 截图。
 *
 * 用法：node tools/preview-code.mjs [--palette warm] [--out preview-code]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const argv = process.argv.slice(2)
const pi = argv.indexOf('--palette')
const PALETTE = pi >= 0 ? argv[pi + 1] : 'warm'
const oi = argv.indexOf('--out')
const OUT = oi >= 0 ? argv[oi + 1] : 'preview-code'

const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
let engine = null
const win = {
  __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
  __DSH_THEME_PALETTE_DEV_REQUEST__: true,
  __DSH_THEME_PALETTE_DEV__: (api) => { engine = api },
}
new Function('window', 'localStorage', 'document', 'navigator', source)(
  win, { getItem: () => null, setItem: () => {} },
  { documentElement: { lang: 'zh-CN' } }, { language: 'zh' },
)
globalThis.__def.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => 'mono' }))
if (!engine) throw new Error('dev hook missing')

const { buildTokens, SCHEMES } = engine
const scheme = SCHEMES.find((s) => s.id === PALETTE) || SCHEMES[1]
const tk = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)

const CODE = [
  ['comment', '// 把背景色解成可读的前景'],
  ['keyword', 'const'],
  ['plain', ' accent '],
  ['punctuation', '='],
  ['plain', ' '],
  ['string', "'#a9683e'"],
  ['plain', '']
]
const LINES = [
  [['comment', '// 每个 token 都对代码块底求解到 4.6:1']],
  [['keyword', 'export function'], ['plain', ' '], ['function', 'solve'], ['punctuation', '('], ['parameter', 'background'], ['punctuation', ','], ['plain', ' '], ['parameter', 'target'], ['plain', ' '], ['punctuation', '='], ['plain', ' '], ['constant', '4.5'], ['punctuation', ')'], ['plain', ' {']],
  [['plain', '  '], ['keyword', 'let'], ['plain', ' '], ['plain', 'lightness'], ['plain', ' '], ['punctuation', '='], ['plain', ' '], ['constant', '0.45']],
  [['plain', '  '], ['keyword', 'while'], ['plain', ' '], ['punctuation', '('], ['function', 'contrast'], ['punctuation', '('], ['plain', 'fg'], ['punctuation', ','], ['plain', ' background'], ['punctuation', ')'], ['plain', ' '], ['punctuation', '<'], ['plain', ' target'], ['punctuation', ')'], ['plain', ' {']],
  [['plain', '    lightness '], ['punctuation', '-='], ['plain', ' '], ['constant', '0.004']],
  [['plain', '  '], ['punctuation', '}']],
  [['plain', '  '], ['keyword', 'return'], ['plain', ' '], ['function', 'fromOklch'], ['punctuation', '('], ['plain', 'lightness'], ['punctuation', ', '], ['plain', 'chroma'], ['punctuation', ', '], ['plain', 'hue'], ['punctuation', ')']],
  [['punctuation', '}']],
  [['plain', '']],
  [['keyword', 'export default'], ['plain', ' { '], ['plain', 'name'], ['punctuation', ':'], ['plain', ' '], ['string-expression', "'warm'"], ['punctuation', ','], ['plain', ' ratio'], ['punctuation', ':'], ['plain', ' '], ['constant', '5.70'], ['punctuation', ','], ['plain', ' ok'], ['punctuation', ':'], ['plain', ' '], ['constant', 'true'], ['plain', ' }']],
]

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const renderLine = (tokens) => tokens.map(([kind, text]) => {
  if (kind === 'plain') return esc(text)
  return `<span style="color:var(--shiki-token-${kind})">${esc(text)}</span>`
}).join('')

const panel = (mode, label) => {
  const vars = Object.entries(tk)
    .filter(([k]) => k.startsWith('--shiki-') || k === '--dshtp-code-fill')
    .map(([k, pair]) => `${k}:${pair[mode]}`)
    .join(';')
  return `<section class="panel ${mode}" style="${vars}">
  <div class="cap">${esc(label)}</div>
  <pre class="shiki css-variables" style="background-color:var(--shiki-background);color:var(--shiki-foreground)">${LINES.map(renderLine).join('\n')}</pre>
</section>`
}

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>语法高亮预览 · ${esc(scheme.label)}</title>
<style>
html,body{margin:0;background:#111;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.page{display:inline-block}
.wrap{display:flex;gap:16px;padding:16px;align-items:flex-start}
.panel{flex:1;min-width:0;border-radius:12px;padding:12px;background:${tk['--dsh-tp-bg'] ? 'transparent' : 'transparent'}}
.cap{font-size:12px;margin-bottom:8px;opacity:.7}
.light .cap{color:#555}.dark .cap{color:#bbb}
pre{margin:0;padding:14px 16px;border-radius:10px;font:13px/1.6 "SF Mono",Consolas,monospace;overflow:auto;white-space:pre}
</style></head><body><div class="page"><div class="wrap">
${panel('light', scheme.label + ' · 浅色')}
${panel('dark', scheme.label + ' · 深色')}
</div></div></body></html>`

const out = path.join(here, OUT + '.html')
fs.writeFileSync(out, html)
console.log('✓ ' + out)