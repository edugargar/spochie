#!/bin/sh
# Cerrar la pantalla cierra tus spochies vivos.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/bin/spochie" unregister 2>/dev/null || true
