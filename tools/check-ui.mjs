#!/usr/bin/env node
/**
 * 设置页结构回归：不启动浏览器，用生产组件的静态渲染检查几个“放错位置就退化”的点。
 *
 *   1. 高对比必须在默认展开区（不能又回到「更多选项」里）
 *   2. 自定义面板必须渲染解释性校正
 *   3. 升级提示可渲染（由 PREVIEW_NOTICE=1 驱动）
 *
 * 这是结构断言，不是视觉验收；真实交互仍需在 GUI 里跑。
 *
 * 用法：node tools/check-ui.mjs
 */
import { execFileSync } from 'node:child_process'
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
  const { decodeConfig } = globalThis.__api

  const readmeFiles = ['README.md', 'README-zh.md', 'README-es.md', 'README-pt.md', 'README-hi.md']
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
    }
    // 标题一致性
    const headings = text.split('\n').filter((l) => l.startsWith('## ')).sort().join('\n')
    if (headingsBase === null) headingsBase = headings
    else check(headings === headingsBase, `${f} 的 ## 标题与 README.md 一致`)
  }

  // 3) screenshots.json 与资产文件一致
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'screenshots.json'), 'utf8'))
  check(manifest.length === 4, 'screenshots.json 为 4 条')
  for (const rel of manifest) check(fs.existsSync(path.join(root, rel)), `资产存在：${rel}`)
} catch (err) {
  console.log('  ✗ README/资产检查失败：' + (err && err.message ? err.message : err))
  failed++
}

console.log(failed === 0 ? '\n结构检查通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
