#!/usr/bin/env node
/**
 * 向五语 README 首屏追加 1.7.0 的另外三张截图（深色 / 自定义面板 / 高对比）。
 *
 * 规则：插在 `## Compatibility` 之前；表格表头按语言写（只有 `## ` 标题要求逐字一致）；
 * 已有画廊则跳过（幂等）。
 *
 * 用法：node tools/insert-readme-gallery.mjs [--check]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const MARK = 'assets/screenshot-settings-hc.png'

const captions = {
  'README.md': ['Dark', 'Custom palette', 'High contrast'],
  'README-zh.md': ['深色', '自定义面板', '高对比'],
  'README-es.md': ['Oscuro', 'Paleta personalizada', 'Alto contraste'],
  'README-pt.md': ['Escuro', 'Paleta personalizada', 'Alto contraste'],
  'README-hi.md': ['डार्क', 'कस्टम पैलेट', 'उच्च कंट्रास्ट'],
}

let failed = 0
for (const [file, caps] of Object.entries(captions)) {
  const p = path.join(root, file)
  let text = fs.readFileSync(p, 'utf8')
  if (CHECK) {
    const ok = text.includes(MARK) && text.includes('assets/screenshot-settings-custom.png') && text.includes('assets/screenshot-settings-dark.png')
    if (!ok) { console.log('  ✗ ' + file + ' 缺少画廊图'); failed++ }
    continue
  }
  if (text.includes(MARK)) { console.log('  = ' + file + ' 已有画廊'); continue }
  const anchor = text.indexOf('## Compatibility')
  if (anchor === -1) { console.log('  ✗ ' + file + ' 无锚点'); failed++; continue }
  const gallery = `| ${caps[0]} | ${caps[1]} | ${caps[2]} |
|---|---|---|
| ![${caps[0]}](assets/screenshot-settings-dark.png) | ![${caps[1]}](assets/screenshot-settings-custom.png) | ![${caps[2]}](assets/screenshot-settings-hc.png) |

`
  text = text.slice(0, anchor) + gallery + text.slice(anchor)
  fs.writeFileSync(p, text)
  console.log('  ✓ ' + file)
}
if (CHECK) { console.log(failed === 0 ? '画廊检查通过' : `${failed} 项失败`); process.exit(failed === 0 ? 0 : 1) }