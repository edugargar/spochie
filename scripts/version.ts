#!/usr/bin/env bun
/**
 * La version vive en .claude-plugin/plugin.json y de ahi se copia a package.json y al
 * marketplace, y se abre una entrada en CHANGELOG.md. Antes eran tres `sed` a mano y un
 * dia se quedaron descuadrados.
 *
 *   bun scripts/version.ts 0.8.0 "Que cambia, en una linea"
 */
import { readFileSync, writeFileSync } from "node:fs";
const [v, ...resto] = process.argv.slice(2);
if (!v || !/^\d+\.\d+\.\d+$/.test(v)) { console.error("uso: bun scripts/version.ts X.Y.Z [resumen]"); process.exit(1); }
const poner = (f: string, re: RegExp, rep: string) => writeFileSync(f, readFileSync(f, "utf8").replace(re, rep));
poner(".claude-plugin/plugin.json", /"version": "[^"]+"/, `"version": "${v}"`);
poner("package.json", /"version": "[^"]+"/, `"version": "${v}"`);
poner(".claude-plugin/marketplace.json", /"version": "[^"]+"/, `"version": "${v}"`);
const hoy = new Date().toISOString().slice(0, 10);
const log = readFileSync("CHANGELOG.md", "utf8");
if (!log.includes(`## ${v} `)) {
  const entrada = `## ${v} (${hoy})\n\n${resto.length ? `- ${resto.join(" ")}\n` : "- \n"}\n`;
  writeFileSync("CHANGELOG.md", log.replace(/^(# Changelog\n\n)/, `$1${entrada}`));
}
console.log(`version ${v} en plugin.json, package.json, marketplace.json y CHANGELOG.md`);
