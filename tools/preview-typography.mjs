#!/usr/bin/env node
/**
 * 字体体系对照：三套预置 × 明暗，用生产 token 渲染同一段文字。
 * 目的：一眼看出"正文/次级/三级/链接"在三套配色里是否同一套规则。
 *
 * 用法：node tools/preview-typography.mjs → tools/preview-typography.html
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

let engine = null
const win = {
  __ModuleLoader__: { load: (d) => { globalThis.__def = d } },
  __DSH_THEME_PALETTE_DEV_REQUEST__: true,
  __DSH_THEME_PALETTE_DEV__: (api) => { engine = api },
}
new Function('window', 'localStorage', 'document', 'navigator', source)(
  win, { getItem: () => null, setItem: () => {} },
  { documentElement: { lang: 'zh-CN' } }, { language: 'zh' },
)
globalThis.__def.factory(() => ({ createElement: () => null, useState: (v) => [v, () => {}], useSyncExternalStore: () => 'mono' }))
if (!engine) throw new Error('dev hook missing')

const { buildTokens, SCHEMES } = engine
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const ids = ['warm', 'indigo', 'moss']

const panel = (scheme, mode) => {
  const t = buildTokens(scheme, 'deep', 'tinted', 'tinted', 'accent', 'on', false)
  const g = (k) => t['--dsw-static-neutral-bluish-' + k][mode]
  const canvas = mode === 'light' ? g('00') : g('950')
  const body = mode === 'light' ? g('1000') : g('50')
  const sec = mode === 'light' ? g('700') : g('300')
  const ter = mode === 'light' ? g('600') : g('400')
  const link = t['--dsw-alias-link'][mode]
  const h = t['--dshtp-md-h1'][mode]
  return `<section class="panel" style="background:${canvas};color:${body}">
  <div class="tag" style="color:${ter}">${esc(scheme.label)} · ${mode === 'light' ? '浅色' : '深色'}</div>
  <div class="h" style="color:${h}">标题 Heading</div>
  <p class="body">正文：配色求解在真实承载面上进行，正文 ${esc(body)}。</p>
  <p class="sec" style="color:${sec}">次级：说明与辅助信息 ${esc(sec)}。</p>
  <p class="ter" style="color:${ter}">三级：注释与元信息 ${esc(ter)}。</p>
  <p class="link" style="color:${link}">链接 ${esc(link)}</p>
</section>`
}

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>字体体系对照</title>
<style>
html,body{margin:0;background:#111;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.page{display:inline-block}
.grid{display:grid;grid-template-columns:repeat(3,320px);gap:14px;padding:16px}
.panel{border-radius:12px;padding:14px 16px;min-height:190px}
.tag{font-size:11px;margin-bottom:6px}
.h{font-size:18px;font-weight:600;margin:2px 0 8px}
p{margin:4px 0;font-size:13px;line-height:1.55}
</style></head><body><div class="page">
<div class="grid">${ids.map((id) => panel(SCHEMES.find((s) => s.id === id), 'light')).join('')}</div>
<div class="grid">${ids.map((id) => panel(SCHEMES.find((s) => s.id === id), 'dark')).join('')}</div>
</div></body></html>`

const out = path.join(here, 'preview-typography.html')
fs.writeFileSync(out, html)
console.log('✓ ' + out)