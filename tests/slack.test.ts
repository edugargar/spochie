import { expect, test } from "bun:test";
import { SlackBridge, envelopeOf, inviteBlocks, messageBlocks, noticeBlocks, fallbackText, chunk, esAcuse, bodyFromBlocks, cadenciaDescubrir, EVENT, type Envelope } from "../src/slack.ts";
import { MAX_PARCHE } from "../src/threads.ts";
import type { Thread, Msg } from "../src/threads.ts";

const t: Thread = {
  id: "a3f1", subject: "el modal se cierra al pulsar Guardar",
  from: { sessionId: "A", name: "a", cwd: "/a", human: "Edu", slackUser: "U_EDU" },
  to: { sessionId: "B", name: "b", cwd: "/b", human: "Alex", slackUser: "U_ALEX" },
  state: "open", createdAt: 0, lastActivityAt: 0,
  context: { branch: "feat/perfil", sha: "cafe12345678", files: ["src/Modal.tsx"] },
  messages: [{ at: 0, from: "A", author: "claude", kind: "text", text: "se cierra antes del POST" }],
};
const msg = (o: Partial<Msg>): Msg => ({ at: 0, from: "A", author: "claude", kind: "text", text: "x", ...o });
const flat = (b: unknown[]) => JSON.stringify(b);

test("el sobre de maquina se reconoce por event_type y payload", () => {
  const env: Envelope = { v: 1, id: "a3f1", kind: "msg", from: "U_EDU" };
  expect(envelopeOf({ metadata: { event_type: EVENT, event_payload: env } })).toEqual(env);
});

test("un mensaje escrito a mano en Slack no tiene sobre", () => {
  expect(envelopeOf({ text: "hola" })).toBeNull();
  expect(envelopeOf({ metadata: { event_type: "otra_cosa", event_payload: { id: "x", from: "y" } } })).toBeNull();
});

test("la invitacion menciona a quien recibe y dice como aceptar", () => {
  const b = flat(inviteBlocks(t));
  expect(b).toContain("<@U_ALEX>");
  expect(b).toContain("spochie accept a3f1");
  expect(b).toContain("Spochie de Edu");
  expect(b).toContain("feat/perfil");
  expect(b).toContain("src/Modal.tsx");
});

test("la capa de Slack no lleva las instrucciones internas del receptor", () => {
  const b = flat(messageBlocks(t, msg({ text: "el catch no limpia el estado" })));
  expect(b).toContain("el catch no limpia el estado");
  expect(b).not.toContain("No apliques cambios");
  expect(b).not.toContain("spochie say");
});

test("se distingue lo que dice la persona de lo que dice su Claude", () => {
  expect(flat(messageBlocks(t, msg({ author: "human" })))).toContain("en persona");
  expect(flat(messageBlocks(t, msg({ author: "claude" })))).toContain("su Claude");
});

test("el aviso del vigilante tambien se ve en Slack, sin borrar el mensaje", () => {
  const b = flat(messageBlocks(t, msg({ text: "donde comemos", offTopic: { verdict: "fuera", why: "comida" } })));
  expect(b).toContain("donde comemos");
  expect(b).toContain("fuera");
  expect(flat(messageBlocks(t, msg({ offTopic: { verdict: "dentro", why: "" } })))).not.toContain("vigilante");
});

test("un parche va en bloque de codigo y avisa de que no lo aplica nadie por ti", () => {
  const b = flat(messageBlocks(t, msg({ kind: "patch", text: "--- a\n+++ b\n-x\n+y" })));
  expect(b).toContain("```");
  expect(b).toContain("nadie escribe en tu");
  expect(b).toContain("+y");
});

test("los avisos del sistema no arrastran el texto interno a Slack", () => {
  const acc = noticeBlocks({ ...t, acceptedBy: "Alex" }, '[spochie a3f1] b ha aceptado el tunel.\nYa podeis hablar: spochie say a3f1 "<texto>"');
  expect(acc.text).toContain("Alex");
  expect(acc.text).not.toContain("spochie say");
  expect(acc.text).not.toContain("<texto>");
  const cl = noticeBlocks({ ...t, closeReason: "resuelto" }, "[spochie a3f1 | s] cerrado (resuelto).");
  expect(cl.text).toContain("resuelto");
  expect(cl.text).not.toContain("[spochie");
});

test("el texto de respaldo es lo que sale en la notificacion del movil", () => {
  expect(fallbackText(t, msg({ text: "el catch no limpia" }))).toBe("Edu: el catch no limpia");
  expect(fallbackText(t, msg({ kind: "patch", text: "diff" }))).toContain("parche");
});

test("los bloques respetan el limite de 3000 caracteres de Slack, troceando", () => {
  const largo = "x".repeat(9000);
  const bloques = messageBlocks(t, msg({ text: largo })) as any[];
  for (const b of bloques) {
    const txt = b.text?.text ?? b.elements?.[0]?.text ?? "";
    expect(txt.length).toBeLessThanOrEqual(3000);
  }
  // Y no se pierde nada por el camino.
  const total = bloques.map(b => b.text?.text ?? "").join("").length;
  expect(total).toBeGreaterThanOrEqual(9000);
});

test("un mensaje largo no se corta a mitad de palabra", () => {
  const largo = Array.from({ length: 200 }, (_, i) => `linea ${i} con texto suficiente para llenar`).join("\n");
  const trozos = chunk(largo);
  for (const c of trozos) expect(c.length).toBeLessThanOrEqual(2800);
  // Nada se parte por dentro de una linea mientras quepa.
  expect(trozos.join("\n").startsWith("linea 0 con texto")).toBe(true);
});

test("una linea mas larga que un bloque se trocea, no se tira", () => {
  const trozos = chunk("x".repeat(7000));
  expect(trozos.join("").length).toBe(7000);
});

test("el texto viaja en los bloques y vuelve entero, sin depender del sobre", () => {
  const largo = Array.from({ length: 300 }, (_, i) => `linea ${i}`).join("\n");
  // fallbackText es corto a proposito: es la notificacion del movil, no el contenido.
  expect(fallbackText(t, msg({ text: largo })).length).toBeLessThan(300);
  // Lo que lee el demonio del otro lado son los bloques marcados.
  const bloques = messageBlocks(t, msg({ text: largo }));
  expect(bodyFromBlocks(bloques as any)).toBe(largo);
});

test("solo los bloques de contenido cuentan: la firma y los avisos no", () => {
  const bloques = messageBlocks(t, msg({ text: "el catch no limpia", offTopic: { verdict: "fuera", why: "x" } }));
  const cuerpo = bodyFromBlocks(bloques as any);
  expect(cuerpo).toBe("el catch no limpia");
  expect(cuerpo).not.toContain("su Claude");
  expect(cuerpo).not.toContain("vigilante");
});

test("la invitacion tambien se reconstruye desde sus bloques", () => {
  expect(bodyFromBlocks(inviteBlocks(t) as any)).toBe("se cierra antes del POST");
});

test("un acuse a secas es aceptar, no un turno de conversacion", () => {
  for (const s of ["acepto", "Acepto.", "vale", "ok", "dale", "👍", " sí "]) expect(esAcuse(s)).toBe(true);
  for (const s of ["acepto, pero mira antes el toaster", "ok el hook devuelve promesa", "vale la pena revisarlo"])
    expect(esAcuse(s)).toBe(false);
});

test("el mrkdwn de Slack se deshace: codigo que parecia una URL vuelve a ser codigo", () => {
  const bloques = [
    { type: "section", block_id: "sp-body-0-1", text: { type: "mrkdwn", text: "await <http://api.post|api.post>('/profile')" } },
    { type: "section", block_id: "sp-body-1-1", text: { type: "mrkdwn", text: "if (a &lt; b &amp;&amp; c &gt; d) {}" } },
  ];
  const cuerpo = bodyFromBlocks(bloques as any);
  expect(cuerpo).toContain("await api.post('/profile')");
  expect(cuerpo).toContain("if (a < b && c > d) {}");
  expect(cuerpo).not.toContain("http://");
});

test("el gasto de un equipo de 15 cabe en el limite de Slack", () => {
  // Se leen las constantes de verdad, no el texto del fichero: si alguien sube el
  // tope o acelera el descubrimiento, la cuenta tiene que salir mal aqui.
  const B = SlackBridge as any;
  const tope: number = B.TOPE_HILOS;

  // El limite Tier 3 es ~50/min por metodo y POR APP, o sea compartido por el equipo.
  const LIMITE = 50;
  const equipo = 15, activos = 2;
  const porMinuto = (cadaMs: number) => 60_000 / cadaMs;

  // conversations.history: una por ronda de descubrimiento y por persona, a la cadencia
  // que le toca a un equipo de 15. Los 15 demonios descubren a la vez, con o sin conversacion.
  const history = equipo * porMinuto(cadenciaDescubrir(equipo));
  // conversations.replies: un tick cada 4 s mirando como mucho TOPE_HILOS hilos,
  // pero una conversacion de dos solo tiene un hilo vivo por lado.
  const replies = activos * Math.min(1, tope) * porMinuto(4_000);

  expect(history).toBeLessThan(LIMITE);
  expect(replies).toBeLessThan(LIMITE);
  expect(tope).toBeLessThanOrEqual(4);
});

test("un parche que cabe no se corta por el camino", () => {
  const linea = "+ const x = 1;";
  const diff = Array(Math.floor(MAX_PARCHE / (linea.length + 1))).fill(linea).join("\n");
  const t = { id: "p1", subject: "x", from: { sessionId: "A", name: "a", cwd: "/a" }, to: { sessionId: "B", name: "b", cwd: "/b" }, state: "open", createdAt: 0, lastActivityAt: 0, context: {}, messages: [] } as any as Thread;
  const bloques = messageBlocks(t, { at: 0, from: "A", author: "claude", kind: "patch", text: diff });
  const texto = JSON.stringify(bloques);
  // El aviso de corte solo aparece si algo se quedo fuera, y lo que cabe no se queda fuera.
  expect(texto).not.toContain("sigue en el transcript");
});

test("el buzon se mira tan a menudo como el cupo de la app permita al equipo real", async () => {
  const { cadenciaDescubrir } = await import("../src/slack.ts");
  expect(cadenciaDescubrir(1)).toBe(5_000);
  expect(cadenciaDescubrir(2)).toBe(5_000);
  expect(cadenciaDescubrir(4)).toBe(9_600);
  expect(cadenciaDescubrir(15)).toBe(36_000);
  expect(cadenciaDescubrir(25)).toBe(60_000);
  // 25 demonios a esa cadencia gastan 25 llamadas por minuto, la mitad del cupo.
  expect(Math.round(25 * 60_000 / cadenciaDescubrir(25))).toBe(25);
});
