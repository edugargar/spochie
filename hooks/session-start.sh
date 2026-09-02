#!/bin/sh
# Registra esta sesion en spochie y arranca el demonio si no lo esta.
# Claude Code exporta CLAUDE_CODE_MESSAGING_SOCKET y _TOKEN antes de correr ningun hook.
#
# Sin Bun, se baja el binario de la release del repo una sola vez. Lo que imprime
# este hook entra en el contexto de la sesion, asi que si algo falta el Claude de
# esa persona se lo dice en vez de que muera en silencio.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${SPOCHIE_HOME:-$HOME/.claude/spochie}/bin"
BIN="$DIR/spochie"
REPO="edugargar/spochie"

if [ ! -x "$BIN" ] && ! command -v bun >/dev/null 2>&1; then
  os=$(uname -s | tr '[:upper:]' '[:lower:]'); arch=$(uname -m)
  case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
  mkdir -p "$DIR" && chmod 700 "$DIR"
  url="https://github.com/$REPO/releases/latest/download/spochie-$os-$arch"
  if curl -fsSL "$url" -o "$BIN.tmp" && chmod +x "$BIN.tmp" && mv "$BIN.tmp" "$BIN"; then
    echo "spochie: downloaded the spochie binary for $os-$arch, no Bun needed."
  else
    rm -f "$BIN.tmp"
    echo "spochie: Bun is not installed and the binary for $os-$arch could not be downloaded from $url. Tell the user to install Bun (curl -fsSL https://bun.sh/install | bash) and restart Claude Code."
    exit 0
  fi
fi
exec "$ROOT/bin/spochie" register
