#!/bin/sh
# Cerrar la pantalla cierra tus spochies vivos.
exec bun run "$(dirname "$0")/../src/cli.ts" unregister
