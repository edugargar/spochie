import { expect, test } from "bun:test";
import { judge } from "../src/guardian.ts";

/** Sin red ni coste: solo el atajo de los mensajes cortos, que es donde estaba el ruido. */
test("un acuse de recibo corto no se juzga", async () => {
  const v = await judge("el boton se rompe en movil", "OK, todo llega.");
  expect(v.verdict).toBe("dentro");
  expect(v.why).toBe("demasiado corto para juzgar");
});

test("un mensaje vacio tampoco", async () => {
  expect((await judge("asunto", "   ")).verdict).toBe("dentro");
});
