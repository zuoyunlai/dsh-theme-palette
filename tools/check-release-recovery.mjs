import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { existingReleaseTag } from './release-tag.mjs'

// Exercise the real post-registry CLI branch without allowing Git, npm or network access.
const src = readFileSync(new URL('./release.mjs', import.meta.url), 'utf8')
const stage = src.match(/^const tagAndPush = [\s\S]*?^}/m)?.[0]
const tail = src.slice(src.indexOf('// 6. Git tag'))
assert.ok(stage && tail.includes('!tagAndPush()') && tail.includes('console.log'))
const tag = 'v1.2.3', calls = [], logs = []
let localTag = false, remoteTag = false, reject = true
function git(...args) {
  const cmd = args.join(' ')
  calls.push(cmd)
  switch (cmd) {
    case 'config --get user.signingkey': return ''
    case 'tag --list '+tag: return localTag ? tag : ''
    case 'tag -a '+tag+' -m fixture 1.2.3': assert.equal(localTag,false); localTag=true; return ''
    case 'rev-parse --verify refs/tags/'+tag+'^{commit}': assert.ok(localTag); return 'abc'
    case 'rev-parse --verify HEAD^{commit}': return 'abc'
    case 'push origin main '+tag: if(reject) throw Error('fixture: rejected'); remoteTag=true; return ''
    default: throw Error('unexpected command: '+cmd)
  }
}
const run = () => vm.runInNewContext(stage+'\n'+tail, {
  existingReleaseTag, git, tag, name:'fixture', version:'1.2.3', has:f=>f==='tag',
  console:{log:s=>logs.push(s)}, ok:s=>logs.push(s), warn:s=>logs.push(s), die:s=>{throw Error(s)},
})
assert.throws(run,/不要重发 npm/)
assert.ok(localTag && !remoteTag)
assert.ok(!logs.some(s=>s.includes('完成：')))
reject=false
run()
assert.ok(remoteTag)
assert.equal(calls.filter(x=>x.startsWith('tag -a ')).length,1)
assert.equal(calls.filter(x=>x.startsWith('push ')).length,2)
assert.ok(logs.some(s=>s.includes('完成：')))
console.log('PASS: rejected -> no completion -> same tag reused -> retry completed (no real push)')
