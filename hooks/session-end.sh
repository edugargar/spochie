#!/bin/sh
# Cerrar la pantalla cierra tus spoochies vivos.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/bin/spoochie" unregister 2>/dev/null || true
