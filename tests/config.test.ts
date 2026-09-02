import { expect, test } from "bun:test";

test("un nombre de contacto ya ocupado por otro id no se pisa: va con sufijo", async () => {
  const Cfg = await import("../src/config.ts");
  const c: any = { guardian: false, transcript: false, contacts: {} };
  Cfg.addContact(c, { id: "U_EDU_REAL", name: "Edu", pk: "pk-real" });
  Cfg.addContact(c, { id: "U_IMPOSTOR", name: "Edu", pk: "pk-otro" });
  expect(Cfg.contact(c, "edu")!.id).toBe("U_EDU_REAL");
  expect(Cfg.contact(c, "edu")!.pk).toBe("pk-real");
  expect(Cfg.contactById(c, "U_IMPOSTOR")!.name).toBe("Edu");
  expect(Object.keys(c.contacts)).toContain("edu-stor");
  // El mismo id con otro nombre si se renombra, sin duplicar.
  Cfg.addContact(c, { id: "U_EDU_REAL", name: "Eduardo" });
  expect(Cfg.contact(c, "eduardo")!.pk).toBe("pk-real");
  expect(Cfg.contact(c, "edu")).toBeNull();
});
