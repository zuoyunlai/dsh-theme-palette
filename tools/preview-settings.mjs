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
const argv = process.argv.slice(2)
const li = argv.indexOf('--lang')
const LANG = li >= 0 ? argv[li + 1] : 'auto'   // auto | zh-CN | zh-TW | en | ja
const pi = argv.indexOf('--palette')
const PALETTE = pi >= 0 ? argv[pi + 1] : 'warm'   // mono | warm | indigo | moss | custom
const wi = argv.indexOf('--width')
// 真机设置页内容宽 = min(800, vw-48) - 236；桌面默认 564。默认按真机宽渲染，避免"预览比真机宽 21%"
const CONTENT_W = wi >= 0 ? Number(argv[wi + 1]) : 564
const ai = argv.indexOf('--adv')
const ADV = ai >= 0 ? argv[ai + 1] !== '0' : false   // 默认折叠，与真机一致
// 一次性升级提示默认只在"已有配置的老用户"出现；出图时用 --notice 强制显示
const ni = argv.indexOf('--notice')
const NOTICE = ni >= 0 ? argv[ni + 1] !== '0' : false
// --hc：强制高对比档（用于高对比截图）
const hi = argv.indexOf('--hc')
const HC = hi >= 0 && argv[hi + 1] !== '0'
// --out <basename>：自定义输出前缀，便于一次出多张不同构型的图
const oi = argv.indexOf('--out')
const OUT_BASE = oi >= 0 ? argv[oi + 1] : ''
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

let engine = null
const sandbox = {
  window: {
    __ModuleLoader__: { load: (d) => { sandbox.def = d } },
    __DSH_THEME_PALETTE_DEV__: (api) => { engine = api },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { head: { appendChild() {} }, createElement: () => ({ dataset: {}, remove() {} }), querySelector: () => null, documentElement: { lang: LANG === 'auto' ? 'zh-CN' : LANG } },
  navigator: { language: 'zh' },
  location: { search: '?dshThemeDev=1' },
}
new Function('window', 'localStorage', 'document', 'navigator', 'location', source)(
  sandbox.window, sandbox.localStorage, sandbox.document, sandbox.navigator, sandbox.location,
)
const React = {
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (v) => (typeof v === 'boolean' ? [ADV, () => {}] : [v, () => {}]),
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
      // React 的 style 对象是 camelCase；预览是静态 HTML，必须转成 kebab-case，
      // 否则 flexDirection 这类属性会被浏览器整条忽略（布局看起来"没生效"）
      const kebab = (k) => k.replace(/^--/, '--').replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
      attrs.push(`style="${Object.entries(v).map(([sk, sv]) => `${kebab(sk)}:${esc(sv)}`).join(';')}"`)
    } else if (k === 'value') attrs.push(`value="${esc(v)}"`)
    else if (k === 'placeholder') attrs.push(`placeholder="${esc(v)}"`)
    else if (k === 'readOnly' && v) attrs.push('readonly')
    else if (k === 'lang') attrs.push(`lang="${esc(v)}"`)
    else if (k === 'id') attrs.push(`id="${esc(v)}"`)
    else if (k === 'scope') attrs.push(`scope="${esc(v)}"`)
    else if (k === 'title') attrs.push(`title="${esc(v)}"`)
    else if (k.startsWith('aria-') || k === 'role' || k === 'type') attrs.push(`${k}="${esc(v)}"`)
    // data-* 原样透传：对比度矩阵靠 data-role / data-surface 做机器可读断言
    else if (k.startsWith('data-')) attrs.push(`${k}="${esc(v)}"`)
  }
  if (VOID.has(type)) return `<${type} ${attrs.join(' ')}>`
  return `<${type}${attrs.length ? ' ' + attrs.join(' ') : ''}>${(kids || []).map(toHtml).join('')}</${type}>`
}

const { buildTokens, cardColors } = engine
const scheme = engine.SCHEMES.find((s) => s.id === PALETTE) || engine.SCHEMES.find((s) => s.id === 'warm')

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
      '--dshtp-card-picked': pick('--dshtp-card-picked', h.card),
    },
  }
}

const props = {
  getCurrent: () => PALETTE,
  subscribe: () => () => {}, setPalette: () => {},
  getSidebarMode: () => 'deep', subscribeSidebar: () => () => {}, setSidebarMode: () => {},
  getTextMode: () => 'tinted', subscribeText: () => () => {}, setTextMode: () => {},
  getRightbarMode: () => 'sidebar', subscribeRightbar: () => () => {}, setRightbarMode: () => {},
  getScrollMode: () => 'tinted', subscribeScroll: () => () => {}, setScrollMode: () => {},
  getControlMode: () => 'accent', subscribeControl: () => () => {}, setControlMode: () => {},
  getMdMode: () => 'on', subscribeMd: () => () => {}, setMdMode: () => {},
  getHcMode: () => (HC ? 'on' : 'off'), subscribeHc: () => () => {}, setHcMode: () => {},
  getConfigCode: () => 'dshs1.eyJ2IjoxLCJwIjoid2FybSIsInMiOiJkZWVwIiwidCI6InRpbnRlZCIsInIiOiJzaWRlYmFyIiwiYyI6InRpbnRlZCIsImsiOiJhY2NlbnQiLCJtIjoib24iLCJoIjoib2ZmIiwibCI6ImF1dG8ifQ',
  applyConfigCode: () => true,
  getCustomColors: () => ({ bg: '#f5efe6', text: '#1d1a17', accent: process.env.PREVIEW_ACCENT || '#a9683e' }),
  subscribeCustom: () => () => {},
  // 静态预览用一份固定的对比度矩阵（真实值由 check-ui 的 --hc 对比断言覆盖）
  getContrastReport: () => {
    const rows = ['main', 'secondary', 'tertiary', 'link'].map((role) => ({
      role,
      cells: ['00', '60', '150', '950', '875', '850', '800'].map((surface, i) => {
        const light = i < 3
        // 高对比应当读数更高（更严的目标），不要造出"开了高对比反而更低"的假数据
        const ratio = HC ? 10.9 - i * 0.6 : 9.8 - i * 0.5
        const claim = HC ? 15 : 12
        const limited = surface === '800' || surface === '850'
        return {
          surface, mode: light ? 'light' : 'dark', scope: surface !== '150',
          ratio: Math.round(ratio * 100) / 100, claim, limited,
          ok: true,
        }
      }),
    }))
    return { hc: HC, mono: false, rows }
  },
  getCustomExplain: () => ({
    accentClamped: false, accentFrom: 0.58, accentTo: 0.58,
    linkShifted: true, linkRatio: 4.7, linkTarget: 4.62,
  }),
  previewConfigCode: (code) => ({
    ok: true,
    config: {
      palette: 'warm', sidebar: 'deep', text: 'tinted', rightbar: 'sidebar',
      scroll: 'tinted', control: 'accent', md: 'on', hc: 'off', lang: 'auto',
      custom: { bg: '#f5efe6', text: '#1d1a17', accent: '#a9683e' },
    },
  }),
  subscribeNotice: () => () => {},
  getNoticePending: () => NOTICE || process.env.PREVIEW_NOTICE === '1',
  dismissNotice: () => {},
  getSampleCode: () => 'dshs1.eyJ2IjoxLCJwIjoiY3VzdG9tIiwicyI6ImRlZXAiLCJ0IjoidGludGVkIiwiciI6InNpZGViYXIiLCJjIjoidGludGVkIiwiayI6ImFjY2VudCIsIm0iOiJvbiIsImgiOiJvZmYiLCJsIjoiemgtQ04iLCJ4Ijp7ImJnIjoiI2Y1ZWZlNiIsInRleHQiOiIjMWQxYTE3IiwiYWNjZW50IjoiIzNmNjZhMyJ9fQ',
  resetCustom: () => {},
  getLangPref: () => (LANG === 'auto' ? 'auto' : LANG), getLocale: () => (LANG === 'auto' ? 'zh-CN' : LANG),
  subscribeLocale: () => () => {}, setLangPref: () => {},
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
.page{width:${CONTENT_W + 56}px;padding:16px}
.wrap{padding:18px;border-radius:16px;border:1px solid rgba(128,128,128,.3);background:${canvas};${style};color:var(--dsw-alias-label-primary)}
</style><style>${engine.settingsCss}</style></head>
<body${dark}><div class="page"><div class="wrap">${toHtml(body)}</div></div></body></html>`
  // OUT_BASE 是裸名（不带横线）；默认后缀自带横线。两者都归一成"无前导横线"再拼接，
  // 避免出现 preview-light--custom.html 这类双横线文件名。
  const raw = OUT_BASE || `${PALETTE === 'warm' ? '' : PALETTE}${LANG === 'auto' ? '' : LANG}`
  const suffix = raw.replace(/^-+/, '')
  const out = path.join(here, `preview-${mode}${suffix ? '-' + suffix : ''}.html`)
  fs.writeFileSync(out, html)
  console.log('✓ ' + out + '（' + Math.round(html.length / 1024) + ' KB）')
}
