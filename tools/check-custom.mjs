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
const { buildTokens, SCHEMES, contrast } = globalThis.__api
const custom = SCHEMES.find((s) => s.id === 'custom')

const ACCENTS = ['#2f6fd0', '#a9683e', '#4f7a42']
const CUSTOM_KEY = 'dsh-theme-palette.custom.v1'
const rows = []
for (const accent of ACCENTS) {
  store.set(CUSTOM_KEY, JSON.stringify({ bg: '#f5efe6', text: '#1d1a17', accent }))
  const t = buildTokens(custom, 'deep', 'tinted', 'sidebar', 'accent', 'accent', 'on', false)
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

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
