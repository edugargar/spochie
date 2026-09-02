/**
 * Un demonio por maquina. Es lo unico que sigue vivo entre turnos, asi que es
 * quien lleva los relojes: un Claude solo existe mientras piensa.
 *
 * Enruta entre sesiones locales por el socket de entrada de cada una, y entre
 * maquinas por Slack (src/slack.ts), donde el hilo es a la vez transporte,
 * direccion y fuente de verdad del estado.
 */
import net from "node:net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { DAEMON_SOCK, DAEMON_LOCK, DAEMON_LOG, ensureDirs } from "./paths.ts";
import { liveSessions, findSession, type SessionRecord } from "./registry.ts";
import * as T from "./threads.ts";
import { encolar } from "./outbox.ts";
import * as Cfg from "./config.ts";
import { deliver } from "./inbox.ts";
import { judge } from "./guardian.ts";
import { publishTranscript, rutaTranscript } from "./transcript.ts";
import { SlackBridge } from "./slack.ts";
import { repoMatches } from "./match.ts";

/** Con un tick fijo de 20s, cada salto del tunel se comia hasta 20s de espera y una
 *  conversacion de 6 mensajes acumulaba dos minutos de nada. Mientras hay un spochie
 *  abierto se mira cada 4s; en reposo, cada 20s, que no cuesta nada. */
const TICK_IDLE_MS = 20_000;
const TICK_VIVO_MS = 4_000;

export function log(...a: unknown[]) {
  const line = `${new Date().toISOString()} ${a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ")}\n`;
  try { appendFileSync(DAEMON_LOG, line); } catch {}
}

function alreadyRunning(): boolean {
  if (!existsSync(DAEMON_LOCK)) return false;
  const pid = Number(readFileSync(DAEMON_LOCK, "utf8").trim());
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

type Req = { op: string; [k: string]: any };

let slack: SlackBridge | null = null;

/** Pega la peticion de republicar el transcript al turno que ya va para esa sesion. */
function conTranscript(t: T.Thread, sessionId: string, texto: string): string {
  if (!Cfg.load().transcript) return texto;
  const tarea = T.tareaTranscript(t, sessionId, rutaTranscript(t.id));
  return tarea ? texto + "\n" + tarea : texto;
}

async function send(sess: SessionRecord | undefined, text: string) {
  if (!sess) return false;
  try { await deliver(sess, text); return true; }
  catch (e) { log("deliver-failed", sess.sessionId, String(e)); return false; }
}

const sessById = (id: string) => liveSessions().find(s => s.sessionId === id);

/** Entrega a un lado: por socket si esta en esta maquina, por Slack si no. */
async function sendToSide(t: T.Thread, side: T.Side, text: string, m?: T.Msg): Promise<boolean> {
  const local = sessById(side.sessionId);
  if (local) return send(local, conTranscript(t, side.sessionId, text));
  if (slack && t.slack) return slack.post(t, text, m);
  return false;
}

async function refreshTranscript(t: T.Thread) {
  if (!Cfg.load().transcript) return;
  try {
    const url = await publishTranscript(t);
    if (url && url !== t.transcriptUrl) { t.transcriptUrl = url; T.save(t); }
  } catch (e) { log("transcript-failed", t.id, String(e)); }
}

async function handle(req: Req): Promise<any> {
  switch (req.op) {
    case "ping":
      return { ok: true, pid: process.pid, slack: Boolean(slack) };

    case "sessions":
      return { ok: true, sessions: liveSessions().map(s => ({ sessionId: s.sessionId, name: s.name, cwd: s.cwd })) };

    case "open": {
      const me = sessById(req.sessionId);
      if (!me) return { ok: false, error: "esta sesion no esta registrada; reinicia Claude Code con el hook puesto" };
      const cfg = Cfg.load();
      const now = Date.now();

      // Destino remoto: "@alex" va por Slack. Destino local: por nombre de sesion.
      const remote = typeof req.to === "string" && req.to.startsWith("@");
      let to: T.Side;
      if (remote) {
        if (!slack) return { ok: false, error: "Slack no esta configurado: corre `spochie slack setup`" };
        // Primero la agenda local: quien te invito o a quien invitaste. Slack solo
        // si no esta, porque buscar por nombre alli exige un scope que puede faltar.
        const u = Cfg.contact(cfg, req.to.slice(1)) ?? await slack.lookupUser(req.to.slice(1));
        if (!u) return { ok: false, error: `no encuentro a ${req.to}: ni en tu agenda de spochie ni en Slack` };
        to = { sessionId: `slack:${u.id}`, name: u.name, cwd: "(otra maquina)", human: u.name, slackUser: u.id };
      } else {
        const matches = findSession(req.to).filter(s => s.sessionId !== req.sessionId);
        if (matches.length === 0) return { ok: false, error: `no encuentro ninguna sesion viva que encaje con "${req.to}"` };
        if (matches.length > 1) return { ok: false, error: `"${req.to}" encaja con varias`, candidates: matches.map(s => `${s.name} (${s.cwd})`) };
        const m = matches[0];
        to = { sessionId: m.sessionId, name: m.name, cwd: m.cwd };
      }

      const t: T.Thread = {
        id: T.newId(),
        subject: req.subject,
        from: { sessionId: me.sessionId, name: me.name, cwd: me.cwd, human: cfg.human, slackUser: cfg.slack?.userId },
        to,
        state: "pending",
        createdAt: now,
        lastActivityAt: now,
        context: req.context ?? {},
        messages: [{ at: now, from: me.sessionId, author: req.author ?? "claude", kind: req.kind ?? "text", text: req.body, files: req.files }],
      };

      if (remote && slack) {
        const th = await slack.openThread(t);
        if (!th) return { ok: false, error: "no pude abrir el hilo en Slack" };
        t.slack = th;
      }
      T.save(t);
      await refreshTranscript(t);

      // Quien abre es quien publica el transcript: el Artifact es suyo.
      if (Cfg.load().transcript) { t.transcriptOwner = me.sessionId; T.save(t); }
      const delivered = remote ? true : await sendToSide(t, t.to, T.renderInvite(t, t.to.sessionId));
      log("open", t.id, me.name, "->", to.name, delivered ? "entregado" : "FALLO");
      return { ok: true, id: t.id, to: to.name, delivered, transcript: t.transcriptUrl };
    }

    /** La puerta de Q3. La abre el humano receptor, no su Claude.
     *  Lo que la hace real es el propio sistema de permisos de Claude Code:
     *  `spochie accept` no debe estar en la allowlist, asi que ejecutarlo saca
     *  el dialogo de permiso y quien lo aprueba es la persona. */
    case "accept": {
      const t = T.load(req.id);
      if (!t) return { ok: false, error: `spochie ${req.id} no existe` };
      if (t.state === "closed") return { ok: false, error: `spochie ${req.id} esta cerrado (${t.closeReason})` };
      if (t.state === "open") return { ok: true, id: t.id, already: true };
      if (t.to.sessionId !== req.sessionId) return { ok: false, error: "solo el lado que recibe la invitacion puede aceptarla" };
      t.state = "open";
      t.acceptedAt = Date.now();
      t.acceptedBy = req.by ?? "humano receptor";
      t.lastActivityAt = t.acceptedAt;
      T.save(t);
      await sendToSide(t, t.from, T.renderAccepted(t, t.from.sessionId));
      await refreshTranscript(t);
      log("accept", t.id, "por", t.acceptedBy);
      return { ok: true, id: t.id, state: t.state };
    }

    case "say": {
      const t = T.load(req.id);
      if (!t) return { ok: false, error: `spochie ${req.id} no existe` };
      if (t.state === "closed") return { ok: false, error: `spochie ${req.id} esta cerrado (${t.closeReason})` };
      if (!T.isParty(t, req.sessionId)) return { ok: false, error: `esta sesion no es parte del spochie ${req.id}` };
      if (t.state === "pending") {
        return t.to.sessionId === req.sessionId
          ? { ok: false, error: `el tunel no esta abierto. Preguntale a tu humano y, si acepta, ejecuta: spochie accept ${t.id}` }
          : { ok: false, error: `el otro lado todavia no ha aceptado el tunel` };
      }

      if (!String(req.text ?? "").trim()) return { ok: false, error: "un mensaje vacio no se manda" };
      const now = Date.now();
      const m: T.Msg = {
        at: now, from: req.sessionId,
        author: req.author ?? "claude",
        kind: req.kind ?? "text",
        text: req.text, files: req.files,
      };
      // El vigilante etiqueta, nunca bloquea. Si falla o tarda, el mensaje sale igual.
      if (Cfg.load().guardian && m.kind === "text" && m.author !== "spochie") {
        m.offTopic = await judge(t.subject, m.text);
      }
      t.messages.push(m);
      t.lastActivityAt = now;
      t.avisado = false;
      T.save(t);

      const other = T.otherSide(t, req.sessionId);
      // "entregado" tiene que ser un hecho comprobado, no la intencion de enviar.
      // Cuando sale por Slack el envio va con retraso, asi que se dice "encolado":
      // decir "entregado" antes de que salga es exactamente la mentira que hace que
      // nadie se fie de un canal.
      let delivered: boolean | "encolado";
      if (sessById(other.sessionId)) {
        delivered = await sendToSide(t, other, T.renderMessage(t, m, other.sessionId), m);
      } else {
        delivered = "encolado";
        encolar(t, m, async (tt, mm) => {
          const otro = T.otherSide(tt, req.sessionId);
          const ok = await sendToSide(tt, otro, T.renderMessage(tt, mm, otro.sessionId), mm);
          log("salida", tt.id, ok ? "publicado en Slack" : "FALLO al publicar");
          if (ok && slack) await slack.pensandoOn(tt, otro.human ?? otro.name);
          if (!ok) {
            const yo = sessById(T.mySide(tt, req.sessionId).sessionId);
            if (yo) await send(yo, `[spochie ${tt.id}] tu mensaje NO salio a Slack. No des por hecho que lo ha leido.`);
          }
        });
      }
      await refreshTranscript(t);
      log("say", t.id, req.sessionId, m.kind, m.offTopic?.verdict ?? "-", delivered ? "entregado" : "FALLO");
      return { ok: true, id: t.id, state: t.state, delivered, offTopic: m.offTopic, transcript: t.transcriptUrl };
    }

    case "close": {
      const t = T.load(req.id);
      if (!t) return { ok: false, error: `spochie ${req.id} no existe` };
      if (t.state === "closed") return { ok: true, id: t.id, already: true };
      if (req.sessionId && !T.isParty(t, req.sessionId)) return { ok: false, error: `esta sesion no es parte del spochie ${req.id}` };
      await closeThread(t, req.reason ?? "cerrado a mano", req.sessionId);
      return { ok: true, id: t.id };
    }

    case "list": {
      const mine = req.sessionId ? T.activeFor(req.sessionId) : T.all();
      return {
        ok: true,
        threads: mine.map(t => ({
          id: t.id, subject: t.subject, state: t.state,
          from: t.from.human ?? t.from.name, to: t.to.human ?? t.to.name,
          messages: t.messages.length, transcript: t.transcriptUrl,
          expiresInSec: t.state === "closed" ? null : Math.round(((T.expiresAt(t) ?? 0) - Date.now()) / 1000),
        })),
      };
    }

    case "search": {
      return {
        ok: true,
        hits: T.buscar(req.q).map(h => ({
          id: h.t.id, subject: h.t.subject, state: h.t.state, donde: h.donde,
          con: (h.t.from.human ?? h.t.from.name) + " y " + (h.t.to.human ?? h.t.to.name),
          cuando: new Date(h.t.createdAt).toISOString().slice(0, 16).replace("T", " "),
          rama: h.t.context.branch,
          extracto: h.msg ? T.contexto(h.msg.text, req.q) : undefined,
          transcript: h.t.transcriptUrl,
        })),
      };
    }

    case "get": {
      const t = T.load(req.id);
      return t ? { ok: true, thread: t } : { ok: false, error: `spochie ${req.id} no existe` };
    }

    /** El hook SessionEnd: cerrar la pantalla cierra tus spochies vivos. */
    case "session-end": {
      const closed: string[] = [];
      for (const t of T.activeFor(req.sessionId)) {
        await closeThread(t, "la otra sesion se cerro", req.sessionId);
        closed.push(t.id);
      }
      return { ok: true, closed };
    }

    /** Q7: si el spochie llego mientras no habia sesion viva, se entrega en cuanto
     *  arranca una que encaje. La cola aguanta lo que el reloj de 4h.
     *  Encajar no es "ser la primera que arranque": la rama del sobre tiene que
     *  existir en su checkout. Si no, se queda en cola para otra sesion. */
    case "claim": {
      const me = sessById(req.sessionId);
      if (!me) return { ok: false, error: "sesion no registrada" };
      const claimed: string[] = [];
      for (const t of T.all()) {
        if (await assign(t) === me.sessionId) claimed.push(t.id);
      }
      return { ok: true, claimed };
    }

    /** Cuando hay varias sesiones abiertas, la persona dice cual se lo queda. */
    case "take": {
      const me = sessById(req.sessionId);
      if (!me) return { ok: false, error: "sesion no registrada" };
      const t = T.load(req.id);
      if (!t) return { ok: false, error: `spochie ${req.id} no existe` };
      if (t.state !== "pending") return { ok: false, error: `spochie ${req.id} ya no esta pendiente` };
      t.to = { ...t.to, sessionId: me.sessionId, name: me.name, cwd: me.cwd, human: Cfg.load().human ?? t.to.human };
      T.save(t);
      await send(me, T.renderInvite(t, me.sessionId));
      log("take", t.id, "->", me.name);
      return { ok: true, id: t.id };
    }

    case "transcript-url": {
      const t = T.load(req.id);
      if (!t) return { ok: false, error: `spochie ${req.id} no existe` };
      t.transcriptUrl = req.url;
      t.transcriptOwner = req.sessionId ?? t.transcriptOwner;
      t.transcriptStale = 0;
      T.save(t);
      if (t.slack && slack) await slack.post(t, `Transcript en vivo: ${req.url}`);
      return { ok: true, id: t.id, url: req.url };
    }

    case "slack-reload": {
      slack = SlackBridge.fromConfig(onSlackMessage, onSlackAccept, onRemoteAccept);
      return { ok: true, slack: Boolean(slack) };
    }

    default:
      return { ok: false, error: `op desconocida: ${req.op}` };
  }
}

/**
 * A que sesion local le toca un spochie que llega de fuera.
 *
 * La primera regla era "la rama del sobre tiene que existir en su checkout". Se cayo
 * con el primer caso realista: Alex en feat/modal-guardar y Edu en feat/guardar-perfil,
 * repos distintos y ramas distintas, que es justo el caso para el que existe spochie.
 * Ahora: la rama si encaja, si no la unica sesion viva, y si hay varias no se reparte
 * a ciegas: se avisa a todas y elige la persona con `spochie take <id>`.
 */
function candidates(t: T.Thread): { pick: SessionRecord | null; ambiguas: SessionRecord[] } {
  const vivas = liveSessions();
  if (vivas.length === 0) return { pick: null, ambiguas: [] };
  const porRama = vivas.filter(s => repoMatches(s.cwd, t.context.branch));
  if (porRama.length === 1) return { pick: porRama[0], ambiguas: [] };
  if (porRama.length > 1) return { pick: null, ambiguas: porRama };
  if (vivas.length === 1) return { pick: vivas[0], ambiguas: [] };
  return { pick: null, ambiguas: vivas };
}

/** Entrega la invitacion a quien le toque, o pregunta si no esta claro. */
async function assign(t: T.Thread): Promise<string | null> {
  if (t.state !== "pending" || !t.to.sessionId.startsWith("slack:")) return null;
  // Quien abrio el tunel no es el destinatario: si se lo repartiera a si mismo,
  // se pisaria el nombre del otro lado y el transcript diria "Alex y Alex".
  const yo = Cfg.load().slack?.userId;
  if (yo && t.from.slackUser === yo) return null;
  const { pick, ambiguas } = candidates(t);
  if (pick) {
    t.to = { ...t.to, sessionId: pick.sessionId, name: pick.name, cwd: pick.cwd, human: Cfg.load().human ?? t.to.human };
    T.save(t);
    await send(pick, T.renderInvite(t, pick.sessionId));
    log("assign", t.id, "->", pick.name);
    return pick.sessionId;
  }
  for (const s of ambiguas) {
    await send(s, `[spochie ${t.id}] ${t.from.human ?? t.from.name} quiere abrir un tunel sobre "${t.subject}", y hay varias sesiones tuyas abiertas.
Si esto es para esta sesion, preguntale a tu humano y ejecuta:  spochie take ${t.id}`);
  }
  if (ambiguas.length) log("assign", t.id, "ambiguo entre", ambiguas.length);
  return null;
}

/** Aceptar escribiendo en el hilo de Slack. Hace lo mismo que `spochie accept`. */
async function onSlackAccept(t: T.Thread, quien: string) {
  if (t.state !== "pending") return;
  // Puede que el spochie todavia no tenga sesion local: primero se le busca una.
  if (t.to.sessionId.startsWith("slack:")) await assign(t);
  const fresco = T.load(t.id) ?? t;
  fresco.state = "open";
  fresco.acceptedAt = Date.now();
  fresco.acceptedBy = Cfg.load().human ?? quien;
  fresco.lastActivityAt = fresco.acceptedAt;
  T.save(fresco);
  await sendToSide(fresco, fresco.from, T.renderAccepted(fresco, fresco.from.sessionId));
  const local = sessById(fresco.to.sessionId);
  if (local) await send(local, `[spochie ${fresco.id} | ${fresco.subject}] tu humano lo ha aceptado ${quien}. El tunel esta abierto: puedes contestar con  spochie say ${fresco.id} "<texto>"`);
  await refreshTranscript(fresco);
  log("accept", fresco.id, quien);
}

/** El otro lado ha aceptado: quien abrio el tunel se entera y sale de "pending". */
async function onRemoteAccept(t: T.Thread, quien: string) {
  const fresco = T.load(t.id) ?? t;
  if (fresco.state !== "pending") return;
  fresco.state = "open";
  fresco.acceptedAt = Date.now();
  fresco.acceptedBy = fresco.to.human ?? quien;
  fresco.lastActivityAt = fresco.acceptedAt;
  T.save(fresco);
  const local = sessById(fresco.from.sessionId);
  if (local) await send(local, T.renderAccepted(fresco, fresco.from.sessionId));
  await refreshTranscript(fresco);
  log("remote-accept", fresco.id);
}

/** Un turno que llega por Slack desde otra maquina, o de un humano escribiendo en el hilo. */
async function onSlackMessage(t: T.Thread, m: T.Msg) {
  t.messages.push(m);
  t.lastActivityAt = m.at;
  if (t.state === "pending" && m.author === "human") { t.state = "open"; t.acceptedAt = m.at; t.acceptedBy = "humano en Slack"; }
  T.save(t);
  // Un spochie recien descubierto todavia no tiene lado local: se le busca uno.
  if (t.state === "pending" && t.to.sessionId.startsWith("slack:")) {
    const asignada = await assign(t);
    log("slack-in", t.id, m.author, asignada ? "asignado" : "sin sesion a la que asignar");
    return;
  }
  const mio = sessById(t.to.sessionId) ? t.to.sessionId : t.from.sessionId;
  const local = sessById(mio);
  if (local) {
    await send(local, conTranscript(t, mio, T.renderMessage(t, m, mio)));
    // El otro lado ve que aqui se esta trabajando, en vez de 40 segundos en blanco.
    if (slack) await slack.pensandoOn(t, T.mySide(t, mio).human ?? T.mySide(t, mio).name);
  }
  await refreshTranscript(t);
  log("slack-in", t.id, m.author, local ? "entregado" : "sin sesion local");
}

async function closeThread(t: T.Thread, reason: string, bySession?: string) {
  t.state = "closed";
  t.closedAt = Date.now();
  t.closeReason = reason;
  T.save(t);
  const notified: string[] = [];
  for (const side of [t.from, t.to]) {
    if (side.sessionId === bySession) continue;
    const ok = await sendToSide(t, side, T.renderClose(t));
    notified.push(`${side.name}:${ok ? "entregado" : "FALLO"}`);
  }
  await refreshTranscript(t);
  log("close", t.id, reason, notified.join(" "));
}

async function tick() {
  const now = Date.now();
  for (const t of T.all()) {
    if (t.state === "closed") continue;
    const due = T.expiresAt(t);
    if (due === null) continue;
    if (now > due) {
      await closeThread(t, t.state === "pending" ? "caducado sin aceptar (4h)" : "silencio de 10 min");
      continue;
    }
    // Avisar antes de matarlo, en vez de que desaparezca sin decir nada.
    if (t.state === "open" && !t.avisado && due - now < T.AVISO_ANTES_MS) {
      t.avisado = true;
      T.save(t);
      for (const side of [t.from, t.to]) {
        const s = sessById(side.sessionId);
        if (s) await send(s, T.renderAviso(t, (due - now) / 1000));
      }
      log("aviso-silencio", t.id);
    }
  }
  if (slack) { try { await slack.poll(); } catch (e) { log("slack-poll-error", String(e)); } }
}

function main() {
  ensureDirs();
  if (alreadyRunning()) { console.error("spochied ya esta corriendo"); process.exit(0); }
  if (existsSync(DAEMON_SOCK)) unlinkSync(DAEMON_SOCK);
  writeFileSync(DAEMON_LOCK, String(process.pid));
  slack = SlackBridge.fromConfig(onSlackMessage, onSlackAccept, onRemoteAccept);

  const server = net.createServer(conn => {
    let buf = "";
    conn.on("data", async chunk => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let res: any;
        try { res = await handle(JSON.parse(line)); }
        catch (e) { res = { ok: false, error: String(e) }; }
        conn.write(JSON.stringify(res) + "\n");
      }
    });
    conn.on("error", () => {});
  });

  server.listen(DAEMON_SOCK, () => log("spochied escuchando", DAEMON_SOCK, "pid", process.pid, "slack", Boolean(slack)));

  const late = () => {
    const vivo = T.all().some(t => t.state !== "closed" && t.slack);
    tick()
      .catch(e => log("tick-error", String(e)))
      .finally(() => setTimeout(late, vivo ? TICK_VIVO_MS : TICK_IDLE_MS));
  };
  setTimeout(late, TICK_VIVO_MS);

  const bye = () => { try { unlinkSync(DAEMON_SOCK); } catch {} try { unlinkSync(DAEMON_LOCK); } catch {} process.exit(0); };
  process.on("SIGINT", bye); process.on("SIGTERM", bye);
}

main();
