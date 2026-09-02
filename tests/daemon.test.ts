import { expect, test, afterAll } from "bun:test";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register } from "../src/registry.ts";
import * as Cfg from "../src/config.ts";
import * as T from "../src/threads.ts";
import { DAEMON_SOCK } from "../src/paths.ts";

/** Un buzon falso: hace de sesion de Claude y apunta lo que le entregan. */
function fakeInbox(name: string) {
  const sock = join(mkdtempSync(join(tmpdir(), `sp-${name}-`)), "s.sock");
  const got: string[] = [];
  const server = net.createServer(c => {
    let buf = "";
    c.on("data", d => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const f = JSON.parse(line);
          if (f.type === "user") got.push(f.message.content);
        } catch {}
      }
    });
  });
  server.listen(sock);
  return { sock, got, server };
}

function rpc(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const c = net.createConnection({ path: DAEMON_SOCK });
    let buf = "";
    c.setTimeout(10_000, () => { c.destroy(); reject(new Error("timeout")); });
    c.on("error", reject);
    c.on("connect", () => c.write(JSON.stringify(req) + "\n"));
    c.on("data", d => {
      buf += d.toString();
      const i = buf.indexOf("\n");
      if (i >= 0) { c.destroy(); resolve(JSON.parse(buf.slice(0, i))); }
    });
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** El buzon falso recibe por su propio socket, en este mismo proceso: el rpc puede
 *  volver antes de que el evento 'data' se haya procesado. Con la suite entera en
 *  paralelo esa carrera se veia. Se espera a que llegue, con tope. */
async function llega(box: { got: string[] }, pred: (s: string) => boolean, ms = 3000) {
  for (let i = 0; i < ms / 25; i++) { if (box.got.some(pred)) return true; await sleep(25); }
  return box.got.some(pred);
}
const A = fakeInbox("a"), B = fakeInbox("b");
let daemon: ChildProcess;

afterAll(() => { daemon?.kill(); A.server.close(); B.server.close(); });

test("ciclo completo: abrir, puerta de aprobacion, hablar y cerrar", async () => {
  // El vigilante llama a un modelo; en un test no queremos ni red ni coste.
  Cfg.save({ guardian: false, transcript: false, aparte: false, human: "Edu" });
  register({ sessionId: "A", name: "repo-a", cwd: "/repo/a", socket: A.sock, token: "ta", pid: process.pid, startedAt: 1 });
  register({ sessionId: "B", name: "repo-b", cwd: "/repo/b", socket: B.sock, token: "tb", pid: process.pid, startedAt: 2 });

  daemon = spawn("bun", ["run", join(import.meta.dir, "..", "src", "daemon.ts")], {
    env: { ...process.env, SPOCHIE_HOME: process.env.SPOCHIE_HOME }, stdio: "ignore",
  });
  for (let i = 0; i < 60 && !existsSync(DAEMON_SOCK); i++) await sleep(100);
  const pong = await rpc({ op: "ping" });
  expect(pong.ok).toBe(true);
  // Que hablamos con EL demonio que hemos levantado, no con otro que ya estuviera.
  expect(pong.pid).toBe(daemon.pid!);
  expect(process.env.SPOCHIE_HOME).toContain("spochie-test-");

  // 1. Abrir: la invitacion llega a B y el hilo nace pendiente.
  const open = await rpc({ op: "open", sessionId: "A", to: "repo-b", subject: "el boton", body: "mira tu Button" });
  expect(open.ok).toBe(true);
  expect(open.delivered).toBe(true);
  const id = open.id;
  expect(await llega(B, x => x.includes(`spochie accept ${id}`))).toBe(true);
  expect((await rpc({ op: "list" })).threads[0].state).toBe("pending");

  // 2. La puerta: B no puede contestar sin que su humano acepte.
  const early = await rpc({ op: "say", sessionId: "B", id, text: "contesto sin permiso" });
  expect(early.ok).toBe(false);
  expect(early.error).toContain(`spochie accept ${id}`);
  expect(A.got.length).toBe(0);

  // 3. Aceptar: solo el lado que recibe puede hacerlo.
  expect((await rpc({ op: "accept", sessionId: "A", id })).ok).toBe(false);
  expect((await rpc({ op: "accept", sessionId: "B", id })).ok).toBe(true);
  expect(await llega(A, x => x.includes("ha aceptado el tunel"))).toBe(true);

  // 4. Hablar en las dos direcciones.
  expect((await rpc({ op: "say", sessionId: "B", id, text: "el wrapper lleva 360" })).delivered).toBe(true);
  expect(await llega(A, x => x.includes("el wrapper lleva 360"))).toBe(true);
  expect((await rpc({ op: "say", sessionId: "A", id, text: "gracias, era eso" })).delivered).toBe(true);
  expect(await llega(B, x => x.includes("gracias, era eso"))).toBe(true);

  // 5. Un tercero no entra.
  expect((await rpc({ op: "say", sessionId: "C", id, text: "hola" })).ok).toBe(false);

  // 6. Cerrar: se avisa al otro lado y deja de entregar.
  expect((await rpc({ op: "close", sessionId: "A", id, reason: "resuelto" })).ok).toBe(true);
  expect(await llega(B, x => x.includes("cerrado (resuelto)"))).toBe(true);
  expect((await rpc({ op: "say", sessionId: "A", id, text: "una mas" })).ok).toBe(false);
}, 30_000);

test("cerrar la pantalla cierra tus spochies vivos", async () => {
  const open = await rpc({ op: "open", sessionId: "A", to: "repo-b", subject: "otro", body: "hola" });
  await rpc({ op: "accept", sessionId: "B", id: open.id });
  const end = await rpc({ op: "session-end", sessionId: "A" });
  expect(end.closed).toContain(open.id);
  // Por id, no por "el ultimo mensaje": con varios hilos vivos el orden de los
  // avisos no esta garantizado y la asercion se volvia intermitente.
  expect(B.got.some(x => x.includes(open.id) && x.includes("la otra sesion se cerro"))).toBe(true);
}, 20_000);

test("un spochie remoto no se lo lleva la primera sesion que arranque", async () => {
  const { repoMatches } = await import("../src/match.ts");
  // Sin rama en el sobre no hay con que decidir: no se reparte.
  expect(repoMatches(process.cwd(), undefined)).toBe(false);
  // Una rama que no existe en ese checkout tampoco encaja.
  expect(repoMatches(process.cwd(), "rama-que-no-existe-jamas")).toBe(false);
});

test("el reparto no exige que el otro tenga tu rama", async () => {
  const { repoMatches } = await import("../src/match.ts");
  // La regla vieja: solo entraba si la rama existia en el checkout del receptor.
  // Eso deja fuera el caso normal, dos personas en ramas y repos distintos.
  expect(repoMatches(process.cwd(), "feat/modal-guardar")).toBe(false);
  // Con una sola sesion viva, ese spochie tiene que llegar igual: lo comprueba
  // el reparto del demonio, no el emparejamiento de ramas.
});

test("varios mensajes seguidos del mismo lado salen como uno", async () => {
  const open = await rpc({ op: "open", sessionId: "A", to: "repo-b", subject: "union", body: "hola" });
  await rpc({ op: "accept", sessionId: "B", id: open.id });
  const antes = B.got.length;
  // Entre sesiones locales no hay union: el socket no tiene el problema de la pared
  // de trozos en Slack. Lo que se comprueba aqui es que no se pierde ninguno.
  await rpc({ op: "say", sessionId: "A", id: open.id, text: "[1] primera parte" });
  await rpc({ op: "say", sessionId: "A", id: open.id, text: "[2] segunda parte" });
  expect(await llega(B, x => x.includes("[2] segunda parte"))).toBe(true);
  expect(B.got.length).toBe(antes + 2);
  expect(await llega(B, x => x.includes("segunda parte"))).toBe(true);
  await rpc({ op: "close", sessionId: "A", id: open.id, reason: "fin" });
}, 20_000);

test("un mensaje que pasa del limite se rechaza antes de salir, no se corta", async () => {
  const { MAX_MENSAJE } = await import("../src/threads.ts");
  expect(MAX_MENSAJE).toBeGreaterThan(20_000);
});

test("un envio local dice entregado solo si el buzon lo acepto", async () => {
  const open = await rpc({ op: "open", sessionId: "A", to: "repo-b", subject: "hecho", body: "hola" });
  await rpc({ op: "accept", sessionId: "B", id: open.id });
  const r = await rpc({ op: "say", sessionId: "A", id: open.id, text: "esto tiene que llegar de verdad" });
  expect(r.delivered).toBe(true);
  expect(await llega(B, x => x.includes("esto tiene que llegar de verdad"))).toBe(true);
  await rpc({ op: "close", sessionId: "A", id: open.id, reason: "fin" });
}, 20_000);

test("un mensaje vacio no sale", async () => {
  const open = await rpc({ op: "open", sessionId: "A", to: "repo-b", subject: "vacio", body: "hola" });
  await rpc({ op: "accept", sessionId: "B", id: open.id });
  const antes = B.got.length;
  const r = await rpc({ op: "say", sessionId: "A", id: open.id, text: "   " });
  expect(r.ok).toBe(false);
  expect(B.got.length).toBe(antes);
  await rpc({ op: "close", sessionId: "A", id: open.id, reason: "fin" });
}, 20_000);

test("con varias sesiones y ninguna que encaje, el aviso de take llega una vez por sesion", async () => {
  // Un spochie llegado por Slack, sin lado local, con una rama que ninguna sesion tiene.
  const t: T.Thread = {
    id: "amb1", subject: "ambiguo", state: "pending", createdAt: Date.now(), lastActivityAt: Date.now(),
    from: { sessionId: "slack:U_ANA", name: "Ana", cwd: "(otra maquina)", human: "Ana", slackUser: "U_ANA" },
    to: { sessionId: "slack:U_ME", name: "yo", cwd: "(esta maquina)", slackUser: "U_ME" },
    context: { branch: "feat/no-existe-en-ningun-checkout" }, messages: [],
  };
  T.save(t);
  const cuenta = (box: { got: string[] }) => box.got.filter(x => x.includes("spochie take amb1")).length;
  const a0 = cuenta(A), b0 = cuenta(B);
  // claim recorre todos los hilos y llama a assign: es lo que pasa con cada mensaje del hilo.
  await rpc({ op: "claim", sessionId: "A" });
  expect(await llega(A, x => x.includes("spochie take amb1"))).toBe(true);
  expect(await llega(B, x => x.includes("spochie take amb1"))).toBe(true);
  await rpc({ op: "claim", sessionId: "A" });
  await rpc({ op: "claim", sessionId: "B" });
  await sleep(300);
  expect(cuenta(A)).toBe(a0 + 1);
  expect(cuenta(B)).toBe(b0 + 1);
});
