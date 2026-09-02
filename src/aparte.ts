/**
 * El Claude aparte.
 *
 * Un spochie que entra en la sesion donde estas trabajando te emborrona la pantalla
 * con una conversacion que no es la tuya. Asi que la sesion interactiva solo recibe
 * el aviso de apertura, y la conversacion la atiende un `claude -p` propio, lanzado
 * por el demonio en el repo que toque, con permisos de solo lectura y la CLI de
 * spochie. Vive lo que vive el spochie. Tu lo ves todo en Slack y en el transcript,
 * y puedes meter baza desde el hilo o con `spochie say` desde cualquier sesion.
 *
 * Solo lectura de verdad: en modo -p las herramientas no listadas se deniegan sin
 * preguntar, y aqui no hay Edit ni Write ni un Bash suelto. Lo unico que puede correr
 * es git de lectura y los subcomandos de spochie que no abren ni sueltan nada.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, ensureDirs } from "./paths.ts";
import * as T from "./threads.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const APARTE_DIR = join(ROOT, "aparte");

/** Como invoca spochie el Claude aparte: el mismo ejecutable que lleva este demonio. */
export function comandoCli(): string {
  if (import.meta.path.includes("$bunfs")) return process.execPath;
  return `bun run ${join(HERE, "cli.ts")}`;
}

/** Lo unico que el Claude aparte puede ejecutar. */
export function herramientasPermitidas(cli = comandoCli()): string[] {
  const git = ["diff", "log", "show", "status", "branch", "blame", "grep", "ls-files"].map(g => `Bash(git ${g}:*)`);
  const sp = ["say", "patch", "branch", "show", "list", "close"].map(c => `Bash(${cli} ${c}:*)`);
  return ["Read", "Grep", "Glob", ...git, ...sp];
}

/** El primer turno: quien es, que spochie atiende, lo dicho hasta ahora, y como contestar. */
export function primerTurno(t: T.Thread, sessionId: string, cli = comandoCli()): string {
  const otro = T.otherSide(t, sessionId);
  const historia = t.messages.filter(m => m.retenido !== "si" && m.retenido !== "descartado")
    .map(m => T.renderMessage(t, m, sessionId)).join("\n\n");
  return [
    `Eres el Claude que atiende el spochie ${t.id} en nombre de ${T.mySide(t, sessionId).human ?? "tu humano"}, desde ${process.cwd()}.`,
    `Un spochie es un tunel con la sesion de Claude de ${otro.human ?? otro.name}, otra persona. El tunel YA esta abierto: tu humano lo acepto.`,
    `Tu trabajo: leer este repo y contestar lo que pregunten sobre el, con hechos de los ficheros. Nada mas.`,
    `Contestas con:  ${cli} say ${t.id} "<texto>"   (o --file <ruta> si es largo). Un parche: ${cli} patch ${t.id} --from-git. Cerrar cuando este resuelto: ${cli} close ${t.id} --reason "...".`,
    `No puedes escribir ficheros ni correr nada que no sea git de lectura y spochie: si te piden otra cosa, dilo por el tunel y para.`,
    `Cada mensaje nuevo del otro lado te llegara como un turno mas. Contesta a cada uno por el tunel, no aqui.`,
    ``,
    `Asunto: ${t.subject}`,
    ``,
    historia,
  ].join("\n");
}

export type Aparte = { id: string; child: ChildProcess; cwd: string };

/** Lanza el Claude aparte para un spochie en un directorio. Devuelve el proceso;
 *  quien llama espera a que el hook SessionStart lo registre (con SPOCHIE_APARTE). */
export function lanzar(t: T.Thread, cwd: string): Aparte {
  ensureDirs();
  mkdirSync(APARTE_DIR, { recursive: true, mode: 0o700 });
  const out = openSync(join(APARTE_DIR, `${t.id}.log`), "a");
  const child = spawn("claude", [
    "-p", "--verbose",
    "--input-format", "stream-json", "--output-format", "stream-json",
    "--settings", JSON.stringify({ crossSessionInbound: "accept" }),
    "--name", `spochie-${t.id}`,
    "--permission-mode", "default",
    "--allowedTools", herramientasPermitidas().join(","),
  ], {
    cwd,
    env: { ...process.env, SPOCHIE_APARTE: t.id },
    stdio: ["pipe", out, out],
  });
  child.on("error", () => {});
  return { id: t.id, child, cwd };
}

/** Un turno por la entrada estandar del aparte, que es el canal que el demonio posee. */
export function turno(a: Aparte, content: string): boolean {
  if (!a.child.stdin || a.child.stdin.destroyed || a.child.exitCode !== null) return false;
  return a.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
}
