#!/usr/bin/env node
/**
 * 审计反哺的回归断言（对应 REV 批次 1/2）。
 *
 * 起因：初版审计发现「极端强调色 → 白色链接」「分享码不含自定义三色」
 * 「文字色相被丢弃」「caption 欠求解」等问题；截图看不出来，必须用数值钉住。
 *
 * 用法：node tools/check-audit.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'client.js'), 'utf8')

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

const {
  buildTokens, SCHEMES, contrast, floors, encodeConfig, decodeConfig, writeCustom, toOklch, flatten,
  devContrastReport, markdownCss, rampsFor, apcaContrast, pickLocale, raiseToLc,
  CONTRAST_SURFACES, CONTRAST_FLOOR, CONTRAST_SOLVER_MARGIN,
  MIN_MAIN, MIN_SECONDARY, MIN_TERTIARY, MIN_LINK, MIN_LINK_DARK, MIN_SECONDARY_DARK, MIN_TERTIARY_DARK,
  FLOORS_HC, FLOORS_HC_DARK, RAMP_MIN_GAP, RAMP_ORDER, hexToRgb, SURFACE_ALIAS_STEPS, hostPatchCss,
} = globalThis.__api
const custom = SCHEMES.find((s) => s.id === 'custom')
const F = floors(false)
const FHC = floors(true)
let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }
const tokensFor = (accent, options = {}) => {
  writeCustom({ bg: '#f5efe6', text: '#1d1a17', accent })
  return buildTokens(custom, 'deep', 'tinted', 'tinted', 'accent', 'on', options.hc === true)
}

console.log('\n1) 极端强调色：链接 / info 填充 / 勾选支点')
for (const accent of ['#ffffff', '#ffff00', '#000000', '#00ff00', '#ff00ff']) {
  for (const hc of [false, true]) {
    const t = tokensFor(accent, { hc })
    const link = t['--dsw-alias-link'].light
    const surfaces = ['00', '60', '150'].map((k) => t[`--dsw-static-neutral-bluish-${k}`].light)
    const linkOk = surfaces.every((bg) => contrast(link, bg) >= floors(hc).link - 0.02)
    const info = t['--dsw-alias-button-info-fill'].light
    const infoOk = contrast('#ffffff', info) >= 4.48
    const brand = t['--dsw-alias-brand-primary'].light
    const brandOk = contrast('#ffffff', brand) >= 3.0
    check(linkOk && infoOk && brandOk,
      `${accent}${hc ? ' HC' : ''} link ${link}（${surfaces.map((bg) => contrast(link, bg).toFixed(2)).join('/')}）`
      + ` info ${info} 白字 ${contrast('#ffffff', info).toFixed(2)} 支点 白字 ${contrast('#ffffff', brand).toFixed(2)}`)
  }
}

console.log('\n2) 分享码包含自定义三色，且旧码兼容')
{
  writeCustom({ bg: '#f5efe6', text: '#1d1a17', accent: '#0088ff' })
  const state = {
    palette: 'custom', sidebar: 'deep', text: 'tinted',
    scroll: 'tinted', control: 'accent', md: 'on', hc: 'off', lang: 'zh-CN',
  }
  const code = encodeConfig(state)
  const decoded = decodeConfig(code)
  check(decoded && decoded.custom && decoded.custom.accent === '#0088ff', '编码再解码后 accent 仍为 #0088ff')
  const legacyRaw = { v: 1, p: 'warm', s: 'deep', t: 'tinted', r: 'sidebar', c: 'tinted', k: 'accent', m: 'on', h: 'off', l: 'zh-CN' }
  const legacy = 'dshs1.' + Buffer.from(JSON.stringify(legacyRaw), 'utf8').toString('base64url')
  const old = decodeConfig(legacy)
  check(old && old.custom === null && old.palette === 'warm', '旧码可导入且 custom 为 null')
  check(decodeConfig('dshs1.not-a-code') === null, '非法短码整体拒绝')
}

console.log('\n3) 文字色相真的参与派生')
{
  writeCustom({ bg: '#f5efe6', text: '#1d1a17', accent: '#a9683e' })
  const base = buildTokens(custom, 'deep', 'tinted')
  writeCustom({ bg: '#f5efe6', text: '#0000ff', accent: '#a9683e' })
  const blue = buildTokens(custom, 'deep', 'tinted')
  writeCustom({ bg: '#f5efe6', text: '#ff0000', accent: '#a9683e' })
  const red = buildTokens(custom, 'deep', 'tinted')
  const key = '--dsw-static-neutral-bluish-1000'
  check(blue[key].light !== red[key].light, `文字色相不同的正文色不同（${blue[key].light} vs ${red[key].light}）`)
  const darkKey = '--dsw-static-neutral-bluish-50'
  check(blue[darkKey].dark !== red[darkKey].dark, `深色正文同样跟随文字色相（${blue[darkKey].dark} vs ${red[darkKey].dark}）`)
}

console.log('\n4) caption 在深色承载面求解（1.11.0：WCAG 下限 + Lc 闸 60/70 + 不反超三级）')
for (const id of ['warm', 'indigo', 'moss']) {
  const scheme = SCHEMES.find((s) => s.id === id)
  for (const hc of [false, true]) {
    const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', hc)
    const cap = t['--dsw-alias-label-caption'].dark
    const b800 = t['--dsw-static-neutral-bluish-800'].dark
    const b850 = t['--dsw-static-neutral-bluish-850'].dark
    const on800 = contrast(cap, b800)
    const on850 = contrast(cap, b850)
    check(on800 >= F.tertiary - 0.02 && on850 >= F.tertiary - 0.02,
      `${id}${hc ? ' HC' : ''} caption ${cap} WCAG 对 800 ${on800.toFixed(2)} / 850 ${on850.toFixed(2)}（≥ ${F.tertiary}）`)
    // 1.11.0（审计 2026-10-27 P2-3）：深色注释原先只按浅色下限求解，Lc 实测 48–52，
    // 低于本插件给文字定的 Lc 60 线。HC 闸定 70 而不是链接的 75：HC 三级在 72–77，套 75 会反超。
    const lcGate = hc ? 70 : 60
    const lc800 = Math.abs(apcaContrast(cap, b800)) * 100
    const lc850 = Math.abs(apcaContrast(cap, b850)) * 100
    check(lc800 >= lcGate - 0.5 && lc850 >= lcGate - 0.5,
      `${id}${hc ? ' HC' : ''} caption Lc 对 800 ${lc800.toFixed(1)} / 850 ${lc850.toFixed(1)}（≥ ${lcGate}）`)
    const ter = t['--dsw-alias-label-tertiary'].dark
    check(on800 <= contrast(ter, b800) + 0.02,
      `${id}${hc ? ' HC' : ''} caption 不反超三级（${on800.toFixed(2)} ≤ ${contrast(ter, b800).toFixed(2)}）`)
  }
}

console.log('\n5) 深色正文按策略 A 定标（950/875/850 → 10:1，800 不兜底）')
for (const id of ['warm', 'indigo', 'moss']) {
  const scheme = SCHEMES.find((s) => s.id === id)
  for (const hc of [false, true]) {
    const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', hc)
    const bg = t['--dsw-static-neutral-bluish-950'].dark
    const ratio = contrast(t['--dsw-static-neutral-bluish-50'].dark, bg)
    check(ratio >= (hc ? floors(hc).main : 10), `${id}${hc ? ' HC' : ''} 深正文/950 ${ratio.toFixed(2)} ≥ ${hc ? floors(hc).main : 10}`)
  }
}

console.log('\n6) 高对比浅色正文对卡层有效')
{
  const scheme = SCHEMES.find((s) => s.id === 'warm')
  const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', true)
  const ratio = contrast(t['--dsw-static-neutral-bluish-1000'].light, t['--dsw-static-neutral-bluish-60'].light)
  check(ratio >= FHC.main - 0.05, `warm HC 1000/60 ${ratio.toFixed(2)} ≥ ${FHC.main}`)
}

console.log('\n7) Markdown 层级与承载面（1.8.1）')
for (const id of ['warm', 'indigo', 'moss']) {
  const scheme = SCHEMES.find((s) => s.id === id)
  const tk = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
  for (const mode of ['light', 'dark']) {
    const h = ['--dshtp-md-h1', '--dshtp-md-h2', '--dshtp-md-h3'].map((k) => tk[k][mode])
    check(new Set(h).size === 3, `${id}/${mode} 标题三档互不相同（${h.join(' / ')}）`)
    const body = tk['--dsw-static-neutral-bluish-' + (mode === 'light' ? '1000' : '50')][mode]
    const sec = tk['--dsw-static-neutral-bluish-' + (mode === 'light' ? '700' : '300')][mode]
    const code = tk['--dshtp-code-fill'][mode]
    const quote = tk['--dshtp-md-quote-fill'][mode]
    const thead = tk['--dshtp-md-table-head'][mode]
    check(contrast(body, code) >= 4.5, `${id}/${mode} 正文/代码块底 ${contrast(body, code).toFixed(2)} ≥ 4.5`)
    check(contrast(body, quote) >= 4.5, `${id}/${mode} 正文/引用底 ${contrast(body, quote).toFixed(2)} ≥ 4.5`)
    check(contrast(sec, thead) >= 5.5, `${id}/${mode} 次级/表头底 ${contrast(sec, thead).toFixed(2)} ≥ 5.5`)
    check(tk['--dsw-alias-markdown-code-block'][mode] === code, `${id}/${mode} <pre> 底色与代码块一致（无双层底）`)
  }
  const off = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'off', false)
  check(off['--dshtp-md-h1'].light === 'inherit' && off['--dshtp-md-quote-fill'].light === 'inherit',
    `${id} md=off 时全部继承正文`)
}

console.log('\n8) 语法高亮跟随配色（1.8.2）')
{
  const NAMES = ['keyword', 'function', 'constant', 'parameter', 'string', 'string-expression', 'comment', 'punctuation', 'link']
  const dE = (a, b) => {
    const lab = (hex) => { const [L, C, h] = toOklch(hex); return [L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180)] }
    const x = lab(a), y = lab(b)
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100
  }
  for (const id of ['warm', 'moss']) {
    const scheme = SCHEMES.find((s) => s.id === id)
    const tk = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
    for (const mode of ['light', 'dark']) {
      const bg = tk['--dshtp-code-fill'][mode]
      for (const name of NAMES) {
        const hex = tk['--shiki-token-' + name][mode]
        check(/^#[0-9a-f]{6}$/i.test(hex) && contrast(hex, bg) >= 4.6,
          `${id}/${mode} token ${name} ${hex} 对代码块底 ${contrast(hex, bg).toFixed(2)} ≥ 4.6`)
      }
      const fams = ['keyword', 'function', 'constant', 'string'].map((n) => tk['--shiki-token-' + n][mode])
      let min = Infinity
      for (let i = 0; i < fams.length; i++) for (let j = i + 1; j < fams.length; j++) min = Math.min(min, dE(fams[i], fams[j]))
      check(min >= 10, `${id}/${mode} 四个色族最小 ΔE ${min.toFixed(1)} ≥ 10`)
      check(tk['--shiki-background'][mode] === bg, `${id}/${mode} shiki 背景与代码块一致`)
    }
    const off = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'off', false)
    check(off['--shiki-token-keyword'] === undefined, `${id} md=off 不输出语法色（交回宿主）`)
  }
}

console.log('\n9) 三套预置的字体体系统一（1.8.2）')
{
  const PRE = ['warm', 'indigo', 'moss']
  const bodyC = [], darkBodyC = []
  for (const id of PRE) {
    const scheme = SCHEMES.find((s) => s.id === id)
    const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
    const lightBody = t['--dsw-static-neutral-bluish-1000'].light
    const darkBody = t['--dsw-static-neutral-bluish-50'].dark
    bodyC.push([id, toOklch(lightBody)[1], toOklch(lightBody)[2]])
    darkBodyC.push([id, toOklch(darkBody)[1], toOklch(darkBody)[2]])
    // 深色正文的色相必须贴近深色面（darkHue），不能与深色面分裂
    if (scheme.darkHue !== undefined) {
      const dh = Math.abs(((toOklch(darkBody)[2] - scheme.darkHue + 540) % 360) - 180)
      check(dh <= 12, `${id} 深正文色相偏离 darkHue ${dh.toFixed(1)}° ≤ 12°`)
    }
  }
  // 1.9.0 起三套直接采用参考实现的 ink 目标，不再要求"色度相等"（参考本身各套 ink 色度不同）
  const INK = {
    warm: ['#2b2622', '#f5efe8'],
    indigo: ['#1a2330', '#eef3fa'],
    moss: ['#1f2a22', '#eef5ef'],
  }
  {
    const dE = (a, b) => {
      const lab = (hex) => { const [L, C, h] = toOklch(hex); return [L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180)] }
      const x = lab(a), y = lab(b)
      return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100
    }
    for (const [id, [inkLight, inkDark]] of Object.entries(INK)) {
      const scheme = SCHEMES.find((s) => s.id === id)
      const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
      const got = t['--dsw-static-neutral-bluish-1000'].light
      const gotDark = t['--dsw-static-neutral-bluish-50'].dark
      check(dE(got, inkLight) <= 4, `${id} 浅色正文对上参考 ink ${got} vs ${inkLight}（ΔE ${dE(got, inkLight).toFixed(1)} ≤ 4）`)
      check(contrast(gotDark, t['--dsw-static-neutral-bluish-950'].dark) >= 9.5, `${id} 深色正文按策略 A：950 上 ${contrast(gotDark, t['--dsw-static-neutral-bluish-950'].dark).toFixed(2)} ≥ 9.5`)
    }
  }
}

console.log('\n10) 菜单面 / 文件 diff / 诊断（1.8.3）')
{
  const PRE = ['warm', 'indigo', 'moss']
  const hueOf = (hex) => toOklch(hex)[2]
  const near = (h, target, tol) => Math.abs(((h - target + 540) % 360) - 180) <= tol
  for (const id of PRE) {
    const scheme = SCHEMES.find((s) => s.id === id)
    const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
    for (const mode of ['light', 'dark']) {
      const canvas = t['--dsw-static-neutral-bluish-' + (mode === 'light' ? '00' : '950')][mode]
      const flat = flatten(t['--dsw-specific-menu'][mode], canvas)
      const body = t['--dsw-static-neutral-bluish-' + (mode === 'light' ? '1000' : '50')][mode]
      check(contrast(body, flat) >= 4.5, `${id}/${mode} 正文/菜单面 ${contrast(body, flat).toFixed(2)} ≥ 4.5`)
      check(t['--dsw-alias-brand-primary-new-colorprimary-new-color'][mode] === t['--dsw-static-deepseek-' + (mode === 'light' ? '500' : '400')][mode],
        `${id}/${mode} brand-primary-new 归到强调色`)
      const addedBg = t['--dsw-alias-file-diff-added-bg'][mode]
      const delBg = t['--dsw-alias-file-diff-deleted-bg'][mode]
      check(contrast(body, addedBg) >= 4.5, `${id}/${mode} 正文/新增 diff 底 ${contrast(body, addedBg).toFixed(2)} ≥ 4.5`)
      check(contrast(body, delBg) >= 4.5, `${id}/${mode} 正文/删除 diff 底 ${contrast(body, delBg).toFixed(2)} ≥ 4.5`)
      check(near(hueOf(t['--dsw-alias-file-diff-added-marker'][mode]), 145, 40), `${id}/${mode} 新增标记仍是绿色系`)
      check(near(hueOf(t['--dsw-alias-file-diff-deleted-marker'][mode]), 27, 40), `${id}/${mode} 删除标记仍是红色系`)
    }
  }
}

// ── 1.9.8：对比度口径统一到 client.js 的 devContrastReport（UI / CLI / 审计同一模型）──
// 语义：pass===true 达标；pass===false 硬失败；pass===null 不计硬门
//      （policyApplicable=false = 政策外或参考面；unmeasured = 该面没被覆盖）
//      limitedByPhysics = 声明目标高于物理上限（真·物理不可达），与政策豁免是两件事
const cellOf = (report, role, surface) => {
  const row = report.rows.find((r) => r.role === role)
  if (!row) return null
  return row.cells.find((c) => c.surface === surface) || null
}
const cellsOf = (report) => report.rows.reduce((acc, r) => acc.concat(r.cells), [])
const ROLE_CN = { main: '正文', secondary: '次级', tertiary: '三级', link: '链接' }
const PRE_CN = { mono: '黑白', warm: '暖砂', indigo: '靛蓝', moss: '苔绿', custom: '自定义' }
const PRE = ['warm', 'indigo', 'moss']

console.log('\n11) 承诺口径：深色正文在承诺面 950/875 必须达标（普通档 10:1 · HC 档 15:1）')
{
  for (const id of PRE) {
    for (const hc of [false, true]) {
      const report = devContrastReport(id, { hc })
      const want = hc ? 15 : 10
      for (const surface of ['950', '875', '850', '800']) {
        const cell = cellOf(report, 'main', surface)
        if (!cell) { check(false, `${id}${hc ? ' HC' : ''} 深·${surface} 缺正文格子`); continue }
        if (surface === '950' || surface === '875') {
          check(cell.policyApplicable === true && cell.declaredTarget === want,
            `${PRE_CN[id]}${hc ? ' HC' : ''} 深·${surface} 正文声明目标 ${cell.declaredTarget}（承诺 ${want}，未再被 floor 截断）`)
          check(cell.measured >= cell.declaredTarget - 0.02 && cell.pass === true,
            `${PRE_CN[id]}${hc ? ' HC' : ''} 深·${surface} 正文实测 ${cell.measured} ≥ 声明目标 ${cell.declaredTarget}（pass=${cell.pass}）`)
        } else {
          check(cell.policyApplicable === false && cell.pass === null && !!cell.exemptReason,
            `${PRE_CN[id]}${hc ? ' HC' : ''} 深·${surface} 正文为政策外（${cell.exemptReason}）· 不计达标也不算失败（pass=${cell.pass}）`)
        }
      }
    }
  }
}

console.log('\n12) 850 次级深面：物理上限高于承诺目标 → 不是物理不可达，只是策略不承诺')
{
  for (const id of PRE) {
    const normal = devContrastReport(id, { hc: false })
    const hcReport = devContrastReport(id, { hc: true })
    const cN = cellOf(normal, 'main', '850')
    const cH = cellOf(hcReport, 'main', '850')
    check(cN.physicalCeiling > cN.declaredTarget && cN.limitedByPhysics === false,
      `${PRE_CN[id]} 深·850 物理上限 ${cN.physicalCeiling} > 承诺目标 ${cN.declaredTarget} → 物理可达，不是物理不可达（limited=${cN.limitedByPhysics}）`)
    check(cN.policyApplicable === false && cN.pass === null && cH.policyApplicable === false && cH.pass === null,
      `${PRE_CN[id]} 深·850 普通档/HC 档均为政策外（pass=${cN.pass}/${cH.pass}·理由 ${cN.exemptReason}）`)
    console.log(`    参考 ${PRE_CN[id]} 深·850 HC 目标 ${cH.declaredTarget} vs 物理上限 ${cH.physicalCeiling}`
      + `（${cH.limitedByPhysics ? 'HC 档目标超出该面上限（政策外，不判失败）' : 'HC 档目标仍可达'}）`)
  }
}

console.log('\n13) 800 模块面：HC 档物理上限低于 15 → 只能判政策外/物理不可达；次级/三级/链接守住 AA 4.5')
{
  for (const id of PRE) {
    for (const hc of [false, true]) {
      const report = devContrastReport(id, { hc })
      const cell = cellOf(report, 'main', '800')
      if (hc) {
        check(cell.physicalCeiling < 15 && cell.limitedByPhysics === true,
          `${PRE_CN[id]} HC 深·800 物理上限 ${cell.physicalCeiling} < 声明目标 15 → 物理不可达（limited=${cell.limitedByPhysics}）`)
        check(cell.pass === null && cell.policyApplicable === false,
          `${PRE_CN[id]} HC 深·800 正文不计入达标（pass=${cell.pass}）也不产生硬失败`)
      } else {
        check(cell.physicalCeiling > cell.declaredTarget && cell.limitedByPhysics === false,
          `${PRE_CN[id]} 普通档 深·800 物理上限 ${cell.physicalCeiling} > 目标 ${cell.declaredTarget} → 物理可达，仅策略不承诺`)
      }
      for (const role of ['secondary', 'tertiary', 'link']) {
        const c = cellOf(report, role, '800')
        check(c.meetsFloor === true && c.measured >= 4.5 && c.pass === true,
          `${PRE_CN[id]}${hc ? ' HC' : ''} 深·800 ${ROLE_CN[role]} 实测 ${c.measured} ≥ AA 底线 4.5（目标 ${c.declaredTarget}）`)
      }
    }
  }
}

console.log('\n14) 政策外不进达标统计、不产生硬失败；未覆盖（黑白）不算失败')
{
  for (const id of ['mono'].concat(PRE)) {
    for (const hc of [false, true]) {
      const report = devContrastReport(id, { hc })
      const cells = cellsOf(report)
      const exemptCells = cells.filter((c) => !c.unmeasured && c.exemptReason)
      const passedCells = cells.filter((c) => c.pass === true)
      const failedCells = cells.filter((c) => c.pass === false)
      check(passedCells.length === report.summary.passed && failedCells.length === report.summary.failed,
        `${PRE_CN[id]}${hc ? ' HC' : ''} 汇总口径与格子一致（passed ${report.summary.passed} / failed ${report.summary.failed}）`)
      check(exemptCells.every((c) => c.pass === null && c.policyApplicable === false),
        `${PRE_CN[id]}${hc ? ' HC' : ''} ${exemptCells.length} 个政策外/参考面格子全部 pass=null（不计入达标）`)
      check(failedCells.length === 0,
        `${PRE_CN[id]}${hc ? ' HC' : ''} 无硬失败（pass=false 的格子 ${failedCells.length} 个）`)
    }
  }
  for (const hc of [false, true]) {
    const report = devContrastReport('mono', { hc })
    check(report.applicable === false && report.summary.unmeasured === report.summary.cells
      && report.summary.passed === 0 && report.summary.failed === 0,
      `黑白${hc ? ' HC' : ''} 全部未覆盖（${report.summary.unmeasured}/${report.summary.cells}）→ 无适用格子，不算失败`)
  }
}

console.log('\n15) 自定义配色（参考读数，不设门：用户自选三色）')
{
  writeCustom({ bg: '#f5efe6', text: '#1d1a17', accent: '#a9683e' })
  for (const hc of [false, true]) {
    const report = devContrastReport('custom', { hc })
    const c875 = cellOf(report, 'main', '875')
    const c800 = cellOf(report, 'main', '800')
    console.log(`    自定义${hc ? ' HC' : ''} 深·875 正文 ${c875.measured}（目标 ${c875.declaredTarget}·上限 ${c875.physicalCeiling}`
      + `·${c875.limitedByPhysics ? '物理不可达' : '可达'}·pass=${c875.pass}） 深·800 正文 ${c800.measured}`
      + `（目标 ${c800.declaredTarget}·上限 ${c800.physicalCeiling}·pass=${c800.pass}）`
      + ` 汇总 达标 ${report.summary.passed}/未达标 ${report.summary.failed}/低于底线 ${report.summary.floorViolations}`)
  }
}

console.log('\n16) 未知模式 id 必须告警（审计 3.9：拼错一个 id 就整套静默退回默认）')
{
  const origWarn = console.warn
  const seen = []
  console.warn = (msg) => { seen.push(String(msg)) }
  try {
    const bogus = {
      sidebarMode: 'zzz-sidebar', textMode: 'zzz-text',
      scrollMode: 'zzz-scroll', controlMode: 'zzz-control', mdMode: 'zzz-md',
    }
    const scheme = SCHEMES.find((x) => x.id === 'warm')
    buildTokens(scheme, bogus.sidebarMode, bogus.textMode,
      bogus.scrollMode, bogus.controlMode, bogus.mdMode, false)
    for (const [field, value] of Object.entries(bogus)) {
      check(seen.some((m) => m.includes('unknown ' + field + ' id') && m.includes(value)),
        `未知 ${field}="${value}" 打出了 console.warn`)
    }
    // 空数组上 every() 恒真 —— 如果上面一条 console.warn 都没打出，这条会空转通过（审计 2026-10-29 P3-1）
    check(seen.length > 0 && seen.every((m) => m.includes('合法值')), '告警文案附带合法值清单')
  } finally {
    console.warn = origWarn
  }
}

console.log('\n17) 侧栏「同色」必须真的等于画布，三档都沿用画布色相（1.9.9 实测缺陷）')
{
  // 用户实测：苔绿选「同色」被染成薄荷绿（画布 h≈121，补偿却用 scheme.hue 162），
  // 靛蓝「同色」与画布差 ΔE 0.50。根因是补色度那一步无条件改写色度与色相。
  const lab = (hex) => {
    const [L, C, h] = toOklch(hex)
    return [L, C * Math.cos(h * Math.PI / 180), C * Math.sin(h * Math.PI / 180)]
  }
  const dE = (a, b) => {
    const x = lab(a), y = lab(b)
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100
  }
  const hueGap = (a, b) => {
    const [, C1, h1] = toOklch(a)
    const [, C2, h2] = toOklch(b)
    if (C1 < 0.006 || C2 < 0.006) return 0   // 无彩色（近白纸面）没有可信色相
    return Math.abs(((h1 - h2) % 360 + 540) % 360 - 180)
  }
  for (const id of ['warm', 'indigo', 'moss']) {
    const scheme = SCHEMES.find((s) => s.id === id)
    for (const hc of [false, true]) {
      const tag = id + (hc ? ' HC' : '')
      const tk = (mode) => buildTokens(scheme, mode, 'tinted', 'tinted', 'accent', 'on', hc)
      const canvas = tk('deep')['--dsw-static-neutral-bluish-00'].light
      const match = tk('match')['--dsw-specific-sidebar-fill'].light
      check(match.toLowerCase() === canvas.toLowerCase(),
        `${tag} 「同色」侧栏 = 画布（${match}，ΔE ${dE(match, canvas).toFixed(2)}）`)
      // 「更浅」在近白纸面上没有余量（LIGHT_CAP 0.985），只要求它有一步可见的差异、不走色；
      // 「更深」是默认档，要求 0.8–8 的可见落差。
      for (const [mode, lo] of [['light', 0.3], ['deep', 0.8]]) {
        const fill = tk(mode)['--dsw-specific-sidebar-fill'].light
        check(hueGap(fill, canvas) <= 12,
          `${tag} 「${mode}」侧栏色相跟画布一致（${fill}，色相差 ${hueGap(fill, canvas).toFixed(1)}°）`)
        const step = dE(fill, canvas)
        check(step >= lo && step <= 8,
          `${tag} 「${mode}」与画布落差可见但不夸张（ΔE ${step.toFixed(2)} ≥ ${lo}）`)
      }
      // 「更浅」曾经三处踩空：比画布更暗（LIGHT_CAP 0.985 < 画布 L 0.9888，实测 #fdfbf8 → #fafaf9），
      // 且靛蓝/苔绿的悬停、选中与底色完全相同（ΔE 0.00 —— 点下去没有任何反馈）。
      const lightFill = tk('light')['--dsw-specific-sidebar-fill'].light
      const lightHover = tk('light')['--dsw-specific-sidebar-nav-item-hover'].light
      const lightActive = tk('light')['--dsw-specific-sidebar-nav-item-active'].light
      check(toOklch(lightFill)[0] >= toOklch(canvas)[0] - 0.002,
        `${tag} 「更浅」不比画布暗（画布 L ${toOklch(canvas)[0].toFixed(4)} → 侧栏 L ${toOklch(lightFill)[0].toFixed(4)}）`)
      check(dE(lightHover, lightFill) >= 0.8,
        `${tag} 「更浅」悬停有可见步进（ΔE ${dE(lightHover, lightFill).toFixed(2)}）`)
      check(dE(lightActive, lightFill) >= 1.8,
        `${tag} 「更浅」选中与悬停拉开（ΔE ${dE(lightActive, lightFill).toFixed(2)}）`)
      check(toOklch(lightHover)[0] >= toOklch(canvas)[0] - 0.008,
        `${tag} 「更浅」悬停最多微微下穿画布（下穿 ${Math.max(0, toOklch(canvas)[0] - toOklch(lightHover)[0]).toFixed(4)} L，上限 0.008）`)
    }
  }
}

console.log('\n18) 右栏完全不接管（1.9.10 撤除该设置，技术债一并清掉）')
{
  // 宿主右栏面板是 position:absolute 的整高透明覆盖层：染网格列看不见（被它盖住），
  // 连面板一起染又会盖住主栏一大块、把开关按钮压在下面（用户实测）。
  // 所以正确行为是「什么都不做」——用断言把这个决定钉住，防止哪天又被加回来。
  check(!markdownCss.includes('data-rightbar-col') && !markdownCss.includes('data-sidebar-right-panel'),
    '样式表不碰右栏网格列与面板元素')
  check(!markdownCss.includes('--dshtp-rightbar') && !markdownCss.includes('--dshtp-canvas-fill'),
    '样式表不引用任何右栏专用 token')
  const moss = SCHEMES.find((s) => s.id === 'moss')
  const tk = buildTokens(moss, 'deep', 'tinted')
  const rightKeys = Object.keys(tk).filter((k) => /rightbar|dshtp-canvas-fill/.test(k))
  check(rightKeys.length === 0, `不产出右栏相关 token（实得 ${rightKeys.join(',') || '无'}）`)
  // 旧分享码里仍带 r，解析不能因此报错 —— 只是该字段已被彻底遗忘。
  const legacy = { v: 1, p: 'moss', s: 'deep', t: 'tinted', r: 'canvas', c: 'neutral', k: 'accent', m: 'on', h: 'off', l: 'zh-CN' }
  const code = 'dshs1.' + Buffer.from(JSON.stringify(legacy), 'utf8').toString('base64url')
  const back = decodeConfig(code)
  check(back !== null && back.palette === 'moss' && back.rightbar === undefined,
    '旧分享码仍可解析，右栏字段被忽略（不报错、不复活）')
  const fresh = encodeConfig({ palette: 'moss', sidebar: 'deep', text: 'tinted', scroll: 'neutral', control: 'accent', md: 'on', hc: 'off', lang: 'zh-CN' })
  const payload = JSON.parse(Buffer.from(fresh.slice('dshs1.'.length), 'base64url').toString('utf8'))
  check(!('r' in payload), '新分享码不再带右栏字段')
  check(decodeConfig(fresh).palette === 'moss', '新分享码可原样解回')
}

console.log('\n19) 高对比边框：浅色对最亮面 3:1，深色对中间两层定标（1.9.10）')
{
  // 深色有四层面（950 侧栏 / 875 / 850 / 800 模块面），一根线不可能对四层等强。
  // 1.9.10 及以前取最亮的 800 定标 → 同一根线在 950 上读 5.3–7.1:1，比浅色侧还硬（用户实测「扎眼」）。
  // 现在深色对 875/850 定标、目标 3.2 / 3.6 / 4.1：950 落 3.6–4.9，800 落 2.2–3.1。
  const solid = (c, bg) => {
    if (!/^#[0-9a-f]{8}$/i.test(c)) return c
    const a = parseInt(c.slice(7, 9), 16) / 255
    const f = [0, 2, 4].map((i) => parseInt(c.slice(1 + i, 3 + i), 16))
    const b = [0, 2, 4].map((i) => parseInt(bg.slice(1 + i, 3 + i), 16))
    return '#' + f.map((v, i) => Math.round(v * a + b[i] * (1 - a)).toString(16).padStart(2, '0')).join('')
  }
  for (const s of ['warm', 'indigo', 'moss']) {
    const sc = SCHEMES.find((x) => x.id === s)
    const norm = buildTokens(sc, 'deep', 'tinted')
    const hc = buildTokens(sc, 'deep', 'tinted', 'neutral', 'accent', 'on', true)
    const rNorm = rampsFor(sc, 'tinted', false)
    const rHc = rampsFor(sc, 'tinted', true)
    // 标准档保持墨色 alpha（发丝线），HC 才是实色
    for (const k of ['--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4']) {
      check(/^#[0-9a-f]{8}$/i.test(norm[k].light) && /^#[0-9a-f]{8}$/i.test(norm[k].dark),
        `${s} 标准档 ${k.split('-').pop()} 仍是墨色 alpha`)
      check(/^#[0-9a-f]{6}$/i.test(hc[k].light) && /^#[0-9a-f]{6}$/i.test(hc[k].dark),
        `${s} HC ${k.split('-').pop()} 是实色`)
    }
    // l1 是装饰性发丝线：两档都不动
    check(hc['--dsw-alias-border-l1'].light === norm['--dsw-alias-border-l1'].light,
      `${s} l1 不随 HC 变化（装饰线，不承载边界信息）`)
    const spec = [['--dsw-alias-border-l2', 3.0, 3.2], ['--dsw-alias-border-l3', 3.4, 3.6], ['--dsw-alias-border-l4', 4.0, 4.1]]
    for (const [k, lightTarget, darkTarget] of spec) {
      const name = k.split('-').pop()
      const lightWorst = Math.min(...[rHc.bluish['00'], rHc.bluish['60']]
        .map((bg) => contrast(solid(hc[k].light, bg), bg)))
      check(lightWorst >= lightTarget * 0.98,
        `${s} HC ${name} 浅色对 00/60 达标（${lightWorst.toFixed(2)} ≥ ${lightTarget}）`)
      const darkMid = Math.min(...[rHc.bluish['875'], rHc.bluish['850']]
        .map((bg) => contrast(solid(hc[k].dark, bg), bg)))
      check(darkMid >= darkTarget * 0.98,
        `${s} HC ${name} 深色对 875/850 达标（${darkMid.toFixed(2)} ≥ ${darkTarget}）`)
      // 950 是深色最暗的一面，读数最高 —— 它才是「看着扎不扎眼」的那一格
      const on950 = contrast(solid(hc[k].dark, rHc.bluish['950']), rHc.bluish['950'])
      check(on950 <= 5.0, `${s} HC ${name} 在 950 上不再过硬（${on950.toFixed(2)} ≤ 5.0）`)
      // 800 是模块面，太软就看不出分界
      const on800 = contrast(solid(hc[k].dark, rHc.bluish['800']), rHc.bluish['800'])
      check(on800 >= 2.0, `${s} HC ${name} 在 800 上仍可辨（${on800.toFixed(2)} ≥ 2.0）`)
    }
  }
}

console.log('\n20) 色觉缺陷（CVD）下文字对比度不塌')
{
  // 文字与承载面的对比度由**明度差**决定，配色只改色度/色相 —— 所以 CVD 理论上不该影响读数。
  // 这条断言就是把这个「理论上」变成实测：模拟 deutan/protan/tritan，
  // 如果哪天有人把文字亮度建立在色相差异上，这里会立刻掉下来。
  const CVD = {
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
  }
  const hex2rgb = (h0) => { let h = String(h0).replace('#', ''); if (h.length === 8) h = h.slice(0, 6); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) }
  const s2l = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const l2s = (v) => { const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))) }
  const rgb2hex = (r) => '#' + r.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
  const reflect = (hex, kind) => {
    if (!kind) return hex
    const m = CVD[kind]
    const lin = hex2rgb(hex).map(s2l)
    return rgb2hex(m.map((r) => r[0] * lin[0] + r[1] * lin[1] + r[2] * lin[2]).map((v) => l2s(Math.max(0, Math.min(1, v)))))
  }
  const lum = (hex) => { const [r, g, b] = hex2rgb(hex).map(s2l); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a, b, kind) => { const la = lum(reflect(a, kind)), lb = lum(reflect(b, kind)); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05) }
  const kinds = ['deutan', 'protan', 'tritan']
  // 自定义配色是前面几组写进 localStorage 的状态（极端强调色都试过），这里固定成一组
  // 确定的三色，避免断言结果随组序变化。
  writeCustom({ bg: '#f5efe6', text: '#1d1a17', accent: '#a9683e' })
  let worst = { v: Infinity }
  for (const scheme of SCHEMES.filter((s) => s.tinted)) {
    const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
    const r = rampsFor(scheme, 'tinted')
    const roles = [
      ['正文', r.bluish['1000']],
      ['次级', t['--dsw-alias-label-secondary'].light],
      ['三级', t['--dsw-alias-label-tertiary'].light],
      ['链接', t['--dsw-alias-link'].light],
    ]
    const surfaces = [r.bluish['00'], r.bluish['60'], r.bluish['150']]
    for (const [name, fg] of roles) {
      for (const bg of surfaces) {
        for (const kind of kinds) {
          const v = ratio(fg, bg, kind)
          if (v < worst.v) worst = { v, scheme: scheme.id, name, bg, kind }
        }
      }
    }
  }
  check(worst.v >= 4.5,
    `浅色：正文/次级/三级/链接 × 三个承载面 × 三种色觉，最低 ${worst.v.toFixed(2)} ≥ 4.5（${worst.scheme}/${worst.name}/${worst.kind} @ ${worst.bg}）`)
  let worstDark = { v: Infinity }
  for (const scheme of SCHEMES.filter((s) => s.tinted)) {
    const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
    const r = rampsFor(scheme, 'tinted')
    const roles = [
      ['正文', r.bluish['50']],
      ['次级', t['--dsw-alias-label-secondary'].dark],
      ['三级', t['--dsw-alias-label-tertiary'].dark],
      ['链接', t['--dsw-alias-link'].dark],
    ]
    const surfaces = [r.bluish['950'], r.bluish['800'], r.bluish['875']]
    for (const [name, fg] of roles) {
      for (const bg of surfaces) {
        for (const kind of kinds) {
          const v = ratio(fg, bg, kind)
          if (v < worstDark.v) worstDark = { v, scheme: scheme.id, name, bg, kind }
        }
      }
    }
  }
  check(worstDark.v >= 4.5,
    `深色：正文/次级/三级/链接 × 950/800/875 × 三种色觉，最低 ${worstDark.v.toFixed(2)} ≥ 4.5（${worstDark.scheme}/${worstDark.name}/${worstDark.kind} @ ${worstDark.bg}）`)
  // 强调色与画布去色后仍要能分开（有色按钮/链接的边界不能只靠色相）
  for (const scheme of SCHEMES.filter((s) => s.tinted)) {
    const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
    const accent = t['--dsw-static-deepseek-500'].light
    const canvas = rampsFor(scheme, 'tinted').bluish['00']
    const rs = kinds.map((k) => ratio(accent, canvas, k))
    check(Math.min(...rs) >= 3.0,
      `${scheme.id} 强调色 vs 画布 去色后最低 ${Math.min(...rs).toFixed(2)} ≥ 3.0（${rs.map((v) => v.toFixed(2)).join('/')}）`)
  }
}

console.log('\n21) 界面语言回退（1.11.0，审计 2026-10-27 P1-2）：非 zh/ja/en 宿主回落 en，不再整页中文')
{
  check(pickLocale('en') === 'en' && pickLocale('ja') === 'ja' && pickLocale('zh-TW') === 'zh-TW',
    '手选语言原样返回（en / ja / zh-TW）')
  check(pickLocale('auto') === 'zh-CN', `宿主 zh → zh-CN（实得 ${pickLocale('auto')}）`)
  // 宿主语言识别不了的场景（fr/de/…）用第二个实例验证：hostLocale 读的是实例自己的 document
  let api2 = null
  let def2 = null
  const win2 = {
    __ModuleLoader__: { load: (d) => { def2 = d } },
    __DSH_THEME_PALETTE_DEV__:(a) => { api2 = a },
    __DSH_THEME_PALETTE_DEV_REQUEST__: true,
  }
  new Function('window', 'localStorage', 'document', 'navigator', src)(
    win2, { getItem: () => null, setItem: () => {} }, { documentElement: { lang: 'fr' } }, { language: 'fr-FR' },
  )
  def2.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => 'mono' }))
  check(api2 && api2.pickLocale('auto') === 'en', `宿主 fr → 回退 en（实得 ${api2 && api2.pickLocale('auto')}）`)
}

console.log('\n22) 承诺下限被**字面量**钉住（审计 2026-10-29 P1-1）')
{
  // 这些数字是 README / DESIGN 对用户白纸黑字承诺的下限。断言必须写**字面量**：
  // 此前这里的期望值来自 floors() —— 同一个实现里的同一份常量。把 CONTRAST_FLOOR 从
  // 4.5 改成 1.0，期望值跟着改，`check-all` 全绿（变异实测复现过）。
  check(CONTRAST_FLOOR === 4.5, `CONTRAST_FLOOR === 4.5（AA 底线，实得 ${CONTRAST_FLOOR}）`)
  check(CONTRAST_SOLVER_MARGIN === 0.93, `CONTRAST_SOLVER_MARGIN === 0.93（求解余量，实得 ${CONTRAST_SOLVER_MARGIN}）`)
  check(MIN_MAIN === 12 && MIN_SECONDARY === 6.2 && MIN_TERTIARY === 4.85,
    `浅色文字下限 12 / 6.2 / 4.85（实得 ${MIN_MAIN} / ${MIN_SECONDARY} / ${MIN_TERTIARY}）`)
  check(MIN_LINK === 4.95 && MIN_LINK_DARK === 4.62,
    `链接下限 4.95（浅）/ 4.62（深）（实得 ${MIN_LINK} / ${MIN_LINK_DARK}）`)
  check(MIN_SECONDARY_DARK === 8.0 && MIN_TERTIARY_DARK === 6.4,
    `深色次级/三级下限 8.0 / 6.4（实得 ${MIN_SECONDARY_DARK} / ${MIN_TERTIARY_DARK}）`)
  check(FLOORS_HC.main === 15 && FLOORS_HC.secondary === 9 && FLOORS_HC.tertiary === 7
    && FLOORS_HC.link === 7 && FLOORS_HC.linkDark === 7,
    `HC 档下限 15 / 9 / 7 / 7 / 7（实得 ${FLOORS_HC.main} / ${FLOORS_HC.secondary} / ${FLOORS_HC.tertiary} / ${FLOORS_HC.link} / ${FLOORS_HC.linkDark}）`)
  check(FLOORS_HC_DARK.secondary === 9.6 && FLOORS_HC_DARK.tertiary === 7.6,
    `HC 深色次级/三级 9.6 / 7.6（实得 ${FLOORS_HC_DARK.secondary} / ${FLOORS_HC_DARK.tertiary}）`)
  check(RAMP_MIN_GAP === 0.006, `RAMP_MIN_GAP === 0.006（色阶档间距，实得 ${RAMP_MIN_GAP}）`)
}

console.log('\n23) 报表字段独立复算：physicalCeiling / limitedByPhysics 不读被测字段（审计 2026-10-29 P1-1 后半）')
{
  // 这两个字段原先的断言是「字段 A 满足字段 B 的关系」，而 A、B 都出自同一个 buildContrastReport ——
  // 一起漂移时断言照样过。这里改成：拿**渲染 token** 自己算一遍物理上限，再和报表比。
  let cells = 0
  let ceilingBad = 0
  let limitedBad = 0
  let sample = ''
  for (const id of PRE) {
    const scheme = SCHEMES.find((s) => s.id === id)
    for (const hc of [false, true]) {
      const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', hc)
      const report = devContrastReport(id, { hc })
      for (const row of report.rows) {
        for (const cell of row.cells) {
          if (cell.unmeasured) continue
          const sf = CONTRAST_SURFACES.find((x) => x.id === cell.surface && x.mode === cell.mode)
          if (!sf) continue
          const bgPair = sf.token ? t[sf.token] : t['--dsw-static-neutral-bluish-' + sf.id]
          if (!bgPair) continue
          const canvasPair = t['--dsw-static-neutral-bluish-' + (sf.mode === 'light' ? '00' : '950')]
          const bg = sf.token ? flatten(bgPair[sf.mode], canvasPair[sf.mode]) : bgPair[sf.mode]
          const mine = Math.round(contrast(sf.mode === 'light' ? '#000000' : '#ffffff', bg) * 100) / 100
          cells++
          if (Math.abs(cell.physicalCeiling - mine) > 0.011) {
            ceilingBad++
            sample = `${id}${hc ? ' HC' : ''} ${row.role}/${sf.id} 报表 ${cell.physicalCeiling} vs 复算 ${mine}`
          }
          if (cell.limitedByPhysics !== (cell.declaredTarget > mine)) limitedBad++
        }
      }
    }
  }
  check(cells > 0 && ceilingBad === 0, `physicalCeiling 与复算一致（${cells} 格，不一致 ${ceilingBad}${sample ? '：' + sample : ''}）`)
  check(cells > 0 && limitedBad === 0, `limitedByPhysics 与复算一致（${cells} 格，不一致 ${limitedBad}）`)
}

console.log('\n24) APCA 参考值与 ×100 换算被钉住（审计 2026-10-29 P1-8）')
{
  const Lc = (fg, bg) => apcaContrast(fg, bg) * 100
  // 公开参考值（SAPC-98G-4g）：数值对不上说明算法/常量/换算被动了
  check(Math.abs(Lc('#000000', '#ffffff') - 106.04) <= 0.02, `黑 on 白 Lc ${Lc('#000000', '#ffffff').toFixed(2)} ≈ 106.04`)
  check(Math.abs(Lc('#ffffff', '#000000') + 107.88) <= 0.02, `白 on 黑 Lc ${Lc('#ffffff', '#000000').toFixed(2)} ≈ −107.88`)
  check(Math.abs(Lc('#888888', '#ffffff') - 63.06) <= 0.02, `#888 on 白 Lc ${Lc('#888888', '#ffffff').toFixed(2)} ≈ 63.06`)
  // 精度必须是 0.01 Lc，不能是整数 —— 否则 raiseToLc 会在「量化后的 Lc」首次过闸就停
  const fractional = ['#777777', '#888888', '#767676', '#123456']
    .filter((fg) => { const v = apcaContrast(fg, '#ffffff'); return Math.abs(v * 100 - Math.round(v * 100)) > 1e-9 })
  check(fractional.length > 0, `Lc 精度高于整数（带小数的样本 ${fractional.length} / 4）`)
  // ×100 换算：raiseToLc 拿到的是 Lc 读数，闸门语义必须是「|Lc| ≥ 60」
  // （暗底浅字为负，引擎内部取绝对值 —— 这里也照这个口径断言）
  const raised = raiseToLc('#555555', ['#1f1c17'], 60)
  const got = Math.abs(apcaContrast(raised, '#1f1c17') * 100)
  check(got >= 60 - 0.02, `raiseToLc 把颜色顶到 |Lc| ≥ 60（${raised} 实得 ${got.toFixed(2)}）`)
}

console.log('\n25) 色阶单调 + 顺序表完整性（审计 2026-10-29 P1-7：900 曾漏在表外）')
{
  // 原缺陷的形状：BASE.bluish 有 '900'、色阶也构建它，但 RAMP_ORDER 里没有 →
  // 900 既不参与递减比较也不被钳制（实测 875→900 的 ΔL 只有 0.00549）。
  // 这里钉两件事：① 凡是构建出来的档位都必须在顺序表里；② 非墨色档严格递减。
  check(RAMP_ORDER.includes('900')
    && RAMP_ORDER.indexOf('875') < RAMP_ORDER.indexOf('900')
    && RAMP_ORDER.indexOf('900') < RAMP_ORDER.indexOf('950'),
    `顺序表含 900 且落在 875 / 950 之间（实得位置 ${RAMP_ORDER.indexOf('900')}）`)

  const INK = { light: ['600', '700', '1000'], dark: ['50', '300', '400'] }
  let uncovered = 0
  let inverted = 0
  let worst = { gap: Infinity }
  for (const scheme of SCHEMES.filter((s) => s.tinted)) {
    const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
    const steps = Object.keys(t)
      .filter((k) => k.startsWith('--dsw-static-neutral-bluish-'))
      .map((k) => k.slice('--dsw-static-neutral-bluish-'.length))
    for (const step of steps) if (!RAMP_ORDER.includes(step)) uncovered++
    for (const side of ['light', 'dark']) {
      let prev = null
      let prevStep = ''
      for (const step of RAMP_ORDER) {
        const pair = t['--dsw-static-neutral-bluish-' + step]
        if (!pair) continue
        const L = toOklch(pair[side])[0]
        if (!INK[side].includes(step) && prev !== null) {
          const gap = prev - L
          if (gap < worst.gap) worst = { gap, scheme: scheme.id, side, pair: prevStep + '→' + step }
          if (gap <= 0) inverted++
        }
        prev = L
        prevStep = step
      }
    }
  }
  check(uncovered === 0, `构建出的每个档位都在 RAMP_ORDER 里（未覆盖 ${uncovered} 个）`)
  check(inverted === 0, `非墨色档严格递减（反序 ${inverted} 处）`)
  // 名义下限是 RAMP_MIN_GAP=0.006，但钳制后要过 8-bit 量化，实测量会低 0.001 左右。
  // 取 0.003 作为「量化后的可用下限」：真出现塌档（如 1.9.8 的 0.36 ΔE/同色）会立刻掉到 0 附近。
  check(worst.gap >= 0.003,
    `相邻非墨色档最小 ΔL ${worst.gap.toFixed(4)} ≥ 0.003（名义 ${RAMP_MIN_GAP}；${worst.scheme}/${worst.side} ${worst.pair}）`)
}

console.log('\n26) 颜色引擎对畸形 hex 有定义行为（审计 2026-10-29 P2-2）')
{
  check(hexToRgb('#abc') === null && hexToRgb('') === null && hexToRgb(null) === null,
    'hexToRgb 对畸形输入返回 null（不再产出 NaN 三元组 / 抛 TypeError）')
  let ok = true
  for (const bad of ['#abc', '', null, undefined, '#gggggg', '#fff']) {
    try {
      const lch = toOklch(bad)
      if (!Array.isArray(lch) || lch.some((v) => Number.isNaN(v))) ok = false
    } catch { ok = false }
  }
  check(ok, 'toOklch 对畸形输入不抛错、不出 NaN（退化为定义值）')
  check(hexToRgb('#a1b2c3').join(',') === '161,178,195', 'hexToRgb 正常路径不受守影响')
}

console.log('\n27) 表面别名显式落地，不依赖 var 链（2026-10-29 悬停卡实测缺陷）')
{
  // 宿主把一批别名写成 `var(--dsw-static-neutral-bluish-NN)` 的引用；插件现在直接写成色阶值
  // （左侧会话行的悬停卡此前拿到的是宿主原始色阶 #2c2c2e）。这里断言：
  // ① 每个别名都在覆盖表里；② 两个模式的值都等于它声明的色阶档。
  // 宿主侧映射是否漂移由 tools/check-host-contract.mjs 核对。
  const scheme = SCHEMES.find((s) => s.id === 'warm')
  const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
  // 这 11 个别名由求解器/专门逻辑给值（品牌色、三级文字、链接、代码块、侧栏），
  // 别名表遇到"已存在"的键会跳过，所以它们本来就不该等于色阶档。
  const BESPOKE = new Set([
    '--dsw-alias-brand-primary', '--dsw-alias-label-caption', '--dsw-alias-label-dimmed',
    '--dsw-alias-label-document-preview', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
    '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner',
    '--dsw-specific-sidebar-fill', '--dsw-specific-sidebar-nav-item-active',
    '--dsw-specific-sidebar-nav-item-hover',
  ])
  let missing = 0
  let mismatch = 0
  let sample = ''
  for (const [name, steps] of Object.entries(SURFACE_ALIAS_STEPS)) {
    const pair = t[name]
    if (!pair) { missing++; continue }
    if (BESPOKE.has(name)) continue
    for (const mode of ['light', 'dark']) {
      const ramp = t['--dsw-static-neutral-bluish-' + steps[mode]]
      if (!ramp || pair[mode] !== ramp[mode]) { mismatch++; sample = name + '/' + mode }
    }
  }
  check(Object.keys(SURFACE_ALIAS_STEPS).length >= 40, `别名表够全（${Object.keys(SURFACE_ALIAS_STEPS).length} 条）`)
  check(missing === 0, `每个表面别名都在覆盖表里（缺 ${missing} 个）`)
  check(mismatch === 0, `表面别名 = 对应色阶档（不一致 ${mismatch}${sample ? '：' + sample : ''}）`)
  // 悬停卡那条链上的关键三档：层底 / 卡片层 / 主文字
  for (const name of ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-label-primary']) {
    check(!!t[name] && !!t[name].dark, `${name} 已被显式覆盖（不再靠 var 链）`)
  }
}

console.log('\n28) 宿主悬停卡：写死的底色被接回配色（2026-10-29 第二次回执）')
{
  // dsh-web-frontend 把悬停卡底色写死在卡片元素上：`--dsw-hovercard-bg:#2C2C2E`。
  // 插件用一个两档同值的专用 token + 注入样式把它接回配色的暗面（暗底白字，对比度不变）。
  const scheme = SCHEMES.find((s) => s.id === 'moss')
  const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
  const hc = t['--dsh-tp-hovercard-bg']
  const ramp = t['--dsw-static-neutral-bluish-850']
  check(!!hc && hc.light === hc.dark, '--dsh-tp-hovercard-bg 明暗同值（悬停卡保持暗底白字）')
  check(!!hc && !!ramp && hc.dark === ramp.dark, '悬停卡底色 = 色阶 850 的暗面（带配色色相，不再是中性 #2C2C2E）')
  check(typeof hostPatchCss === 'string' && /\*\{--dsw-hovercard-bg:var\(--dsh-tp-hovercard-bg[^}]*!important\}/.test(hostPatchCss),
    '宿主补丁样式把 --dsw-hovercard-bg 接到专用 token 上（!important：宿主声明在卡片元素自身）')
  const mono = buildTokens(SCHEMES.find((s) => s.id === 'mono'), 'deep', 'tinted', 'tinted', 'accent', 'on', false)
  check(!mono['--dsh-tp-hovercard-bg'], '黑白档不产出悬停卡 token（回落到宿主原色）')
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)