#!/usr/bin/env bash
# Fetch the vendored reference repositories into repos/ at their pinned tags.
#
# repos/ is gitignored: these are read-only reference sources for humans and
# coding agents, not dependencies. Application code never imports from them.
#
# Usage: ./scripts/vendor.sh [name ...]   (default: all)
set -euo pipefail

cd "$(dirname "$0")/.."

# name|github repo|ref (a tag, or a 40-character commit sha)
VENDORED=(
  "effect|Effect-TS/effect|effect@4.0.0"
  # Tracks the catalog:alchemy pin (ADR 0028).
  "alchemy|alchemy-run/alchemy|v2.0.0-beta.80"
  "effect-query|voidhashcom/effect-query|v1.0.4"
  "effect-machine|typeonce-dev/effect-machine|@typeonce/effect-machine@0.3.0"
)

fetch() {
  local name=$1 repo=$2 ref=$3
  # Tags contain @ and / (e.g. "@typeonce/effect-machine@0.3.0"); both must be
  # percent-encoded or GitHub reads them as path segments.
  local encoded
  encoded=$(printf '%s' "$ref" | sed -e 's|@|%40|g' -e 's|/|%2F|g')
  # A tag lives under refs/tags; a commit sha does not resolve there and is
  # fetched as a bare ref instead.
  local path
  if [[ $ref =~ ^[0-9a-f]{40}$ ]]; then
    path="${ref}"
  else
    path="refs/tags/${encoded}"
  fi
  local url="https://github.com/${repo}/archive/${path}.tar.gz"
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  echo "→ ${name} @ ${ref}"
  curl -fsSL -o "$tmp/src.tar.gz" "$url"
  mkdir -p "$tmp/x"
  tar xzf "$tmp/src.tar.gz" -C "$tmp/x"

  rm -rf "repos/${name}"
  mkdir -p repos
  mv "$tmp/x"/*/ "repos/${name}"
}

wanted=("$@")
for entry in "${VENDORED[@]}"; do
  IFS='|' read -r name repo ref <<<"$entry"
  if [ ${#wanted[@]} -eq 0 ] || printf '%s\n' "${wanted[@]}" | grep -qx "$name"; then
    fetch "$name" "$repo" "$ref"
  fi
done

echo "Done. repos/ is gitignored — do not commit it."
