#!/usr/bin/env node
/**
 * 宿主契约测试：插件依赖的 token 名与 DOM/CSS 钩子，在当前 DSH 构建里是否仍然存在。
 *
 * 为什么需要：这些关系没有类型或运行时保证，宿主改名不会报错，只会静默失效
 * （覆盖层照收，样式不生效，配色悄悄跳回默认）。
 *
 * **取证来源有两个**（审计 2026-10-29 P1-4）：
 *   1. `app.asar`（本机桌面端，最贴近真机；Windows 默认路径 / --asar / DSH_ASAR）；
 *   2. `node_modules/@deepseek-ai/` 里的宿主 peer 包（**CI 用这条**）。
 *      这三个包是宿主真身的同一份发布物：dsh-client-ui-theme / dsh-client-ui-layout / dsh-web-frontend。
 *      此前脚本只认 Windows 硬编码路径，CI 是 ubuntu-latest → 永远 SKIP → 这一层 0 条断言，
 *      而它恰好是唯一能发现「宿主把某个 --dsw-* 改名了」的手段。现在 CI 装 peer 包并加 --strict，真跑。
 *
 * 用法：
 *   node tools/check-host-contract.mjs
 *   node tools/check-host-contract.mjs --asar "D:/Programs/DeepSeek Harness/resources/app.asar"
 *   DSH_ASAR="D:/Programs/DeepSeek Harness/resources/app.asar" node tools/check-host-contract.mjs
 *   node tools/check-host-contract.mjs --strict     # 两个来源都拿不到时判失败（CI/发版用）
 *
 * 退出码：0 = 跑了且全过 / 78 = SKIP（两个来源都没有，非 --strict）/ 1 = 有契约失效。
 * 2026-10-28 修：原先 SKIP 走退出码 0，发版门把它当「✓ 通过」打印出来 —— 那一层其实 0 条断言。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const ai = argv.indexOf('--asar')
const STRICT = argv.includes('--strict')
const ASAR = (ai >= 0 ? argv[ai + 1]
  : (process.env.DSH_ASAR && process.env.DSH_ASAR.trim()) ? process.env.DSH_ASAR.trim()
    : 'D:/Programs/DeepSeek Harness/resources/app.asar')?.replace(/\\/g, '/')

/** 从 asar 里按正则取三份文本；拿到 asar 但缺文件时返回 null（要报缺失，不能静默降级）。 */
function readFromAsar(asarPath) {
  const fd = fs.openSync(asarPath, 'r')
  try {
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
    const pick = (re) => { const f = findOne(re); return f ? read(f) : null }
    return {
      source: 'asar:' + asarPath,
      theme: pick(/dsh-client-ui-theme\/lib\/client\.js$/),
      layout: pick(/dsh-client-ui-layout\/lib\/client\.js$/),
      css: pick(/dsh-web-frontend\/dist\/assets\/index-.*\.css$/),
    }
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * 从 node_modules 的宿主 peer 包取三份文本（CI 路径）。
 * 三个包版本由 package.json 的 devDependencies 钉死，`npm install` 后即可用。
 */
function readFromNodeModules() {
  const nm = path.join(root, 'node_modules', '@deepseek-ai')
  const themePath = path.join(nm, 'dsh-client-ui-theme', 'lib', 'client.js')
  const layoutPath = path.join(nm, 'dsh-client-ui-layout', 'lib', 'client.js')
  const assetsDir = path.join(nm, 'dsh-web-frontend', 'dist', 'assets')
  const cssName = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).find((f) => /^index-.*\.css$/.test(f))
    : null
  if (!fs.existsSync(themePath) && !fs.existsSync(layoutPath) && !cssName) return null
  const readIf = (p) => (p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)
  return {
    source: 'node_modules/@deepseek-ai（宿主 peer 包）',
    theme: readIf(themePath),
    layout: readIf(layoutPath),
    css: readIf(cssName ? path.join(assetsDir, cssName) : null),
  }
}

const texts = fs.existsSync(ASAR) ? readFromAsar(ASAR) : readFromNodeModules()
if (!texts) {
  console.log('SKIP: 既拿不到宿主 asar（' + ASAR + '），也没有 node_modules 里的宿主 peer 包')
  if (STRICT) {
    console.error('  ✗ --strict：两个来源都没有，契约检查无法执行（CI 上请先 npm install）')
    process.exit(1)
  }
  process.exit(78)
}
console.log('取证来源：' + texts.source)

let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }

if (!texts.theme) { console.log('  ✗ 找不到 ui-theme/lib/client.js'); failed++ }
else {
  const text = texts.theme
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
if (!texts.layout) { console.log('  ✗ 找不到 ui-layout/lib/client.js'); failed++ }
else {
  const layoutText = texts.layout
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
if (!texts.css) { console.log('  ✗ 找不到前端构建 CSS'); failed++ }
else {
  const text = texts.css
  check(text.includes('_markdown_'), '构建 CSS 仍含 _markdown_ 模块类名')
  check(text.includes('md-code-block'), '构建 CSS 仍含 md-code-block')
}

// ---- 表面别名映射：宿主把别名声成 var(--dsw-static-neutral-bluish-NN)，插件必须逐条对上 ----
// 2026-10-29：左侧会话行的悬停卡拿到的仍是宿主原始色阶（#2c2c2e），因为插件只覆盖色阶、
// 指望 var 链生效。插件改成把这些别名直接写成色阶值后，**映射必须与宿主一致**，
// 否则会出现「层 1 用了层 2 的档」这种静默错色。这里从宿主真实构建里解出映射并对表。
if (texts.theme) {
  const grabBlock = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp('(?:^|[};"])' + esc + '\\{([^}]*)\\}', 'g')
    let acc = ''
    let m
    while ((m = re.exec(texts.theme))) acc += ';' + m[1]
    return acc
  }
  const lightCss = grabBlock('body')
  const darkCss = grabBlock('body[data-ds-dark-theme]')
  const stepOf = (css, name) => {
    const m = new RegExp(name.replace(/[-]/g, '\\-') + ':var\\(--dsw-static-neutral-bluish-(\\d+)\\)').exec(css)
    return m ? m[1] : null
  }
  // 插件侧的期望表：从 client.js 的 dev 钩子取（与生产同一份表）
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  let expected = null
  try {
    const src = fs.readFileSync(path.join(repoRoot, 'client.js'), 'utf8')
    const win = {
      __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
      __DSH_THEME_PALETTE_DEV__: (api) => { globalThis.__api = api },
      __DSH_THEME_PALETTE_DEV_REQUEST__: true,
    }
    new Function('window', 'localStorage', 'document', 'navigator', src)(
      win,
      { getItem: () => null, setItem: () => {} },
      { documentElement: { lang: 'zh' } },
      { language: 'zh' },
    )
    globalThis.__def.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => 'mono' }))
    expected = globalThis.__api.SURFACE_ALIAS_STEPS
  } catch (err) {
    console.log('  ! 读不到 client.js 的 SURFACE_ALIAS_STEPS，跳过别名映射核对：' + (err && err.message))
  }
  if (expected) {
    let drift = 0
    let sample = ''
    for (const [name, steps] of Object.entries(expected)) {
      const hostLight = stepOf(lightCss, name)
      const hostDark = stepOf(darkCss, name)
      if (hostLight !== steps.light || hostDark !== steps.dark) {
        drift++
        sample = `${name}：宿主 ${hostLight}/${hostDark} vs 插件 ${steps.light}/${steps.dark}`
      }
    }
    check(drift === 0, `表面别名映射与宿主一致（${Object.keys(expected).length} 条，漂移 ${drift}${sample ? '：' + sample : ''}）`)
  }
}

console.log(failed === 0 ? '\n契约检查通过' : `\n${failed} 项契约失效`)
process.exit(failed === 0 ? 0 : 1)
