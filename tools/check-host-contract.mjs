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
 *   DSH_ASAR="D:/Programs/DeepSeek Harness/resources/app.asar" node tools/check-host-contract.mjs
 *   node tools/check-host-contract.mjs --strict     # 拿不到 asar 时判失败（CI/发版用）
 *
 * 退出码：0 = 跑了且全过 / 78 = SKIP（没找到 asar，非 --strict）/ 1 = 有契约失效。
 * 2026-10-28 修：原先 SKIP 走退出码 0，发版门把它当「✓ 通过」打印出来 ——
 * CI 与别的机器上这一层其实 0 条断言，宿主 token 改名这类事故没有任何自动覆盖。
 */
import fs from 'node:fs'

const argv = process.argv.slice(2)
const ai = argv.indexOf('--asar')
const STRICT = argv.includes('--strict')
const ASAR = pathResolve(
  ai >= 0 ? argv[ai + 1]
    : (process.env.DSH_ASAR && process.env.DSH_ASAR.trim()) ? process.env.DSH_ASAR.trim()
      : 'D:/Programs/DeepSeek Harness/resources/app.asar',
)

function pathResolve(p) {
  return p.replace(/\\/g, '/')
}

if (!fs.existsSync(ASAR)) {
  console.log('SKIP: 找不到宿主 asar（' + ASAR + '），跳过契约检查')
  if (STRICT) {
    console.error('  ✗ --strict：拿不到宿主 asar，契约检查无法执行')
    process.exit(1)
  }
  process.exit(78)
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
    '--dsw-specific-menu',
    '--dsw-alias-brand-primary-new-colorprimary-new-color',
    '--dsw-alias-file-diff-added-bg',
  ]
  for (const name of tokens) check(text.includes(name), 'ui-theme 仍有 ' + name)
  // 可见性探针（2026-10-28 P0-C）依赖这条链：body 的背景色走 --dsw-alias-bg-base，
  // 而 alias-bg-base 指向色阶 00（浅）/ 950（深）—— 也就是说「body 实际背景色」一定经过我们覆盖的色阶。
  // 宿主若改名或改画布来源，插件的可见性判据就会一直失配（假警报）。
  check(/--dsw-alias-bg-base:\s*var\(--dsw-static-neutral-bluish-00\)/.test(text), '画布底色走 --dsw-static-neutral-bluish-00（浅色）')
  check(/--dsw-alias-bg-base:\s*var\(--dsw-static-neutral-bluish-950\)/.test(text), '画布底色走 --dsw-static-neutral-bluish-950（深色）')
  check(/background-color:\s*var\(--dsw-alias-bg-base\)/.test(text), 'body 背景色取自 --dsw-alias-bg-base')
}
if (!layout) { console.log('  ✗ 找不到 ui-layout/lib/client.js'); failed++ }
else {
  const layoutText = read(layout)
  // 1.9.8 的自愈判据（标记 token --dshtp-layer）依赖宿主 presenter 的两个行为：
  //   a) 快照里的每个 token 都写到 body —— 标记 token 才会出现在 body 上；
  //   b) 重写前先摘掉上一批 token —— 覆盖层被撤销时标记才会随之消失。
  check(
    /for \(const \[name, value\] of Object\.entries\(snapshot\.active\.tokens\)\)[\s\S]{0,160}setProperty\(name, value\)/.test(layoutText),
    'presenter 把快照里的每个 token 都写到 body',
  )
  check(
    /appliedTokens[\s\S]{0,160}removeProperty\(name\)/.test(layoutText),
    'presenter 重写前先摘掉上一批 token',
  )
  // 右栏底色 1.9.10 起不再接管（宿主面板是整高透明覆盖层，染色要么看不见、要么盖住主栏），
  // 所以这里也不再用 data-sidebar-right-panel 做契约 —— 依赖消失，断言一并撤除。
}
if (!css) { console.log('  ✗ 找不到前端构建 CSS'); failed++ }
else {
  const text = read(css)
  check(text.includes('_markdown_'), '构建 CSS 仍含 _markdown_ 模块类名')
  check(text.includes('md-code-block'), '构建 CSS 仍含 md-code-block')
}

fs.closeSync(fd)
console.log(failed === 0 ? '\n契约检查通过' : `\n${failed} 项契约失效`)
process.exit(failed === 0 ? 0 : 1)
