#!/usr/bin/env bash
# Replay the current workflow's source check against existing 1.13.5 history.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
work=$(mktemp -d)
git clone --quiet --local --no-hardlinks --no-tags --no-checkout "$root" "$work/repo"
cd "$work/repo"
git remote remove origin
TAG=v1.13.5; VERSION=1.13.5
export TAG VERSION
git tag "$TAG" c8fe56d
gate=$(awk '/TAG_SHA=\$\(git rev-parse/{p=1} p && /^[[:space:]]*$/{exit} p{sub(/^          /,"");sub(/\r$/,"");print}' "$root/.github/workflows/publish.yml")
[[ "$gate" == *HEAD_SHA* && "$gate" == *PKG_V* ]]
git checkout --quiet --detach "$TAG"
test "$(node -p "require('./package.json').version")" = "$VERSION"
bash -eu -c "$gate"
git checkout --quiet --detach eaaa990
test "$(node -p "require('./package.json').version")" = "$VERSION"
if bash -eu -c "$gate"; then exit 1; fi
git checkout --quiet --detach "$TAG"
if TAG=v0.0.0 bash -eu -c "$gate"; then exit 1; fi
git tag v1.13.4 HEAD
if TAG=v1.13.4 VERSION=1.13.4 bash -eu -c "$gate"; then exit 1; fi
printf 'Source gate: 4/4 passed\n'
