#!/usr/bin/env node
/**
 * 从 CHANGELOG.md 里抽出某个版本的整节，作为 GitHub Release 的 notes。
 *
 * 为什么要独立成脚本（而不是在 workflow 里内联 node -e）：
 *   内联写法要同时躲 shell 的双引号与正则的转义，`\Z` 在 JS 里根本不是锚点 ——
 *   抽出来能本地跑、能单测，workflow 里只剩一行 `node tools/release-notes.mjs <version>`。
 *
 * 用法：node tools/release-notes.mjs 1.13.0 > release-notes.md
 *   版本节找不到时不报错（退出 0），输出最小说明 —— notes 缺失不该中断发版。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2]
if (!version) {
  console.error('用法：release-notes.mjs <version>')
  process.exit(2)
}

const md = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const lines = md.split('\n')

// 版本节标题形如「### 1.13.0」或「### 1.13.0（未发布）」
const start = lines.findIndex((l) => l.startsWith('### ' + version))
if (start === -1) {
  console.log(`## ${version}\n\n详见仓库 CHANGELOG.md 的对应小节。`)
  process.exit(0)
}

// 节的结束：下一个二级或三级标题（## / ###）
let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
  if (/^#{2,3}\s/.test(lines[i])) { end = i; break }
}

const body = lines.slice(start + 1, end).join('\n').trim()
console.log(body || `## ${version}\n\n详见仓库 CHANGELOG.md 的对应小节。`)
