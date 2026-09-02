import { expect, test } from "bun:test";

test("launchd no se degrada: una ruta de plugin mas vieja no sustituye a una mas nueva", async () => {
  const { versionDeRuta, masNueva } = await import("../src/arranque.ts");
  expect(versionDeRuta("<string>/Users/x/.claude/plugins/cache/edugargar/spoochie/0.5.1/src/daemon.ts</string>")).toBe("0.5.1");
  expect(versionDeRuta("/Users/x/Desktop/spoochie/src/daemon.ts")).toBeNull();
  expect(masNueva("0.5.2", "0.5.1")).toBe(true);
  expect(masNueva("0.10.0", "0.9.9")).toBe(true);
  expect(masNueva("0.5.1", "0.5.1")).toBe(false);
});

test("el estado de ~/.claude/spochie se muda a spoochie una vez, y no pisa lo que ya hay", async () => {
  const { migrarEstado } = await import("../src/paths.ts");
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const base = mkdtempSync(join(tmpdir(), "sp-mig-"));
  const viejo = join(base, "spochie"), nuevo = join(base, "spoochie");
  mkdirSync(viejo); writeFileSync(join(viejo, "config.json"), '{"human":"Edu"}');
  expect(migrarEstado(viejo, nuevo)).toBe(true);
  expect(existsSync(viejo)).toBe(false);
  expect(readFileSync(join(nuevo, "config.json"), "utf8")).toContain("Edu");
  // Segunda vez: nada que mover. Y si hubiera algo nuevo, no se toca.
  expect(migrarEstado(viejo, nuevo)).toBe(false);
  mkdirSync(viejo); writeFileSync(join(viejo, "config.json"), "{}");
  expect(migrarEstado(viejo, nuevo)).toBe(false);
  expect(readFileSync(join(nuevo, "config.json"), "utf8")).toContain("Edu");
});
