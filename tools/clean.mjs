#!/usr/bin/env node
/**
 * 清掉本地产物（审计 2026-10-29 P2-16）：发版遗留的 tarball、截图工作目录、主题包导出。
 *
 * 为什么需要：仓库根目录长期躺着 6 个 `dsh-theme-palette-*.tgz`（1.3.0–1.13.0，共 1.5MB），
 * 每次发版还会再多一个 —— 它们被 `.gitignore` 排除，所以不会有任何门禁提示；
 * 但找东西/打包目录时会混进视野，`npm pack` 输出里也容易误读成产物。
 *
 * 只删**可重建**的东西，且逐项打印；`--dry` 只列出不动手。
 * 不碰 `assets/`、`docs/`、`tools/baseline/`（后者已出库，见 tools/README.md）。
 *
 * 用法：
 *   npm run clean          # 真删
 *   npm run clean -- --dry # 只列
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry')

/** 可重建产物：相对路径或匹配函数。 */
const targets = [
  { what: '发版遗留的 tarball', match: (f) => /^dsh-theme-palette-.*\.tgz$/.test(f) },
  { what: '截图/测量工作目录', match: (f) => f === 'tools/out' },
  // 刻意**不**删 dist/：那是 `npm run packs` 导出的主题包，可能是要交付/上传的产物。
  // 想重建它跑一次 `npm run packs` 即可，不需要靠 clean 顺手删掉。
]

const entries = fs.readdirSync(root, { withFileTypes: true }).map((e) => e.name)
const hits = []
for (const t of targets) {
  for (const name of entries) if (t.match(name)) hits.push({ what: t.what, path: path.join(root, name), rel: name })
}
// tools/ 下的子目录按相对路径匹配（entries 是根目录项，单独扫一遍）
const toolsDir = path.join(root, 'tools')
if (fs.existsSync(toolsDir)) {
  for (const name of fs.readdirSync(toolsDir)) {
    const rel = 'tools/' + name
    for (const t of targets) {
      if (t.match(rel) && !hits.some((h) => h.rel === rel)) hits.push({ what: t.what, path: path.join(toolsDir, name), rel })
    }
  }
}

if (hits.length === 0) {
  console.log('没有需要清理的产物。')
  process.exit(0)
}

for (const h of hits) {
  const size = fs.existsSync(h.path) ? fs.statSync(h.path).size : 0
  console.log((DRY ? '  · 将删除 ' : '  ✓ 已删除 ') + h.rel + '（' + (size / 1024).toFixed(0) + ' KB，' + h.what + '）')
  if (!DRY) fs.rmSync(h.path, { recursive: true, force: true })
}
console.log('\n' + (DRY ? '干跑：' : '清理完成：') + hits.length + ' 项可重建产物'
  + (DRY ? '（加 --dry 的反面即真删）' : '，都可用 npm pack / npm run shots / npm run packs 重建'))
