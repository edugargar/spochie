import { expect, test } from "bun:test";
import * as T from "../src/threads.ts";
import { encolar } from "../src/outbox.ts";

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

function hilo(id: string): T.Thread {
  const t: T.Thread = {
    id, subject: "prueba", state: "open", createdAt: Date.now(), lastActivityAt: Date.now(),
    from: { sessionId: "A", name: "a", cwd: "/tmp/a" },
    to: { sessionId: "B", name: "b", cwd: "/tmp/b" },
    context: {}, messages: [],
  } as any;
  T.save(t);
  return t;
}

const msg = (text: string, files?: string[]): T.Msg =>
  ({ at: Date.now(), from: "A", author: "claude", kind: "text", text, ...(files ? { files } : {}) });

test("los mensajes seguidos salen como uno y no se pierde ningun adjunto", async () => {
  const t = hilo("ob01");
  const salidas: T.Msg[] = [];
  const salida = async (_t: T.Thread, m: T.Msg) => { salidas.push(m); };

  encolar(t, msg("parte uno", ["/tmp/uno.png"]), salida, 40);
  encolar(t, msg("parte dos", ["/tmp/dos.png"]), salida, 40);
  encolar(t, msg("parte tres", ["/tmp/dos.png"]), salida, 40);
  await dormir(150);

  expect(salidas.length).toBe(1);
  expect(salidas[0].text).toBe("parte uno\n\nparte dos\n\nparte tres");
  // El adjunto del segundo llegaba antes al limbo, y el repetido no se manda dos veces.
  expect(salidas[0].files).toEqual(["/tmp/uno.png", "/tmp/dos.png"]);
});

test("sin adjuntos no se inventa una lista vacia", async () => {
  const t = hilo("ob02");
  const salidas: T.Msg[] = [];
  encolar(t, msg("solo texto"), async (_t, m) => { salidas.push(m); }, 40);
  await dormir(150);
  expect(salidas.length).toBe(1);
  expect("files" in salidas[0]).toBe(false);
});

test("un parche sale solo y al momento, sin esperar a la ventana", async () => {
  const t = hilo("ob03");
  const salidas: T.Msg[] = [];
  const salida = async (_t: T.Thread, m: T.Msg) => { salidas.push(m); };
  encolar(t, { ...msg("texto"), kind: "patch" }, salida, 5_000);
  await dormir(30);
  expect(salidas.length).toBe(1);
  expect(salidas[0].kind).toBe("patch");
});

test("se manda el hilo recien leido de disco, no la copia de hace dos segundos", async () => {
  const t = hilo("ob04");
  const vistos: T.Thread[] = [];
  encolar(t, msg("hola"), async (tt) => { vistos.push(tt); }, 60);
  // Mientras espera la ventana, el otro lado cierra el hilo.
  T.save({ ...T.load("ob04")!, state: "closed" });
  await dormir(200);
  expect(vistos.length).toBe(1);
  expect(vistos[0].state).toBe("closed");
});

test("cada lado tiene su propia ventana: no se mezclan las voces", async () => {
  const t = hilo("ob05");
  const salidas: T.Msg[] = [];
  const salida = async (_t: T.Thread, m: T.Msg) => { salidas.push(m); };
  encolar(t, msg("digo yo"), salida, 40);
  encolar(t, { ...msg("digo yo"), from: "B", text: "digo el otro" }, salida, 40);
  await dormir(150);
  expect(salidas.length).toBe(2);
  expect(salidas.map(m => m.text).sort()).toEqual(["digo el otro", "digo yo"]);
});
