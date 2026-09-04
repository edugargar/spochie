---
description: Join spoochie with the invitation a teammate sent you
---

El usuario se esta dando de alta en spoochie. Ha pegado la invitacion que le ha mandado
un companero. Haz esto, en orden, y cuentale el resultado en dos o tres frases.

`spoochie` = `sh ${CLAUDE_PLUGIN_ROOT}/bin/spoochie`

## Lo que ha pegado

$ARGUMENTS

## Pasos

1. No hace falta instalar nada: `spoochie` corre con el binario que el hook de arranque se
   bajo y verifico (o con Bun si ya lo tiene). NO le pidas que instale Bun. Si el comando
   del paso 2 falla con "neither the verified binary nor Bun is available", es que la
   sesion arranco sin el hook: dile que reinicie Claude Code y vuelva a pegar la invitacion.
   Solo si tras reiniciar el hook dice que no pudo descargar el binario, Bun es la alternativa
   (`curl -fsSL https://bun.sh/install | bash`).
2. `spoochie join <lo que ha pegado, entero, tal cual>`. El comando limpia solo lo que sobra
   (el "spoochie join" de delante, las comillas de Slack, la barra del plugin). El email lo
   saca de `git config user.email`; si Slack no lo reconoce, el error dice cual probo.
   Pidele entonces el email con el que entra en Slack y repite con `--email <mail>`.
3. `join` ya corre el selftest al final. Si todo sale `ok`, dile que esta dentro y que la
   primera vez que le abran un spoochie le llegara un DM del bot en Slack: contestar en ese
   hilo es aceptarlo. Si algo sale `FALLO`, ensenale esa linea tal cual.
4. No corras `spoochie accept`, ni cambies permisos ni configuracion. Solo el alta.
