import { expect, test, afterAll } from "bun:test";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { herramientasPermitidas, primerTurno } from "../src/aparte.ts";

/**
 * El Claude aparte de verdad es `claude -p`. Aqui hay uno falso en el PATH que hace
 * lo que el demonio necesita de el: registrarse como sesion con SPOCHIE_APARTE (lo que
 * en la vida real hace el hook SessionStart) y apuntar cada turno que le entra por
 * stdin. Con eso se prueba el reparto: el aparte recibe la conversacion, la sesion
 * interactiva solo el aviso.
 */
const HOME = mkdtempSync(join(tmpdir(), "spochie-ap-"));
const DAEMON_SOCK = join(HOME, "daemon.sock");
const RECIBIDO = join(HOME, "aparte-recibido.txt");
// Directorios de verdad: el aparte se lanza con cwd ahi, y un cwd que no existe es ENOENT.
const REPO_A = mkdtempSync(join(tmpdir(), "repo-pa-")), REPO_B = mkdtempSync(join(tmpdir(), "repo-pb-"));

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
const recibido = () => existsSync(RECIBIDO) ? readFileSync(RECIBIDO, "utf8") : "";

const A = fakeInbox("apa"), B = fakeInbox("apb");
let daemon: ChildProcess;
afterAll(() => { daemon?.kill(); A.server.close(); B.server.close(); });

test("el aparte solo puede leer, hablar por el tunel y cerrar", () => {
  const h = herramientasPermitidas("/x/spochie");
  expect(h).toContain("Read");
  expect(h).toContain("Bash(/x/spochie say:*)");
  expect(h).toContain("Bash(git diff:*)");
  expect(h.join(" ")).not.toMatch(/Edit|Write|accept|release|discard|Bash\(sh|Bash\(git push/);
});

test("al aceptar, la conversacion va al Claude aparte y la sesion solo recibe el aviso", async () => {
  const bin = mkdtempSync(join(tmpdir(), "sp-claude-ap-"));
  writeFileSync(join(bin, "claude"), `#!/bin/sh
# Se registra como haria el hook (el "socket" es un fichero que existe: el registro exige
# uno, y aqui la entrega va por stdin) y apunta lo que le llega.
mkdir -p "$SPOCHIE_HOME/sessions"
printf '{"sessionId":"ap-%s","name":"aparte-%s","cwd":"%s","socket":"%s/latido","token":"t","pid":%s,"startedAt":%s,"aparte":"%s"}' \\
  "$SPOCHIE_APARTE" "$SPOCHIE_APARTE" "$PWD" "$SPOCHIE_HOME" "$$" "$(date +%s)000" "$SPOCHIE_APARTE" > "$SPOCHIE_HOME/sessions/ap-$SPOCHIE_APARTE.json"
chmod 600 "$SPOCHIE_HOME/sessions/ap-$SPOCHIE_APARTE.json"
while IFS= read -r line; do printf '%s\\n' "$line" >> "$SPOCHIE_HOME/aparte-recibido.txt"; done
`);
  chmodSync(join(bin, "claude"), 0o755);

  mkdirSync(join(HOME, "sessions"), { recursive: true, mode: 0o700 });
  writeFileSync(join(HOME, "config.json"), JSON.stringify({ guardian: false, transcript: false, aparte: true, human: "Edu" }), { mode: 0o600 });
  for (const [id, box, cwd] of [["PA", A, REPO_A], ["PB", B, REPO_B]] as const) {
    writeFileSync(join(HOME, "sessions", `${id}.json`),
      JSON.stringify({ sessionId: id, name: `repo-${id.toLowerCase()}`, cwd, socket: box.sock, token: "t", pid: process.pid, startedAt: Date.now() }),
      { mode: 0o600 });
  }
  daemon = spawn("bun", ["run", join(import.meta.dir, "..", "src", "daemon.ts")], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SPOCHIE_HOME: HOME }, stdio: "ignore",
  });
  for (let i = 0; i < 60 && !existsSync(DAEMON_SOCK); i++) await sleep(100);
  expect((await rpc({ op: "ping" })).pid).toBe(daemon.pid!);

  const open = await rpc({ op: "open", sessionId: "PA", to: "repo-pb", subject: "el boton", body: "mira tu Button" });
  expect(open.ok).toBe(true);
  // La invitacion si entra en la sesion: es el humano quien acepta.
  expect(await hasta(() => B.got.some(x => x.includes(`spochie accept ${open.id}`)))).toBe(true);

  const acc = await rpc({ op: "accept", sessionId: "PB", id: open.id, by: "Edu" });
  expect(acc.ok).toBe(true);
  expect(acc.aparte).toBe(REPO_B);
  // El aparte nace en el directorio de la sesion que acepto y recibe el primer turno con el asunto.
  expect(await hasta(() => recibido().includes("Asunto: el boton") && recibido().includes("mira tu Button"))).toBe(true);
  expect(await hasta(() => B.got.some(x => x.includes(`Lo atiende un Claude aparte en ${REPO_B}`)))).toBe(true);

  // Lo que dice A ahora va al aparte, no a la sesion B.
  const antes = B.got.length;
  const say = await rpc({ op: "say", sessionId: "PA", id: open.id, text: "es el min-width del contenedor, seguro" });
  expect(say.delivered).toBe(true);
  expect(await hasta(() => recibido().includes("min-width del contenedor"))).toBe(true);
  await sleep(300);
  expect(B.got.slice(antes).some(x => x.includes("min-width"))).toBe(false);

  // Un aparte nunca es candidato para otro spochie.
  const s = await rpc({ op: "sessions" });
  expect(s.sessions.find((x: any) => x.aparte === open.id)).toBeTruthy();
  const otro = await rpc({ op: "open", sessionId: "PA", to: "repo-pb", subject: "otro", body: "otra cosa" });
  expect(otro.ok).toBe(true);
  expect(await hasta(() => B.got.some(x => x.includes(`spochie accept ${otro.id}`)))).toBe(true);

  // Cerrar avisa al aparte por el mismo camino.
  await rpc({ op: "close", sessionId: "PA", id: open.id, reason: "resuelto" });
  expect(await hasta(() => recibido().includes("cerrado (resuelto)"))).toBe(true);
}, 30_000);

test("el primer turno lleva quien es, como contestar y lo dicho hasta ahora", () => {
  const t: any = { id: "z9", subject: "el boton", from: { sessionId: "A", name: "a", cwd: "/a", human: "Ana" }, to: { sessionId: "ap-z9", name: "aparte", cwd: "/b", human: "Edu" }, context: {}, state: "open",
    messages: [{ at: 1, from: "A", author: "claude", kind: "text", text: "mira tu Button" }, { at: 2, from: "A", author: "claude", kind: "text", text: "esto no", retenido: "si" }] };
  const p = primerTurno(t, "ap-z9", "/x/spochie");
  expect(p).toContain("/x/spochie say z9");
  expect(p).toContain("mira tu Button");
  expect(p).not.toContain("esto no");
  expect(p).toContain("Ana");
});
