import { expect, test, afterAll } from "bun:test";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { textoDialogo } from "../src/dialogo.ts";

/**
 * El aviso fuera de la terminal. Aqui el "dialogo" es un programa que recibe el texto y
 * contesta con un boton: Aceptar salvo que el asunto diga "rechazame". Con eso se prueba
 * lo que pidio Edu: la sesion donde trabaja no recibe NADA, ni la invitacion; aceptar
 * abre el aparte en su repo y la conversacion va alli; rechazar cierra el tunel.
 */
const HOME = mkdtempSync(join(tmpdir(), "spoochie-dlg-"));
const DAEMON_SOCK = join(HOME, "daemon.sock");
const RECIBIDO = join(HOME, "aparte-recibido.txt");
const AVISOS = join(HOME, "avisos.txt");
const REPO = mkdtempSync(join(tmpdir(), "repo-dlg-"));

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
        try { const f = JSON.parse(line); if (f.type === "user") got.push(f.message.content); } catch {}
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
    c.on("error", reject);
    c.on("connect", () => c.write(JSON.stringify(req) + "\n"));
    c.on("data", d => { buf += d.toString(); const i = buf.indexOf("\n"); if (i >= 0) { c.destroy(); resolve(JSON.parse(buf.slice(0, i))); } });
  });
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function hasta(pred: () => boolean, ms = 8000) { for (let i = 0; i < ms / 50; i++) { if (pred()) return true; await sleep(50); } return pred(); }
const leer = (f: string) => existsSync(f) ? readFileSync(f, "utf8") : "";
const hilo = (id: string) => JSON.parse(readFileSync(join(HOME, "threads", `${id}.json`), "utf8"));

const S = fakeInbox("dlg");
let daemon: ChildProcess;
afterAll(() => { daemon?.kill(); S.server.close(); });

test("el texto del aviso lleva quien, asunto, rama y la pregunta, y dice que abre una ventana aparte", () => {
  const t: any = { id: "d1", subject: "el boton", from: { sessionId: "slack:U1", name: "Ana", human: "Ana", cwd: "x" }, to: {}, context: { branch: "feat/x" },
    messages: [{ at: 1, from: "slack:U1", author: "claude", kind: "text", text: "mira tu Button" }] };
  const s = textoDialogo(t);
  expect(s).toContain("Ana quiere abrir un spoochie");
  expect(s).toContain("Asunto: el boton");
  expect(s).toContain("Rama: feat/x");
  expect(s).toContain("mira tu Button");
  expect(s).toContain("Poochie no las toca");
});

test("el aviso va a un dialogo: la sesion no recibe nada; aceptar abre el aparte, rechazar cierra", async () => {
  const bin = mkdtempSync(join(tmpdir(), "sp-dlg-bin-"));
  writeFileSync(join(bin, "dialogo"), `#!/bin/sh
printf '%s\\n---\\n' "$1" >> "$SPOOCHIE_HOME/avisos.txt"
case "$1" in *rechazame*) echo Rechazar ;; *) echo Aceptar ;; esac
`);
  writeFileSync(join(bin, "claude"), `#!/bin/sh
while IFS= read -r line; do printf '%s\\n' "$line" >> "$SPOOCHIE_HOME/aparte-recibido.txt"; done
`);
  chmodSync(join(bin, "dialogo"), 0o755); chmodSync(join(bin, "claude"), 0o755);
  mkdirSync(join(HOME, "sessions"), { recursive: true, mode: 0o700 });
  mkdirSync(join(HOME, "threads"), { recursive: true, mode: 0o700 });
  writeFileSync(join(HOME, "config.json"), JSON.stringify({ guardian: false, transcript: false, aparte: true, human: "Edu", slack: { userId: "U_ME" } }), { mode: 0o600 });
  writeFileSync(join(HOME, "sessions", "S.json"),
    JSON.stringify({ sessionId: "S", name: "trabajo", cwd: REPO, socket: S.sock, token: "t", pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
  daemon = spawn("bun", ["run", join(import.meta.dir, "..", "src", "daemon.ts")], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPOOCHIE_HOME: HOME, SPOOCHIE_VENTANA: "fondo", SPOOCHIE_AVISO: join(bin, "dialogo") }, stdio: "ignore",
  });
  for (let i = 0; i < 60 && !existsSync(DAEMON_SOCK); i++) await sleep(100);
  expect((await rpc({ op: "ping" })).pid).toBe(daemon.pid!);

  // Un spoochie llegado de otra maquina, sin lado local todavia.
  const sobre = (id: string, subject: string) => ({
    id, subject, state: "pending", createdAt: Date.now(), lastActivityAt: Date.now(),
    from: { sessionId: "slack:U_ANA", name: "Ana", cwd: "(otra maquina)", human: "Ana", slackUser: "U_ANA" },
    to: { sessionId: "slack:U_ME", name: "yo", cwd: "(esta maquina)", slackUser: "U_ME" },
    context: {}, messages: [{ at: Date.now(), from: "slack:U_ANA", author: "claude", kind: "text", text: `pregunta de ${id}` }],
  });
  writeFileSync(join(HOME, "threads", "ok1.json"), JSON.stringify(sobre("ok1", "el boton")));
  await rpc({ op: "claim", sessionId: "S" });

  // El dialogo se mostro con la pregunta; el aparte nacio en el repo de la sesion y recibio el primer turno.
  expect(await hasta(() => leer(AVISOS).includes("pregunta de ok1"))).toBe(true);
  expect(await hasta(() => leer(RECIBIDO).includes("Asunto: el boton") && leer(RECIBIDO).includes("pregunta de ok1"))).toBe(true);
  expect(hilo("ok1").state).toBe("open");
  expect(hilo("ok1").to.cwd).toBe(REPO);

  // Rechazar cierra, sin aparte.
  writeFileSync(join(HOME, "threads", "no1.json"), JSON.stringify(sobre("no1", "rechazame")));
  await rpc({ op: "claim", sessionId: "S" });
  expect(await hasta(() => hilo("no1").state === "closed")).toBe(true);
  expect(hilo("no1").closeReason).toContain("rechazado");
  await sleep(300);
  expect(leer(RECIBIDO)).not.toContain("no1");

  // Y la sesion de trabajo no ha recibido NADA en todo el proceso.
  expect(S.got).toEqual([]);
}, 30_000);
