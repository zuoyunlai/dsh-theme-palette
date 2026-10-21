/**
 * 生成配色看板 HTML（截图回归的"被测页面"）。
 *
 * 为什么需要它：插件的真实渲染在 DSH 的 Web GUI 里，而那个页面要鉴权 token，
 * 无头浏览器拿不到；但**配色系统本身的视觉回归**不需要整个 App —— 把每个 token
 * 渲染成真实的界面块（侧栏条目、气泡、按钮、开关、滚动条、正文层级），
 * 就足以发现"对比度掉了、色相反了、层级糊了"这类问题。
 *
 * 颜色全部来自 client.js 的生产引擎（经 __DSH_THEME_PALETTE_DEV__ 钩子），
 * 所以看板 = 上线配色的忠实投影，不是另画一套。
 *
 * 用法：node tools/sheet.mjs      → 生成 tools/sheet.html
 *      node tools/shoot.mjs       → 用无头 Chrome 截 4 张（每套配色一张，含明暗两版）
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
sandbox.def.factory(() => ({ createElement: () => null, useState: () => [null, () => {}], useSyncExternalStore: () => 'mono' }))
if (!engine) throw new Error('生产引擎没有暴露 dev 钩子')

const { buildTokens, SCHEMES } = engine

/** 宿主原值（黑白配色走宿主，缺的 token 用它兜底） */
const HOST = {
  light: {
    canvas: '#ffffff', card: '#f5f6f7', overlay: '#e9ecf2', sidebar: '#f9fafb', hover: '#f1f3f5', active: '#ebeef2',
    text: '#0f1115', secondary: '#61666b', tertiary: '#81858c', caption: '#adb2b8',
    link: '#4176e6', bubble: '#edf3fe', button: '#ec1313', switchOn: '#0f1115',
    scroll: '#e5e5e5', scrollHover: '#d4d4d4',
  },
  dark: {
    canvas: '#151517', card: '#2c2c2e', overlay: '#61666b', sidebar: '#1b1b1c', hover: '#2c2c2e', active: '#43454a',
    text: '#f9fafb', secondary: '#cfd3d6', tertiary: '#adb2b8', caption: '#81858c',
    link: '#7aaaff', bubble: '#2c2c2e', button: '#f9fafb', switchOn: '#f9fafb',
    scroll: '#3c3c3d', scrollHover: '#545557',
  },
}

/** 取某套配色在某模式下的界面色板（缺省回落到宿主值）。 */
const isDarkFallback = (h) => h.card

function palette(scheme, mode) {
  const t = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent')
  const pick = (name, fallback) => {
    const entry = t[name]
    return entry ? entry[mode] : fallback
  }
  // 注意：色阶 token 的 light/dark 两值是同一个（色阶本身与模式无关），
  // 真正的"深色画布"是**另一个步**（950 而不是 00）。所以按宿主的别名映射取步号。
  const steps = mode === 'dark'
    ? { canvas: '950', card: '850', overlay: '800', text: '50', secondary: '300', tertiary: '400' }
    : { canvas: '00', card: '60', overlay: '150', text: '1000', secondary: '700', tertiary: '600' }
  const stat = (step, fallback) => pick('--dsw-static-neutral-bluish-' + step, fallback)
  const h = HOST[mode]
  return {
    canvas: stat(steps.canvas, h.canvas),
    card: stat(steps.card, h.card),
    overlay: stat(steps.overlay, h.overlay),
    sidebar: pick('--dsw-specific-sidebar-fill', h.sidebar),
    hover: pick('--dsw-specific-sidebar-nav-item-hover', h.hover),
    active: pick('--dsw-specific-sidebar-nav-item-active', h.active),
    text: stat(steps.text, h.text),
    secondary: stat(steps.secondary, h.secondary),
    tertiary: stat(steps.tertiary, h.tertiary),
    caption: pick('--dsw-alias-label-caption', h.caption),
    link: pick('--dsw-alias-link', h.link),
    bubble: pick('--dsw-specific-bubble', h.bubble),
    button: pick('--dsw-alias-button-primary-fill', h.button),
    switchOn: pick('--dsw-alias-brand-primary', h.switchOn),
    scroll: stat('200', h.scroll),
    scrollHover: stat('300', h.scrollHover),
    code: pick('--dsh-code-fill', isDarkFallback(h)),
    codeInline: pick('--dsh-code-inline', h.card),
    picked: pick('--dsh-card-picked', h.card),
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function panel(scheme, mode) {
  const c = palette(scheme, mode)
  const isDark = mode === 'dark'
  const label = mode === 'dark' ? '深色' : '浅色'
  const bg = c.canvas
  const code = c.code
  return `
  <section class="panel" data-scheme="${scheme.id}" data-mode="${mode}" style="
      --canvas:${c.canvas}; --card:${c.card}; --sidebar:${c.sidebar}; --hover:${c.hover}; --active:${c.active};
      --text:${c.text}; --secondary:${c.secondary}; --tertiary:${c.tertiary}; --caption:${c.caption};
      --link:${c.link}; --bubble:${c.bubble}; --button:${c.button}; --switch:${c.switchOn};
      --scroll:${c.scroll}; --scrollHover:${c.scrollHover}; --picked:${c.picked}; --code:${c.code}; --codeInline:${c.codeInline};
      background:${bg};">
    <header>
      <b>${esc(scheme.label)}</b><span class="dim">${label}模式</span>
      <span class="hexes">画布 ${c.canvas} · 侧栏 ${c.sidebar} · 卡层 ${c.card} · 代码 ${c.code} · 气泡 ${c.bubble}</span>
    </header>

    <div class="frame">
      <aside class="col-side">
        <div class="brand">deepseek <b>HARNESS</b></div>
        <div class="new-chat">＋ 新会话</div>
        <div class="row active">论衡插件其他文类模板需求</div>
        <div class="row">定位错配审计-2026-10-20</div>
        <div class="row hover">行政国家理念跨国流动</div>
        <div class="row dim2">1 天前</div>
        <div class="section-label">工作区</div>
        <div class="row">论衡开发</div>
        <div class="scroll-track"><i></i></div>
      </aside>

      <main class="col-main">
        <div class="tabs"><span class="on">对话</span><span>轨迹</span><span>上下文</span><span>画廊</span></div>
        <h3>其余批次可以先做；B3/B4/B5 各自会改变判定结果</h3>
        <p class="body">正文示例：这段文字用来检查正文在画布上的可读性，以及它是否带上配色的色味。
          次级说明文字出现在这里，<span class="sec">像这样</span>；更弱的注释<span class="cap">（例如 13:17）</span>再弱一档。
          链接形如 <a>定位错配审计</a>，保证不丢锚点感。</p>
        <div class="bubble">主人发出的消息：这个对话条目的文字底色会不会太红？</div>
        <div class="card">
          <div class="card-title">定位错配审计-2026-10-20-人文社科长文-v1.md</div>
          <div class="card-desc">人文社科长文定位 × 论衡 v19.21.0 的错配审计</div>
        </div>
        <pre class="code">const theme = ctx.get('theme')
theme.overrideTokens('mine', { '--dsw-alias-link': { light, dark } })</pre>
        <div class="controls">
          <button class="btn">打开</button>
          <span class="chip">定题 1/1</span>
          <span class="chip ghost">检索 0/3</span>
          <span class="switch on"><i></i></span>
          <span class="switch"><i></i></span>
          <span class="state err">错误</span><span class="state warn">警告</span><span class="state ok">成功</span>
        </div>
      </main>
    </div>
  </section>`
}

const css = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#0a0a0a}
.page{width:720px;padding:16px;display:flex;flex-direction:column;gap:16px;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.panel{border-radius:14px;overflow:hidden;color:var(--text);font-size:13px;line-height:1.55;border:1px solid rgba(128,128,128,.25)}
.panel header{display:flex;align-items:baseline;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(128,128,128,.18)}
.panel header b{font-size:14px}
.panel .dim{opacity:.6;font-size:12px}
.hexes{margin-left:auto;font:11px/1.4 ui-monospace,Consolas,monospace;opacity:.55}
.frame{display:flex;min-height:330px}
.col-side{width:210px;background:var(--sidebar);padding:10px 8px;display:flex;flex-direction:column;gap:4px}
.brand{font-size:12px;font-weight:600;padding:2px 6px 8px;letter-spacing:.2px}
.new-chat{border:1px solid var(--hover);border-radius:9px;padding:7px 10px;text-align:center;font-size:12px;margin-bottom:6px}
.row{padding:6px 8px;border-radius:7px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.row.active{background:var(--active)}
.row.hover{background:var(--hover)}
.row.dim2{color:var(--tertiary);font-size:11px}
.section-label{color:var(--tertiary);font-size:11px;padding:8px 8px 2px}
.scroll-track{position:relative;flex:1;min-height:16px}
.scroll-track i{position:absolute;right:-6px;top:6px;bottom:6px;width:4px;border-radius:3px;background:var(--scroll)}
.col-main{flex:1;background:var(--canvas);padding:10px 14px;display:flex;flex-direction:column;gap:9px;min-width:0}
.tabs{display:flex;gap:14px;font-size:12px;color:var(--tertiary);border-bottom:1px solid var(--hover);padding-bottom:6px}
.tabs .on{color:var(--text);box-shadow:inset 0 -2px 0 var(--button)}
h3{margin:2px 0 0;font-size:15px;line-height:1.45;font-weight:600}
.body{margin:0;font-size:13px}
.sec{color:var(--secondary)}
.cap{color:var(--caption);font-size:12px}
a{color:var(--link);text-decoration:none;border-bottom:1px dotted color-mix(in srgb,var(--link) 60%,transparent)}
.bubble{align-self:flex-end;max-width:78%;background:var(--bubble);border-radius:14px;padding:9px 12px;font-size:12.5px;line-height:1.5}
.card{background:var(--card);border-radius:10px;padding:9px 11px;border:1px solid var(--hover)}
.card-title{font-size:12.5px}
.card-desc{color:var(--tertiary);font-size:11.5px;margin-top:2px}
.code{margin:0;background:var(--code);border-radius:9px;padding:9px 11px;font:11.5px/1.5 ui-monospace,Consolas,monospace;color:var(--secondary);white-space:pre-wrap}
.controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
.btn{background:var(--button);color:var(--canvas);border:0;border-radius:8px;padding:6px 14px;font:inherit;font-size:12px}
.chip{border:1px solid var(--hover);border-radius:999px;padding:2px 9px;font-size:11.5px;color:var(--secondary)}
.chip.ghost{border-style:dashed}
.switch{width:26px;height:14px;border-radius:999px;background:var(--hover);position:relative;display:inline-block}
.switch i{position:absolute;top:4px;left:4px;width:6px;height:6px;border-radius:50%;background:var(--card)}
.switch.on{background:var(--switchOn)}
.switch.on i{left:16px;background:var(--canvas)}
.state{font-size:11.5px;padding:1px 6px;border-radius:6px}
.state.err{color:#ef4444}.state.warn{color:#f59e0b}.state.ok{color:#22c55e}
`

const body = SCHEMES.map((s, i) => `
  <div class="view" data-i="${i + 1}">${panel(s, 'light')}${panel(s, 'dark')}</div>`).join('')

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>dsh-theme-palette · 配色看板</title>
<style>${css}
.view{display:none}
.view.on{display:flex;flex-direction:column;gap:16px}
</style></head>
<body><div class="page">${body}</div>
<script>
  // ?v=N 选第 N 套配色（默认 1）；每张截图含该套的浅色 + 深色两个面板
  const v = Number(new URLSearchParams(location.search).get('v') || 1)
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('on', Number(el.dataset.i) === v))
  document.documentElement.dataset.ready = '1'
</script></body></html>`

const out = path.join(here, 'sheet.html')
fs.writeFileSync(out, html)
console.log('✓ ' + out + '（' + Math.round(html.length / 1024) + ' KB，' + SCHEMES.length + ' 个视图）')
