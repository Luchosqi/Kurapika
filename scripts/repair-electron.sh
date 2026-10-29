#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ ! -d node_modules/electron ]]; then
  printf 'Instala primero las dependencias con npm install.\n' >&2
  exit 1
fi

version="$(node -p "require('./node_modules/electron/package.json').version")"
case "$(uname -m)" in
  x86_64) architecture=x64 ;;
  aarch64) architecture=arm64 ;;
  *) printf 'Arquitectura Linux no compatible.\n' >&2; exit 1 ;;
esac

archive="electron-v${version}-linux-${architecture}.zip"
expected="$(node -e 'const checksum = require("./node_modules/electron/checksums.json")[process.argv[1]]; if (!checksum) process.exit(1); process.stdout.write(checksum)' "$archive")"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

if [[ -n "${KURAPIKA_ELECTRON_ARCHIVE:-}" ]]; then
  cp -- "$KURAPIKA_ELECTRON_ARCHIVE" "$temporary/$archive"
else
  curl -fL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 10 \
    -o "$temporary/$archive" \
    "https://github.com/electron/electron/releases/download/v${version}/${archive}"
fi

actual="$(sha256sum "$temporary/$archive")"
actual="${actual%% *}"
if [[ "$actual" != "$expected" ]]; then
  printf 'El SHA-256 del binario de Electron no coincide.\n' >&2
  exit 1
fi

mkdir -p node_modules/electron/dist
unzip -oq "$temporary/$archive" -d node_modules/electron/dist
printf electron > node_modules/electron/path.txt
printf 'Electron %s instalado y verificado.\n' "$version"
