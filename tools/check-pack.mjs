#!/usr/bin/env node
/**
 * npm 包内容守卫：跑 `npm pack --dry-run --json`，逐个核对**必需文件**在不在包里。
 *
 * 为什么单独一个脚本（2026-10-28 P3-P 的后续）：
 *   1.11.0 刚修过「npm 包内 README 截图全部 404」（`files` 漏了 `assets/`），当时没有回归守卫 ——
 *   把 package.json 的 "assets" 删掉，六件套与发版门全绿。
 *   后来守卫写进了 `tools/release.mjs`，但**只有本地发版路径**会跑到；
 *   CI 直接推 tag 的路径（Trusted Publishing）就漏了。
 *   把清单抽到这个文件里，两条路径共用同一份 required，**避免清单在两处漂移**。
 *
 * 用法：node tools/check-pack.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 必需文件清单：少任何一个都不该发版。 */
const REQUIRED = [
  'package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg',
  'README.md', 'README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md',
  'CHANGELOG.md', 'LICENSE', 'docs/DESIGN.md',
  'assets/screenshot-settings-light.png', 'assets/screenshot-settings-dark.png',
  'assets/screenshot-settings-custom.png', 'assets/screenshot-settings-hc.png',
  'assets/screenshots.meta.json',
  'locale/en.json', 'locale/zh.json', 'locale/ja.json', 'locale/zh-TW.json',
]

// npm 的 JS 入口（有它就不必经过 cmd.exe / sh）
const npmCli = [
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find((p) => existsSync(p))

function npm(args) {
  const cli = npmCli
  if (cli) return execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' })
  if (process.platform === 'win32') return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: root, encoding: 'utf8' })
  return execFileSync('npm', args, { cwd: root, encoding: 'utf8' })
}

let out = ''
try {
  out = npm(['pack', '--dry-run', '--json'])
} catch (err) {
  console.error('  ✗ npm pack --dry-run 跑失败：' + String((err && (err.stdout || err.stderr)) || (err && err.message) || err).trim())
  process.exit(1)
}

let info
try {
  info = JSON.parse(out.slice(out.indexOf('[')))[0]
} catch {
  console.error('  ✗ 读不出 npm pack --dry-run 的结果')
  process.exit(1)
}

const files = (info.files || []).map((f) => f.path)
const missing = REQUIRED.filter((p) => !files.includes(p))
if (missing.length) {
  console.error('  ✗ npm 包里少了这些文件：')
  for (const p of missing) console.error('      ' + p)
  process.exit(1)
}

console.log('  ✓ 打包 ' + info.entryCount + ' 个文件 / ' + (info.size / 1024).toFixed(1) + ' KB')
console.log('  ✓ 包内容齐备（' + REQUIRED.length + ' 个必需文件都在）')
