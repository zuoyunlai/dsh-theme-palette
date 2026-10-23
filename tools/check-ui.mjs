#!/usr/bin/env node
/**
 * 设置页结构回归：不启动浏览器，用生产组件的静态渲染检查几个“放错位置就退化”的点。
 *
 *   1. 高对比必须在默认展开区（不能又回到「更多选项」里）
 *   2. 自定义面板必须渲染解释性校正
 *   3. 升级提示可渲染（由 PREVIEW_NOTICE=1 驱动）
 *
 * 这是结构断言，不是视觉验收；真实交互仍需在 GUI 里跑。
 *
 * 用法：node tools/check-ui.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const preview = (args, env = {}) => {
  execFileSync(process.execPath, ['tools/preview-settings.mjs', ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  })
}
const read = (name) => fs.readFileSync(path.join(root, 'tools', name), 'utf8')

let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }

try {
  preview(['--palette', 'warm', '--adv', '0'])
  const light = read('preview-light.html')
  check(light.includes('dsh-tp-row-hc'), '高对比在默认展开区')
  check(!light.includes('class="dsh-tp-adv"'), '默认不渲染「更多选项」容器')

  preview(['--palette', 'custom', '--adv', '1'])
  const custom = read('preview-light-custom.html')
  check(custom.includes('dsh-tp-explain'), '自定义面板渲染解释性校正')
  check(custom.includes('dsh-tp-row-hc'), '自定义下高对比仍在默认区')

  preview(['--palette', 'custom', '--adv', '0'], { PREVIEW_NOTICE: '1' })
  const withNotice = read('preview-light-custom.html')
  check(withNotice.includes('dsh-tp-notice'), '升级提示可渲染')
  check(withNotice.includes('dsh-tp-row-hc'), '提示与高对比可同时出现')
} catch (err) {
  console.log('  ✗ 预览渲染失败：' + (err && err.message ? err.message : err))
  failed++
}

console.log(failed === 0 ? '\n结构检查通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
