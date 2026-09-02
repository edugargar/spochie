#!/bin/sh
# Registra esta sesion en spochie y arranca el demonio si no lo esta.
# Claude Code exporta CLAUDE_CODE_MESSAGING_SOCKET y _TOKEN antes de correr ningun hook.
exec bun run "$(dirname "$0")/../src/cli.ts" register
