import { expect, test } from "bun:test";

test("launchd no se degrada: una ruta de plugin mas vieja no sustituye a una mas nueva", async () => {
  const { versionDeRuta, masNueva } = await import("../src/arranque.ts");
  expect(versionDeRuta("<string>/Users/x/.claude/plugins/cache/edugargar/spochie/0.5.1/src/daemon.ts</string>")).toBe("0.5.1");
  expect(versionDeRuta("/Users/x/Desktop/spochie/src/daemon.ts")).toBeNull();
  expect(masNueva("0.5.2", "0.5.1")).toBe(true);
  expect(masNueva("0.10.0", "0.9.9")).toBe(true);
  expect(masNueva("0.5.1", "0.5.1")).toBe(false);
});
