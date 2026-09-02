import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, ensureDirs } from "./paths.ts";

export type Config = {
  /** Nombre con el que te ven los demas. Por defecto, tu usuario del sistema. */
  human?: string;
  /** El vigilante de tema cuesta una llamada a Haiku por mensaje. */
  guardian: boolean;
  /** Publicar el transcript como Artifact al abrir y en cada turno. */
  transcript: boolean;
  /** Quien te invito, y a quien has invitado. "@edu" se resuelve aqui antes de
   *  preguntar a Slack, que para buscar por nombre exige users:read. */
  contacts?: Record<string, { id: string; name: string }>;
  slack?: {
    /** Token de usuario (xoxp-) de tu app de Slack, obtenido por OAuth. Tuyo, no compartido.
     *  Vacio si usas tokenFile. Ya no hace falta para nada: con el de bot basta. */
    userToken?: string;
    /** Fichero JSON del que leer el token, para no tener una segunda copia que rotar
     *  si otra herramienta tuya ya guarda uno. */
    tokenFile?: string;
    /** Clave dentro de ese JSON. Por defecto "userToken". */
    tokenKey?: string;
    /** Token de bot (xoxb-) de la app. Es credencial de la app, no personal: todo
     *  el trafico de spochie vive en el DM entre el bot y cada persona, que es
     *  UN canal por maquina que consultar en vez de los 197 DMs de alguien. */
    botToken?: string;
    botTokenKey?: string;
    /** Tu id de usuario en Slack, para saber que mensajes del hilo son tuyos. */
    userId: string;
    /** Cada cuanto se miran los hilos abiertos. */
    pollMs: number;
  };
};

const FILE = join(ROOT, "config.json");
const DEFAULTS: Config = { guardian: true, transcript: false };

export function load(): Config {
  ensureDirs();
  if (!existsSync(FILE)) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...JSON.parse(readFileSync(FILE, "utf8")) }; }
  catch { return { ...DEFAULTS }; }
}

/** El token, venga de donde venga. Leerlo del fichero de otra herramienta en vez de
 *  copiarlo evita tener dos copias que rotar por separado. */
export function slackToken(c: Config): string | null {
  if (c.slack?.userToken) return c.slack.userToken;
  if (!c.slack?.tokenFile) return null;
  try {
    const j = JSON.parse(readFileSync(c.slack.tokenFile, "utf8"));
    const t = j[c.slack.tokenKey ?? "userToken"];
    return typeof t === "string" && t ? t : null;
  } catch { return null; }
}

/** El token de bot, del mismo fichero si hace falta. */
export function slackBotToken(c: Config): string | null {
  if (c.slack?.botToken) return c.slack.botToken;
  if (!c.slack?.tokenFile) return null;
  try {
    const t = JSON.parse(readFileSync(c.slack.tokenFile, "utf8"))[c.slack.botTokenKey ?? "botToken"];
    return typeof t === "string" && t ? t : null;
  } catch { return null; }
}

/** Guarda un contacto por su nombre en minusculas y sin espacios, que es como se
 *  escribe despues de la arroba. */
export function addContact(c: Config, p: { id: string; name: string }) {
  c.contacts = { ...(c.contacts ?? {}), [claveContacto(p.name)]: p };
}

export const claveContacto = (n: string) => n.toLowerCase().replace(/\s+/g, "");

export function contact(c: Config, needle: string): { id: string; name: string } | null {
  return c.contacts?.[claveContacto(needle)] ?? null;
}

export function save(c: Config) {
  ensureDirs();
  writeFileSync(FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
}
