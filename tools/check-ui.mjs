#!/usr/bin/env node
/**
 * 设置页结构回归：不启动浏览器，用生产组件的静态渲染检查几个“放错位置就退化”的点。
 *
 *   1. 高对比必须在默认展开区（不能又回到「更多选项」里）
 *   2. 自定义面板必须渲染解释性校正
 *   3. 升级提示可渲染（由 PREVIEW_NOTICE=1 驱动）
 *   4. README 截图资产与 screenshots.json / screenshots.meta.json 三重对齐（忘了重拍就红）
 *
 * 这是结构断言，不是视觉验收；真实交互仍需在 GUI 里跑。
 *
 * 用法：node tools/check-ui.mjs
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const preview = (args, env = {}) => {
  execFileSync(process.execPath, ['tools/preview-settings.mjs', ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'ignore',
  })
}
const read = (name) => fs.readFileSync(path.join(root, 'tools', name), 'utf8')

let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }

try {
  preview(['--palette', 'warm', '--adv', '0'])
  const light = read('preview-light.html')
  check(light.includes('dsh-tp-row-hc'), '高对比在默认展开区')
  check(!light.includes('class="dsh-tp-adv"'), '默认不渲染「更多选项」容器')

  preview(['--palette', 'custom', '--adv', '1'])
  const custom = read('preview-light-custom.html')
  check(custom.includes('dsh-tp-explain'), '自定义面板渲染解释性校正')
  check(custom.includes('dsh-tp-row-hc'), '自定义下高对比仍在默认区')

  preview(['--palette', 'custom', '--adv', '0'], { PREVIEW_NOTICE: '1' })
  const withNotice = read('preview-light-custom.html')
  check(withNotice.includes('dsh-tp-notice'), '升级提示可渲染')
  check(withNotice.includes('dsh-tp-row-hc'), '提示与高对比可同时出现')

  // ---- R1：对比度矩阵 ----
  // 渲染 advanced 版（矩阵含在默认区，展开态由 --adv 1 驱动）
  preview(['--palette', 'warm', '--adv', '1'])
  const matrixHtml = read('preview-light.html')
  check(matrixHtml.includes('id="dsh-tp-matrix-body"'), '对比度矩阵可展开')
  const roleRows = (matrixHtml.match(/data-role="(main|secondary|tertiary|link)"/g) || []).length
  check(roleRows >= 4, `矩阵含 ≥4 个角色行（实得 ${roleRows}）`)
  const surfaceCells = new Set((matrixHtml.match(/data-surface="(\d+)"/g) || []).map((s) => s.replace(/\D/g, '')))
  check(surfaceCells.size >= 4, `矩阵含 ≥4 个承载面（实得 ${surfaceCells.size}：${[...surfaceCells].join('/')}）`)
  check(matrixHtml.includes('data-surface="menuL"') && matrixHtml.includes('data-surface="menuD"'), '矩阵含菜单面（半透明·按画布合成）')
  check(matrixHtml.includes('复制诊断') || matrixHtml.includes('Copy diagnostics'), '矩阵含诊断导出入口')

  // 政策外（深色 800/850 正文）必须标「政策外」+ ※，不能挂「表面受限」——
  // 那是物理不可达才用的标签；850 的物理上限远高于目标，挂上去就是误标。
  const cellTitle = (html, role, surface) => {
    const m = html.match(new RegExp(`data-role="${role}"[^>]*data-surface="${surface}"[^>]*title="([^"]*)"`))
    return m ? m[1] : ''
  }
  const t800 = cellTitle(matrixHtml, 'main', '800')
  const t850 = cellTitle(matrixHtml, 'main', '850')
  check(t800.includes('政策外') && !t800.includes('表面受限'), `800 正文标「政策外」而非「表面受限」（${t800}）`)
  check(t850.includes('政策外') && !t850.includes('表面受限'), `850 正文标「政策外」而非「表面受限」（${t850}）`)
  const t950 = cellTitle(matrixHtml, 'main', '950')
  check(t950 !== '' && !t950.includes('政策外'), `950 正文在承诺面内（${t950}）`)
  // 政策外的格子只能带 ※，不能带 △
  const markOf = (html, role, surface) => {
    const m = html.match(new RegExp(`data-role="${role}"[^>]*data-surface="${surface}"[^>]*>([^<]*)`))
    return m ? m[1] : ''
  }
  check(markOf(matrixHtml, 'main', '800').includes('※') && !markOf(matrixHtml, 'main', '800').includes('△'), '800 正文只标 ※ 不标 △')
  check(markOf(matrixHtml, 'main', '850').includes('※') && !markOf(matrixHtml, 'main', '850').includes('△'), '850 正文只标 ※ 不标 △')
  // 统计行必须把「政策外」单列
  check(matrixHtml.includes('统计（达标 / 未达标 / 政策外）'), '矩阵统计行区分达标/未达标/政策外')

  // 高对比开关必须改变深模块 800 的正文读数（防止永远显示"达标"）
  const pick = (html) => {
    const m = html.match(/data-role="main"[^>]*data-surface="800"[^>]*>([^<]+)/)
    return m ? m[1].trim() : ''
  }
  preview(['--palette', 'warm', '--adv', '1', '--hc', '0'])
  const stdCell = pick(read('preview-light.html'))
  preview(['--palette', 'warm', '--adv', '1', '--hc', '1'])
  const hcCell = pick(read('preview-light.html'))
  check(stdCell !== '' && hcCell !== '' && stdCell !== hcCell, `HC 切换改变 800 正文读数（标准「${stdCell}」→ 高对比「${hcCell}」）`)

  // 承载面清单只能有一份定义：palette-dev 不得再自带 SURFACES
  const clientSrc = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
  const devSrc = fs.readFileSync(path.join(root, 'palette-dev.mjs'), 'utf8')
  check((clientSrc.match(/const CONTRAST_SURFACES/g) || []).length === 1, 'CONTRAST_SURFACES 在 client.js 只定义一次')
  check(!/const SURFACES = \[/.test(devSrc), 'palette-dev 不再自带承载面清单')
  check(devSrc.includes('CONTRAST_SURFACES'), 'palette-dev 使用共享常量')
} catch (err) {
  console.log('  ✗ 预览渲染失败：' + (err && err.message ? err.message : err))
  failed++
}

// ---- R3/R4：README 与资产的结构断言（批次 1 合并验收）----
try {
  // 1) 「试试示例」按钮必须出现在导入区。
  //    前面第 3 步用 --adv 0 重渲染会覆盖同名文件，这里必须自己重新生成 advanced 版。
  preview(['--palette', 'custom', '--adv', '1'])
  const customHtml = read('preview-light-custom.html')
  check(customHtml.includes('试试示例') || customHtml.includes('Try a sample'), '导入区含「试试示例」入口')

  // 2) 五语 README：新章节存在、示例码可被生产 decodeConfig 解析且三色一致
  const src = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
  const store = new Map()
  const win = {
    __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
    __DSH_THEME_PALETTE_DEV_REQUEST__: true,
    __DSH_THEME_PALETTE_DEV__: (api) => { globalThis.__api = api },
  }
  new Function('window', 'localStorage', 'document', 'navigator', src)(
    win,
    { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    { documentElement: { lang: 'zh-CN' } },
    { language: 'zh' },
  )
  globalThis.__def.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => 'mono' }))
  const { decodeConfig, encodeConfig } = globalThis.__api

  // 六语 README：标题逐字一致、示例码可被生产 decodeConfig 解析并往返自等。
  // 集合口径（审计 2026-10-29 P2-11）：UI 支持的每门语言都要有 README（en / zh / ja），
  // 其余语种（es / pt / hi）是额外翻译，可以多但不能少。
  const readmeFiles = ['README.md', 'README-zh.md', 'README-ja.md', 'README-es.md', 'README-pt.md', 'README-hi.md']
  const codeRe = /dshs1\.[A-Za-z0-9_-]{20,}/g
  let headingsBase = null
  for (const f of readmeFiles) {
    const text = fs.readFileSync(path.join(root, f), 'utf8')
    check(text.includes('## Pitfalls we hit') && text.includes('## Sharing') && text.includes('## Trade-offs'), `${f} 含三个新章节`)
    const code = (text.match(codeRe) || [])[0]
    check(!!code, `${f} 含示例短码`)
    if (code) {
      const decoded = decodeConfig(code)
      check(!!decoded && !!decoded.custom && decoded.custom.accent === '#3f66a3', `${f} 示例码解码三色一致`)
      // 往返自等（2026-10-28 P1-f）：README 里的示例码曾经还带着 1.9.10 已撤除的 "r":"sidebar"，
      // decode 仍能读、三色也对，所以上面的断言查不出来；只有「再编码一次等于自己」才能发现它过期。
      const round = decoded ? encodeConfig(decoded) : ''
      check(round === code, `${f} 示例码由生产编码器往返自等（过期码会红）`)
    }
    // 标题一致性（比较前剥掉 \r：工作区里各文件的行尾可能不同，标题集合不该被行尾影响）
    const headings = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.startsWith('## ')).sort().join('\n')
    if (headingsBase === null) headingsBase = headings
    else check(headings === headingsBase, `${f} 的 ## 标题与 README.md 一致`)
  }

  // 2a-2) 「What it does」的要点条数必须一致（审计 2026-10-29 P2-6）。
  //    标题一致只保证章节在，不保证**内容条目**没少 —— 1.13.1 的 es/pt/hi 就少了一条
  //    「自定义配色 + 短码导入导出 + 高对比 + 4 语界面」，而标题比对完全看不出来。
  {
    const counts = []
    for (const f of readmeFiles) {
      // 统一成 LF 再扫：Windows 检出（core.autocrlf=true）默认把工作区换成 CRLF，
      // 而仓库里存的是 LF —— 只认 LF 的话这条检查会「只在 Windows 本机红、CI 绿」，
      // 属于典型的假红（2026-10-31 实测踩到）。
      const text = fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n')
      const start = text.indexOf('\n## What it does\n')
      const end = start < 0 ? -1 : text.indexOf('\n## ', start + 1)
      if (start < 0 || end < 0) { check(false, `${f} 找不到 ## What it does 段落`); continue }
      const bullets = text.slice(start, end).split('\n').filter((l) => /^- /.test(l)).length
      counts.push(`${f}=${bullets}`)
      check(bullets > 0, `${f} 的 ## What it does 有要点（实得 ${bullets} 条）`)
    }
    const uniq = new Set(counts.map((c) => c.split('=')[1]))
    check(uniq.size === 1, `六语的 ## What it does 要点条数一致（${counts.join(' / ')}）`)
  }

  // 2a-3) locale 元数据集合（审计 2026-10-29 P2-10 / P2-11）：
  //    locale/*.json 不是 UI 文案（UI 文案内联在 client.js，70 键 × 4 语），
  //    而是**目录/市场页的元数据**。既然如此就要把它的口径钉住：
  //    ① 每份只有 meta.title / meta.description（不能偷偷塞 UI 文案进去又没人读）；
  //    ② 每份的 key 集完全一致；
  //    ③ 每种 README 语言都有对应的 locale 元数据（少一个，市场页就缺一门语言的简介）。
  {
    const localeDir = path.join(root, 'locale')
    const localeFiles = fs.readdirSync(localeDir).filter((f) => f.endsWith('.json'))
    let keyBase = null
    for (const f of localeFiles) {
      const data = JSON.parse(fs.readFileSync(path.join(localeDir, f), 'utf8'))
      const keys = Object.keys(data).sort().join(',')
      if (keyBase === null) keyBase = keys
      else check(keys === keyBase, `locale/${f} 的顶层 key 与其它 locale 一致（${keys}）`)
      const meta = data.meta || {}
      check(typeof meta.title === 'string' && typeof meta.description === 'string',
        `locale/${f} 只有 meta.title / meta.description（市场页元数据）`)
    }
    const localeLangs = localeFiles.map((f) => f.replace(/\.json$/, ''))
    const readmeLangs = readmeFiles.map((f) => (f === 'README.md' ? 'en' : f.replace(/^README-/, '').replace(/\.md$/, '')))
    const missing = readmeLangs.filter((l) => !localeLangs.includes(l))
    check(missing.length === 0, `每种 README 语言都有 locale 元数据（缺：${missing.join(',') || '无'}）`)
    for (const uiLang of ['en', 'zh', 'zh-TW', 'ja']) {
      check(localeLangs.includes(uiLang), `UI 语言 ${uiLang} 有 locale 元数据`)
    }
  }

  // 2b) 文档口径对账门（2026-10-28 P1-a/d）：README 里最容易被手改漂移的两处数字。
  //     · 「深色链接 6.4」是错的：代码真源 MIN_LINK_DARK = 4.62，深色链接另过 APCA Lc ≥ 60。
  //     · 「27,000+ 处 token 引用」不可复现：今天可复现的量是 158 个 token × 1080 组设置。
  for (const f of readmeFiles) {
    const text = fs.readFileSync(path.join(root, f), 'utf8')
    check(!/27[,.](000|000)\+/.test(text), `${f} 不再出现不可复现的「27,000+ 处 token 引用」`)
    const linkClaim = text.match(/链接[^；;]{0,60}?6\.4/) || text.match(/link[^;]{0,60}?6\.4/) || null
    check(linkClaim === null, `${f} 不再把深色链接承诺写成 6.4（真源 4.62 + APCA Lc 60）`)
  }

  // 升级提示与版本同步（审计 2026-10-27 P3-11）：每版要手改 4 个语种的 notice，
  // 之前只断言「可渲染」—— 文案里忘改版本号不会红。这里钉住：恰好 4 条，且都含当前版本号。
  {
    const versionNow = (src.match(/PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1]
    const notices = src.match(/notice: '[^']*'/g) || []
    check(notices.length === 4, `四语种都有 notice 文案（实得 ${notices.length}）`)
    check(notices.length === 4 && notices.every((s) => s.includes(versionNow)),
      `每条 notice 都含当前版本号 ${versionNow}（升级时四处文案要一起改）`)
  }

  // 3) screenshots.json 与资产文件一致
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'screenshots.json'), 'utf8'))
  check(manifest.length === 4, 'screenshots.json 为 4 条')
  for (const rel of manifest) check(fs.existsSync(path.join(root, rel)), `资产存在：${rel}`)

  // 4) 截图元数据：清单 ↔ 磁盘 ↔ 当前设置页三重对齐。
  //    目的：改了设置页结构或配色却忘了重拍，这里会红 —— 而不是让列表卡片继续展示已经不存在的控件。
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'screenshots.meta.json'), 'utf8'))
  const pluginVersion = (fs.readFileSync(path.join(root, 'client.js'), 'utf8')
    .match(/PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1]
  const images = Array.isArray(meta.images) ? meta.images : []
  check(images.length === 4, 'screenshots.meta.json 为 4 条')
  check(meta.pluginVersion === pluginVersion, `截图记录的版本与插件一致（${meta.pluginVersion} / ${pluginVersion}）`)
  check(images.map((e) => e.file).join() === manifest.join(), 'meta 与 screenshots.json 的文件清单顺序一致')
  for (const e of images) {
    const abs = path.join(root, e.file)
    if (!fs.existsSync(abs)) { check(false, `资产存在：${e.file}`); continue }
    const buf = fs.readFileSync(abs)
    const sha = createHash('sha256').update(buf).digest('hex')
    check(sha === e.sha256 && buf.length === e.bytes, `${path.basename(e.file)} 与清单逐字节一致（${e.width}×${e.height}）`)
    // 用同一组参数重出预览 HTML：设置页结构/配色一变这里就对不上，提示该重拍照了
    preview(e.preview || [])
    const htmlBytes = fs.readFileSync(path.join(root, e.html))
    check(createHash('sha256').update(htmlBytes).digest('hex') === e.htmlSha256,
      `${path.basename(e.file)} 的源预览页未变（变了就重跑 node tools/shoot-settings.mjs）`)
  }
} catch (err) {
  console.log('  ✗ README/资产检查失败：' + (err && err.message ? err.message : err))
  failed++
}

console.log(failed === 0 ? '\n结构检查通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
