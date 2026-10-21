/**
 * 把插件设置页渲染成静态 HTML（浅色 + 深色两块），用于**看板级别的视觉检查**。
 * 组件本身是 React 元素树；这里用一个极小的树→HTML 渲染器把它铺开，
 * 样式取自插件真正注入的 SETTINGS_CSS（经 dev 钩子拿到），token 由生产引擎按模式算出。
 *
 * 用法：node tools/preview-settings.mjs   → tools/preview.html
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

let engine = null
const sandbox = {
  window: {
    __ModuleLoader__: { load: (d) => { sandbox.def = d } },
    __DSH_THEME_PALETTE_DEV__: (api) => { engine = api },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { head: { appendChild() {} }, createElement: () => ({ dataset: {}, remove() {} }), querySelector: () => null, documentElement: { lang: 'zh' } },
  navigator: { language: 'zh' },
}
new Function('window', 'localStorage', 'document', 'navigator', source)(
  sandbox.window, sandbox.localStorage, sandbox.document, sandbox.navigator,
)
const React = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (v) => (typeof v === 'boolean' ? [true, () => {}] : [v, () => {}]),
  useSyncExternalStore: (sub, get) => get(),
}
const plugin = sandbox.def.factory(() => React)

let section = null
const ctx = {
  get: (n) => (n === 'theme' ? { overrideTokens: () => () => {}, getTheme: () => ({ preference: 'light' }), setTheme: () => {} } : undefined),
  effect: (f) => { const d = f(); return d || (() => {}) },
  on: () => () => {},
  inject: () => {},
  slots: { inject: (n, fn) => fn(), register: (o, C) => { section = C; return () => {} } },
}
plugin.apply(ctx)
if (!section || !engine) throw new Error('拿不到设置页组件或引擎')

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const VOID = new Set(['br', 'img', 'input', 'hr'])

function toHtml(node) {
  if (node == null || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (Array.isArray(node)) return node.map(toHtml).join('')
  const { type, props, kids } = node
  if (typeof type === 'function') return toHtml(type({ ...props, ...props.kids }))
  const attrs = []
  for (const [k, v] of Object.entries(props)) {
    if (v == null || k === 'kids' || k === 'children') continue
    if (k === 'className') attrs.push(`class="${esc(v)}"`)
    else if (k === 'style' && typeof v === 'object') {
      attrs.push(`style="${Object.entries(v).map(([sk, sv]) => `${sk}:${esc(sv)}`).join(';')}"`)
    } else if (k.startsWith('aria-') || k === 'role' || k === 'type') attrs.push(`${k}="${esc(v)}"`)
  }
  if (VOID.has(type)) return `<${type} ${attrs.join(' ')}>`
  return `<${type}${attrs.length ? ' ' + attrs.join(' ') : ''}>${(kids || []).map(toHtml).join('')}</${type}>`
}

const { buildTokens, cardColors } = engine
const scheme = engine.SCHEMES.find((s) => s.id === 'warm')

/** 一个模式下设置页会用到的 token → CSS 变量 */
function vars(mode) {
  const t = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on')
  const pick = (name, fallback) => (t[name] ? t[name][mode] : fallback)
  const stat = (step, fallback) => pick('--dsw-static-neutral-bluish-' + step, fallback)
  const h = mode === 'dark'
    ? { canvas: '#151517', card: '#2c2c2e', text: '#f9fafb', sec: '#cfd3d6', ter: '#adb2b8' }
    : { canvas: '#ffffff', card: '#f5f6f7', text: '#0f1115', sec: '#61666b', ter: '#81858c' }
  const steps = mode === 'dark'
    ? { canvas: '950', card: '850', text: '50', sec: '300', ter: '400' }
    : { canvas: '00', card: '60', text: '1000', sec: '700', ter: '600' }
  return {
    canvas: stat(steps.canvas, h.canvas),
    card: stat(steps.card, h.card),
    vars: {
      '--dsw-alias-label-primary': stat(steps.text, h.text),
      '--dsw-alias-label-secondary': stat(steps.sec, h.sec),
      '--dsw-alias-label-tertiary': stat(steps.ter, h.ter),
      '--dsw-alias-border-l2': mode === 'dark' ? '#ffffff1f' : '#0000001a',
      '--dsw-alias-border-l4': mode === 'dark' ? '#ffffff33' : '#00000029',
      '--dsw-alias-interactive-bg-hover': mode === 'dark' ? '#f9fafb14' : '#12110f0f',
      '--dsw-alias-bg-layer-1': stat(steps.card, h.card),
      '--dsw-alias-bg-module-platform': stat(mode === 'dark' ? '800' : '60', h.card),
      '--dsw-alias-state-error-primary': '#ef4444',
      '--dsh-card-picked': pick('--dsh-card-picked', h.card),
    },
  }
}

const props = {
  getCurrent: () => scheme.id,
  subscribe: () => () => {}, setPalette: () => {},
  getSidebarMode: () => 'deep', subscribeSidebar: () => () => {}, setSidebarMode: () => {},
  getTextMode: () => 'tinted', subscribeText: () => () => {}, setTextMode: () => {},
  getRightbarMode: () => 'sidebar', subscribeRightbar: () => () => {}, setRightbarMode: () => {},
  getScrollMode: () => 'tinted', subscribeScroll: () => () => {}, setScrollMode: () => {},
  getControlMode: () => 'accent', subscribeControl: () => () => {}, setControlMode: () => {},
  getMdMode: () => 'on', subscribeMd: () => () => {}, setMdMode: () => {},
  getHealth: () => ({ ok: true, checked: 5 }), subscribeHealth: () => () => {},
}

const body = section(props)
// 深色必须靠 body 上的属性切换（生产环境正是 `body[data-ds-dark-theme]`），
// 所以明暗各出一个文件，而不是一页放两块。
for (const mode of ['light', 'dark']) {
  const { canvas, vars: vv } = vars(mode)
  const style = Object.entries(vv).map(([k, v]) => `${k}:${v}`).join(';')
  const dark = mode === 'dark' ? ' data-ds-dark-theme' : ''
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>设置页预览 · ${mode}</title><style>
html,body{margin:0;background:#0a0a0a;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.page{width:720px;padding:16px}
.wrap{padding:18px;border-radius:16px;border:1px solid rgba(128,128,128,.3);background:${canvas};${style};color:var(--dsw-alias-label-primary)}
</style><style>${engine.settingsCss}</style></head>
<body${dark}><div class="page"><div class="wrap">${toHtml(body)}</div></div></body></html>`
  const out = path.join(here, `preview-${mode}.html`)
  fs.writeFileSync(out, html)
  console.log('✓ ' + out + '（' + Math.round(html.length / 1024) + ' KB）')
}
