/**
 * 一键发版：npm publish + 等 registry 出现该版本 + 校验 dist-tag + 可选打 tag 推 Git。
 *
 * 用法：
 *   node tools/release.mjs --dry            # 只做本地检查 + 只读查 registry（不发布、不推送）
 *   node tools/release.mjs                  # 真发布（需要 npm 登录态）
 *   node tools/release.mjs --tag            # 发布后再打 tag 并推 main + tag
 *   node tools/release.mjs --skip-publish   # 只打 tag（版本已经在 registry 上了）
 *
 * 安全约束（2026-10-21 审计后改）：
 *   - **不再用 shell 拼字符串**。`package.json` 的 name/version 会进命令，若有人提交一个
 *     `name: "x; <cmd>"`，工作区干净检查挡不住它。现在 name/version/tag 先过严格白名单，
 *     命令一律 execFileSync(程序, 参数数组)，npm 直接走 `node <npm-cli.js> ...`。
 *   - registry 探测改用 fetch（不再依赖 curl / shell 重定向）。
 *   - `--dry` 不产生任何副作用（只有只读 GET）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const args = process.argv.slice(2)
const has = (f) => args.includes('--' + f)
const arg = (f, d = '') => { const i = args.indexOf('--' + f); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d }

const REGISTRY = 'https://registry.npmjs.org'
/** npm 的 JS 入口（有它就不必经过 cmd.exe / sh）。 */
const NPM_CLI = [
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find((p) => existsSync(p))

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const { name, version } = pkg
const tag = 'v' + version

// ---- 白名单：这三个值会进命令，必须是"只有包名/版本该有的字符" ----
const NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const TAG_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const run = (cmd, cmdArgs, opts = {}) => {
  const out = execFileSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  return typeof out === 'string' ? out.trim() : ''
}
const git = (...gitArgs) => run('git', gitArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
const npm = (npmArgs) => {
  if (NPM_CLI) return run(process.execPath, [NPM_CLI, ...npmArgs])
  // 兜底：Windows 上 npm 是 .cmd，Node 20+ 不许直接 spawn .cmd ——
  // 用 cmd.exe 冒烟但**参数分开传**（不拼字符串），且只在拿不到 npm-cli.js 时才走到这里。
  if (process.platform === 'win32') return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...npmArgs])
  return run('npm', npmArgs)
}
const httpStatus = async (url) => {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' })
    return res.status
  } catch {
    return 0
  }
}
const ok = (m) => console.log('  ✓ ' + m)
const warn = (m) => console.log('  ! ' + m)
const die = (m) => { console.error('  ✗ ' + m); process.exit(1) }

console.log(`\n发版 ${name}@${version}${has('dry') ? '（dry run）' : ''}\n`)

// 0. 输入白名单
if (!NAME_RE.test(name)) die('package.json 的 name 含非法字符，拒绝拼进命令：' + JSON.stringify(name))
if (!VERSION_RE.test(version)) die('package.json 的 version 含非法字符：' + JSON.stringify(version))
if (!TAG_RE.test(tag)) die('tag 名含非法字符：' + JSON.stringify(tag))
ok(`name/version 白名单通过：${name}@${version}（tag ${tag}）`)

// 1. 本地检查
try { run(process.execPath, ['--check', 'client.js']); ok('client.js 语法') } catch { die('client.js 语法错误') }

// 1b. PLUGIN_VERSION 与 package.json 必须一致（否则设置页角标会说谎）
{
  const src = readFileSync(path.join(root, 'client.js'), 'utf8')
  const m = src.match(/const PLUGIN_VERSION = '([^']+)'/)
  if (!m) warn('client.js 里找不到 PLUGIN_VERSION，跳过一致性检查')
  else if (m[1] !== version) die(`版本漂移：client.js PLUGIN_VERSION=${m[1]}，package.json=${version}`)
  else ok(`PLUGIN_VERSION 与 package.json 一致：${m[1]}`)
}

// 1c. dsh.client 必须配 exports["./client"] —— 缺了宿主 client-modules 会直接启动失败
//     （2026-10-21 实测：加 exports 却漏掉 ./client 导致重启后整个 profile 起不来）
{
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (manifest.dsh && manifest.dsh.client) {
    const clientRel = manifest.exports && manifest.exports['./client']
    if (!clientRel) die('dsh.client 已声明但 exports 缺 "./client"（宿主会报 exports no "./client" bundle）')
    const rel = typeof clientRel === 'string' ? clientRel : clientRel.default
    if (typeof rel !== 'string' || !existsSync(path.join(root, rel))) die('exports["./client"] 指向的文件不存在：' + rel)
    ok('client 子路径可解析：exports["./client"] → ' + rel)
  }
}

// 1d. 兼容性声明（engines.dsh / peer）——用**宿主自己的语义**校验
//
//     宿主 app-boot 里是：semver.satisfies(runtimeVersion, range, { includePrerelease: true })
//     少了 includePrerelease 会得出完全相反的结论（0.3.0-rc.1 看似被拒、其实是放行）。
//     这里不去猜：直接按宿主那行代码的口径算，并守住两条底线——
//       · 不能把 0.1.x / 0.2.0 放进来（那一代不是 exports["./client"] 这套加载器）
//       · 不能把未来的 0.2.2-rc.x / 0.3.x-rc.x 误拒（预发布分支缺失的经典坑）
{
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const engines = manifest.engines || {}
  const dshRange = typeof engines.dsh === 'string' ? engines.dsh : ''
  const dshPeers = Object.entries(manifest.peerDependencies || {}).filter(([k]) => k === '@deepseek-ai/dsh' || k.startsWith('@deepseek-ai/dsh-'))
  const meta = manifest.peerDependenciesMeta || {}
  const hardPeers = dshPeers.filter(([k]) => !(meta[k] && meta[k].optional))

  let semver = null
  try { semver = (await import('semver')).default } catch { /* 没装就跳过，只告警 */ }
  if (!semver) {
    warn('没装 semver（npm i 后启用），跳过 engines.dsh 兼容性预检')
  } else {
    // 与宿主完全一致的判定
    const sat = (v, range) => range.trim() !== '' && semver.satisfies(v, range, { includePrerelease: true })
    if (!dshRange) {
      if (hardPeers.length === 0) warn('既没声明 engines.dsh、也没有非可选 peer —— 宿主会"直接放行不读"，等于对任何版本都宣称兼容')
      else warn('没声明 engines.dsh；宿主会退回读 peer 判定兼容性')
    } else {
      const mustReject = ['0.1.7-rc.2', '0.2.0-rc.2']
      const mustAdmit = ['0.2.1-rc.1', '0.2.2-rc.1', '0.3.0-rc.1']
      for (const v of mustReject) {
        if (sat(v, dshRange)) die(`engines.dsh 过宽：${v} 也会被放行，但那一代不是 exports["./client"] 加载器，强装会启动失败`)
      }
      for (const v of mustAdmit) {
        if (!sat(v, dshRange)) die(`engines.dsh 会在 ${v} 上误拒（缺预发布分支？宿主的 includePrerelease 语义下本应放行）`)
      }
      const hostArg = arg('host', process.env.DSH_VERSION || '')
      if (hostArg) {
        if (!sat(hostArg, dshRange)) die(`目标宿主 ${hostArg} 不在 engines.dsh (${dshRange}) 范围内`)
        ok(`engines.dsh ${dshRange}：放行 ${hostArg}；同时拒绝 0.1.x/0.2.0、放行 0.2.2-rc 与 0.3-rc`)
      } else {
        ok(`engines.dsh ${dshRange}：拒绝 0.1.x/0.2.0、放行 0.2.2-rc 与 0.3-rc（传 --host <版本> 可断言具体宿主）`)
      }
    }
  }
}

// 1e. 回归与宿主契约：配色数值、自定义回归、宿主 token/DOM 钩子
//     契约脚本在拿不到 asar 时会 SKIP（退出 0），不阻断其它机器发版。
for (const script of ['tools/check-audit.mjs', 'tools/check-custom.mjs', 'tools/check-ui.mjs', 'tools/check-host-contract.mjs', 'tools/check-selfheal.mjs']) {
  try {
    run(process.execPath, [script])
    ok(script + ' 通过')
  } catch (err) {
    die(script + ' 失败：' + String((err && (err.stdout || err.stderr)) || (err && err.message) || err).trim())
  }
}

const dirty = git('status', '--porcelain')
if (dirty) die('工作区不干净，先提交：\n' + dirty)
ok('工作区干净')

const packed = npm(['pack', '--dry-run', '--json'])
try {
  const info = JSON.parse(packed.slice(packed.indexOf('[')))[0]
  ok(`打包 ${info.entryCount} 个文件 / ${(info.size / 1024).toFixed(1)} KB`)
} catch { die('读不出 npm pack --dry-run 的结果') }

// 2. 版本是否已在 registry（只读）
let remoteList = []
try {
  const r = await fetch(`${REGISTRY}/${name}`, { headers: { accept: 'application/json' } })
  if (r.status === 200) {
    const body = await r.json()
    remoteList = Object.keys(body.versions || {})
  }
} catch { /* 网络不可达就当"没有" */ }
if (remoteList.includes(version)) {
  if (!has('skip-publish')) die('该版本已发布，先改 package.json 的 version')
  ok(`registry 上已有 ${version}（skip-publish）`)
} else {
  ok(`registry 上没有 ${version}（当前 ${remoteList.length} 个版本）`)
}

if (has('dry')) { console.log('\n干跑结束：没有发布、没有推送、没有打 tag。\n'); process.exit(0) }

// 3. 发布
if (!has('skip-publish')) {
  console.log('\n发布中…')
  const publishArgs = ['publish', `--registry=${REGISTRY}`]
  // provenance 需要 CI 的 OIDC 身份；本地发布开了必失败，所以只在 CI 里加。
  if (process.env.CI === 'true') publishArgs.push('--provenance')
  try {
    const out = npm(publishArgs)
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
  if (await httpStatus(`${REGISTRY}/${name}/${version}`) === 200) { live = true; break }
  await new Promise((r) => setTimeout(r, 15000))
}
if (!live) die('10 分钟内没出现在 registry —— 可能仍在审核，稍后手动跑 npm view ' + name + ' versions')
ok(`registry 上已可下载 ${version}`)

// 5. dist-tag
const latest = npm(['view', `${name}`, 'dist-tags.latest', `--registry=${REGISTRY}`]).trim()
if (latest === version) ok(`latest = ${version}`)
else {
  warn(`latest 指向 ${latest}，前移中…`)
  try {
    npm(['dist-tag', 'add', `${name}@${version}`, 'latest', `--registry=${REGISTRY}`])
    ok(`已前移 latest → ${version}`)
  } catch { warn('前移失败，需要人工处理') }
}

// 6. Git tag（可选）
if (has('tag')) {
  try {
    const signingKey = (() => { try { return git('config', '--get', 'user.signingkey').trim() } catch { return '' } })()
    const tagArgs = ['tag', '-a', tag, '-m', `${name} ${version}`]
    if (signingKey) tagArgs.splice(1, 0, '-s')
    git(...tagArgs)
    git('push', 'origin', 'main', tag)
    ok(`已打${signingKey ? '（签名）' : ''} tag 并推送 ${tag}`)
    if (!signingKey) warn('未配置 GPG 签名密钥，tag 是未签名注解——装了 `user.signingkey` 后会自动改用 -s')
  } catch (err) {
    warn('tag/推送失败：' + (err.stderr || err.message))
  }
}

console.log(`\n完成：https://www.npmjs.com/package/${name}/v/${version}\n`)
