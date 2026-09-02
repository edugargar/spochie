---
description: Join spochie with the invitation a teammate sent you
---

El usuario se esta dando de alta en spochie. Ha pegado la invitacion que le ha mandado
un companero. Haz esto, en orden, y cuentale el resultado en dos o tres frases.

`spochie` = `bun run ${CLAUDE_PLUGIN_ROOT}/src/cli.ts`

## Lo que ha pegado

$ARGUMENTS

## Pasos

1. `bun --version`. Si no existe, para aqui y dile que instale Bun (`curl -fsSL https://bun.sh/install | bash`)
   y vuelva a pegar la invitacion. El hook de spochie corre con Bun y sin el no arranca nada.
2. `spochie join <lo que ha pegado, entero, tal cual>`. El comando limpia solo lo que sobra
   (el "spochie join" de delante, las comillas de Slack, la barra del plugin). El email lo
   saca de `git config user.email`; si Slack no lo reconoce, el error dice cual probo.
   Pidele entonces el email con el que entra en Slack y repite con `--email <mail>`.
3. `join` ya corre el selftest al final. Si todo sale `ok`, dile que esta dentro y que la
   primera vez que le abran un spochie le llegara un DM del bot en Slack: contestar en ese
   hilo es aceptarlo. Si algo sale `FALLO`, ensenale esa linea tal cual.
4. No corras `spochie accept`, ni cambies permisos ni configuracion. Solo el alta.
