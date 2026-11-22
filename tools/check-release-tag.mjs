import assert from 'node:assert/strict'
import { existingReleaseTag } from './release-tag.mjs'
const tag = 'v1.2.3'
function git(target) {
  return (...args) => {
    if (args.join(' ') === 'tag --list ' + tag) return target ? tag : ''
    if (args.join(' ') === 'rev-parse --verify refs/tags/' + tag + '^{commit}') return target
    if (args.join(' ') === 'rev-parse --verify HEAD^{commit}') return 'head'
    throw new Error('unexpected git command ' + args.join(' '))
  }
}
assert.equal(existingReleaseTag(git(null), tag), false)
assert.equal(existingReleaseTag(git('head'), tag), true)
assert.throws(() => existingReleaseTag(git('other'), tag), /指向其他提交/)
assert.throws(() => existingReleaseTag(() => { throw Error('git failed') }, tag), /git failed/)
console.log('tag identity: absent / same commit / different commit / git failure: PASS')
