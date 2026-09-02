/**
 * Como se arranca el demonio, y como se sabe que sigue vivo.
 *
 * Antes lo levantaba el primer hook SessionStart y moria con el reinicio de la
 * maquina; el sintoma de un demonio muerto era "no llega nada". Ahora en macOS se
 * registra en launchd con KeepAlive, y escribe un latido cada 20 s que `doctor` mide.
 * El hook sigue sirviendo de red: si no hay latido, arranca lo que haga falta.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, DAEMON_LOG, DAEMON_LOCK, ensureDirs } from "./paths.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** `bun build --compile` mete los ficheros en un sistema virtual. Si estamos ahi,
 *  el ejecutable es spochie mismo y el demonio se arranca como subcomando. */
export const COMPILADO = import.meta.path.includes("$bunfs");

export const LATIDO = join(ROOT, "latido");
export const LATIDO_MS = 20_000;
export const LABEL = "dev.spochie.spochied";

export function comandoDemonio(): string[] {
  // Para las pruebas: un demonio que no arranca, a proposito y sin depender del PATH.
  if (process.env.SPOCHIE_DAEMON_CMD) return process.env.SPOCHIE_DAEMON_CMD.split(" ");
  if (COMPILADO) return [process.execPath, "daemon"];
  const bun = (() => { try { return execFileSync("which", ["bun"], { encoding: "utf8" }).trim(); } catch { return "bun"; } })();
  return [bun, "run", join(HERE, "daemon.ts")];
}

export function latir() {
  try {
    if (!existsSync(LATIDO)) writeFileSync(LATIDO, "", { mode: 0o600 });
    const now = new Date();
    utimesSync(LATIDO, now, now);
  } catch {}
}

/** Segundos desde el ultimo latido, o null si nunca lo hubo. */
export function edadLatido(): number | null {
  try { return (Date.now() - statSync(LATIDO).mtimeMs) / 1000; } catch { return null; }
}

const plistPath = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function plistDeseado(): string {
  const args = comandoDemonio().map(a => `      <string>${a}</string>`).join("\n");
  const path = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Lo escribe spochie (register / join). Se reescribe solo si cambia la ruta del plugin. -->
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${path}</string>
    <key>HOME</key><string>${homedir()}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${DAEMON_LOG}</string>
  <key>StandardErrorPath</key><string>${DAEMON_LOG}</string>
</dict></plist>
`;
}

const uid = () => { try { return execFileSync("id", ["-u"], { encoding: "utf8" }).trim(); } catch { return "501"; } };
const launchctl = (args: string[]) => { try { execFileSync("launchctl", args, { stdio: "ignore" }); return true; } catch { return false; } };

export function launchdInstalado(): boolean {
  return process.platform === "darwin" && existsSync(plistPath()) && !process.env.SPOCHIE_HOME;
}

/** Deja el demonio bajo launchd. Idempotente: si el plist ya dice lo mismo, no toca
 *  nada. Si cambia (el plugin se actualizo y la ruta es otra), lo recarga. Con
 *  SPOCHIE_HOME puesto no se instala nada: eso es un laboratorio, no tu maquina. */
export function instalarLaunchd(): "instalado" | "actualizado" | "igual" | "no" {
  if (process.platform !== "darwin" || process.env.SPOCHIE_HOME) return "no";
  ensureDirs();
  const deseado = plistDeseado();
  const p = plistPath();
  const habia = existsSync(p) ? readFileSync(p, "utf8") : null;
  if (habia === deseado) return "igual";
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, deseado, { mode: 0o644 });
  // Un demonio que arranco un hook sigue con el candado puesto; launchd arrancaria
  // otro que moriria al instante, y lo reintentaria cada 10 s. Se apaga el viejo.
  if (habia === null) {
    try { const pid = Number(readFileSync(DAEMON_LOCK, "utf8").trim()); if (pid) process.kill(pid, "SIGTERM"); } catch {}
  } else {
    launchctl(["bootout", `gui/${uid()}/${LABEL}`]);
  }
  launchctl(["bootstrap", `gui/${uid()}`, p]) || launchctl(["load", "-w", p]);
  return habia === null ? "instalado" : "actualizado";
}

/** Arranca el demonio como toque: por launchd si esta, a mano si no. */
export function arrancarDemonio() {
  ensureDirs();
  if (launchdInstalado()) {
    if (launchctl(["kickstart", `gui/${uid()}/${LABEL}`])) return;
  }
  const out = openSync(DAEMON_LOG, "a");
  const [cmd, ...args] = comandoDemonio();
  spawn(cmd, args, { detached: true, stdio: ["ignore", out, out] }).unref();
}
