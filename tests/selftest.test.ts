import { expect, test } from "bun:test";
import { selftest } from "../src/selftest.ts";

/**
 * Un paso en verde porque nunca llego a ejecutarse es peor que un fallo: te hace
 * creer que algo funciona. Aqui se rompe lo primero de todo (que arranque el
 * demonio) y se comprueba que nada de lo que viene detras sale en verde.
 */
test("con el demonio roto, ni un solo paso sale en verde", async () => {
  const path = process.env.PATH;
  process.env.PATH = "/nonexistent-para-que-no-haya-bun";
  try {
    const pasos = await selftest();
    expect(pasos.length).toBeGreaterThan(0);
    expect(pasos.filter(p => p.ok)).toEqual([]);
    expect(pasos.some(p => p.detalle === "no se ha llegado a probar" || p.que === "la prueba se rompio")).toBe(true);
  } finally {
    process.env.PATH = path;
  }
}, 30_000);
