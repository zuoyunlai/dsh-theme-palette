/**
 * 把一个本地 HTML 整页截成 PNG（通用；默认 tools/preview.html）。
 * 无需登录、无需重启 App —— 这是「配色系统」这一层的视觉回归。
 *
 * 用法：node tools/shoot-sheet.mjs [--out tools/out/<run>] [--width 760] [--scale 1]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }

const fileArg = arg('file', 'preview.html')
const htmlPath = path.isAbsolute(fileArg) ? fileArg : path.join(here, fileArg)
if (!existsSync(htmlPath)) { console.error('找不到页面：' + htmlPath); process.exit(2) }

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const outDir = path.resolve(arg('out', path.join(here, 'out', stamp)))
const W = Number(arg('width', '760'))
const SCALE = Number(arg('scale', '1'))
mkdirSync(outDir, { recursive: true })

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) { console.error('找不到 Chrome / Edge'); process.exit(2) }

const PORT = 9400 + Math.floor(Math.random() * 300)
const profile = path.join(os.tmpdir(), 'palette-sheet-' + Date.now())
const child = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu',
  '--allow-file-access-from-files', '--force-color-profile=srgb', `--window-size=${W},1000`, 'about:blank',
], { stdio: 'ignore' })

async function waitDevtools() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return r.json() } catch {}
    await sleep(150)
  }
  throw new Error('devtools 未就绪')
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = new Map() }
  static async attach(url) {
    const ws = new WebSocket(url)
    const c = new CDP(ws)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')) })
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
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.pending.set(id, { res, rej }))
  }
  once(method) {
    return new Promise((res) => { const l = this.events.get(method) || []; l.push(res); this.events.set(method, l) })
  }
}

const main = async () => {
  try {
    await waitDevtools()
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const target = list.find((t) => t.type === 'page')
    const cdp = await CDP.attach(target.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: 1, mobile: false })

    const manifest = []
    for (const v of [0]) {
      const url = 'file:///' + htmlPath.replace(/\\/g, '/') + '?v=' + v
      const loaded = cdp.once('Page.loadEventFired')
      await cdp.send('Page.navigate', { url })
      await loaded
      await sleep(300)
      await cdp.send('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready', awaitPromise: true })
      const meas = await cdp.send('Runtime.evaluate', {
        expression: "(() => { const p = document.querySelector('.page'); return Math.ceil(p.getBoundingClientRect().height + 32); })()",
        returnByValue: true,
      })
      const h = Math.ceil(meas.result.value)
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: h, deviceScaleFactor: 1, mobile: false })
      await sleep(200)
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: W, height: h, scale: SCALE },
      })
      const buf = Buffer.from(shot.data, 'base64')
      const name = path.basename(htmlPath, '.html') + '.png'
      writeFileSync(path.join(outDir, name), buf)
      manifest.push({ name, view: v, px: `${W * SCALE}x${h * SCALE}`, sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16) })
      console.log(`✓ ${name}  ${W * SCALE}x${h * SCALE}`)
    }
    writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ html: 'tools/sheet.html', width: W, scale: SCALE, shots: manifest }, null, 2) + '\n')
    console.log('\n输出：' + outDir)
  } finally {
    try { child.kill() } catch {}
    await sleep(200)
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
  }
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
