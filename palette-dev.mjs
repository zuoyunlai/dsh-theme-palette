/**
 * 配色报表 / 硬门（开发期）。
 *
 * 直接加载 client.js 的**生产引擎**（经 window.__DSH_THEME_PALETTE_DEV__ 这个开发期钩子），
 * 不保留第二份配色实现。阈值也来自生产 `floors()`，不再另写一套 15.5/6.2。
 *
 * 输出三列含义：
 *   实际  — 生成 token 的实测对比度
 *   目标  — 生产下限（标准或 --hc）
 *   可达  — 该承载面上纯黑/纯白能达到的上限；目标高于它时标「表面受限」，
 *          这是表面亮度问题，不是求解器能修的，因此不计入硬失败。
 *
 * 用法：
 *   node palette-dev.mjs          # 标准档
 *   node palette-dev.mjs --hc     # 高对比档
 * 有硬失败时退出码 1（可直接当 CI 门）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, 'client.js'), 'utf8')
const HC = process.argv.indexOf('--hc') !== -1

let engine = null
const sandbox = {
  window: {
    __ModuleLoader__: { load: (def) => { sandbox.__def = def } },
    __DSH_THEME_PALETTE_DEV__: (api) => { engine = api },
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: { documentElement: { lang: 'zh' } },
  navigator: { language: 'zh' },
  location: { search: '?dshThemeDev=1' },
}
new Function('window', 'localStorage', 'document', 'navigator', 'location', source)(
  sandbox.window, sandbox.localStorage, sandbox.document, sandbox.navigator, sandbox.location,
)
sandbox.__def.factory(() => ({
  createElement: () => null,
  useState: () => [null, () => {}],
  useSyncExternalStore: () => 'mono',
}))
if (!engine) throw new Error('生产引擎没有暴露 dev 钩子')

const { buildTokens, SCHEMES, SIDEBAR_MODES, TEXT_MODES, contrast, toOklch, floors, CONTRAST_SURFACES, CONTRAST_ROLES } = engine
const F = floors(HC)
const roleFloor = (role) => (F[role] === undefined ? F.link : F[role])

// 承载面与角色来自 client.js 的唯一定义（CONTRAST_SURFACES / CONTRAST_ROLES），
// 本文件不再自带第二份清单——设置页 UI 读数与这份报表用的是同一套口径。
const MODE_NAME = { light: '浅', dark: '深' }
const SURFACES = CONTRAST_SURFACES.map((sf) => ({
  ...sf,
  name: `${MODE_NAME[sf.mode]}·${sf.id}${sf.scope === false ? '*' : ''}`,
  // 150 只作为图标/悬浮底出现，未发现正文用法：报表只列 tertiary/link，避免制造无关噪声
  fgs: Object.fromEntries(
    CONTRAST_ROLES
      .filter((r) => sf.scope !== false || r.id === 'tertiary' || r.id === 'link')
      .map((r) => [r.id, r.step[sf.mode]]),
  ),
}))

const get = (tokens, mode, key) => (key === 'link'
  ? tokens['--dsw-alias-link'][mode]
  : tokens[`--dsw-static-neutral-bluish-${key}`][mode])

const lab = (hex) => {
  const [L, C, h] = toOklch(hex)
  return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]
}
const dE = (x, y) => {
  const [L1, a1, b1] = lab(x), [L2, a2, b2] = lab(y)
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2) * 100
}

let violations = 0
let limited = 0
for (const scheme of SCHEMES) {
  if (!scheme.tinted) { console.log(`\n=== ${scheme.label} ===（未覆盖，走宿主原值）`); continue }
  const tokens = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', HC)
  console.log(`\n=== ${scheme.label}${HC ? ' · 高对比' : ''} ===`)
  for (const surface of SURFACES) {
    const bg = get(tokens, surface.mode, surface.id)
    const ceiling = contrast(surface.mode === 'light' ? '#000000' : '#ffffff', bg)
    const parts = Object.entries(surface.fgs).map(([role, key]) => {
      const ratio = contrast(get(tokens, surface.mode, key), bg)
      const target = roleFloor(role)
      // 承诺本身可达成 → 按承诺；承诺高于该面上限 → 按该面可达上限（93% 留出色彩余量）
      const isLimited = ceiling < target / 0.93
      const feasible = isLimited ? ceiling * 0.93 : target
      const ok = surface.scope === false ? true : ratio >= feasible
      if (!ok) violations++
      if (isLimited) limited++
      const mark = ok ? (isLimited ? ' △表面上限' : '') : ' ✗'
      const targetText = isLimited ? `${feasible.toFixed(2)}≤${target}` : String(target)
      return `${key} ${ratio.toFixed(2)}/${targetText}${mark}`
    })
    console.log(`  ${surface.name.padEnd(11)} ${bg}  ${parts.join('  ')}`)
  }

  console.log('  品牌基准色 / 链接')
  {
    const anchor = tokens['--dsw-static-deepseek-500'].light
    const lk = tokens['--dsw-alias-link']
    console.log(`    基准色 500 ${anchor}（卡片预览 / info 填充 / 焦点环）`
      + `  白字对比 ${contrast('#ffffff', anchor).toFixed(2)}`)
    console.log(`    链接 浅 ${lk.light}  对 150 ${contrast(lk.light, get(tokens, 'light', '150')).toFixed(2)}`
      + ` / 卡层 ${contrast(lk.light, get(tokens, 'light', '60')).toFixed(2)}`
      + `  | 深 ${lk.dark}  对 800 ${contrast(lk.dark, get(tokens, 'dark', '800')).toFixed(2)}`)
    console.log(`    注释 浅 ${tokens['--dsw-alias-label-caption'].light}`
      + `  | 深 ${tokens['--dsw-alias-label-caption'].dark}`
      + `  对 800 ${contrast(tokens['--dsw-alias-label-caption'].dark, get(tokens, 'dark', '800')).toFixed(2)}`
      + ` / 对 850 ${contrast(tokens['--dsw-alias-label-caption'].dark, get(tokens, 'dark', '850')).toFixed(2)}`)
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
    const canvas = get(tokens, 'light', '00')
    const dCanvas = get(tokens, 'dark', '950')
    const mark = mode.id === 'deep' ? ' ←默认' : ''
    console.log(`    ${mode.label}  浅 ${fill} / ${hov} / ${act}  ΔE ${dE(canvas, fill).toFixed(2)}/${dE(fill, hov).toFixed(2)}/${dE(fill, act).toFixed(2)}${mark}`)
    console.log(`    ${''.padEnd(mode.label.length)}  深 ${dFill} / ${dHov} / ${dAct}  ΔE ${dE(dCanvas, dFill).toFixed(2)}/${dE(dFill, dHov).toFixed(2)}/${dE(dFill, dAct).toFixed(2)}`)
  }
}

console.log(`\n硬失败：${violations} 处；表面受限（目标高于该面可达上限）：${limited} 处`)
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

if (violations > 0) process.exitCode = 1
