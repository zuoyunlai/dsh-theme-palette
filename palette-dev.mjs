/**
 * 配色报表（开发期）。
 *
 * 直接加载 client.js 的**生产引擎**（经 window.__DSH_THEME_PALETTE_DEV__ 这个开发期钩子），
 * 不保留第二份配色实现 —— 早先这份文件自带旧引擎，报表和上线不是同一套。
 *
 * 用法：node palette-dev.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, 'client.js'), 'utf8')

let engine = null
const sandbox = {
  window: {
    __ModuleLoader__: { load: (def) => { sandbox.__def = def } },
    __DSH_THEME_PALETTE_DEV__: (api) => { engine = api },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { documentElement: { lang: 'zh' } },
  navigator: { language: 'zh' },
}
new Function('window', 'localStorage', 'document', 'navigator', source)(
  sandbox.window, sandbox.localStorage, sandbox.document, sandbox.navigator,
)
sandbox.__def.factory(() => ({
  createElement: () => null,
  useState: () => [null, () => {}],
  useSyncExternalStore: () => 'mono',
}))
if (!engine) throw new Error('生产引擎没有暴露 dev 钩子')

const { buildTokens, SCHEMES, SIDEBAR_MODES, TEXT_MODES, contrast, toOklch } = engine

/** 真实承载面 → 落在该面上的前景。取自宿主 ui-theme 的别名映射。 */
const SURFACES = [
  { name: '画布 00', step: 'neutral-bluish-00', fg: ['1000', '700', '600', 'link500'] },
  { name: '卡层 60', step: 'neutral-bluish-60', fg: ['1000', '700', '600', 'link500'] },
  { name: '悬浮 150*', step: 'neutral-bluish-150', fg: ['600', 'link500'], scope: false },
  { name: '深画布 950', step: 'neutral-bluish-950', fg: ['50', '300', '400', 'link400'] },
  // 875 = bg-layer-1（弹层/抽屉），850 = bg-layer-2，800 = bg-layer-3 兼 bg-module-platform。
  // 三层都要报：文末的「承诺面」是这三个面里最亮的 800，不是画布。
  { name: '深层1 875', step: 'neutral-bluish-875', fg: ['50', '300', '400', 'link400'] },
  { name: '深卡 850', step: 'neutral-bluish-850', fg: ['50', '300', '400', 'link400'] },
  { name: '深模块 800', step: 'neutral-bluish-800', fg: ['50', '300', '400', 'link400'] },
]
// 合规下限：低于它才是违规（正文 AAA 7 / 次级与三级 AA 4.62）。
// '1000' 的 15.5 与 '700' 的 6.2 是设计目标，一并当硬线放在这里，因为浅色侧从来没破过。
const FLOOR = { '1000': 15.5, '700': 6.2, '600': 4.62, link500: 4.62, '50': 7, '300': 6, '400': 4.62, link400: 4.62 }
// 设计目标（高于 WCAG）：深色正文希望 ≥10。缺口只记 △，不算违规 ——
// 800 是最亮的深色面（layer-3 / module），正文在那里天然最低（8.95–9.56，仍是 AAA 7 的 1.3 倍）。
const TARGET = { '50': 10 }

// 链接报**实际渲染用的那条**（`--dsw-alias-link`），不是色阶中段：
// 中段 500 是设计稿给的标准色（品牌基准色），它在浅色 150 面上本来就过不了 AA，
// 插件已把「当文字用」的链接单独派生。若改用 static-500 报，会报出一个界面里不存在的数值。
const getter = (tokens) => (key) => {
  if (key === 'link500') return tokens['--dsw-alias-link'].light
  if (key === 'link400') return tokens['--dsw-alias-link'].dark
  const name = /^[0-9]+$/.test(key) ? `neutral-bluish-${key}` : key
  return tokens[`--dsw-static-${name}`].light
}

const lab = (hex) => {
  const [L, C, h] = toOklch(hex)
  return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]
}
const dE = (x, y) => {
  const [L1, a1, b1] = lab(x), [L2, a2, b2] = lab(y)
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2) * 100
}

let violations = 0
for (const scheme of SCHEMES) {
  if (!scheme.tinted) { console.log(`\n=== ${scheme.label} ===（未覆盖，走宿主原值）`); continue }
  const tokens = buildTokens(scheme, 'deep')
  const get = getter(tokens)
  console.log(`\n=== ${scheme.label} ===`)
  for (const surface of SURFACES) {
    const bg = get(surface.step)
    const parts = surface.fg.map((fg) => {
      const ratio = contrast(get(fg), bg)
      const ok = surface.scope === false ? true : ratio >= FLOOR[fg]
      if (!ok) violations++
      const short = ok && TARGET[fg] !== undefined && ratio < TARGET[fg]
      return `${fg} ${ratio.toFixed(2)}${ok ? (short ? ' △' : '') : ' ✗'}`
    })
    console.log(`  ${surface.name.padEnd(12)} ${bg}  ${parts.join('  ')}`)
  }

  console.log('  品牌基准色 / 链接')
  {
    const anchor = tokens['--dsw-static-deepseek-500'].light
    const rgb = 'rgb(' + [1, 3, 5].map((i) => parseInt(anchor.slice(i, i + 2), 16)).join(', ') + ')'
    const lk = tokens['--dsw-alias-link']
    console.log(`    基准色 500 ${anchor} ${rgb}（卡片预览 / info 填充 / 焦点环）`
      + `  白字对比 ${contrast('#ffffff', anchor).toFixed(2)}`)
    console.log(`    链接 浅 ${lk.light}  对 150 ${contrast(lk.light, get('neutral-bluish-150')).toFixed(2)}`
      + ` / 卡层 ${contrast(lk.light, get('neutral-bluish-60')).toFixed(2)}`
      + `  | 深 ${lk.dark}  对 800 ${contrast(lk.dark, get('neutral-bluish-800')).toFixed(2)}`)
  }

  console.log('  侧栏三档（ΔE：画布↔侧栏 / 悬停 / 选中）')
  for (const mode of SIDEBAR_MODES) {
    const tk = buildTokens(scheme, mode.id)
    const fill = tk['--dsw-specific-sidebar-fill'].light
    const hov = tk['--dsw-specific-sidebar-nav-item-hover'].light
    const act = tk['--dsw-specific-sidebar-nav-item-active'].light
    const dFill = tk['--dsw-specific-sidebar-fill'].dark
    const dHov = tk['--dsw-specific-sidebar-nav-item-hover'].dark
    const dAct = tk['--dsw-specific-sidebar-nav-item-active'].dark
    const canvas = get('neutral-bluish-00')
    const dCanvas = get('neutral-bluish-950')
    const mark = mode.id === 'deep' ? ' ←默认' : ''
    console.log(`    ${mode.label}  浅 ${fill} / ${hov} / ${act}  ΔE ${dE(canvas, fill).toFixed(2)}/${dE(fill, hov).toFixed(2)}/${dE(fill, act).toFixed(2)}${mark}`)
    console.log(`    ${''.padEnd(mode.label.length)}  深 ${dFill} / ${dHov} / ${dAct}  ΔE ${dE(dCanvas, dFill).toFixed(2)}/${dE(dFill, dHov).toFixed(2)}/${dE(dFill, dAct).toFixed(2)}`)
  }
}

console.log(`\n低于下限的配对：${violations} 处`)
console.log(`侧栏档位：${SIDEBAR_MODES.map((m) => m.label).join(' / ')}`)

console.log('\n文字着色三档')
for (const scheme of SCHEMES) {
  if (!scheme.tinted) continue
  console.log(`  ${scheme.label}`)
  for (const mode of TEXT_MODES) {
    const t = buildTokens(scheme, 'deep', mode.id)
    const g = (k) => t[`--dsw-static-${k}`].light
    const cL = (fg, bg) => contrast(g(fg), g(bg)).toFixed(2)
    console.log(`    ${mode.label.padEnd(4)} 正文 ${g('neutral-bluish-1000')}  次文 ${g('neutral-bluish-700')}`
      + `  深正文 ${g('neutral-bluish-50')}`
      + `  | 正文 ${cL('neutral-bluish-1000', 'neutral-bluish-00')}`
      + `  三级 ${cL('neutral-bluish-600', 'neutral-bluish-60')}`
      + `  深正文 ${cL('neutral-bluish-50', 'neutral-bluish-950')}`)
  }
}
