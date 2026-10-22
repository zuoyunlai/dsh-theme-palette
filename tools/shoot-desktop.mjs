/**
 * 桌面版截图回归：通过 CDP 连到运行中的 DSH 桌面窗口，按「配色 × 明暗」逐张截图。
 *
 * 前提：DSH 桌面版必须以调试端口启动一次（见 tools/README.md）：
 *   "DeepSeek Harness.exe" --remote-debugging-port=9333
 *
 * 做法：不改配置、不点菜单 —— 走插件自己的开发期接口
 *   window.__DSH_THEME_PALETTE_DEV__.setPalette('warm')
 *   window.__DSH_THEME_PALETTE_DEV__.setTheme('dark')
 * 抓完会把「原来的配色与明暗偏好」还原（theme 会写进宿主设置，不还会改用户配置）。
 *
 * 用法：
 *   node tools/shoot-desktop.mjs                  # 抓全部 4 套 × 浅/深 → tools/out/<时间戳>/
 *   node tools/shoot-desktop.mjs --only warm,dark  # 只抓指定配色
 *   node tools/shoot-desktop.mjs --port 9333 --out tools/out/run1
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const port = Number(arg('port', '9333'))
const only = String(arg('only', '')).split(',').map((s) => s.trim()).filter(Boolean)
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const outDir = path.resolve(arg('out', path.join(here, 'out', stamp)))

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = new Map() }
  static async attach(url) {
    const ws = new WebSocket(url)
    const c = new CDP(ws)
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws 连接失败')) })
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id)
        c.pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      } else if (msg.method) {
        const list = c.events.get(msg.method) || []
        list.forEach((fn) => fn(msg.params))
        c.events.set(msg.method, [])
      }
    }
    return c
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.pending.set(id, { res, rej }))
  }
}

async function pickPageTarget() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error('拿不到调试目标')
  const list = await res.json()
  const pages = list.filter((t) => t.type === 'page' && /^https?:/.test(t.url))
  if (pages.length === 0) throw new Error('没有找到页面目标（窗口是否已加载？）')
  // 优先 dsh 的页面
  return pages.find((t) => /dsh|127\.0\.0\.1|localhost/.test(t.url)) || pages[0]
}

const evaluate = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(expression + ' → ' + JSON.stringify(r.exceptionDetails).slice(0, 200))
  return r.result.value
}

async function main() {
  const target = await pickPageTarget()
  const cdp = await CDP.attach(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  // 1) 在页面脚本运行**之前**注入开关与收集器。
  //    插件默认不暴露开发接口（需 ?dshThemeDev=1 或 window.__DSH_THEME_PALETTE_DEV_REQUEST__），
  //    桌面 app 的 URL 我们改不了，所以用 CDP 的 addScriptToEvaluateOnNewDocument。
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__DSH_THEME_PALETTE_DEV_REQUEST__ = true;
      window.__DSH_THEME_PALETTE_DEV__ = function (x) {
        if (x && typeof x.setPalette === 'function') window.__DSH_DEV_API__ = x;
        else window.__DSH_ENGINE__ = x;
      };
    `,
  })

  // 2) 重载让它生效（插件在模块求值期读那个 flag）
  const loaded = cdp.once('Page.loadEventFired')
  await cdp.send('Page.reload', { ignoreCache: false })
  await loaded

  // 3) 等插件把 setter 交上来（最多 20 秒）
  let ready = false
  for (let i = 0; i < 40; i++) {
    ready = await evaluate(cdp, '!!(window.__DSH_DEV_API__ && typeof window.__DSH_DEV_API__.setPalette === "function")')
    if (ready) break
    await sleep(500)
  }
  if (!ready) throw new Error('插件未交出自动化接口（检查插件是否已加载、是否 >= 1.4.4）')

  const api = 'window.__DSH_DEV_API__'
  const all = only.length ? only : await evaluate(cdp, `${api}.schemes`)
  const originalPref = await evaluate(cdp, `${api}.getPreference()`)
  const originalPalette = await evaluate(cdp, "localStorage.getItem('dsh-theme-palette.v1') || 'mono'")
  fs.mkdirSync(outDir, { recursive: true })
  const manifest = []

  try {
    for (const scheme of all) {
      for (const mode of ['light', 'dark']) {
        await evaluate(cdp, `${api}.setPalette(${JSON.stringify(scheme)})`)
        await evaluate(cdp, `${api}.setTheme(${JSON.stringify(mode)})`)
        await sleep(700) // 等 presenter 落样式 + 字体
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        const buf = Buffer.from(shot.data, 'base64')
        const name = `${scheme}-${mode}.png`
        fs.writeFileSync(path.join(outDir, name), buf)
        manifest.push({ name, scheme, mode, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex').slice(0, 16) })
        console.log(`✓ ${name}  ${(buf.length / 1024).toFixed(0)} KB`)
      }
    }
  } finally {
    // 还原用户原来的偏好（theme 会写进宿主设置，不还会改用户配置）。
    // 放 finally：中途任何一张截图失败，也不能把宿主的明暗偏好留在被改写状态。
    try {
      await evaluate(cdp, `${api}.setPalette(${JSON.stringify(originalPalette)})`)
      await evaluate(cdp, `${api}.setTheme(${JSON.stringify(originalPref)})`)
      console.log(`已还原配色 ${originalPalette} / 明暗 ${originalPref}`)
    } catch (err) {
      console.error(`✗ 还原失败，请手动把配色改回 ${originalPalette}、明暗改回 ${originalPref}：` + err.message)
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ target: target.url, viewport: await evaluate(cdp, '[innerWidth, innerHeight]'), originalPreference: originalPref, originalPalette, shots: manifest }, null, 2) + '\n')
  console.log(`\n输出目录：${outDir}`)
}

main().catch((e) => { console.error('✗ ' + e.message); process.exit(1) })
