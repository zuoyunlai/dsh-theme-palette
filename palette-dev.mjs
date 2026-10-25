/**
 * 配色报表 / 硬门（开发期）。
 *
 * 直接加载 client.js 的**生产引擎**（经 window.__DSH_THEME_PALETTE_DEV__ 这个开发期钩子），
 * 不保留第二份配色实现。
 *
 * 1.9.8 起，报表口径只有一处：client.js 的 buildContrastReport / devContrastReport。
 * 本文件只负责**打印与汇总**，不再自己算目标、截断目标、拼物理上限：
 *   实测     measured        —— 生产引擎实测值
 *   声明目标 declaredTarget  —— 政策承诺值（普通档 12/6.2/4.62/4.62，深色正文 10；
 *                              HC 档 15/9/7/7）
 *   物理上限 physicalCeiling —— 纯计算（该承载面上黑/白前景能达到的对比度）；
 *                              **不含** 0.93 求解余量（余量只体现在 feasibleTarget）
 *   分类                     —— 达标 / 未达标 / 政策外 / 物理不可达 / 参考面 / 未覆盖
 *   结论                     —— 是否计入达标统计、是否算硬失败
 *
 * 硬门只有一条：pass === false（未达标）→ 退出码 1。
 * 政策外（深色正文在 800 / 850）**既不算达标也不算失败**；
 * 未覆盖（黑白配色不覆盖承载面）同样不算失败。
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

const {
  buildTokens, SCHEMES, SIDEBAR_MODES, TEXT_MODES, RIGHTBAR_MODES, MD_MODES,
  SCROLL_MODES, CONTROL_MODES, contrast, toOklch, flatten,
  devContrastReport, buildContrastReport, CONTRAST_SURFACES, CONTRAST_FLOOR, CONTRAST_SOLVER_MARGIN,
} = engine

/* ---------- 显示辅助 ---------- */

// 中文按两列宽排版：直接用 String.padEnd 会错位。
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
const dwidth = (s) => {
  let n = 0
  for (const ch of String(s)) n += WIDE.test(ch) ? 2 : 1
  return n
}
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - dwidth(s)))
const num = (v) => {
  if (v === null || v === undefined) return '—'
  const r = Math.round(v * 100) / 100
  return Object.is(r, -0) ? '0' : String(r)
}

// 侧栏三档的 ΔE（参考读数用，与对比度模型无关）
const lab = (hex) => {
  const [L, C, h] = toOklch(hex)
  return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]
}
const dE = (x, y) => {
  const [L1, a1, b1] = lab(x), [L2, a2, b2] = lab(y)
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2) * 100
}

const ROLE_LABEL = { main: '正文', secondary: '次级', tertiary: '三级', link: '链接' }
const EXEMPT_LABEL = { 'module-surface': '模块面', 'sub-surface': '次级深面' }
const MODE_LABEL = { light: '浅', dark: '深' }
const SURFACE_META = new Map(CONTRAST_SURFACES.map((sf) => [sf.id, sf]))
const surfaceLabel = (id, mode) => {
  const sf = SURFACE_META.get(id)
  return `${MODE_LABEL[mode] || mode}·${(sf && sf.label) || id}`
}

/**
 * 分类：把「政策外」和「物理不可达」彻底分开。
 *
 * 优先级（先到先得，一格只归一类）：
 *   未覆盖   — 承载面没被覆盖（黑白配色），拿不到读数
 *   参考面   — scope=false（150 / menuL / menuD）：只作参考，不计硬门
 *   政策外   — policyApplicable=false 且不是参考面（深色正文在 800 / 850）：
 *              **不承诺**，既不算达标也不算失败；不是「物理上做不到」
 *   物理不可达 — 声明目标真的高于该承载面的物理上限
 *   达标 / 未达标 — 承诺范围内的结论
 */
function classify(cell) {
  if (cell.unmeasured) return { cat: '未覆盖', mark: '—' }
  if (cell.exemptReason === 'surface-scope') return { cat: '参考面', mark: '○' }
  if (cell.exemptReason) return { cat: '政策外', mark: '○' }
  if (cell.limitedByPhysics) return { cat: '物理不可达', mark: '△' }
  if (cell.pass === true) return { cat: '达标', mark: '✓' }
  if (cell.pass === false) return { cat: '未达标', mark: '✗' }
  return { cat: '参考面', mark: '○' }
}

/** 结论：这一格在统计里算什么。 */
function verdict(cell, cls) {
  switch (cls.cat) {
    case '未覆盖':
      return '未覆盖 · 不计硬门'
    case '参考面':
      return '参考面 · 不计硬门'
    case '政策外': {
      const why = EXEMPT_LABEL[cell.exemptReason] || cell.exemptReason
      let out = `政策外（${why}）· 不计达标 · 不算失败`
      // 政策外不等于物理不可达；但 HC 档下 800/850 的声明目标也可能真的超上限，
      // 这时把两件事分开写清楚，不把政策外读成「表面受限」。
      if (cell.limitedByPhysics) out += ` · 目标 ${num(cell.declaredTarget)} > 上限 ${num(cell.physicalCeiling)}`
      return out
    }
    case '物理不可达':
      return cell.pass === true
        ? `物理不可达 · 按上限×${CONTRAST_SOLVER_MARGIN}=${num(cell.feasibleTarget)} 判定 · 计入达标`
        : `物理不可达 · ✗ 未达标（硬失败）`
    case '达标':
      return '计入达标'
    case '未达标':
      return '✗ 未达标（硬失败）'
    default:
      return '—'
  }
}

const COLS = [
  { title: '承载面', w: 9 },
  { title: '角色', w: 5 },
  { title: '实测', w: 6 },
  { title: 'Lc', w: 6 },
  { title: '声明目标', w: 8 },
  { title: '物理上限', w: 8 },
  { title: '分类', w: 10 },
  { title: '结论', w: 0 },
]
const header = '  ' + COLS.map((c, i) => pad(c.title, c.w)).join('  ').replace(/\s+$/, '')

/* ---------- 主循环 ---------- */

const total = {
  passed: 0, failed: 0, exempt: 0, policyExempt: 0, scopeExempt: 0,
  unmeasured: 0, floorViolations: 0, physicallyLimited: 0,
}
let hardFailures = 0

for (const scheme of SCHEMES) {
  const report = devContrastReport(scheme.id, { hc: HC })
  const title = `=== ${scheme.label}${HC ? ' · 高对比' : ''} ===`
  if (!report.applicable) {
    // 黑白配色不覆盖承载面 → 全部未覆盖 → 没有适用格子，也不是失败。
    console.log(`\n${title}（未覆盖承载面）`)
    console.log('  无适用格子（该配色不覆盖承载面，读数全部未覆盖 → 不计达标，也不算失败）')
    total.unmeasured += report.summary.unmeasured
    continue
  }

  console.log(`\n${title}`)
  console.log(header)
  let lastRole = null
  for (const row of report.rows) {
    if (lastRole !== null) console.log('')
    lastRole = row.role
    for (const cell of row.cells) {
      const cls = classify(cell)
      const line = [
        pad(surfaceLabel(cell.surface, cell.mode), COLS[0].w),
        pad(ROLE_LABEL[row.role] || row.role, COLS[1].w),
        pad(num(cell.measured), COLS[2].w),
        pad(cell.apca === null || cell.apca === undefined ? '—' : cell.apca.toFixed(1), COLS[3].w),
        pad(num(cell.declaredTarget), COLS[4].w),
        pad(num(cell.physicalCeiling), COLS[5].w),
        pad(cls.cat, COLS[6].w),
      ].join('  ') + '  ' + `${cls.mark} ${verdict(cell, cls)}`
      console.log('  ' + line)
      if (cell.pass === false) hardFailures++
    }
  }

  // 单套配色的小结：政策外拆成「政策豁免 / 参考面」，避免混成一个数。
  const cells = report.rows.reduce((acc, r) => acc.concat(r.cells), [])
  const policyExempt = cells.filter((c) => !c.unmeasured && c.exemptReason && c.exemptReason !== 'surface-scope').length
  const scopeExempt = cells.filter((c) => !c.unmeasured && c.exemptReason === 'surface-scope').length
  console.log(`  ── 小结：达标 ${report.summary.passed} · 未达标 ${report.summary.failed}`
    + ` · 政策外 ${report.summary.exempt}（政策豁免 ${policyExempt} · 参考面 ${scopeExempt}）`
    + ` · 未覆盖 ${report.summary.unmeasured} · 低于 AA ${CONTRAST_FLOOR} 底线 ${report.summary.floorViolations}`
    + ` · 物理不可达 ${report.summary.physicallyLimited}`)

  total.passed += report.summary.passed
  total.failed += report.summary.failed
  total.exempt += report.summary.exempt
  total.policyExempt += policyExempt
  total.scopeExempt += scopeExempt
  total.unmeasured += report.summary.unmeasured
  total.floorViolations += report.summary.floorViolations
  total.physicallyLimited += report.summary.physicallyLimited
}

console.log(`\n汇总（${HC ? '高对比档' : '标准档'} · 全部配色）：`
  + `达标 ${total.passed} · 未达标 ${total.failed}`
  + ` · 政策外 ${total.exempt}（政策豁免 ${total.policyExempt} · 参考面 ${total.scopeExempt}）`
  + ` · 未覆盖 ${total.unmeasured} · 低于 AA ${CONTRAST_FLOOR} 底线 ${total.floorViolations}`
  + ` · 物理不可达 ${total.physicallyLimited}`)
console.log(`硬门：${hardFailures} 处未达标（只有 pass===false 算失败；政策外与未覆盖都不算）`)

/* ---------- 全组合扫描 ----------

 * 承诺面（浅 00/60、深 950/875）必须在**所有**配置下都成立 ——
 * 只报默认组合的话，改一个轴（侧栏档、文字档）就能悄悄把承诺面拖到线下。
 * 这里把全部配置轴跑一遍：配色 × 侧栏 × 文字 × 右栏 × Markdown × 滚动 × 控件 × 高对比。
 */

const COMMITTED = new Set(['00', '60', '950', '875'])
const sweepMin = new Map()    // `${scheme}|${surface}|${mode}|${档}` → { min, target }
const sweepFloor = new Map()  // `${scheme}|${role}|${surface}|${mode}|${exempt}` → { n, min }
let sweepCombos = 0
let sweepHardFail = 0
const sweepFailures = []

for (const scheme of SCHEMES) {
  for (const sidebar of SIDEBAR_MODES) {
    for (const text of TEXT_MODES) {
      for (const rightbar of RIGHTBAR_MODES) {
        for (const md of MD_MODES) {
          for (const scroll of SCROLL_MODES) {
            for (const control of CONTROL_MODES) {
              for (const hc of [false, true]) {
                sweepCombos++
                const tokens = buildTokens(
                  scheme, sidebar.id, text.id, rightbar.id, scroll.id, control.id, md.id, hc,
                )
                const report = buildContrastReport(tokens, hc, { mono: !scheme.tinted })
                for (const row of report.rows) {
                  for (const cell of row.cells) {
                    if (cell.unmeasured) continue
                    if (cell.pass === false) {
                      sweepHardFail++
                      if (sweepFailures.length < 20) {
                        sweepFailures.push({
                          配色: scheme.label, 侧栏: sidebar.id, 文字: text.id, 高对比: hc,
                          承载面: cell.surface, 角色: row.role,
                          实测: cell.measured, 目标: cell.declaredTarget, 豁免: cell.exemptReason || null,
                        })
                      }
                    }
                    if (!cell.meetsFloor) {
                      const key = `${scheme.label}|${row.role}|${cell.surface}|${cell.mode}|${cell.exemptReason || '承诺面'}`
                      const prev = sweepFloor.get(key)
                      if (!prev) sweepFloor.set(key, { n: 1, min: cell.measured })
                      else {
                        prev.n++
                        if (cell.measured < prev.min) prev.min = cell.measured
                      }
                    }
                    if (row.role === 'main' && COMMITTED.has(cell.surface)) {
                      const key = `${scheme.label}|${cell.surface}|${cell.mode}|${hc ? 'HC' : '标准'}`
                      const prev = sweepMin.get(key)
                      if (!prev || cell.measured < prev.min) {
                        sweepMin.set(key, {
                          min: cell.measured,
                          target: cell.declaredTarget,
                          ceiling: cell.physicalCeiling,
                          feasible: cell.feasibleTarget,
                          limited: cell.limitedByPhysics,
                        })
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

console.log(`\n全组合扫描（${sweepCombos} 组配置 × 承诺面）`)
for (const scheme of SCHEMES) {
  const line = [`  ${scheme.label.padEnd(4)}`]
  for (const [surface, mode] of [['00', 'light'], ['60', 'light'], ['950', 'dark'], ['875', 'dark']]) {
    for (const tier of ['标准', 'HC']) {
      const v = sweepMin.get(`${scheme.label}|${surface}|${mode}|${tier}`)
      if (!v) { line.push(`${surface}/${tier} —`); continue }
      // 物理不可达：声明目标高于该面上限 → 按「上限 × 0.93」判定，仍算达标。
      if (v.limited) {
        line.push(`${surface}/${tier} ${num(v.min)}(上限 ${num(v.ceiling)}×0.93=${num(v.feasible)} 判定)`)
        continue
      }
      const flag = v.min < v.target ? ' ← 低于承诺目标' : ''
      line.push(`${surface}/${tier} ${num(v.min)}(≥${num(v.target)})${flag}`)
    }
  }
  console.log('    ' + line.join('  '))
}
console.log('  「—」= 该配置下这一面不是插件写的（黑白配色不覆盖承载面），没有可测读数。')
console.log(`  未达标（pass===false）：${sweepHardFail}`)
if (sweepFailures.length) {
  console.log('  失败明细（前 20 条）：')
  for (const f of sweepFailures) console.log('    ' + JSON.stringify(f))
}
if (sweepFloor.size) {
  console.log(`  低于 AA ${CONTRAST_FLOOR} 底线的格子（不计硬门，仅作记录）：`)
  for (const [key, v] of [...sweepFloor.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${key.padEnd(32)} ×${String(v.n).padStart(4)}  最低 ${num(v.min)}`)
  }
}
hardFailures += sweepHardFail

/* ---------- 以下是参考读数，不参与硬门 ---------- */

console.log('\n参考读数（不参与硬门）')

const get = (tokens, mode, key) => (key === 'link'
  ? tokens['--dsw-alias-link'][mode]
  : tokens[`--dsw-static-neutral-bluish-${key}`][mode])

for (const scheme of SCHEMES) {
  if (!scheme.tinted) continue
  const tokens = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', HC)
  console.log(`\n  ${scheme.label} · 品牌基准色 / 链接`)
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

console.log('\n文字着色三档')
for (const scheme of SCHEMES) {
  if (!scheme.tinted) continue
  console.log(`  ${scheme.label}`)
  for (const mode of TEXT_MODES) {
    const t = buildTokens(scheme, 'deep', mode.id)
    const g = (k) => t[`--dsw-static-${k}`].light
    // 深色侧要用 **dark 值**：深色正文是 50 步的 dark 取值，承载面是 950 的 dark 取值。
    // 1.9.7 之前这里错取了 .light，算出来的是「浅色模式的近白」对「浅色模式的 950」——
    // 一组没有意义的对比度。
    const gDark = (k) => t[`--dsw-static-${k}`].dark
    const cL = (fg, bg) => contrast(g(fg), g(bg)).toFixed(2)
    const cD = (fg, bg) => contrast(gDark(fg), gDark(bg)).toFixed(2)
    console.log(`    ${mode.label.padEnd(4)} 正文 ${g('neutral-bluish-1000')}  次文 ${g('neutral-bluish-700')}`
      + `  深正文 ${gDark('neutral-bluish-50')}`
      + `  | 正文 ${cL('neutral-bluish-1000', 'neutral-bluish-00')}`
      + `  三级 ${cL('neutral-bluish-600', 'neutral-bluish-60')}`
      + `  深正文 ${cD('neutral-bluish-50', 'neutral-bluish-950')}`)
  }
}

process.exitCode = hardFailures > 0 ? 1 : 0
