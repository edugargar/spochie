import { execFileSync } from "node:child_process";

export type Invitacion = { b: string; t?: string };

/** Lo que llega pegado nunca es la cadena limpia. Puede venir el comando entero
 *  ("spochie join eyJ... --email x"), la barra del plugin ("/spochie:alta eyJ..."),
 *  comillas invertidas de Slack, o el trozo suelto. Se busca el unico token que
 *  puede ser base64url largo y se ignora todo lo demas. */
export function limpiarCadena(entrada: string): string | null {
  const trozos = (entrada ?? "").replace(/[`'"]/g, " ").split(/\s+/).filter(Boolean);
  for (const t of trozos) {
    if (t.startsWith("--")) continue;
    if (/^[A-Za-z0-9_-]{40,}$/.test(t)) return t;
  }
  return null;
}

/** Una invitacion es un JSON en base64url con el token del bot dentro. Si no
 *  descodifica o no trae token, no es una invitacion: se dice, no se adivina. */
export function leerInvitacion(blob: string): Invitacion | null {
  try {
    const j = JSON.parse(Buffer.from(blob, "base64url").toString("utf8"));
    return typeof j?.b === "string" && j.b ? { b: j.b, t: typeof j.t === "string" ? j.t : undefined } : null;
  } catch { return null; }
}

/** El email de trabajo casi siempre esta ya en git, y pedirlo otra vez es un paso
 *  mas en el unico sitio donde estamos contando pasos. Si no cuadra con Slack, el
 *  que se da de alta lo pasa a mano; el error dice cual se intento. */
export function emailDeGit(cwd = process.cwd()): string | undefined {
  try {
    const e = execFileSync("git", ["config", "--get", "user.email"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : undefined;
  } catch { return undefined; }
}
