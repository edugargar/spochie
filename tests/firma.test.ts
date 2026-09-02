import { test, expect } from "bun:test";
import { nuevasClaves, firmar, comprobar, canon, verificarSobre } from "../src/firma.ts";
import * as Cfg from "../src/config.ts";

const k = nuevasClaves();

test("una firma valida se comprueba y una alterada no", () => {
  const sig = firmar(k.priv, "a1", "msg", "U1", "hola");
  expect(comprobar(k.pub, "a1", "msg", "U1", "hola", sig)).toBe(true);
  expect(comprobar(k.pub, "a1", "msg", "U1", "hola.", sig)).toBe(false);
  expect(comprobar(k.pub, "a1", "msg", "U2", "hola", sig)).toBe(false);
  expect(comprobar(nuevasClaves().pub, "a1", "msg", "U1", "hola", sig)).toBe(false);
});

test("lo que Slack toca por el camino no rompe la firma", () => {
  const sig = firmar(k.priv, "a1", "msg", "U1", "a & b <c> http://x.y/z\r\n");
  const llegado = "a &amp; b &lt;c&gt; <http://x.y/z>";
  expect(canon(llegado)).toBe("a & b <c> http://x.y/z");
  expect(comprobar(k.pub, "a1", "msg", "U1", llegado, sig)).toBe(true);
});

test("la primera clave de un id se fija, y otra distinta despues se rechaza", () => {
  Cfg.save({ guardian: false, transcript: false });
  const env = { id: "t1", kind: "msg", from: "U_ALEX", fromName: "Alex", pk: k.pub, sig: firmar(k.priv, "t1", "msg", "U_ALEX", "x") };
  expect(verificarSobre(env, "x")).toBe("nueva");
  expect(Cfg.contactById(Cfg.load(), "U_ALEX")?.pk).toBe(k.pub);
  expect(verificarSobre(env, "x")).toBe("ok");
  const otra = nuevasClaves();
  const impostor = { ...env, pk: otra.pub, sig: firmar(otra.priv, "t1", "msg", "U_ALEX", "x") };
  expect(verificarSobre(impostor, "x")).toBe("mala");
  expect(Cfg.contactById(Cfg.load(), "U_ALEX")?.pk).toBe(k.pub);
});

test("un sobre sin firma se marca, no se descarta", () => {
  expect(verificarSobre({ id: "t2", kind: "msg", from: "U_X" }, "x")).toBe("sin-firma");
});

test("la clave de la invitacion queda en la agenda con el nombre", () => {
  const c: Cfg.Config = { guardian: false, transcript: false };
  Cfg.addContact(c, { id: "U_EDU", name: "Edu", pk: "PK1" });
  Cfg.addContact(c, { id: "U_EDU", name: "Edu" });
  expect(Cfg.contact(c, "edu")?.pk).toBe("PK1");
});
