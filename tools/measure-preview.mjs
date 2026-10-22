#!/usr/bin/env node
/**
 * 版面探针：把设置页在指定**内容宽**下渲染，量出
 *   ① 是否有元素越过内容右边界（A4 的验收判据）
 *   ② 每一行的实际高度（A4：≤84px）
 *   ③ 关键元素的计算颜色（A1/A8：卡片名是否 label-primary、hint 是否 secondary）
 *
 * 用法：node tools/measure-preview.mjs [--file preview-light.html] [--width 564]
 * 退出码：0 无越界，1 有越界
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }

const fileArg = arg('file', 'preview-light.html')
const htmlPath = path.isAbsolute(fileArg) ? fileArg : path.join(here, fileArg)
const VIEW = Number(arg('width', '564')) + 56

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p))
if (!CHROME) { console.error('找不到 Chrome / Edge'); process.exit(2) }

const PORT = 9800 + Math.floor(Math.random() * 150)
const profile = path.join(os.tmpdir(), 'palette-measure-' + Date.now())
const child = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${VIEW},1400`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  'file:///' + htmlPath.replace(/\\/g, '/'),
], { stdio: 'ignore' })

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('file:'))
      if (page) return page
    } catch (err) { /* 等启动 */ }
    await sleep(250)
  }
  throw new Error('拿不到调试目标')
}

const page = await target()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res) => { ws.onopen = res })
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (method, params = {}) => new Promise((res) => {
  const n = ++id
  pending.set(n, res)
  ws.send(JSON.stringify({ id: n, method, params }))
})

await send('Runtime.enable')
await sleep(300)

const script = `(() => {
  const root = document.querySelector('.dsh-tp')
  if (!root) return { error: 'no .dsh-tp' }
  const r = root.getBoundingClientRect()
  const limit = r.right + 0.5
  const over = []
  for (const el of root.querySelectorAll('*')) {
    const b = el.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) continue
    if (b.right > limit) over.push({ tag: el.tagName.toLowerCase(), cls: el.className || '', right: +b.right.toFixed(1), text: (el.textContent || '').trim().slice(0, 18) })
  }
  const rows = [...root.querySelectorAll('.dsh-tp-row')].map((el) => ({
    label: ((el.querySelector('b') || {}).textContent || '').trim().slice(0, 14),
    h: +el.getBoundingClientRect().height.toFixed(0),
  }))
  const colorOf = (sel) => {
    const el = root.querySelector(sel)
    return el ? getComputedStyle(el).color : null
  }
  return {
    contentWidth: +r.width.toFixed(1),
    limit: +limit.toFixed(1),
    overflow: over,
    rows,
    nameColor: colorOf('.dsh-tp-card-name'),
    hintColor: colorOf('.dsh-tp-custom-hint'),
    lang: root.getAttribute('lang'),
  }
})()`

const res = await send('Runtime.evaluate', { expression: script, returnByValue: true })
const data = res.result && res.result.result ? res.result.result.value : null
ws.close()
child.kill()

if (!data || data.error) { console.error('量取失败:', data && data.error); process.exit(2) }

console.log(`内容宽 ${data.contentWidth}px · 右边界 ${data.limit} · lang=${data.lang}`)
console.log(`卡片名颜色 ${data.nameColor} · 说明颜色 ${data.hintColor}`)
const tall = data.rows.filter((r) => r.h > 84)
console.log(`行数 ${data.rows.length} · 超高行 ${tall.length}` + (tall.length ? '：' + tall.map((t) => `${t.label}=${t.h}px`).join(', ') : ''))
if (data.overflow.length) {
  console.log('越界元素 ' + data.overflow.length + ':'); 
  for (const o of data.overflow.slice(0, 6)) console.log(`  ${o.tag}.${o.cls} right=${o.right} 「${o.text}」`)
} else {
  console.log('越界元素 0')
}
process.exit(data.overflow.length === 0 ? 0 : 1)
