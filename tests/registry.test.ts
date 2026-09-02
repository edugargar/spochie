import { expect, test } from "bun:test";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register, liveSessions, unregister } from "../src/registry.ts";

const sockOf = (n: string) => { const p = join(mkdtempSync(join(tmpdir(), "sp-")), n); writeFileSync(p, ""); return p; };

test("barre las sesiones cuyo proceso ya no vive", () => {
  register({ sessionId: "viva", name: "viva", cwd: "/a", socket: sockOf("v.sock"), token: "t", pid: process.pid, startedAt: 1 });
  register({ sessionId: "muerta", name: "muerta", cwd: "/b", socket: sockOf("m.sock"), token: "t", pid: 999_999, startedAt: 2 });
  const ids = liveSessions().map(s => s.sessionId);
  expect(ids).toContain("viva");
  expect(ids).not.toContain("muerta");
  unregister("viva");
});

test("una sesion sin socket en disco tampoco cuenta", () => {
  register({ sessionId: "sin-socket", name: "x", cwd: "/c", socket: "/tmp/no-existe-x.sock", token: "t", pid: process.pid, startedAt: 3 });
  expect(liveSessions().map(s => s.sessionId)).not.toContain("sin-socket");
});

test("un id con barras no revienta el alta de la sesion", () => {
  // Pasa de verdad: si el hook SessionStart no trae session_id, se usa la ruta del
  // socket, y con barras writeFileSync se iba en ENOENT sin que nadie se enterara.
  const socket = sockOf("4242.sock");
  register({ sessionId: socket, name: "raro", cwd: "/tmp", socket, token: "t", pid: process.pid, startedAt: Date.now() });
  const encontrada = liveSessions().find(s => s.sessionId === socket);
  expect(encontrada).toBeDefined();
  expect(encontrada!.socket).toBe(socket);
  unregister(socket);
  expect(liveSessions().find(s => s.sessionId === socket)).toBeUndefined();
});
