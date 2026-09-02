import { execFileSync } from "node:child_process";

/** Lo que viaja en la invitacion. `u` es para quien va (asi el alta no tiene que
 *  buscarse a si mismo en Slack, que exige un scope que la app puede no tener) e `i`
 *  es quien invita, para que "@edu" resuelva en local sin llamar a Slack. */
export type Invitacion = { b: string; t?: string; u?: string; n?: string; i?: { id: string; name: string; pk?: string } };

export function crearInvitacion(inv: Invitacion): string {
  return Buffer.from(JSON.stringify(inv)).toString("base64url");
}

/** Lo que llega pegado nunca es la cadena limpia. Puede venir el comando entero
 *  ("spoochie join eyJ... --email x"), la barra del plugin ("/spoochie:join eyJ..."),
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
    if (typeof j?.b !== "string" || !j.b) return null;
    const inv: Invitacion = { b: j.b };
    if (typeof j.t === "string") inv.t = j.t;
    if (typeof j.u === "string" && /^[UW][A-Z0-9]{6,}$/.test(j.u)) inv.u = j.u;
    // Como se llama quien se da de alta, para que no firme con el usuario de su Mac.
    if (typeof j.n === "string" && j.n.trim()) inv.n = j.n.trim().slice(0, 60);
    if (j.i && typeof j.i.id === "string" && typeof j.i.name === "string") {
      inv.i = { id: j.i.id, name: j.i.name };
      if (typeof j.i.pk === "string") inv.i.pk = j.i.pk;
    }
    return inv;
  } catch { return null; }
}

/** El DM que recibe quien se da de alta. Lleva todo lo que tiene que hacer, en
 *  orden, con la cadena ya dentro: no hay nada que pedir aparte. */
export function textoInvitacion(blob: string, quien: string, repo = "edugargar/spoochie"): string {
  const arroba = quien.toLowerCase().replace(/\s+/g, "");
  return [
    `${quien} te invita a spoochie: un tunel entre tu sesion de Claude Code y la suya.`,
    `Nadie escribe en tu maquina y ningun tunel se abre sin que tu aceptes.`,
    ``,
    `Para entrar no hace falta instalar nada antes:`,
    `1. En Claude Code:  /plugin marketplace add ${repo}`,
    `2. Despues:         /plugin install spoochie@${repo.split("/")[0]}`,
    `3. Reinicia Claude Code (la primera vez tarda unos segundos: se baja lo que necesita).`,
    `4. Pega esto en Claude Code, entero:`,
    `/spoochie:join ${blob}`,
    ``,
    `Tu Claude te dira si estas dentro. Para probar, pidele: "abre un spoochie con @${arroba} y preguntale que es esto".`,
  ].join("\n");
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
