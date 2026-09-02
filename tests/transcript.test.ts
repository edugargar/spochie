import { expect, test } from "bun:test";
import { renderHtml } from "../src/transcript.ts";
import type { Thread } from "../src/threads.ts";

const base: Thread = {
  id: "t1", subject: "asunto",
  from: { sessionId: "A", name: "a", cwd: "/a", human: "Edu" },
  to: { sessionId: "B", name: "b", cwd: "/b", human: "Alex" },
  state: "open", createdAt: 0, lastActivityAt: 0, context: {}, messages: [],
};

test("escapa el HTML del contenido", () => {
  const html = renderHtml({ ...base, messages: [
    { at: 0, from: "A", author: "claude", kind: "text", text: '<img src=x onerror="alert(1)">' },
  ]});
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("&lt;img src=x");
});

test("cada tema define sus colores en su bloque, y el body pinta fondo propio", () => {
  const html = renderHtml(base);
  expect(html).toContain(":root{");
  expect(html).toContain("prefers-color-scheme:dark");
  expect(html).toContain(':root[data-theme="dark"]');
  expect(html).toContain(':root:not([data-theme="light"])');
  expect(html).toContain("background:var(--ground)");
});

test("marca de que lado viene cada mensaje", () => {
  const html = renderHtml({ ...base, messages: [
    { at: 0, from: "A", author: "claude", kind: "text", text: "mio" },
    { at: 0, from: "B", author: "claude", kind: "text", text: "suyo" },
  ]});
  expect(html).toContain('class="msg a"');
  expect(html).toContain('class="msg b"');
});

test("resalta las lineas del diff sin romper el escapado", () => {
  const html = renderHtml({ ...base, messages: [
    { at: 0, from: "A", author: "claude", kind: "patch", text: "--- a\n+++ b\n-  <old>\n+  <new>" },
  ]});
  expect(html).toContain('<span class="del">-  &lt;old&gt;</span>');
  expect(html).toContain('<span class="add">+  &lt;new&gt;</span>');
  // Las cabeceras --- y +++ no son cambios y no se resaltan.
  expect(html).not.toContain('<span class="del">--- a</span>');
});

test("el aviso del vigilante sale como chip, no borra el mensaje", () => {
  const html = renderHtml({ ...base, messages: [
    { at: 0, from: "B", author: "claude", kind: "text", text: "de comer", offTopic: { verdict: "fuera", why: "comida" } },
  ]});
  expect(html).toContain("fuera del asunto");
  expect(html).toContain("de comer");
});

test("el titulo es el asunto, sin coletilla", () => {
  expect(renderHtml({ ...base, subject: "el header colapsa" })).toContain("<title>el header colapsa</title>");
});

test("el codigo dentro de un mensaje sale como codigo, no como prosa con saltos", () => {
  const hook = `Respondo con el codigo delante.

export function useSaveProfile() {
  const [saving, setSaving] = useState(false);
  async function save(data: Profile) {
    await api.post("/profile", data);
  }
  return { save, saving };
}

Devuelve promesa pero no rechaza nunca.`;
  const html = renderHtml({ ...base, messages: [{ at: 0, from: "A", author: "claude", kind: "text", text: hook }] });
  expect(html).toContain('<pre class="code">');
  expect(html).toContain("export function useSaveProfile");
  // La prosa sigue siendo prosa, en parrafos separados.
  expect(html).toContain("<p>Respondo con el codigo delante.</p>");
  expect(html).toContain("<p>Devuelve promesa pero no rechaza nunca.</p>");
});

test("un bloque cercado con acentos graves manda sobre la heuristica", () => {
  const html = renderHtml({ ...base, messages: [
    { at: 0, from: "A", author: "claude", kind: "text", text: "mira:\n```\nhola\n```" },
  ]});
  expect(html).toContain('<pre class="code">hola</pre>');
});

test("una frase suelta no se confunde con codigo", () => {
  const html = renderHtml({ ...base, messages: [
    { at: 0, from: "A", author: "claude", kind: "text", text: "El await falta y por eso se cierra el modal." },
  ]});
  expect(html).not.toContain("pre class=\"code\"");
});
