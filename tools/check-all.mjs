#!/usr/bin/env node
/**
 * 回归总入口：按顺序跑全部检查脚本，把「SKIP」与「通过」分开记账。
 *
 * 为什么需要它（2026-10-28 P3-O）：
 *   契约脚本 `tools/check-host-contract.mjs` 在拿不到宿主 asar / 宿主 peer 包时会 SKIP，
 *   退出码 78（不再是 0）。直接用 `a && b && c` 串联的话，SKIP 会让整条链断掉 ——
 *   别的机器与 CI 上就变成「因为没跑而红」。这里把 78 当作「没验」单独记账：
 *   它不算失败，但会在输出里明写「未执行」。
 *
 * 为什么这里是**唯一**的脚本清单（审计 2026-10-29 P1-5）：
 *   发版门原先在 `tools/release.mjs` 里另抄一份 5 个脚本的清单，今天两份功能等价，
 *   但加第 8 个脚本时 `npm run check` 会绿、发版门会瞎。现在 `release.mjs` 直接调本文件，
 *   本地回归 / CI / 发版门三条路径共用同一份列表。
 *
 * 用法：node tools/check-all.mjs
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scripts = [
  'tools/check-audit.mjs',
  'tools/check-custom.mjs',
  'tools/check-ui.mjs',
  'tools/check-host-contract.mjs',
  'tools/check-selfheal.mjs',
  'tools/check-colormath.mjs',
  // 五语 README 的示例短码必须仍是生产编码器的产物（审计 2026-10-29 P1-6）：
  // 这个脚本此前硬编码了一份 1.9.10 之前的短码，在干净检出上直接红，于是没人跑它。
  'tools/insert-readme-sections.mjs --check',
  // 包内容守卫（2026-10-29）：必需文件 / 版本一致性 / 包内链接自包含，三条路径共用一份（tools/check-pack.mjs）
  'tools/check-pack.mjs',
]

let failed = 0
let skipped = 0
let passed = 0
for (const entry of scripts) {
  const [script, ...scriptArgs] = entry.split(' ')
  try {
    const out = execFileSync(process.execPath, [script, ...scriptArgs], { cwd: root, encoding: 'utf8' })
    const lines = (out || '').trim().split('\n')
    const last = lines[lines.length - 1] || ''
    passed++
    console.log('  ✓ ' + entry + ' — ' + last)
  } catch (err) {
    const status = err && typeof err.status === 'number' ? err.status : 1
    const out = String((err && (err.stdout || err.stderr)) || (err && err.message) || err)
    if (status === 78) {
      skipped++
      console.log('  ! ' + entry + ' — SKIP（未执行，不计失败）')
    } else {
      failed++
      console.error('  ✗ ' + entry + ' 失败：\n' + out.trim())
    }
  }
}

console.log('')
if (failed > 0) {
  console.error('回归失败 ' + failed + ' 项' + (skipped ? '（另有 ' + skipped + ' 项 SKIP）' : ''))
  process.exit(1)
}
// 件数不再写死：加一个脚本就自动跟着变（审计 2026-10-29 P3-4）
console.log('回归全部通过：' + passed + ' / ' + scripts.length + ' 项'
  + (skipped ? '（' + skipped + ' 项 SKIP：没跑，不等于通过）' : ''))
