#!/usr/bin/env node
/**
 * 宿主契约测试：插件依赖的 token 名与 DOM/CSS 钩子，在当前 DSH 构建里是否仍然存在。
 *
 * 为什么需要：这些关系没有类型或运行时保证，宿主改名不会报错，只会静默失效。
 * 本脚本只读 asar，不安装、不改宿主；找不到 asar 时 SKIP（退出 0），便于在别的机器上跑。
 *
 * 用法：
 *   node tools/check-host-contract.mjs
 *   node tools/check-host-contract.mjs --asar "D:/Programs/DeepSeek Harness/resources/app.asar"
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const ai = argv.indexOf('--asar')
const ASAR = pathResolve(ai >= 0 ? argv[ai + 1] : 'D:/Programs/DeepSeek Harness/resources/app.asar')

function pathResolve(p) {
  return p.replace(/\\/g, '/')
}

if (!fs.existsSync(ASAR)) {
  console.log('SKIP: 找不到宿主 asar（' + ASAR + '），跳过契约检查')
  process.exit(0)
}

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const jsonSize = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonSize)
fs.readSync(fd, jsonBuf, 0, jsonSize, 16)
const header = JSON.parse(jsonBuf.toString('utf8').replace(/\0+$/, ''))
const base = 16 + head.readUInt32LE(4)
const files = []
;(function walk(node, prefix) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name
    if (entry.files) walk(entry, p)
    else files.push({ path: p, offset: Number(entry.offset), size: entry.size })
  }
})(header, '')

const read = (f) => {
  const buf = Buffer.alloc(f.size)
  fs.readSync(fd, buf, 0, f.size, base + f.offset)
  return buf.toString('utf8')
}
const findOne = (re) => files.find((f) => re.test(f.path))

const theme = findOne(/dsh-client-ui-theme\/lib\/client\.js$/)
const layout = findOne(/dsh-client-ui-layout\/lib\/client\.js$/)
const css = findOne(/dsh-web-frontend\/dist\/assets\/index-.*\.css$/)

let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }

if (!theme) { console.log('  ✗ 找不到 ui-theme/lib/client.js'); failed++ }
else {
  const text = read(theme)
  const tokens = [
    '--dsw-alias-link',
    '--dsw-alias-label-caption',
    '--dsw-alias-button-info-fill',
    '--dsw-specific-sidebar-fill',
    '--dsw-static-neutral-bluish-800',
    '--dsw-static-deepseek-500',
    '--dsw-alias-markdown-code-block',
  ]
  for (const name of tokens) check(text.includes(name), 'ui-theme 仍有 ' + name)
}
if (!layout) { console.log('  ✗ 找不到 ui-layout/lib/client.js'); failed++ }
else check(read(layout).includes('data-rightbar-col'), 'ui-layout 仍有 data-rightbar-col')
if (!css) { console.log('  ✗ 找不到前端构建 CSS'); failed++ }
else {
  const text = read(css)
  check(text.includes('_markdown_'), '构建 CSS 仍含 _markdown_ 模块类名')
  check(text.includes('md-code-block'), '构建 CSS 仍含 md-code-block')
}

fs.closeSync(fd)
console.log(failed === 0 ? '\n契约检查通过' : `\n${failed} 项契约失效`)
process.exit(failed === 0 ? 0 : 1)
