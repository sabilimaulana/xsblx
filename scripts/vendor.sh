#!/usr/bin/env bash
# Fetch the vendored reference repositories into repos/ at their pinned tags.
#
# repos/ is gitignored: these are read-only reference sources for humans and
# coding agents, not dependencies. Application code never imports from them.
#
# Usage: ./scripts/vendor.sh [name ...]   (default: all)
set -euo pipefail

cd "$(dirname "$0")/.."

# name|github repo|tag
VENDORED=(
  "effect|Effect-TS/effect|effect@4.0.0-beta.103"
  "alchemy|alchemy-run/alchemy|v2.0.0-beta.70"
  "effect-query|voidhashcom/effect-query|v1.0.4"
  "better-auth|better-auth/better-auth|v1.7.0-rc.4"
  "effect-machine|typeonce-dev/effect-machine|@typeonce/effect-machine@0.3.0"
)

fetch() {
  local name=$1 repo=$2 tag=$3
  # Tags contain @ and / (e.g. "@typeonce/effect-machine@0.3.0"); both must be
  # percent-encoded or GitHub reads them as path segments.
  local encoded
  encoded=$(printf '%s' "$tag" | sed -e 's|@|%40|g' -e 's|/|%2F|g')
  local url="https://github.com/${repo}/archive/refs/tags/${encoded}.tar.gz"
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  echo "→ ${name} @ ${tag}"
  curl -fsSL -o "$tmp/src.tar.gz" "$url"
  mkdir -p "$tmp/x"
  tar xzf "$tmp/src.tar.gz" -C "$tmp/x"

  rm -rf "repos/${name}"
  mkdir -p repos
  mv "$tmp/x"/*/ "repos/${name}"
}

wanted=("$@")
for entry in "${VENDORED[@]}"; do
  IFS='|' read -r name repo tag <<<"$entry"
  if [ ${#wanted[@]} -eq 0 ] || printf '%s\n' "${wanted[@]}" | grep -qx "$name"; then
    fetch "$name" "$repo" "$tag"
  fi
done

echo "Done. repos/ is gitignored — do not commit it."
