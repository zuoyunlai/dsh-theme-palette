// git is injected so release identity checks can be exercised without a remote.
export function existingReleaseTag(git, tag) {
  if (!git('tag', '--list', tag)) return false
  const target = git('rev-parse', '--verify', 'refs/tags/' + tag + '^{commit}')
  if (target !== git('rev-parse', '--verify', 'HEAD^{commit}')) {
    throw new Error(tag + ' 指向其他提交，拒绝覆盖或推送')
  }
  return true
}
