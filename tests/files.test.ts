import { expect, test, afterEach } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bajar, SPOOL, MAX_BYTES } from "../src/files.ts";

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

function sirve(cuerpo: Uint8Array, ok = true) {
  globalThis.fetch = (async () => ({
    ok, arrayBuffer: async () => cuerpo.buffer.slice(cuerpo.byteOffset, cuerpo.byteOffset + cuerpo.byteLength),
  })) as any;
}

test("un nombre con ../ no escribe fuera del spool", async () => {
  sirve(new TextEncoder().encode("hola"));
  const rutas = await bajar("t", [{ id: "F1", name: "../../../fuera.txt", url_private_download: "u" }], "h1");
  expect(rutas.length).toBe(1);
  expect(rutas[0].startsWith(join(SPOOL, "h1") + "/")).toBe(true);
  // Las barras se quedan en _, asi que los puntos que sobreviven no llevan a ningun lado.
  expect(rutas[0].slice(join(SPOOL, "h1").length + 1)).not.toContain("/");
  expect(readFileSync(rutas[0], "utf8")).toBe("hola");
});

test("el id tampoco se cuela: tambien lo pone el otro lado", async () => {
  sirve(new TextEncoder().encode("x"));
  const rutas = await bajar("t", [{ id: "../../../evil", name: "a.txt", url_private_download: "u" }], "h2");
  expect(rutas.length).toBe(1);
  expect(rutas[0].startsWith(join(SPOOL, "h2") + "/")).toBe(true);
  expect(existsSync(join(SPOOL, "h2"))).toBe(true);
});

test("lo que pasa del limite no toca el disco", async () => {
  sirve(new Uint8Array(MAX_BYTES + 1));
  const rutas = await bajar("t", [{ id: "F2", name: "gordo.bin", url_private_download: "u" }], "h3");
  expect(rutas).toEqual([]);
});

test("un fichero sin url se salta sin tumbar los demas", async () => {
  sirve(new TextEncoder().encode("ok"));
  const rutas = await bajar("t", [{ id: "F3", name: "sin-url.txt" }, { id: "F4", name: "con-url.txt", url_private: "u" }], "h4");
  expect(rutas.length).toBe(1);
  expect(rutas[0]).toContain("con-url.txt");
});

test("una descarga que falla no deja medio fichero", async () => {
  sirve(new TextEncoder().encode("x"), false);
  const rutas = await bajar("t", [{ id: "F5", name: "a.txt", url_private_download: "u" }], "h5");
  expect(rutas).toEqual([]);
});
