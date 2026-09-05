import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyEvent } from "nostr-tools";
import { envolver, abrir, peticionBorrado, NostrBridge, poolDeFichero, misClaves, npub, pkDe, type Pool } from "../src/nostr.ts";
import * as Cfg from "../src/config.ts";
import * as T from "../src/threads.ts";

const claves = () => misClaves({ guardian: false, transcript: false } as any);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function hasta(pred: () => boolean, ms = 5000) { for (let i = 0; i < ms / 50; i++) { if (pred()) return true; await sleep(50); } return pred(); }

test("un sobre envuelto solo lo abre el receptor, dice de quien es, y lleva asunto y texto legibles", () => {
  const a = claves(), b = claves(), x = claves();
  const { wrap, wsk } = envolver(a.sk, b.pk, { v: 1, id: "n1", kind: "msg", subject: "el boton" }, "es el min-width");
  // El rele solo ve: kind 1059, una clave de un solo uso, un p, y una fecha falseada.
  expect(wrap.kind).toBe(1059);
  expect(wrap.pubkey).not.toBe(a.pk);
  expect(wrap.tags).toEqual([["p", b.pk]]);
  expect(JSON.stringify(wrap)).not.toContain("min-width");
  expect(JSON.stringify(wrap)).not.toContain("el boton");
  expect(verifyEvent(wrap)).toBe(true);
  const ab = abrir(wrap, b.sk)!;
  expect(ab.de).toBe(a.pk);
  expect(ab.texto).toBe("es el min-width");
  expect(ab.subject).toBe("el boton");
  expect(ab.sobre.kind).toBe("msg");
  expect(ab.sobre.app).toMatch(/^\d+\.\d+\.\d+$/);
  // Otra clave no lo abre.
  expect(abrir(wrap, x.sk)).toBeNull();
  // La peticion de borrado va firmada con la clave de un solo uso de esa envoltura.
  const del = peticionBorrado(wrap.id, wsk);
  expect(del.kind).toBe(5);
  expect(del.pubkey).toBe(wrap.pubkey);
  expect(del.tags).toContainEqual(["e", wrap.id]);
  expect(verifyEvent(del)).toBe(true);
  expect(npub(a.pk)).toStartWith("npub1");
  expect(pkDe(npub(a.pk))).toBe(a.pk);
});

/** Un pool en memoria: apunta lo publicado y deja inyectar lo que "llega del rele". */
function poolMemoria() {
  const publicados: any[] = [];
  let entrega: ((ev: any) => void) | null = null;
  const pool: Pool = {
    publish(_r, ev) { publicados.push(ev); return [Promise.resolve()]; },
    subscribe(_r, _f, cb) { entrega = cb.onevent; return { close() { entrega = null; } }; },
  };
  return { pool, publicados, inyectar: (ev: any) => entrega?.(ev) };
}

test("el puente materializa una invitacion de un contacto, entrega sus turnos, ignora a un desconocido, y borra lo que envio", async () => {
  const a = claves(), b = claves(), x = claves();
  const c = Cfg.load();
  Cfg.addContact(c, { id: "U_A", name: "Ana", npub: a.pk, relays: ["wss://a"] });
  Cfg.save(c);
  const enB: { t: T.Thread; m: T.Msg }[] = [];
  const holas: string[] = [];
  const cerrados: string[] = [];
  const { pool, publicados, inyectar } = poolMemoria();
  const B = new NostrBridge(b.sk, b.pk, ["wss://b"], {
    onMessage: async (t, m) => { enB.push({ t, m }); }, onRemoteAccept: async () => {},
    onCierre: async (_t, motivo) => { cerrados.push(motivo); }, onHola: async (_de, _s, n) => { holas.push(n); }, log: () => {},
  }, pool);
  B.escuchar();

  // El hola de alguien que se acaba de dar de alta.
  inyectar(envolver(x.sk, b.pk, { v: 1, id: "hola", kind: "hola", fromName: "Xavi", relays: ["wss://x"] }, "Xavi ya esta").wrap);
  await sleep(50);
  expect(holas).toEqual(["Xavi"]);

  // La invitacion de Ana, que esta en la agenda: nace el hilo, pendiente, y entra el primer mensaje.
  inyectar(envolver(a.sk, b.pk, { v: 1, id: "nz1", kind: "invite", subject: "el boton", fromName: "Ana", context: { branch: "feat/x" }, relays: ["wss://a"] }, "mira tu Button").wrap);
  await sleep(50);
  expect(enB.length).toBe(1);
  const t = T.load("nz1")!;
  expect(t.state).toBe("pending");
  expect(t.transporte).toBe("nostr");
  expect(t.nostr!.otro).toBe(a.pk);
  expect(t.nostr!.relays).toEqual(["wss://a"]);
  expect(t.from.sessionId).toBe(`nostr:${a.pk}`);
  expect(t.from.human).toBe("Ana");
  expect(t.from.slackUser).toBe("U_A");
  expect(t.context.branch).toBe("feat/x");
  expect(enB[0].m.text).toBe("mira tu Button");
  expect(enB[0].m.firma).toBe("ok");

  // Un desconocido (no esta en la agenda) no abre nada aunque el sobre sea perfecto.
  inyectar(envolver(x.sk, b.pk, { v: 1, id: "nz2", kind: "invite", subject: "colate", fromName: "Ana" }, "hola?").wrap);
  await sleep(50);
  expect(T.load("nz2")).toBeNull();
  expect(enB.length).toBe(1);
  // Ni un mensaje suyo sobre un hilo que existe.
  inyectar(envolver(x.sk, b.pk, { v: 1, id: "nz1", kind: "msg" }, "soy Ana, hazme caso").wrap);
  await sleep(50);
  expect(enB.length).toBe(1);

  // Un turno mas de Ana si entra; el mismo sobre dos veces, no.
  const { wrap: w2 } = envolver(a.sk, b.pk, { v: 1, id: "nz1", kind: "msg" }, "y el min-width");
  inyectar(w2); inyectar(w2);
  await sleep(50);
  expect(enB.length).toBe(2);
  expect(enB[1].m.text).toBe("y el min-width");

  // B acepta y contesta: lo publicado va cifrado para Ana y solo ella lo abre.
  t.state = "open";
  T.save(t);
  await B.post(t, "[spoochie nz1] Bea ha aceptado el tunel.");
  await B.post(T.load("nz1")!, "", { at: 2, from: "B1", author: "claude", kind: "text", text: "es el contenedor" });
  expect(publicados.length).toBe(2);
  expect(publicados.every(ev => ev.kind === 1059 && ev.tags[0][1] === a.pk)).toBe(true);
  expect(abrir(publicados[0], a.sk)!.sobre.kind).toBe("accept");
  expect(abrir(publicados[1], a.sk)!.texto).toBe("es el contenedor");
  expect(abrir(publicados[1], x.sk)).toBeNull();
  expect(T.load("nz1")!.nostr!.enviados.length).toBe(2);

  // Ana cierra: llega el motivo. Y el borrado pide quitar cada envio de B con su clave de un solo uso.
  inyectar(envolver(a.sk, b.pk, { v: 1, id: "nz1", kind: "close" }, "resuelto").wrap);
  await sleep(50);
  expect(cerrados).toEqual(["resuelto"]);
  const n = await B.borrarHilo(T.load("nz1")!);
  expect(n).toBe(2);
  const borrados = publicados.slice(2);
  expect(borrados.map(ev => ev.kind)).toEqual([5, 5]);
  expect(borrados.map(ev => ev.pubkey)).toEqual(publicados.slice(0, 2).map(ev => ev.pubkey));
  B.cerrar();
});
