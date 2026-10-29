#!/usr/bin/env node
/**
 * npm 包内容守卫：跑 `npm pack --dry-run --json`，做三组「发出去的东西自己说自己是谁」的对账：
 *
 *   1. **必需文件清单**（2026-10-28 P3-P）：少任何一个都不该发版；
 *   2. **版本一致性**（审计 2026-10-29 P0-1）：`package.json` / `PLUGIN_VERSION` /
 *      `screenshots.meta.json` / CHANGELOG 最新版本节必须四个数相同。
 *      此前只有 `tools/release.mjs` 断言其中一条边，而 `release.mjs` **不在 CI 里** ——
 *      `package.json` 单方面 bump 能一路发出去，设置页角标却说着旧版本（变异实测：
 *      package.json 改 1.99.0，`check-all` 与两档报表全绿）；
 *   3. **包内相对链接自包含**（审计 2026-10-29 P0-2）：README / CHANGELOG / DESIGN 里
 *      `](...)` 指向的相对路径必须真的在包里。1.13.1 发出去的包里有 6 条死链
 *      （`tools/README.md` ×5、`AUDIT-2026-10-27.md` ×1）；"必需文件清单"天然挡不住
 *      「有人新加了一条指向包外文件的链接」，所以这里直接扫链接本身。
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
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 必需文件清单：少任何一个都不该发版。 */
const REQUIRED = [
  'package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg',
  'README.md', 'README-zh.md', 'README-ja.md', 'README-es.md', 'README-pt.md', 'README-hi.md',
  'CHANGELOG.md', 'LICENSE', 'docs/DESIGN.md',
  // 五语 README 的末尾都指向它；1.13.1 的包里没有 → npmjs.com 上 5 条 404（审计 P0-2）
  'tools/README.md',
  // CHANGELOG 的 1.11.0 版本节引用了这份审计报告；同理必须自包含（审计 P0-2）
  'AUDIT-2026-10-27.md',
  'assets/screenshot-settings-light.png', 'assets/screenshot-settings-dark.png',
  'assets/screenshot-settings-custom.png', 'assets/screenshot-settings-hc.png',
  'assets/screenshots.meta.json',
  // locale/*.json 是**市场页元数据**（不是 UI 文案），每种 README 语言都要有一份（审计 P2-10/P2-11）
  'locale/en.json', 'locale/zh.json', 'locale/zh-TW.json', 'locale/ja.json',
  'locale/es.json', 'locale/pt.json', 'locale/hi.json',
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
const problems = []

// ---- 1. 必需文件 ----
const missing = REQUIRED.filter((p) => !files.includes(p))
if (missing.length) {
  console.error('  ✗ npm 包里少了这些文件：')
  for (const p of missing) console.error('      ' + p)
  process.exit(1)
}

// ---- 2. 版本一致性（审计 2026-10-29 P0-1）----
// 四个版本号分布在四处。历史上是「两两各钉一条、缺一条边」：
//   check-ui 钉了 PLUGIN_VERSION ↔ 截图元数据；release.mjs 钉了 package.json ↔ PLUGIN_VERSION。
// 缺的正好是发版实际依赖的那条边（package.json ↔ 发布物），而 release.mjs 不在 CI 里。
{
  const readText = (rel) => readFileSync(path.join(root, rel), 'utf8')
  const pkgVersion = JSON.parse(readText('package.json')).version
  const clientVersion = /PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(readText('client.js'))?.[1]
  const shotVersion = JSON.parse(readText('assets/screenshots.meta.json')).pluginVersion
  // 只认纯版本号节（CHANGELOG 里还有「### 未发版 · 发版预检补强」这类非版本标题）
  const changelogVersion = /^###\s+(\d+\.\d+\.\d+)\s*$/m.exec(readText('CHANGELOG.md'))?.[1]
  const rows = [
    ['client.js PLUGIN_VERSION', clientVersion],
    ['assets/screenshots.meta.json pluginVersion', shotVersion],
    ['CHANGELOG 最新版本节', changelogVersion],
  ]
  let bad = 0
  for (const [what, got] of rows) {
    if (!got) { problems.push(`${what} 读不到（正则没匹配上？）`); bad++; }
    else if (got !== pkgVersion) { problems.push(`${what} = ${got}，与 package.json 的 ${pkgVersion} 不一致`); bad++; }
  }
  if (!bad) console.log('  ✓ 版本四处一致：' + pkgVersion + '（package.json / PLUGIN_VERSION / 截图元数据 / CHANGELOG）')
}

// ---- 3. 包内相对链接自包含（审计 2026-10-29 P0-2）----
{
  const readText = (rel) => readFileSync(path.join(root, rel), 'utf8')
  const mdInPack = files.filter((f) => f.endsWith('.md'))
  const broken = []
  for (const f of mdInPack) {
    for (const m of readText(f).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1]
      // 绝对 URL / 锚点 / 站内绝对路径不归这里管（它们不依赖包内文件）
      if (/^(https?:|mailto:|#|\/)/i.test(target)) continue
      const rel = target.split('#')[0]
      if (!rel) continue
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(f), rel))
      if (!files.includes(resolved)) broken.push(f + ' → ' + target)
    }
  }
  if (broken.length) {
    console.error('  ✗ 包内有链接指向包外的文件（npmjs.com 上会 404）：')
    for (const b of broken) console.error('      ' + b)
    problems.push(broken.length + ' 条死链')
  } else {
    console.log('  ✓ 包内相对链接全部自包含（扫了 ' + mdInPack.length + ' 份 markdown）')
  }
}

if (problems.length) {
  console.error('  ✗ 包内容对账失败：')
  for (const p of problems) console.error('      ' + p)
  process.exit(1)
}

console.log('  ✓ 打包 ' + info.entryCount + ' 个文件 / ' + (info.size / 1024).toFixed(1) + ' KB')
console.log('  ✓ 包内容齐备（' + REQUIRED.length + ' 个必需文件都在）')
