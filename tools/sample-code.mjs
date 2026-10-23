#!/usr/bin/env node
/**
 * 生成 README 用的示例短码 —— 直接跑生产 encodeConfig，**不手写**。
 *
 * 为什么：手写的码一旦与 schema 漂移，README 就在教用户导入坏数据，
 * 而且这种坏数据要等到用户真去粘贴时才暴露。
 *
 * 用法：node tools/sample-code.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

const store = new Map()
// 示例：三色派生的一套自定义（暖砂底 + 靛蓝强调），非默认组合，便于验证"三色真的生效"
const CUSTOM = { bg: '#f5efe6', text: '#1d1a17', accent: '#3f66a3' }
store.set('dsh-theme-palette.custom.v1', JSON.stringify(CUSTOM))

const win = {
  __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
  __DSH_THEME_PALETTE_DEV_REQUEST__: true,
  __DSH_THEME_PALETTE_DEV__: (api) => { globalThis.__api = api },
}
new Function('window', 'localStorage', 'document', 'navigator', source)(
  win,
  { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
  { documentElement: { lang: 'zh-CN' } },
  { language: 'zh' },
)
globalThis.__def.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => 'mono' }))

const { encodeConfig, decodeConfig } = globalThis.__api
const state = {
  palette: 'custom', sidebar: 'deep', text: 'tinted', rightbar: 'sidebar',
  scroll: 'tinted', control: 'accent', md: 'on', hc: 'off', lang: 'zh-CN',
  custom: CUSTOM,
}
const code = encodeConfig(state)

// 自检：写进 README 的码必须能被生产 decodeConfig 读回来，且三色一致
const back = decodeConfig(code)
if (!back) { console.error('✗ 示例码无法被 decodeConfig 解析'); process.exit(1) }
if (!back.custom) { console.error('✗ 示例码不含自定义三色'); process.exit(1) }
for (const k of ['bg', 'text', 'accent']) {
  if (back.custom[k] !== CUSTOM[k]) {
    console.error(`✗ 三色往返不一致：${k} ${back.custom[k]} ≠ ${CUSTOM[k]}`)
    process.exit(1)
  }
}

console.log('示例短码（已通过 decodeConfig 自检，三色一致）：')
console.log('')
console.log(code)
console.log('')
console.log('包含字段：palette / sidebar / text / rightbar / scroll / control / md / hc / lang + x(底色·文字·强调)')