#!/usr/bin/env bash
# Build the client (Node 22 from .tools) and cross-compile a static
# linux/arm64 server binary with the client embedded:
#   dist/dogfight-linux-arm64, dist/VERSION
# Refuses to run on a dirty tree so the stamped version names real code.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain)" ]]; then
  echo "release: working tree is dirty; commit or stash first" >&2
  git status --short >&2
  exit 1
fi
VERSION="$(git describe --always --dirty)"

export PATH="$PWD/.tools/node/bin:$PATH"
if ! node --version | grep -q '^v22\.'; then
  echo "release: need Node 22 at .tools/node/bin (found $(node --version 2>/dev/null || echo none))" >&2
  exit 1
fi

# go.mod's toolchain line pins the patched Go; GOTOOLCHAIN=local (or an older
# go that cannot switch) would silently build with something else.
want="$(sed -n 's/^toolchain //p' go.mod)"
if [[ -n "$want" && "$(go env GOVERSION)" != "$want" ]]; then
  echo "release: go.mod wants $want, go here is $(go env GOVERSION) (unset GOTOOLCHAIN=local)" >&2
  exit 1
fi

echo "release: client"
(cd client && npm ci --no-audit --no-fund && npm run build)

echo "release: server $VERSION (linux/arm64)"
mkdir -p dist
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
  go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o dist/dogfight-linux-arm64 ./cmd/dogfight
printf '%s\n' "$VERSION" > dist/VERSION
file dist/dogfight-linux-arm64
echo "release: dist/dogfight-linux-arm64 $VERSION"
