/**
 * Firma de sobres. Sin esto el `from` de un sobre es lo que diga quien lo postea, y
 * todo el mundo postea con el mismo token de bot: cualquiera del equipo podia firmar
 * como cualquiera. Ahora cada persona tiene una clave ed25519 que nace en el alta;
 * la publica viaja en la invitacion y en cada sobre, y se fija la primera vez que se
 * ve (como SSH). A partir de ahi, un sobre de ese id con otra clave se descarta.
 */
import { createHash, generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } from "node:crypto";
import * as Cfg from "./config.ts";

export type Claves = { pub: string; priv: string };
export type Veredicto = "ok" | "nueva" | "sin-firma" | "mala";

export function nuevasClaves(): Claves {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pub: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    priv: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

/** Slack toca el texto por el camino (escapa &, <, >, enlaza URLs). Se firma la forma
 *  que sobrevive al viaje, que es la misma que reconstruye `bodyFromBlocks`. */
export function canon(text: string): string {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/<(?:https?:\/\/)?[^|>]*\|([^>]*)>/g, "$1")
    .replace(/<((?:https?|mailto):[^>]*)>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .trim();
}

const datos = (id: string, kind: string, from: string, text: string) =>
  Buffer.from(`${id}\n${kind}\n${from}\n${createHash("sha256").update(canon(text)).digest("hex")}`);

export function firmar(priv: string, id: string, kind: string, from: string, text: string): string {
  const key = createPrivateKey({ key: Buffer.from(priv, "base64"), type: "pkcs8", format: "der" });
  return sign(null, datos(id, kind, from, text), key).toString("base64");
}

export function comprobar(pub: string, id: string, kind: string, from: string, text: string, sig: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(pub, "base64"), type: "spki", format: "der" });
    return verify(null, datos(id, kind, from, text), key, Buffer.from(sig, "base64"));
  } catch { return false; }
}

/** Mis claves, creandolas la primera vez. */
export function misClaves(c: Cfg.Config): Claves {
  if (!c.keys) { c.keys = nuevasClaves(); Cfg.save(c); }
  return c.keys;
}

/** Que hacer con un sobre que llega. Fija la clave la primera vez que se ve un id
 *  ("nueva"), y a partir de ahi exige la misma. Un sobre sin firma se entrega pero se
 *  dice: es de una version anterior o de alguien sin claves, y eso el humano lo tiene
 *  que ver. Uno con firma mala no se entrega. */
export function verificarSobre(env: { id: string; kind: string; from: string; fromName?: string; pk?: string; sig?: string }, text: string): Veredicto {
  if (!env.sig || !env.pk) return "sin-firma";
  if (!comprobar(env.pk, env.id, env.kind, env.from, text, env.sig)) return "mala";
  const c = Cfg.load();
  const conocido = Cfg.contactById(c, env.from);
  if (conocido?.pk) return conocido.pk === env.pk ? "ok" : "mala";
  Cfg.addContact(c, { id: env.from, name: conocido?.name ?? env.fromName ?? env.from, pk: env.pk });
  Cfg.save(c);
  return "nueva";
}
