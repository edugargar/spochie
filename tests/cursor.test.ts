import { expect, test } from "bun:test";
import * as T from "../src/threads.ts";
import { SlackBridge } from "../src/slack.ts";

/**
 * El cursor del hilo vivia en memoria: al reiniciar el demonio se releia el hilo
 * entero de Slack y cada mensaje ya entregado volvia a caer en la sesion. Aqui se
 * simula ese reinicio con un puente nuevo sobre el mismo hilo en disco.
 */
function hilo(id: string): T.Thread {
  const t = {
    id, subject: "cursor", state: "open", createdAt: Date.now(), lastActivityAt: Date.now(),
    from: { sessionId: "A", name: "a", cwd: "/tmp/a", slackUser: "U_OTRO" },
    to: { sessionId: "B", name: "b", cwd: "/tmp/b", slackUser: "U_ME" },
    context: {}, messages: [],
    slack: { channel: "D1", ts: "100.000" },
  } as any as T.Thread;
  T.save(t);
  return t;
}

function puente(entregado: T.Msg[]) {
  const b: any = new (SlackBridge as any)(
    "xoxp-falso", "xoxb-falso", "U_ME",
    async (_t: T.Thread, m: T.Msg) => { entregado.push(m); },
    async () => {}, async () => {},
  );
  b.get = async () => ({
    messages: [
      { ts: "100.000", user: "U_OTRO", text: "raiz" },
      { ts: "101.000", user: "U_OTRO", text: "primero" },
      { ts: "102.000", user: "U_OTRO", text: "segundo" },
    ],
  });
  return b;
}

test("lo ya entregado no se vuelve a entregar cuando se reinicia el demonio", async () => {
  const t = hilo("cu01");
  const uno: T.Msg[] = [];
  await puente(uno).pollThread(T.load("cu01"));
  expect(uno.map(m => m.text)).toEqual(["primero", "segundo"]);
  expect(T.load("cu01")!.slackCursor).toBe("102.000");

  // Reinicio: puente nuevo, memoria en blanco, el mismo hilo de Slack respondiendo lo mismo.
  const dos: T.Msg[] = [];
  await puente(dos).pollThread(T.load("cu01"));
  expect(dos).toEqual([]);
});

test("el cursor avanza mensaje a mensaje, no de golpe al final", async () => {
  // Si algo peta a mitad se pierde un mensaje, que es mejor que reinyectar el hilo entero.
  const t = hilo("cu02");
  const vistos: T.Msg[] = [];
  const b: any = new (SlackBridge as any)(
    "u", "b", "U_ME",
    async (_t: T.Thread, m: T.Msg) => {
      vistos.push(m);
      if (m.text === "segundo") throw new Error("la sesion se cayo");
    },
    async () => {}, async () => {},
  );
  b.get = async () => ({
    messages: [
      { ts: "100.000", user: "U_OTRO", text: "raiz" },
      { ts: "101.000", user: "U_OTRO", text: "primero" },
      { ts: "102.000", user: "U_OTRO", text: "segundo" },
      { ts: "103.000", user: "U_OTRO", text: "tercero" },
    ],
  });
  await b.pollThread(T.load("cu02")).catch(() => {});
  expect(vistos.map(m => m.text)).toEqual(["primero", "segundo"]);
  expect(T.load("cu02")!.slackCursor).toBe("102.000");
});
