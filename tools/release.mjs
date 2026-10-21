/**
 * 一键发版：npm publish + 等 registry 出现该版本 + 校验 dist-tag + 可选打 tag 推 Git。
 *
 * 用法：
 *   node tools/release.mjs --dry            # 只做本地检查（语法、打包内容、版本可用性）
 *   node tools/release.mjs                  # 真发布（需要 npm 登录态）
 *   node tools/release.mjs --tag            # 发布后再打 tag 并推 main + tag
 *   node tools/release.mjs --skip-publish   # 只打 tag（版本已经在 registry 上了）
 *
 * 为什么需要它：本机 npm 默认源是 npmmirror，publish 必须显式指官方源；而 npm 对新包名
 * 会走「暂存审核」，CLI 照样打印 `+ pkg@ver`，必须回查 registry 才知道有没有真的放出来。
 * 另外 latest 不保证自动前移，得验一次。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const args = process.argv.slice(2)
const has = (f) => args.includes('--' + f)

const REGISTRY = 'https://registry.npmjs.org'
// Windows 上 `npm` 实际是 npm.cmd，execFileSync 不做 PATHEXT 解析，必须写全名。
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const { name, version } = pkg
const tag = 'v' + version

const run = (cmd, cmdArgs, opts = {}) => {
  const out = execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  return typeof out === 'string' ? out.trim() : ''
}
const sh = (cmd) => run(process.platform === 'win32' ? 'cmd' : 'sh', process.platform === 'win32' ? ['/c', cmd] : ['-c', cmd])
const ok = (m) => console.log('  ✓ ' + m)
const die = (m) => { console.error('  ✗ ' + m); process.exit(1) }

console.log(`\n发版 ${name}@${version}${has('dry') ? '（dry run）' : ''}\n`)

// 1. 本地检查
try { run(process.execPath, ['--check', 'client.js']); ok('client.js 语法') } catch { die('client.js 语法错误') }
const dirty = sh('git status --porcelain')
if (dirty) die('工作区不干净，先提交：\n' + dirty)
ok('工作区干净')

const packed = run(process.platform === 'win32' ? 'cmd' : 'sh',
  process.platform === 'win32' ? ['/c', 'npm pack --dry-run --json'] : ['-c', 'npm pack --dry-run --json'])
try {
  const info = JSON.parse(packed.slice(packed.indexOf('[')))[0]
  ok(`打包 ${info.entryCount} 个文件 / ${(info.size / 1024).toFixed(1)} KB`)
} catch { die('读不出 npm pack --dry-run 的结果') }

// 2. 版本是否已在 registry
let remote = null
try { remote = JSON.parse(sh(`${NPM} view ${name} versions --json --registry=${REGISTRY}`)) } catch { remote = null }
const remoteList = Array.isArray(remote) ? remote : remote ? [remote] : []
if (remoteList.includes(version)) {
  ok(`registry 上已有 ${version}`)
  if (!has('skip-publish')) die('该版本已发布，先改 package.json 的 version')
} else {
  ok(`registry 上没有 ${version}（当前 ${remoteList.length} 个版本）`)
}

if (has('dry')) { console.log('\n干跑结束，没有发布。\n'); process.exit(0) }

// 3. 发布
if (!has('skip-publish')) {
  console.log('\n发布中…')
  try {
    // Node 20+ 在 Windows 上不允许直接 spawn .cmd（CVE-2024-27980 的缓解），
    // 必须走 shell；所以统一用 sh()，而不是 execFileSync。
    const out = sh(`${NPM} publish --registry=${REGISTRY}`)
    if (out) console.log(out)
  } catch (err) {
    die('npm publish 失败：' + (err.stderr || err.message))
  }
}

// 4. 回查 registry（新包会进暂存审核，CLI 打印成功不代表已放出）
console.log('\n等 registry 出现该版本（最多 10 分钟，暂存审核通过前会一直 404）…')
const started = Date.now()
let live = false
while (Date.now() - started < 10 * 60 * 1000) {
  try {
    const code = sh(`${CURL} -s -o ${process.platform === 'win32' ? 'NUL' : '/dev/null'} -w "%{http_code}" ${REGISTRY}/${name}/${version}`)
    if (code.trim() === '200') { live = true; break }
  } catch { /* 网络抖动继续等 */ }
  await new Promise((r) => setTimeout(r, 15000))
}
if (!live) die('10 分钟内没出现在 registry —— 可能仍在审核，稍后手动跑 npm view ' + name + ' versions')
ok(`registry 上已可下载 ${version}`)

// 5. dist-tag
const latest = sh(`${NPM} view ${name} dist-tags.latest --registry=${REGISTRY}`).trim()
if (latest === version) ok(`latest = ${version}`)
else {
  console.log(`  ! latest 指向 ${latest}，手工前移：npm dist-tag add ${name}@${version} latest --registry=${REGISTRY}`)
  try {
    sh(`${NPM} dist-tag add ${name}@${version} latest --registry=${REGISTRY}`)
    ok(`已前移 latest → ${version}`)
  } catch { console.log('  ! 前移失败，需要人工处理') }
}

// 6. Git tag（可选）
if (has('tag')) {
  try {
    sh(`git tag -a ${tag} -m "${name} ${version}"`)
    sh(`git push origin main ${tag}`)
    ok(`已打 tag 并推送 ${tag}`)
  } catch (err) {
    console.log('  ! tag/推送失败：' + (err.stderr || err.message))
  }
}

console.log(`\n完成：https://www.npmjs.com/package/${name}/v/${version}\n`)
