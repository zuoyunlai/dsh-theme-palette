#!/usr/bin/env node
/**
 * 回归总入口：按顺序跑六件套，把「SKIP」与「通过」分开记账。
 *
 * 为什么需要它（2026-10-28 P3-O）：
 *   契约脚本 `tools/check-host-contract.mjs` 在拿不到宿主 asar 时会 SKIP，
 *   退出码 78（不再是 0）。直接用 `a && b && c` 串联的话，SKIP 会让整条链断掉 ——
 *   别的机器与 CI 上就变成「因为没跑而红」。这里把 78 当作「没验」单独记账：
 *   它不算失败，但会在输出里明写「未执行」。
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
]

let failed = 0
let skipped = 0
for (const script of scripts) {
  try {
    const out = execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
    const lines = (out || '').trim().split('\n')
    const last = lines[lines.length - 1] || ''
    console.log('  ✓ ' + script + ' — ' + last)
  } catch (err) {
    const status = err && typeof err.status === 'number' ? err.status : 1
    const out = String((err && (err.stdout || err.stderr)) || (err && err.message) || err)
    if (status === 78) {
      skipped++
      console.log('  ! ' + script + ' — SKIP（未执行，不计失败）')
    } else {
      failed++
      console.error('  ✗ ' + script + ' 失败：\n' + out.trim())
    }
  }
}

console.log('')
if (failed > 0) {
  console.error('回归失败 ' + failed + ' 项' + (skipped ? '（另有 ' + skipped + ' 项 SKIP）' : ''))
  process.exit(1)
}
console.log('回归全部通过' + (skipped ? '（' + skipped + ' 项 SKIP：没跑，不等于通过）' : ''))
