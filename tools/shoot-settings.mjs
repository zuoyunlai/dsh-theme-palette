#!/usr/bin/env node
/**
 * 把设置页预览 HTML 截成 README / 目录仓库用的 PNG（无头 Chrome + CDP，零第三方依赖）。
 *
 * 为什么要这个脚本：设置页结构一变（例如 1.9.10 撤掉「右侧栏底色」），
 * `assets/screenshot-*.png` 就会悄悄过期 —— 列表卡片的预览图仍在展示已经不存在的控件。
 * 这里把「出图」做成一条命令，并把每张图的 sha256/尺寸/插件版本写进
 * `assets/screenshots.meta.json`，由 `tools/check-ui.mjs` 反查一致性：
 * 图被手改过、或版本号变了却没重拍，检查就会红。
 *
 * 注意：`screenshots.json` 是**目录仓库的提交契约**（1–8 条相对路径的数组），
 * 不要往里塞元数据 —— 元数据一律写到 screenshots.meta.json。
 *
 * 用法：
 *   node tools/shoot-settings.mjs                 # 一键重拍 4 张并写清单（等于 --all）
 *   node tools/shoot-settings.mjs --all
 *   node tools/shoot-settings.mjs --in tools/preview-light.html --out assets/x.png
 *   可选：--width 620（CSS 像素，默认 620，与真机设置页内容宽一致）
 *         --scale 1（设备像素比，默认 1；2 出 Retina 双倍图）
 * 退出码：0 成功 / 2 参数或环境问题（如本机没有 Chrome/Edge）
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const has = (k) => argv.includes('--' + k)

const WIDTH = Number(arg('width', '620'))
const SCALE = Number(arg('scale', '1'))
const META = path.join(root, 'assets', 'screenshots.meta.json')

/** 四张图各自的构型：折叠态出浅/深，展开对比度矩阵出高对比/自定义（与历史资产同构） */
const SHOTS = [
  { out: 'assets/screenshot-settings-light.png', html: 'tools/preview-light.html', preview: ['--palette', 'warm', '--adv', '0'] },
  { out: 'assets/screenshot-settings-dark.png', html: 'tools/preview-dark.html', preview: ['--palette', 'warm', '--adv', '0'] },
  // 顺序与 screenshots.json 既有条目一致（light, dark, custom, hc），避免每次重拍都改契约文件
  { out: 'assets/screenshot-settings-custom.png', html: 'tools/preview-light-customadv.html', preview: ['--palette', 'custom', '--adv', '1', '--out', 'customadv'] },
  { out: 'assets/screenshot-settings-hc.png', html: 'tools/preview-light-hcadv.html', preview: ['--hc', '1', '--adv', '1', '--out', 'hcadv'] },
]
/** 目录仓库契约文件（数组，1–8 条相对路径），由本脚本保持与 assets 同步，形状不可改 */
const CONTRACT = path.join(root, 'screenshots.json')

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) {
  console.error('找不到 Chrome/Edge：截图需要本机有无头浏览器。请先安装，或改用 --in/--out 单张模式在别的机器上出图。')
  process.exit(2)
}

class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = new Map() }
  static async attach (url) {
    const ws = new WebSocket(url)
    const c = new CDP(ws)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP websocket 连接失败')) })
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id); c.pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      } else if (msg.method) {
        const list = c.events.get(msg.method) || []
        list.forEach((fn) => fn(msg.params)); c.events.set(msg.method, [])
      }
    }
    return c
  }
  send (method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.pending.set(id, { res, rej }))
  }
  once (method) {
    return new Promise((res) => { const l = this.events.get(method) || []; l.push(res); this.events.set(method, l) })
  }
}

async function launch () {
  const port = 9300 + Math.floor(Math.random() * 600)
  const profile = path.join(os.tmpdir(), 'dsh-tp-shot-' + Date.now())
  const child = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--disable-gpu',
    '--allow-file-access-from-files',
    '--force-color-profile=srgb',
    `--window-size=${WIDTH},1200`,
    'about:blank',
  ], { stdio: 'ignore' })

  let version = null
  for (let i = 0; i < 160; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) { version = await r.json(); break }
    } catch {}
    await sleep(150)
  }
  if (!version) { try { child.kill() } catch {}; throw new Error('无头浏览器没起来（devtools 端口无响应）') }
  return { port, profile, child, browser: version.Browser }
}

/** 截一张：整页（.page 的底边为准），不做裁切与缩放之外的处理 */
async function shoot (cdp, htmlAbs, outAbs) {
  const loaded = cdp.once('Page.loadEventFired')
  await cdp.send('Page.navigate', { url: 'file:///' + htmlAbs.replace(/\\/g, '/') })
  await loaded
  await sleep(350)
  await cdp.send('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready', awaitPromise: true })
  await sleep(150)
  const meas = await cdp.send('Runtime.evaluate', {
    expression: "(() => { const p = document.querySelector('.page'); if (!p) return document.documentElement.scrollHeight; const r = p.getBoundingClientRect(); return Math.ceil(r.bottom + (window.scrollY || 0)); })()",
    returnByValue: true,
  })
  const h = Math.ceil(meas.result.value)
  if (!(h > 0)) throw new Error('量不到页面高度：' + path.basename(htmlAbs))
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: h, deviceScaleFactor: 1, mobile: false })
  await sleep(200)
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: WIDTH, height: h, scale: SCALE },
  })
  writeFileSync(outAbs, Buffer.from(shot.data, 'base64'))
  const b = readFileSync(outAbs)
  return { cssWidth: WIDTH, cssHeight: h, width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }
}

const pluginVersion = (() => {
  const src = readFileSync(path.join(root, 'client.js'), 'utf8')
  const m = src.match(/PLUGIN_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (!m) throw new Error('client.js 里找不到 PLUGIN_VERSION')
  return m[1]
})()

const single = arg('in') && arg('out')
let browser = null
const entries = []
try {
  const env = await launch()
  browser = env
  const list = await (await fetch(`http://127.0.0.1:${env.port}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  const cdp = await CDP.attach(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1200, deviceScaleFactor: 1, mobile: false })

  if (single) {
    const inAbs = path.resolve(arg('in'))
    const outAbs = path.resolve(arg('out'))
    if (!existsSync(inAbs)) { console.error('找不到输入 HTML：' + inAbs); process.exit(2) }
    mkdirSync(path.dirname(outAbs), { recursive: true })
    const m = await shoot(cdp, inAbs, outAbs)
    console.log(`✓ ${path.relative(root, outAbs)}  ${m.width}x${m.height}  ${Math.round(m.bytes / 1024)}KB`)
  } else {
    for (const s of SHOTS) {
      execFileSync(process.execPath, ['tools/preview-settings.mjs', ...s.preview], { cwd: root, stdio: 'ignore' })
      const htmlAbs = path.join(root, s.html)
      const outAbs = path.join(root, s.out)
      mkdirSync(path.dirname(outAbs), { recursive: true })
      const m = await shoot(cdp, htmlAbs, outAbs)
      entries.push({
        file: s.out,
        html: s.html.replace(/\\/g, '/'),
        preview: s.preview,
        htmlSha256: createHash('sha256').update(readFileSync(htmlAbs)).digest('hex'),
        ...m,
      })
      console.log(`✓ ${s.out}  ${m.width}x${m.height}  ${Math.round(m.bytes / 1024)}KB  ${m.sha256.slice(0, 10)}`)
    }
    writeFileSync(META, JSON.stringify({
      generatedAt: new Date().toISOString(),
      pluginVersion,
      chrome: env.browser,
      width: WIDTH,
      scale: SCALE,
      images: entries,
    }, null, 2) + '\n')
    // 目录仓库契约文件：只放相对路径数组（1–8 条），顺序与上面的 SHOTS 一致
    writeFileSync(CONTRACT, JSON.stringify(entries.map((e) => e.file), null, 2) + '\n')
    console.log('\n✓ ' + path.relative(root, META) + '（' + entries.length + ' 条，插件 ' + pluginVersion + '）')
    console.log('✓ screenshots.json 已同步为 ' + entries.length + ' 条相对路径')
  }
} finally {
  if (browser) {
    try { browser.child.kill() } catch {}
    await sleep(300)
    try { rmSync(browser.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
  }
}
