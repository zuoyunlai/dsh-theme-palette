#!/usr/bin/env node
/**
 * JSON 树语法色回归（2026-11-22 审计 P1）。
 *
 * 背景：宿主把 --dsw-alias-json-tree-* 写成固定字面量，工具输出里的语法高亮一直是
 * 宿主原色（浅色 #881391 / #c41a16 / #1c00cf …）。插件现在声明这七个 token，本脚本钉住
 * 三件事，防止"接管了但读不清"或"接管了但角色分不开"：
 *   1) 染色配色下七个角色都有值，六个前景在**树自己的承载面**上 ≥ MIN_JSON_TREE；
 *   2) 角色之间的区分度仍在（属性/字符串/标点两两 ΔE 有下限）；
 *   3) 黑白配色不声明（保持宿主原貌），悬停色仍是低透明度叠加层。
 *
 * 用法：node tools/check-json-tree.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'client.js'), 'utf8')

const store = new Map()
const win = {
  __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
  __DSH_THEME_PALETTE_DEV__: (api) => { globalThis.__api = api },
  __DSH_THEME_PALETTE_DEV_REQUEST__: true,
}
new Function('window', 'localStorage', 'document', 'navigator', src)(
  win,
  { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  { head: { appendChild() {} }, createElement: () => ({ dataset: {}, remove() {} }), querySelector: () => null, documentElement: { lang: 'zh' } },
  { language: 'zh' },
)
globalThis.__def.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => 'mono' }))
const api = globalThis.__api

let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }

const ROLES = ['property', 'string', 'number', 'keyword', 'punctuation', 'icon']
const HOVER = '--dsw-alias-json-tree-hover'
const tokenOf = (role) => '--dsw-alias-json-tree-' + role
const build = (scheme, hc = false) => api.buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', hc)
const floorOf = (hc) => (hc ? api.MIN_JSON_TREE_HC : api.MIN_JSON_TREE)
check(api.MIN_JSON_TREE === 5 && api.MIN_JSON_TREE_HC === 7, '下限常量未漂移（标准 5 / 高对比 7）')
const HEX = /^#[0-9a-f]{6}$/i
const HEX8 = /^#[0-9a-f]{8}$/i

const tinted = api.SCHEMES.filter((s) => s.tinted)
check(tinted.length >= 4, '染色配色样本 ≥ 4 套（实得 ' + tinted.length + '）')

let worst = { ratio: Infinity, where: '' }
for (const scheme of tinted) {
 for (const hc of [false, true]) {
  const t = build(scheme, hc)
  const bg = {
    light: t['--dsw-static-neutral-bluish-00'] && t['--dsw-static-neutral-bluish-00'].light,
    dark: t['--dsw-static-neutral-bluish-875'] && t['--dsw-static-neutral-bluish-875'].dark,
  }
  check(HEX.test(bg.light || '') && HEX.test(bg.dark || ''), scheme.id + '：树的承载面（layer-1）可解析')
  for (const role of ROLES) {
    for (const mode of ['light', 'dark']) {
      const v = t[tokenOf(role)] && t[tokenOf(role)][mode]
      check(HEX.test(v || ''), scheme.id + ' / ' + mode + '：' + role + ' 已声明（' + v + '）')
      const ratio = HEX.test(v || '') && HEX.test(bg[mode] || '') ? api.contrast(v, bg[mode]) : 0
      const floor = floorOf(hc)
      check(ratio >= floor - 1e-9,
        scheme.id + (hc ? '（高对比）' : '') + ' / ' + mode + '：' + role + ' 对树承载面 ' + Number(ratio.toFixed(2)) + ' ≥ ' + floor)
      if (ratio < worst.ratio) worst = { ratio, where: scheme.id + (hc ? '/hc' : '') + '/' + mode + '/' + role }
    }
  }
  const hover = t[HOVER]
  check(HEX8.test(hover && hover.light || '') && HEX8.test(hover && hover.dark || ''), scheme.id + '：悬停色是 8 位 hex')
  const alphaOf = (v) => parseInt(String(v).slice(7, 9), 16)
  check(alphaOf(hover.light) <= 0x26 && alphaOf(hover.dark) <= 0x26, scheme.id + '：悬停透明度 ≤ 0.15')
 }
}

// 角色区分度：接管颜色不等于允许把语法高亮抹成一片
{
  const t = build(tinted[0])
  const pairs = [['property', 'string'], ['string', 'number'], ['property', 'punctuation'], ['icon', 'punctuation']]
  for (const [a, b] of pairs) {
    const dL = api.deltaE(t[tokenOf(a)].light, t[tokenOf(b)].light)
    const dD = api.deltaE(t[tokenOf(a)].dark, t[tokenOf(b)].dark)
    check(dL >= 10 && dD >= 10, a + ' vs ' + b + ' 的 OKLab ΔE ≥ 10（浅 ' + Number(dL.toFixed(2)) + ' / 深 ' + Number(dD.toFixed(2)) + '）')
  }
}

// 黑白配色保持宿主原貌
{
  const mono = api.SCHEMES.find((s) => s.id === 'mono')
  const t = api.buildTokens(mono, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
  const leaked = Object.keys(t).filter((k) => k.includes('json-tree'))
  check(leaked.length === 0, '黑白配色不声明 JSON 树颜色（实得 ' + leaked.length + ' 个）')
}

// 同一入参两次构建必须一致（token 缓存不能把上一次的求解结果带进来）
{
  const a = build(tinted[0])
  const b = build(tinted[0])
  check(JSON.stringify(a) === JSON.stringify(b), '同入参两次构建结果一致')
}

console.log('')
if (failed > 0) { console.error('JSON 树回归失败 ' + failed + ' 项'); process.exit(1) }
console.log('JSON 树回归通过（最低 ' + Number(worst.ratio.toFixed(2)) + ' @ ' + worst.where + '）')
