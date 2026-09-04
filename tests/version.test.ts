import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("la version es la misma en plugin.json, package.json, marketplace.json y encabeza el CHANGELOG", () => {
  const raiz = join(import.meta.dir, "..");
  const v = (f: string) => JSON.parse(readFileSync(join(raiz, f), "utf8"));
  const plugin = v(".claude-plugin/plugin.json").version;
  expect(v("package.json").version).toBe(plugin);
  expect(v(".claude-plugin/marketplace.json").plugins[0].version).toBe(plugin);
  const log = readFileSync(join(raiz, "CHANGELOG.md"), "utf8");
  expect(log.split("\n").find(l => l.startsWith("## "))).toStartWith(`## ${plugin} `);
});
