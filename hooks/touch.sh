#!/bin/sh
# UserPromptSubmit: cada prompt tuyo toca el registro de esta sesion. Con eso el demonio
# sabe en que terminal estas trabajando y ahi entrega la invitacion. Sin Bun ni nada:
# leer el session_id del evento y un touch.
id=$(sed -n 's/.*"session_id" *: *"\([^"]*\)".*/\1/p' | head -1)
[ -n "$id" ] || exit 0
safe=$(printf '%s' "$id" | tr -c 'A-Za-z0-9._-\n' '_')
f="${SPOCHIE_HOME:-$HOME/.claude/spochie}/sessions/$safe.json"
[ -f "$f" ] && touch "$f"
exit 0
