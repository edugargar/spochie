import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, renameSync } from "node:fs";

/** SPOOCHIE_HOME aisla todo el estado. Los tests lo usan: os.homedir() en Bun no
 *  respeta $HOME, asi que sin esto un test escribe en tu ~/.claude de verdad. */
export const ROOT = process.env.SPOOCHIE_HOME ?? join(homedir(), ".claude", "spoochie");

/** El proyecto se llamo "spochie" hasta la 0.5.4. El estado (config con el token y las
 *  claves, agenda, hilos) vivia en ~/.claude/spochie: la primera vez que arranca la
 *  version nueva se lo lleva tal cual al directorio nuevo, para que nadie tenga que
 *  volver a darse de alta. Solo si el nuevo no existe todavia. */
export function migrarEstado(viejo: string, nuevo: string): boolean {
  if (!existsSync(viejo) || existsSync(nuevo)) return false;
  try { renameSync(viejo, nuevo); return true; } catch { return false; }
}
if (!process.env.SPOOCHIE_HOME) migrarEstado(join(homedir(), ".claude", "spochie"), ROOT);
export const SESSIONS_DIR = join(ROOT, "sessions");
export const THREADS_DIR = join(ROOT, "threads");
export const DAEMON_SOCK = join(ROOT, "daemon.sock");
export const DAEMON_LOCK = join(ROOT, "daemon.pid");
export const DAEMON_LOG = join(ROOT, "daemon.log");
export const OUTBOX_FILE = join(ROOT, "outbox.json");

export function ensureDirs() {
  for (const d of [ROOT, SESSIONS_DIR, THREADS_DIR]) mkdirSync(d, { recursive: true, mode: 0o700 });
}
