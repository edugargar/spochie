#!/bin/sh
# Registra esta sesion en spoochie y arranca el demonio si no lo esta.
# Claude Code exporta CLAUDE_CODE_MESSAGING_SOCKET y _TOKEN antes de correr ningun hook.
#
# Sin Bun, se baja el binario de la release DE ESTA VERSION del plugin (no "latest"),
# se comprueba su SHA-256 contra el SHA256SUMS de la misma release, y se guarda con la
# version en el nombre: asi actualizar el plugin actualiza el binario, y un binario
# manipulado en el camino no se ejecuta. Lo que imprime este hook entra en el contexto
# de la sesion, asi que si algo falta el Claude de esa persona se lo dice.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${SPOOCHIE_HOME:-$HOME/.claude/spoochie}/bin"
VERSION=$(sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' "$ROOT/.claude-plugin/plugin.json" | head -1)
BIN="$DIR/spoochie-$VERSION"
# El repo del que bajar el binario: el mismo del que se instalo el plugin. Un fork lo
# cambia en .claude-plugin/marketplace.json ("origin") y aqui no hay que tocar nada.
REPO=$(sed -n 's/.*"origin" *: *"\([^"]*\)".*/\1/p' "$ROOT/.claude-plugin/marketplace.json" | head -1)
[ -n "$REPO" ] || REPO="edugargar/spoochie"
REPO="${SPOOCHIE_ORIGEN:-$REPO}"

if [ ! -x "$BIN" ] && ! command -v bun >/dev/null 2>&1; then
  os=$(uname -s | tr '[:upper:]' '[:lower:]'); arch=$(uname -m)
  case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
  mkdir -p "$DIR" && chmod 700 "$DIR"
  base="https://github.com/$REPO/releases/download/v$VERSION"
  name="spoochie-$os-$arch"
  if curl -fsSL "$base/$name" -o "$BIN.tmp" && curl -fsSL "$base/SHA256SUMS" -o "$BIN.sums"; then
    want=$(awk -v n="$name" '$2 == n { print $1 }' "$BIN.sums")
    got=$(shasum -a 256 "$BIN.tmp" 2>/dev/null | awk '{ print $1 }')
    [ -z "$got" ] && got=$(sha256sum "$BIN.tmp" 2>/dev/null | awk '{ print $1 }')
    rm -f "$BIN.sums"
    if [ -n "$want" ] && [ "$want" = "$got" ]; then
      chmod +x "$BIN.tmp" && mv "$BIN.tmp" "$BIN"
      # Los binarios de versiones anteriores ya no hacen falta.
      for old in "$DIR"/spoochie-*; do [ "$old" = "$BIN" ] || rm -f "$old"; done
      rm -f "$DIR/spoochie"
      echo "spoochie: downloaded and verified the spoochie $VERSION binary for $os-$arch, no Bun needed."
    else
      rm -f "$BIN.tmp"
      echo "spoochie: the downloaded binary for $os-$arch did NOT match the release checksum (got ${got:-nothing}, expected ${want:-nothing}). Not running it. Tell the user; installing Bun (curl -fsSL https://bun.sh/install | bash) works as an alternative."
      exit 0
    fi
  else
    rm -f "$BIN.tmp" "$BIN.sums"
    echo "spoochie: Bun is not installed and the $VERSION binary for $os-$arch could not be downloaded from $base. Tell the user to install Bun (curl -fsSL https://bun.sh/install | bash) and restart Claude Code."
    exit 0
  fi
fi
exec "$ROOT/bin/spoochie" register
