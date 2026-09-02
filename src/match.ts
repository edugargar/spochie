import { execFileSync } from "node:child_process";

/**
 * Una sesion encaja con un spochie que llega de fuera si su checkout conoce la rama
 * del sobre. Sin rama no hay con que decidir, y no se reparte a ciegas: se queda en
 * cola hasta que arranque una sesion que si encaje, o hasta que caduquen las 4h.
 */
export function repoMatches(cwd: string, branch?: string): boolean {
  if (!branch) return false;
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", branch], { cwd, stdio: "ignore" });
    return true;
  } catch { return false; }
}
