#!/usr/bin/env bash
# Replay only the Latest decision block. No credentials, remote calls or files needed.
set -euo pipefail
block=$(awk '/^          registry_latest=/{p=1} p{done=($0 ~ /^          fi[[:space:]]*$/);sub(/^          /,"");sub(/\r$/,"");print;if(done) exit} END{if(!done) exit 1}' .github/workflows/publish.yml)
[[ -n "$block" ]]
case_run() (
  VERSION=$1; TAG=v$1; PKG=dsh-theme-palette; TARBALL=fixture.tgz
  registry=$2; exists=$3; expected=$4
  npm() { [[ "$1" == view ]] || exit 9; printf '%s' "$registry"; }
  gh() { [[ "$1" == release ]] || exit 9; case "$2" in view) [[ "$exists" == yes ]];; upload|edit|create) printf '%s\n' "$*";; *) exit 9;; esac; }
  PATH=''  # even an accidental new external command must fail, never call a real CLI
  actual=$(set -e; eval "$block")
  [[ "$actual" == "$expected" ]] || { printf 'unexpected calls: %s\n' "$actual" >&2; exit 1; }
)
case_run 2.0.0 2.0.0 no 'release create v2.0.0 fixture.tgz --verify-tag --notes-file release-notes.md --title v2.0.0 — dsh-theme-palette --latest=true'
case_run 1.0.0 2.0.0 yes $'release upload v1.0.0 fixture.tgz --clobber\nrelease edit v1.0.0 --notes-file release-notes.md'
case_run 1.0.0 2.0.0 no 'release create v1.0.0 fixture.tgz --verify-tag --notes-file release-notes.md --title v1.0.0 — dsh-theme-palette --latest=false'
case_run 2.0.1-rc.1 2.0.1-rc.1 no 'release create v2.0.1-rc.1 fixture.tgz --verify-tag --notes-file release-notes.md --title v2.0.1-rc.1 — dsh-theme-palette --latest=false'
printf 'Latest policy: 4/4 passed\n'
