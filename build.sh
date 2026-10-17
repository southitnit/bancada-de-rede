#!/usr/bin/env sh
# Gera os executáveis da Bancada de Rede em dist/ (Windows, Linux e macOS).
# Precisa só do Go 1.24+. As dependências já estão em vendor/, então funciona offline.
set -eu
cd "$(dirname "$0")"
VERSION="${VERSION:-5.0.0}"
LDF="-s -w -X main.version=${VERSION}"
export CGO_ENABLED=0
mkdir -p dist

# junta o motor de rede (engine-src/*.js -> public/engine.js)
[ -d engine-src ] && sh tools/bundle-engine.sh
[ -f tools/build-i18n.js ] && command -v node >/dev/null && node tools/build-i18n.js

# ícone e manifesto do .exe (arquivos .syso já vêm prontos no projeto)
if command -v rsrc >/dev/null 2>&1; then
  rsrc -arch amd64 -ico assets/icon.ico -manifest assets/bancada.manifest -o rsrc_windows_amd64.syso
  rsrc -arch arm64 -ico assets/icon.ico -manifest assets/bancada.manifest -o rsrc_windows_arm64.syso
fi

build() { echo "  $1/$2 -> dist/$3"; GOOS=$1 GOARCH=$2 go build -trimpath -ldflags "$LDF $4" -o "dist/$3" .; }
build windows amd64 BancadaDeRede-windows-x64.exe   "-H windowsgui"
build windows arm64 BancadaDeRede-windows-arm64.exe "-H windowsgui"
build linux   amd64 bancada-de-rede-linux-x64       ""
build linux   arm64 bancada-de-rede-linux-arm64     ""
build darwin  amd64 bancada-de-rede-macos-intel     ""
build darwin  arm64 bancada-de-rede-macos-apple     ""
echo "Pronto: dist/"
