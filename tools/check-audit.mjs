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
  buildTokens, SCHEMES, contrast, floors, encodeConfig, decodeConfig, writeCustom, toOklch,
} = globalThis.__api
const custom = SCHEMES.find((s) => s.id === 'custom')
const F = floors(false)
const FHC = floors(true)
let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }
const tokensFor = (accent, options = {}) => {
  writeCustom({ bg: '#f5efe6', text: '#1d1a17', accent })
  return buildTokens(custom, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', options.hc === true)
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
    palette: 'custom', sidebar: 'deep', text: 'tinted', rightbar: 'sidebar',
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

console.log('\n4) caption 在深色承载面求解')
for (const id of ['warm', 'indigo', 'moss']) {
  const scheme = SCHEMES.find((s) => s.id === id)
  const t = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', false)
  const cap = t['--dsw-alias-label-caption'].dark
  const on800 = contrast(cap, t['--dsw-static-neutral-bluish-800'].dark)
  const on850 = contrast(cap, t['--dsw-static-neutral-bluish-850'].dark)
  check(on800 >= F.tertiary - 0.02 && on850 >= F.tertiary - 0.02,
    `${id} caption ${cap} 对 800 ${on800.toFixed(2)} / 850 ${on850.toFixed(2)}（目标 ${F.tertiary}）`)
}

console.log('\n5) 深色正文按可达上限求解，不再假装 12/15')
for (const id of ['warm', 'indigo', 'moss']) {
  const scheme = SCHEMES.find((s) => s.id === id)
  for (const hc of [false, true]) {
    const t = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', hc)
    const bg = t['--dsw-static-neutral-bluish-800'].dark
    const ratio = contrast(t['--dsw-static-neutral-bluish-50'].dark, bg)
    const ceiling = contrast('#ffffff', bg) * 0.93
    const target = Math.min(floors(hc).main, ceiling)
    check(ratio >= target - 0.02, `${id}${hc ? ' HC' : ''} 50/800 ${ratio.toFixed(2)} ≥ ${target.toFixed(2)}（承诺 ${floors(hc).main}，可达 ${ceiling.toFixed(2)}）`)
  }
}

console.log('\n6) 高对比浅色正文对卡层有效')
{
  const scheme = SCHEMES.find((s) => s.id === 'warm')
  const t = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', true)
  const ratio = contrast(t['--dsw-static-neutral-bluish-1000'].light, t['--dsw-static-neutral-bluish-60'].light)
  check(ratio >= FHC.main - 0.05, `warm HC 1000/60 ${ratio.toFixed(2)} ≥ ${FHC.main}`)
}

console.log('\n7) Markdown 层级与承载面（1.8.1）')
for (const id of ['warm', 'indigo', 'moss']) {
  const scheme = SCHEMES.find((s) => s.id === id)
  const tk = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', false)
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
  const off = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'off', false)
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
    const tk = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', false)
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
    const off = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'off', false)
    check(off['--shiki-token-keyword'] === undefined, `${id} md=off 不输出语法色（交回宿主）`)
  }
}

console.log('\n9) 三套预置的字体体系统一（1.8.2）')
{
  const PRE = ['warm', 'indigo', 'moss']
  const bodyC = [], darkBodyC = []
  for (const id of PRE) {
    const scheme = SCHEMES.find((s) => s.id === id)
    const t = buildTokens(scheme, 'deep', 'tinted', 'sidebar', 'tinted', 'accent', 'on', false)
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
  const ratio = (arr) => Math.max(...arr.map((x) => x[1])) / Math.min(...arr.map((x) => x[1]))
  check(ratio(bodyC) <= 1.25, `三套浅色正文字色度比 ${ratio(bodyC).toFixed(2)} ≤ 1.25（${bodyC.map((x) => x[0] + ':' + x[1].toFixed(3)).join(' ')}）`)
  check(ratio(darkBodyC) <= 1.5, `三套深色正文字色度比 ${ratio(darkBodyC).toFixed(2)} ≤ 1.5（${darkBodyC.map((x) => x[0] + ':' + x[1].toFixed(3)).join(' ')}）`)
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
