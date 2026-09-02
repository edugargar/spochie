#!/usr/bin/env bun
import net from "node:net";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve as rpath } from "node:path";
import { userInfo } from "node:os";
import { DAEMON_SOCK, DAEMON_LOG, ensureDirs } from "./paths.ts";
import { register, liveSessions, unregister, type SessionRecord } from "./registry.ts";
import * as Cfg from "./config.ts";
import { MAX_MENSAJE, MAX_PARCHE } from "./threads.ts";
import { TRANSCRIPTS_DIR } from "./transcript.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function rpc(req: any, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const c = net.createConnection({ path: DAEMON_SOCK });
    let buf = "";
    const fail = (e: Error) => { c.destroy(); reject(e); };
    c.setTimeout(timeoutMs, () => fail(new Error("el demonio no contesta")));
    c.on("error", fail);
    c.on("connect", () => c.write(JSON.stringify(req) + "\n"));
    c.on("data", d => {
      buf += d.toString();
      const i = buf.indexOf("\n");
      if (i >= 0) { c.destroy(); try { resolve(JSON.parse(buf.slice(0, i))); } catch (e) { reject(e as Error); } }
    });
  });
}

async function ensureDaemon() {
  ensureDirs();
  if (existsSync(DAEMON_SOCK)) {
    try { await rpc({ op: "ping" }, 1500); return; } catch {}
  }
  const { arrancarDemonio } = await import("./arranque.ts");
  arrancarDemonio();
  // Bajo launchd el primer arranque puede tardar: si el anterior acaba de morir,
  // launchd espera su ThrottleInterval (10 s) antes de volver a intentarlo.
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { await rpc({ op: "ping" }, 1000); return; } catch {}
  }
  throw new Error(`no consigo arrancar el demonio; mira ${DAEMON_LOG}`);
}

/** Quien soy: la sesion cuyo socket de entrada es el que me han exportado a mi. */
function whoAmI(): SessionRecord {
  const sock = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
  if (!sock) throw new Error("no hay CLAUDE_CODE_MESSAGING_SOCKET: esto tiene que correr dentro de una sesion de Claude Code");
  const me = liveSessions().find(s => s.socket === sock);
  if (!me) throw new Error("esta sesion no esta registrada; hace falta el hook SessionStart de spochie (y reiniciar la sesion)");
  return me;
}

function git(cwd: string, args: string[]): string | undefined {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined; }
  catch { return undefined; }
}

/** El sobre fijo y pequeno: rama, SHA, ficheros tocados. Nada mas automatico:
 *  adjuntar de mas es comodo hasta el dia que un .env se cuela en el sobre. */
function autoContext(cwd: string) {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) return {};
  return {
    branch,
    sha: git(cwd, ["rev-parse", "HEAD"]),
    files: git(cwd, ["diff", "--name-only", "HEAD"])?.split("\n").filter(Boolean).slice(0, 12),
  };
}

/** Las banderas se buscan solo entre los argumentos, nunca dentro del texto de un
 *  mensaje: un cuerpo que mencione "--human" no debe cambiar quien firma. */
const args = (a: string[], posicionales: number) => a.slice(posicionales);
const flag = (a: string[], n: string) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
const has = (a: string[], n: string) => a.includes(`--${n}`);
const fileList = (a: string[]) => flag(a, "files")?.split(",").map(f => rpath(f.trim())).filter(Boolean);

function out(r: any) {
  if (r?.ok === false) { console.error(`spochie: ${r.error}`); if (r.candidates) for (const c of r.candidates) console.error(`  - ${c}`); process.exit(1); }
  console.log(JSON.stringify(r, null, 2));
}

const USAGE = `spochie - tunel entre sesiones de Claude Code de personas distintas

  spochie sessions                          sesiones vivas en esta maquina
  spochie open <destino> --subject "..." --body "..." [--files a,b]
      destino: nombre de sesion local, o @persona para otra maquina (via Slack)
  spochie take <id>                         quedarte un spochie cuando tienes varias sesiones
  spochie accept <id>                       LO EJECUTA EL HUMANO RECEPTOR, no su Claude
  spochie say <id> "<texto>" [--files a,b]
      --human  SOLO si estas transcribiendo palabras literales de tu usuario.
               Lo que escribas tu va sin bandera: se firma como su Claude.
  spochie say <id> --file <ruta|->      para textos largos, sin pelearte con las comillas
  spochie patch <id> [--diff-file f | --from-git]
  spochie branch <id> <nombre-de-rama>
  spochie release <id> | discard <id>   LO EJECUTA EL HUMANO RECEPTOR: suelta o tira lo que retuvo el vigilante
  spochie close <id> [--reason "..."]
  spochie list | show <id>
  spochie search "<texto>"              busca entre los spochies de esta maquina
  spochie transcript <id> [--url <url-del-artifact>]
  spochie selftest                      prueba el bucle entero aqui, sin necesitar a nadie
  spochie doctor                        repasa lo que tiene que estar bien para entregar
  spochie config [--human "Edu"] [--guardian on|off] [--transcript on|off]

  Alta de otra persona, en un pegado:
  spochie invite --to <U0..|email> [--name Alex]   el bot le manda la invitacion por DM, con los pasos
  spochie invite                        o imprime la linea para mandarsela tu
  spochie join <cadena> [--email <mail>] la que ejecuta quien se da de alta
      (el email sale de git config si no lo pasas; pega la linea entera, se limpia sola)

  Alta a mano, si prefieres los tokens uno a uno:
  spochie slack setup --token xoxp-... --bot-token xoxb-...
  spochie slack setup --token-file <ruta.json>     |   spochie slack off
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  // Como binario compilado no hay `bun run daemon.ts`: el demonio es este mismo
  // ejecutable con `daemon`. Importarlo lo arranca.
  if (cmd === "daemon") { await import("./daemon.ts"); return; }

  if (cmd === "register") {
    // Con el hook, el evento llega por stdin. A mano desde una terminal no llega nada
    // y leer stdin se quedaba colgado para siempre: el env de la sesion ya trae lo
    // unico que hace falta, asi que ni se intenta.
    const raw = process.stdin.isTTY ? "{}" : await new Response(Bun.stdin.stream()).text().catch(() => "{}");
    const ev = raw.trim() ? JSON.parse(raw) : {};
    const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
    const token = process.env.CLAUDE_CODE_MESSAGING_TOKEN;
    if (!socket || !token) { console.error("spochie: esta sesion no tiene buzon; no registro"); return; }
    const cwd: string = ev.cwd ?? process.cwd();
    const sessionId: string = ev.session_id ?? socket;
    register({
      sessionId,
      // Los ultimos caracteres, no los primeros: con ids como "sim-a" y "sim-b" el
      // prefijo es identico y el nombre perdia justo lo que los distingue.
      name: `${cwd.split("/").pop()}-${sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(-4)}`,
      cwd, socket, token,
      // El nombre del socket es el PID del proceso claude: /tmp/cc-socks/<pid>.sock
      // Verificado en 2.1.251. Senal de vida exacta, sin depender del arbol de procesos.
      pid: Number(socket.split("/").pop()!.replace(/\.sock$/, "")) || process.ppid,
      startedAt: Date.now(),
    });
    // En macOS el demonio pasa a launchd, que lo mantiene vivo y lo levanta al
    // arrancar. Se hace aqui, en cada arranque de sesion, porque la ruta del plugin
    // cambia con cada version y el plist tiene que seguirla.
    try { const { instalarLaunchd } = await import("./arranque.ts"); const r = instalarLaunchd(); if (r !== "igual" && r !== "no") console.error(`spochie: demonio ${r} en launchd`); } catch {}
    await ensureDaemon();
    try { await rpc({ op: "claim", sessionId }, 5000); } catch {}
    return;
  }

  if (cmd === "unregister") {
    const raw = await new Response(Bun.stdin.stream()).text().catch(() => "{}");
    const ev = raw.trim() ? JSON.parse(raw) : {};
    const sock = process.env.CLAUDE_CODE_MESSAGING_SOCKET;
    const id = ev.session_id ?? liveSessions().find(s => s.socket === sock)?.sessionId;
    if (!id) return;
    try { await rpc({ op: "session-end", sessionId: id }, 5000); } catch {}
    unregister(id);
    return;
  }

  if (cmd === "config") {
    const c = Cfg.load();
    if (flag(rest, "human")) c.human = flag(rest, "human");
    if (flag(rest, "guardian")) c.guardian = flag(rest, "guardian") === "on";
    if (flag(rest, "transcript")) c.transcript = flag(rest, "transcript") === "on";
    Cfg.save(c);
    console.log(JSON.stringify({
      ...c,
      slack: c.slack ? {
        userId: c.slack.userId,
        origen: c.slack.tokenFile ? `${c.slack.tokenFile} (${c.slack.tokenKey})` : "token guardado aqui",
        valido: Boolean(Cfg.slackToken(c)),
      } : undefined,
    }, null, 2));
    return;
  }

  // ── Alta en un solo pegado ───────────────────────────────────────────────
  //
  // El camino largo (instalar la app tu, sacar dos tokens de una pantalla de Slack a
  // la que hay que tener acceso de admin) sobra: el token de usuario solo servia para
  // buscar personas, y eso lo hace el bot si la app tiene users:read. Asi que lo unico
  // que hay que pasarle a alguien es el token del bot, que es de la app, no suyo.
  if (cmd === "invite") {
    const c = Cfg.load();
    const bot = Cfg.slackBotToken(c);
    if (!bot || !c.slack?.userId) { console.error("aqui no hay Slack configurado; no puedo invitar a nadie"); process.exit(1); return; }
    const { whoIs } = await import("./slack.ts");
    const { crearInvitacion, textoInvitacion } = await import("./alta.ts");
    const quien = await whoIs(bot);
    if (!quien) { console.error("el token de bot que tienes no vale (auth.test)"); process.exit(1); return; }
    const { misClaves } = await import("./firma.ts");
    const yo = { id: c.slack.userId, name: c.human ?? userInfo().username, pk: misClaves(c).pub };
    const api = (m: string, body: unknown) => fetch(`https://slack.com/api/${m}`, {
      method: "POST", headers: { authorization: `Bearer ${bot}`, "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(r => r.json());

    // Con --to, el bot le manda la invitacion por DM con los pasos dentro. Asi no hay
    // nada que copiar, y como la invitacion ya dice para quien es, el alta no tiene
    // que buscarse en Slack (que exige users:read, un scope que puede faltar).
    const to = flag(rest, "to");
    if (to) {
      let dest: { id: string; name: string } | null = Cfg.contact(c, to);
      if (!dest && /^[UW][A-Z0-9]{6,}$/.test(to)) {
        // Sin users:read el nombre no se puede sacar de Slack; --name lo pone quien invita.
        const r = await api("users.info", { user: to });
        const nombre = flag(rest, "name") ?? (r.ok ? (r.user?.profile?.real_name ?? r.user?.name) : undefined);
        if (!nombre) { console.error(`la app no puede leer el nombre de ${to}; dimelo tu:  spochie invite --to ${to} --name Alex`); process.exit(1); return; }
        dest = { id: to, name: nombre };
      }
      if (!dest && to.includes("@")) {
        const r = await api("users.lookupByEmail", { email: to });
        if (r.ok) dest = { id: r.user.id, name: r.user.profile?.real_name ?? r.user.name };
        else if (r.error === "missing_scope") console.error(`la app no puede buscar por email (falta users:read.email de bot).`);
      }
      if (!dest) {
        console.error(`no se a quien mandarsela: pasa su id de Slack, --to U01234567 (esta en su perfil, "Copiar id de miembro").`);
        process.exit(1); return;
      }
      const blob = crearInvitacion({ b: bot, t: quien.team, u: dest.id, i: yo });
      const im = await api("conversations.open", { users: dest.id });
      if (!im.ok) { console.error(`no puedo abrir el DM con ${dest.name}: ${im.error}`); process.exit(1); return; }
      const post = await api("chat.postMessage", { channel: im.channel.id, text: textoInvitacion(blob, yo.name) });
      if (!post.ok) { console.error(`no he podido mandar el DM: ${post.error}`); process.exit(1); return; }
      Cfg.addContact(c, dest); Cfg.save(c);
      console.log(`Enviada a ${dest.name} por DM del bot, con los pasos dentro. Ya puedes escribirle @${Cfg.claveContacto(dest.name)}.`);
      return;
    }

    const r = await api("users.list", { limit: 1 });
    const blob = crearInvitacion({ b: bot, t: quien.team, i: yo });
    console.log(`Mandale esto a quien quieras dar de alta. Es una linea:\n`);
    console.log(`  /spochie:join ${blob}\n`);
    if (r.ok) console.log(`Su email lo saca de git; si no cuadra con Slack, que anada --email <mail>.`);
    else {
      console.log(`Ojo: la app no tiene users:read de bot, asi que tendra que anadir --user <su id de Slack>.`);
      console.log(`Mas facil: spochie invite --to <su id>, y el bot le manda la invitacion ya resuelta por DM.`);
    }
    return;
  }

  if (cmd === "join") {
    const { limpiarCadena, leerInvitacion, emailDeGit } = await import("./alta.ts");
    // Se limpia todo lo pegado, no solo rest[0]: quien se da de alta pega la linea
    // entera tal cual se la mandaron, con "spochie join" delante y comillas de Slack.
    const blob = limpiarCadena(rest.join(" "));
    if (!blob) {
      console.error("no veo ninguna invitacion en lo que has pegado.");
      console.error("Pidele a quien te da de alta que corra `spochie invite` y mandarte la linea entera.");
      process.exit(2); return;
    }
    const datos = leerInvitacion(blob);
    if (!datos) { console.error("esa cadena no es una invitacion de spochie"); process.exit(2); return; }

    const { whoIs } = await import("./slack.ts");
    const bot = await whoIs(datos.b);
    if (!bot) { console.error("el token de la invitacion ya no vale. Pide otra."); process.exit(1); }

    // Tu id de Slack: por email si el bot puede buscar, o a mano.
    let userId = flag(rest, "user") ?? datos.u;
    const email = userId ? undefined : (flag(rest, "email") ?? emailDeGit());
    if (!userId && email) {
      const r = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
        { headers: { authorization: `Bearer ${datos.b}` } });
      const j = await r.json();
      if (j.ok) userId = j.user.id;
      else if (j.error === "missing_scope") {
        // Esto no lo arregla quien se da de alta: es la app de Slack, que no lleva
        // users:read de bot. Culparle del email le manda a mirar donde no esta el fallo.
        console.error(`la app de Slack no puede buscar personas (falta users:read de bot). Eso lo arregla quien te invita.`);
        console.error(`Mientras tanto, pasa tu id de Slack, que esta en tu perfil ("Copiar id de miembro"):`);
        console.error(`  spochie join <cadena> --user U01234567`);
        process.exit(1);
      } else {
        console.error(`no te encuentro en Slack como ${email} (${j.error}).`);
        console.error(`Pasa el email con el que entras en Slack:  spochie join <cadena> --email <mail>`);
        console.error(`O tu id, que esta en tu perfil de Slack ("Copiar id de miembro"):  --user U01234567`);
        process.exit(1);
      }
    }
    if (!userId) { console.error("dime quien eres:  --email <tu-email>  o  --user <U0123>"); process.exit(2); }

    const c = Cfg.load();
    c.slack = { botToken: datos.b, userId, pollMs: 20_000 };
    if (!c.human) c.human = flag(rest, "nombre") ?? userInfo().username;
    if (datos.i) Cfg.addContact(c, datos.i);
    const { misClaves } = await import("./firma.ts");
    misClaves(c);
    Cfg.save(c);
    if (datos.i) console.log(`Te ha invitado ${datos.i.name}: ya puedes escribirle @${Cfg.claveContacto(datos.i.name)}.`);
    console.log(`Listo. Estas dentro de ${bot!.team} como ${userId}${email ? ` (${email})` : ""}, y el bot es ${bot!.user}.`);
    try { const { instalarLaunchd } = await import("./arranque.ts"); instalarLaunchd(); } catch {}
    await ensureDaemon();
    await rpc({ op: "slack-reload" }).catch(() => {});

    // La comprobacion va aqui dentro a proposito: darse de alta y no saber si
    // entrega es medio paso, y medio paso es el que nadie da.
    console.log(`\nComprobando que entrega de verdad...\n`);
    const { selftest } = await import("./selftest.ts");
    let malos = 0;
    for (const p of await selftest()) {
      if (!p.ok) malos++;
      console.log(`${p.ok ? "  ok " : "FALLO"}  ${p.que.padEnd(38)} ${p.detalle}`);
    }
    console.log(malos ? `\n${malos} fallos: spochie no esta listo.` : "\nTodo bien. spochie entrega en esta maquina.");
    process.exit(malos ? 1 : 0);
  }

  if (cmd === "slack") {
    const c = Cfg.load();
    if (rest[0] === "off") { delete c.slack; Cfg.save(c); console.log("Slack apagado"); }
    else if (rest[0] === "setup") {
      const tokenFile = flag(rest, "token-file");
      const tokenKey = flag(rest, "token-key") ?? "userToken";
      const botTokenKey = flag(rest, "bot-token-key") ?? "botToken";
      let token = flag(rest, "token");
      let botToken = flag(rest, "bot-token");
      if (tokenFile) {
        try {
          const j = JSON.parse(readFileSync(rpath(tokenFile), "utf8"));
          token = j[tokenKey]; botToken = j[botTokenKey];
        } catch { console.error(`no puedo leer ${tokenFile}`); process.exit(1); }
        if (!token) { console.error(`${tokenFile} no tiene la clave "${tokenKey}"`); process.exit(1); }
      }
      if (!token || !botToken) {
        console.error("spochie necesita dos tokens de la misma app de Slack:");
        console.error("  --token xoxp-...      el tuyo, de usuario. Solo se usa para buscar personas.");
        console.error("  --bot-token xoxb-...  el de la app. Postea y lee los hilos.");
        console.error("O los dos de un fichero:  --token-file <ruta.json>");
        process.exit(2);
      }
      // Se comprueban los dos antes de guardar nada: un setup que dice "listo" y luego
      // no entrega es peor que uno que falla aqui.
      const { whoIs } = await import("./slack.ts");
      const yo = await whoIs(token);
      if (!yo) { console.error("el token de usuario no vale: Slack no me dice quien eres (auth.test)"); process.exit(1); }
      const bot = await whoIs(botToken);
      if (!bot) { console.error("el token de bot no vale (auth.test)"); process.exit(1); }
      const user = flag(rest, "user") ?? yo.userId;
      console.log(`Eres ${yo.user} en ${yo.team} (${user}), y el bot es ${bot.user}`);
      if (!c.human) c.human = yo.user;
      c.slack = tokenFile
        ? { tokenFile: rpath(tokenFile), tokenKey, botTokenKey, userId: user, pollMs: 20_000 }
        : { userToken: token, botToken, userId: user, pollMs: 20_000 };
      Cfg.save(c);
      await ensureDaemon();
      out(await rpc({ op: "slack-reload" }));
    } else console.log(USAGE);
    return;
  }

  await ensureDaemon();

  switch (cmd) {
    case "sessions": {
      const r = await rpc({ op: "sessions" });
      for (const s of r.sessions) console.log(`${s.name.padEnd(24)} ${s.cwd}`);
      break;
    }
    case "open": {
      const me = whoAmI();
      const [to] = rest;
      const subject = flag(rest, "subject"), body = flag(rest, "body");
      if (!to || !subject || !body) { console.error("faltan argumentos\n" + USAGE); process.exit(2); }
      const r = await rpc({ op: "open", sessionId: me.sessionId, to, subject, body, files: fileList(rest), context: autoContext(me.cwd) });
      out(r);
      // El demonio genera el HTML pero no puede publicarlo: Artifact es una herramienta
      // de la sesion de Claude, no de un proceso suelto. Asi que se lo pide aqui,
      // porque si no el transcript se queda en disco y nadie ve el enlace.
      if (r?.ok && Cfg.load().transcript) {
        console.log(`\nSIGUIENTE PASO, hazlo ahora: publica ${join(TRANSCRIPTS_DIR, `${r.id}.html`)} con la herramienta Artifact`);
        console.log(`y despues registra la URL para que aparezca en el hilo de Slack:`);
        console.log(`  spochie transcript ${r.id} --url <url>`);
      }
      break;
    }
    case "take":
      out(await rpc({ op: "take", sessionId: whoAmI().sessionId, id: rest[0] }));
      break;
    case "accept":
      out(await rpc({ op: "accept", sessionId: whoAmI().sessionId, id: rest[0], by: Cfg.load().human }));
      break;
    case "say": {
      const me = whoAmI();
      const id = rest[0];
      const f = flag(rest, "file");
      const text = f
        ? (f === "-" ? await new Response(Bun.stdin.stream()).text() : readFileSync(rpath(f), "utf8"))
        : rest[1];
      if (!id || !text) { console.error("faltan argumentos\n" + USAGE); process.exit(2); }
      if (text.length > MAX_MENSAJE) { console.error(`el mensaje pasa de ${MAX_MENSAJE} caracteres (${text.length}). Cortalo tu o manda un parche.`); process.exit(2); }
      out(await rpc({ op: "say", sessionId: me.sessionId, id, text, files: fileList(rest), author: has(args(rest, 2), "human") ? "human" : "claude" }));
      break;
    }
    case "patch": {
      const me = whoAmI();
      const id = rest[0];
      const f = flag(rest, "diff-file");
      const diff = f ? readFileSync(rpath(f), "utf8") : git(me.cwd, ["diff", "HEAD"]);
      if (!diff?.trim()) { console.error("no hay diff que mandar"); process.exit(2); }
      // Por Slack un parche mas gordo que esto llegaba cortado, con un "sigue en el
      // transcript" que el otro lado no puede aplicar. Mejor decirlo aqui.
      if (diff.length > MAX_PARCHE) {
        console.error(`el parche son ${diff.length} caracteres y por el tunel caben ${MAX_PARCHE}.`);
        console.error(`Empuja la rama y mandala:  spochie branch ${id ?? "<id>"} <rama>`);
        process.exit(2);
      }
      out(await rpc({ op: "say", sessionId: me.sessionId, id, text: diff, kind: "patch" }));
      break;
    }
    case "branch":
      out(await rpc({ op: "say", sessionId: whoAmI().sessionId, id: rest[0], text: rest[1], kind: "branch" }));
      break;
    case "release":
    case "discard":
      out(await rpc({ op: cmd, sessionId: whoAmI().sessionId, id: rest[0] }));
      break;
    case "close":
      out(await rpc({ op: "close", sessionId: whoAmI().sessionId, id: rest[0], reason: flag(rest, "reason") }));
      break;
    case "list": {
      let sessionId: string | undefined;
      try { sessionId = whoAmI().sessionId; } catch {}
      const r = await rpc({ op: "list", sessionId });
      if (!r.threads.length) { console.log("(ningun spochie)"); break; }
      for (const t of r.threads)
        console.log(`${t.id}  ${t.state.padEnd(8)} ${t.from} -> ${t.to}  "${t.subject}"  (${t.messages} msg, caduca en ${t.expiresInSec}s)${t.transcript ? `  ${t.transcript}` : ""}`);
      break;
    }
    case "selftest": {
      const { selftest } = await import("./selftest.ts");
      console.log("Probando el bucle entero en esta maquina, sin tocar Slack ni tu estado.\n");
      let malos = 0;
      for (const p of await selftest()) {
        if (!p.ok) malos++;
        console.log(`${p.ok ? "  ok " : "FALLO"}  ${p.que.padEnd(38)} ${p.detalle}`);
      }
      console.log(malos ? `\n${malos} fallos: spochie no esta listo.` : "\nTodo bien. spochie entrega en esta maquina.");
      if (malos) process.exit(1);
      break;
    }
    case "doctor": {
      const { revisar } = await import("./doctor.ts");
      let malos = 0;
      for (const c of await revisar()) {
        const marca = c.ok === true ? "  ok " : c.ok === "aviso" ? " nota" : "FALLO";
        if (c.ok === false) malos++;
        console.log(`${marca}  ${c.que.padEnd(26)} ${c.detalle}`);
      }
      if (malos) process.exit(1);
      break;
    }
    case "search": {
      const q = rest.join(" ");
      if (!q) { console.error("que busco?\n" + USAGE); process.exit(2); }
      const r = await rpc({ op: "search", q });
      if (!r.hits.length) { console.log(`(nada con "${q}")`); break; }
      for (const h of r.hits) {
        console.log(`${h.id}  ${h.cuando}  ${h.state.padEnd(7)} ${h.con}`);
        console.log(`      "${h.subject}"${h.rama ? `  [${h.rama}]` : ""}  (coincide en el ${h.donde})`);
        if (h.extracto) console.log(`      ${h.extracto}`);
        if (h.transcript) console.log(`      ${h.transcript}`);
      }
      break;
    }
    case "show":
      out(await rpc({ op: "get", id: rest[0] }));
      break;
    case "transcript": {
      const id = rest[0];
      const url = flag(rest, "url");
      if (url) { out(await rpc({ op: "transcript-url", id, url, sessionId: whoAmI().sessionId })); break; }
      const p = join(TRANSCRIPTS_DIR, `${id}.html`);
      if (!existsSync(p)) { console.error(`no hay transcript para ${id} (activa con: spochie config --transcript on)`); process.exit(1); }
      console.log(p);
      console.log(`Publicalo con la herramienta Artifact y guarda la URL:  spochie transcript ${id} --url <url>`);
      break;
    }
    default:
      console.log(USAGE);
  }
}

main().catch(e => { console.error(`spochie: ${e.message}`); process.exit(1); });
