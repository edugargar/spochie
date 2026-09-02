import { test, expect } from "bun:test";
import { limpiarCadena, leerInvitacion } from "../src/alta.ts";

const blob = Buffer.from(JSON.stringify({ b: "xoxb-" + "z".repeat(40), t: "Equipo" })).toString("base64url");

test("la cadena se saca del comando entero pegado", () => {
  expect(limpiarCadena(`spochie join ${blob} --email ana@example.com`)).toBe(blob);
});

test("la cadena se saca de la barra del plugin y de las comillas de Slack", () => {
  expect(limpiarCadena("/spochie:alta `" + blob + "`")).toBe(blob);
});

test("la cadena suelta vale tal cual", () => {
  expect(limpiarCadena(blob)).toBe(blob);
});

test("sin cadena no se inventa una", () => {
  expect(limpiarCadena("spochie join --email ana@example.com")).toBeNull();
  expect(limpiarCadena("")).toBeNull();
});

test("una bandera larga no se confunde con la cadena", () => {
  expect(limpiarCadena(`--${"x".repeat(60)} ${blob}`)).toBe(blob);
});

test("la invitacion trae el token del bot", () => {
  expect(leerInvitacion(blob)?.b).toStartWith("xoxb-");
  expect(leerInvitacion(blob)?.t).toBe("Equipo");
});

test("lo que no es una invitacion no cuela", () => {
  expect(leerInvitacion("no-es-base64-de-nada")).toBeNull();
  expect(leerInvitacion(Buffer.from(JSON.stringify({ t: "Equipo" })).toString("base64url"))).toBeNull();
});
