import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** SPOCHIE_HOME aisla todo el estado. Los tests lo usan: os.homedir() en Bun no
 *  respeta $HOME, asi que sin esto un test escribe en tu ~/.claude de verdad. */
export const ROOT = process.env.SPOCHIE_HOME ?? join(homedir(), ".claude", "spochie");
export const SESSIONS_DIR = join(ROOT, "sessions");
export const THREADS_DIR = join(ROOT, "threads");
export const DAEMON_SOCK = join(ROOT, "daemon.sock");
export const DAEMON_LOCK = join(ROOT, "daemon.pid");
export const DAEMON_LOG = join(ROOT, "daemon.log");

export function ensureDirs() {
  for (const d of [ROOT, SESSIONS_DIR, THREADS_DIR]) mkdirSync(d, { recursive: true, mode: 0o700 });
}
