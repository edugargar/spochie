import { expect, test } from "bun:test";
import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliver } from "../src/inbox.ts";

/** El formato del buzon no esta en la documentacion: sale del propio binario de
 *  Claude Code, que lo imprime como receta soportada. Si cambia, este test cae. */
test("entrega la linea de auth y luego el turno de usuario, en ese orden", async () => {
  const sock = join(mkdtempSync(join(tmpdir(), "sp-")), "s.sock");
  const lines: string[] = [];
  const done = new Promise<void>(resolve => {
    net.createServer(c => {
      let buf = "";
      c.on("data", d => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); }
        if (lines.length >= 2) resolve();
      });
    }).listen(sock);
  });

  await deliver(
    { sessionId: "X", name: "x", cwd: "/tmp", socket: sock, token: "tok-123", pid: 1, startedAt: 0 },
    "hola",
  );
  await done;

  expect(JSON.parse(lines[0])).toEqual({ type: "auth", token: "tok-123" });
  expect(JSON.parse(lines[1])).toEqual({ type: "user", message: { role: "user", content: "hola" } });
});

test("un socket que no existe falla, no se cuelga", async () => {
  await expect(deliver(
    { sessionId: "X", name: "x", cwd: "/tmp", socket: "/tmp/no-existe-spoochie.sock", token: "t", pid: 1, startedAt: 0 },
    "hola",
  )).rejects.toThrow();
});
