#!/usr/bin/env node
/**
 * 自愈回归（1.9.8）：覆盖层被宿主撤销后，插件必须自己把配色层放回去。
 *
 * 为什么要有这个脚本：宿主把每一层的 disposer 挂在调用方 fiber 上，插件被卸载/重载、
 * 或 fiber 的 effect 被清理时，这一层就没了 —— 表现是"配色自己跳回默认"，而设置还在。
 * 1.9.7 的判据是"关键 token 的计算值是否为空"，宿主基础 token 永远有值 → 永远报"健康"，
 * 配色却已经丢了（假健康）。1.9.8 改成"标记属性 + 颜色比对"，这里用假宿主逐条验证。
 *
 * 覆盖的场景：
 *   1. 正常应用：层写进 body，标记属性在，宿主侧只有一层
 *   2. 宿主撤销该层：插件能发现并重放（不再假健康）
 *   3. 退避：连续失败不会密集重放
 *   4. 反复失效：达到上限后停用自动重放（只报一次错）
 *   5. 无层累积：重放前先撤旧层
 *   6. 取色拖动（1.11.0）：同一帧内多次改色只重放一次，且以最后一次为准
 *   7. 卸载：插件卸载后不再重放
 *
 * 用法：node tools/check-selfheal.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

let failed = 0
const check = (ok, msg) => { if (ok) console.log('  ✓ ' + msg); else { failed++; console.log('  ✗ ' + msg) } }

// ---- 假宿主：像 ThemeRuntime 那样按 source 存层，dispose 时把该层的 token 从 body 上摘掉 ----
const bodyProps = new Map()          // body 上的 CSS 变量（名字 → 值）
const layers = new Map()             // source → 该层写过的 token 名集合
let overrideCalls = 0                // overrideTokens 被调用的次数（= 1 + 重放次数）
let disposeCalls = 0
const logs = []

const theme = {
  overrideTokens(source, tokens) {
    overrideCalls++
    const layer = { names: new Set(Object.keys(tokens)) }
    layers.set(source, layer)
    for (const [name, pair] of Object.entries(tokens)) {
      bodyProps.set(name, pair && pair.dark ? pair.dark : '')
    }
    return () => {
      disposeCalls++
      // 与宿主一致：disposer 只撤自己创建的那一层；同 source 已被新层顶掉时不动手
      if (layers.get(source) !== layer) return
      layers.delete(source)
      for (const name of layer.names) bodyProps.delete(name)
    }
  },
  getTheme: () => ({ preference: 'dark' }),
  setTheme: () => {},
}

// ---- 假 DOM ----
const listeners = new Map()
const addListener = (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f) }
const removeListener = (t, f) => { if (listeners.has(t)) listeners.get(t).delete(f) }

const document = {
  head: { appendChild() {} },
  createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
  querySelector: () => null,
  documentElement: { lang: 'zh-CN', style: { setProperty() {}, removeProperty() {} } },
  body: { style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, removeAttribute() {} },
  visibilityState: 'visible',
  addEventListener: addListener,
  removeEventListener: removeListener,
  dispatchEvent: (e) => { const s = listeners.get(e.type); if (s) for (const f of s) f(e); return true },
}
const getComputedStyle = () => ({
  getPropertyValue: (name) => (bodyProps.has(name) ? bodyProps.get(name) : ''),
})

// ---- 假时钟：自愈有 900ms 静默期与退避表，用假时钟跑得又快又准 ----
let now = 1_700_000_000_000
const realNow = Date.now
Date.now = () => now
const advance = (ms) => { now += ms }
const rafQueue = []
const flushRaf = () => { const q = rafQueue.splice(0, rafQueue.length); for (const fn of q) fn() }

// ---- 沙箱加载 client.js ----
// localStorage 用 Map 实现（而不是恒返 null 的桩）：场景 6 要验证「帧内取最后一次生效」，
// 恒 null 会让 readCustom 每次都回落默认三色，取色永远不生效 —— 与真实宿主行为不符。
const store = new Map()
const sandbox = {
  window: { __ModuleLoader__: { load: (d) => { sandbox.def = d } } },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
  document,
  navigator: { language: 'zh-CN' },
  location: { search: '' },
  getComputedStyle,
  MutationObserver: class { observe() {} disconnect() {} },
  // rAF 批处理（而不是立即执行）：场景 7 要证明「同帧多次取色只重放一次」，
  // 立即执行的 rAF 会把每次排队都当场消费掉，测不出合并。
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length },
  setInterval: () => 0,   // 定时器不跑：场景由测试显式触发
  clearInterval: () => {},
  console: {
    log: (...a) => logs.push(a.join(' ')),
    warn: (...a) => logs.push(a.join(' ')),
    error: (...a) => logs.push(a.join(' ')),
    info: (...a) => logs.push(a.join(' ')),
  },
}
const names = ['window', 'localStorage', 'document', 'navigator', 'location', 'getComputedStyle', 'MutationObserver', 'requestAnimationFrame', 'setInterval', 'clearInterval', 'console']
new Function(...names, source)(...names.map((n) => sandbox[n]))
if (!sandbox.def) throw new Error('拿不到插件定义')

// ---- 假 ctx：抓住 effect 的清理函数、theme/change 订阅与设置页注入的 setter ----
let effectCleanup = null
let settingsInject = null
const handlers = new Map()
const ctx = {
  get: (n) => (n === 'theme' ? theme : undefined),
  effect: (f) => {
    const d = f()
    effectCleanup = typeof d === 'function' ? d : null
    return () => { if (effectCleanup) { effectCleanup(); effectCleanup = null } }
  },
  on: (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) },
  inject: () => {},
  slots: {
    inject: (n, fn) => fn(),
    register: (def) => { settingsInject = def.inject(); return () => {} },
  },
}
const plugin = sandbox.def.factory(() => ({
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids }),
  useState: (v) => [v, () => {}],
  useSyncExternalStore: (sub, get) => get(),
}))

const fireThemeChange = () => { const fn = handlers.get('theme/change'); if (fn) fn() }
const MARK = '--dshtp-layer'
const markPresent = () => bodyProps.has(MARK) && bodyProps.get(MARK) === '1'
/** 模拟宿主撤销这一层：把该层写过的属性从 body 上摘掉（宿主 presenter 就是这么做的） */
const revokeLayer = () => { for (const k of [...bodyProps.keys()]) bodyProps.delete(k); layers.clear() }

try {
  plugin.apply(ctx)

  // 1. 正常应用
  check(overrideCalls === 1, `启动应用一次覆盖层（实得 ${overrideCalls}）`)
  check(markPresent(), '标记属性 --dshtp-layer 已写进 body')
  check(layers.size === 1, '宿主侧只有一层')

  // 2. 宿主撤销该层 → 插件必须发现并重放
  revokeLayer()
  advance(2000)
  fireThemeChange()
  check(overrideCalls === 2, `层被撤销后自动重放（overrideTokens 调用 ${overrideCalls} 次）`)
  check(markPresent(), '重放后标记属性回来了')
  check(layers.size === 1, '重放后宿主侧仍只有一层（旧层已撤）')
  check(logs.some((l) => l.includes('已重放第 1 次')), '日志里有一次重放记录')

  // 3. 退避：紧接着再撤销一次，不该立刻重放
  revokeLayer()
  advance(1000)
  fireThemeChange()
  check(overrideCalls === 2, `退避期内不再重放（overrideTokens 调用 ${overrideCalls} 次）`)

  // 4. 反复失效 → 达到上限后停用（退避表最长 600s，每次推进 700s）
  let guard = 0
  while (guard++ < 40 && !logs.some((l) => l.includes('已停用自动重放'))) {
    revokeLayer()
    advance(700000)
    fireThemeChange()
  }
  const disabled = logs.filter((l) => l.includes('已停用自动重放'))
  check(disabled.length === 1, `反复失效后只报一次停用（实得 ${disabled.length} 次）`)
  const before = overrideCalls
  revokeLayer()
  advance(700000)
  fireThemeChange()
  check(overrideCalls === before, '停用后不再重放')

  // 6. 取色拖动（1.11.0，审计 2026-10-27 P2-4）：同帧多次 setCustomColor 只重放一次，最后一次生效
  if (settingsInject) {
    settingsInject.setPalette('custom')
    settingsInject.setCustomColor('accent', '#112233')
    flushRaf()
    const first = bodyProps.get('--dsw-static-deepseek-500')
    const beforeDrag = overrideCalls
    settingsInject.setCustomColor('accent', '#445566')
    settingsInject.setCustomColor('accent', '#778899')
    check(overrideCalls === beforeDrag, `帧内 2 次取色不触发重放（实得 +${overrideCalls - beforeDrag}）`)
    flushRaf()
    check(overrideCalls === beforeDrag + 1, `帧合并后只重放一次（实得 +${overrideCalls - beforeDrag}）`)
    const last = bodyProps.get('--dsw-static-deepseek-500')
    check(first !== undefined && last !== undefined && first !== last,
      `帧内取最后一次生效（--dsw-static-deepseek-500：${first} → ${last}）`)
  } else {
    check(false, '未捕获设置页 inject（无法验证帧合并）')
  }

  // 7. 卸载后不再重放
  if (effectCleanup) effectCleanup()
  const afterUnload = overrideCalls
  advance(700000)
  fireThemeChange()
  check(overrideCalls === afterUnload, '卸载后不再重放')
  check(disposeCalls >= 1, '卸载时撤掉了覆盖层')
} catch (err) {
  failed++
  console.log('  ✗ 自愈脚本异常：' + (err && err.stack ? err.stack : err))
} finally {
  Date.now = realNow
}

if (failed > 0) {
  console.log('\n自愈回归失败 ' + failed + ' 项')
  process.exitCode = 1
} else {
  console.log('\n自愈回归全部通过')
}
