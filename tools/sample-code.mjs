#!/usr/bin/env node
/**
 * 生成 README 用的示例短码 —— 直接跑生产 encodeConfig，**不手写**。
 *
 * 为什么：手写的码一旦与 schema 漂移，README 就在教用户导入坏数据，
 * 而且这种坏数据要等到用户真去粘贴时才暴露。
 *
 * 为什么导出函数（审计 2026-10-29 P1-6）：
 *   `tools/insert-readme-sections.mjs` 里曾**硬编码**一份 1.9.10 之前生成的码（还带已撤除的
 *   `"r":"sidebar"` 字段），于是那个脚本的 `--check` 在干净检出上永远红 → 没人跑它 →
 *   它自己也慢慢腐烂。现在它 import 本文件的 `generateSampleCode()`，两边不可能再漂移。
 *
 * 用法：node tools/sample-code.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 示例：三色派生的一套自定义（暖砂底 + 靛蓝强调），非默认组合，便于验证"三色真的生效"
export const SAMPLE_CUSTOM = { bg: '#f5efe6', text: '#1d1a17', accent: '#3f66a3' }

/**
 * 用生产编码器生成示例短码，并做往返自检（三色必须原样读回）。
 * @returns {string} `dshs1.` 开头的短码
 * @throws 自检失败时抛错（调用方决定是退出还是记红）
 */
export function generateSampleCode() {
  const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
  const store = new Map()
  store.set('dsh-theme-palette.custom.v1', JSON.stringify(SAMPLE_CUSTOM))

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
    palette: 'custom', sidebar: 'deep', text: 'tinted',
    scroll: 'tinted', control: 'accent', md: 'on', hc: 'off', lang: 'zh-CN',
    custom: SAMPLE_CUSTOM,
  }
  const code = encodeConfig(state)

  // 自检：写进 README 的码必须能被生产 decodeConfig 读回来，且三色一致
  const back = decodeConfig(code)
  if (!back) throw new Error('示例码无法被 decodeConfig 解析')
  if (!back.custom) throw new Error('示例码不含自定义三色')
  for (const k of ['bg', 'text', 'accent']) {
    if (back.custom[k] !== SAMPLE_CUSTOM[k]) {
      throw new Error(`三色往返不一致：${k} ${back.custom[k]} ≠ ${SAMPLE_CUSTOM[k]}`)
    }
  }
  return code
}

// CLI：只有被直接执行时才打印（被 import 时不动任何东西）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  let code
  try {
    code = generateSampleCode()
  } catch (err) {
    console.error('✗ ' + err.message)
    process.exit(1)
  }
  console.log('示例短码（已通过 decodeConfig 自检，三色一致）：')
  console.log('')
  console.log(code)
  console.log('')
  console.log('包含字段：palette / sidebar / text / scroll / control / md / hc / lang + x(底色·文字·强调)')
}
