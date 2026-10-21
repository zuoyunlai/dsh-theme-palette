/**
 * 截图回归比对：把一批截图与基线逐张比 sha256，报「新增 / 未变 / 变化」。
 *
 * 为什么用哈希而不是逐像素差分：同一台机器、同一 Chrome、同一视口下渲染是确定的
 * （`--force-color-profile=srgb` + `deviceScaleFactor` 固定），字节相同就真的没变；
 * 变了就是像素变了，不需要容忍阈值。要「变在哪」就看两张 PNG 并排。
 *
 * 用法：
 *   node tools/compare.mjs --dir tools/out/<run>            # 与基线比
 *   node tools/compare.mjs --dir tools/out/<run> --update   # 把这次设为新基线
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const has = (k) => argv.includes('--' + k)

const dir = path.resolve(arg('dir', path.join(here, 'out')))
const base = path.resolve(arg('baseline', path.join(here, 'baseline')))
if (!fs.existsSync(dir)) { console.error('找不到截图目录：' + dir); process.exit(2) }

const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)
const pngs = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).sort() : []

if (has('update')) {
  fs.mkdirSync(base, { recursive: true })
  for (const f of fs.readdirSync(base)) if (f.endsWith('.png')) fs.unlinkSync(path.join(base, f))
  for (const f of pngs(dir)) fs.copyFileSync(path.join(dir, f), path.join(base, f))
  console.log(`✓ 基线已更新：${base}（${pngs(dir).length} 张）`)
  process.exit(0)
}

const current = pngs(dir)
const baseline = pngs(base)
if (baseline.length === 0) {
  console.log('还没有基线。第一次请跑：node tools/compare.mjs --dir ' + path.relative(process.cwd(), dir) + ' --update')
  process.exit(2)
}

const rows = []
let changed = 0
let missing = 0
for (const name of current) {
  const inBase = baseline.includes(name)
  const same = inBase && hash(path.join(dir, name)) === hash(path.join(base, name))
  if (!inBase) missing++
  else if (!same) changed++
  rows.push({ name, status: !inBase ? '新增（基线里没有）' : same ? '未变' : '变化', size: fs.statSync(path.join(dir, name)).size })
}
const gone = baseline.filter((n) => !current.includes(n))

const pad = (s, n) => String(s).padEnd(n)
console.log(pad('截图', 26) + pad('状态', 18) + '大小')
for (const r of rows) console.log(pad(r.name, 26) + pad(r.status, 18) + (r.size / 1024).toFixed(0) + ' KB')
if (gone.length) console.log('\n基线里有、这次没抓：' + gone.join(', '))

console.log(`\n合计 ${current.length} 张：未变 ${current.length - changed - missing}，变化 ${changed}，新增 ${missing}`)
process.exit(changed + missing > 0 ? 1 : 0)
