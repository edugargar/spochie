/**
 * Vigilante de tema. Compara cada mensaje con el asunto del spochie y ETIQUETA.
 * Nunca bloquea: un guardian que corta el mensaje bueno mata la conversacion sin
 * que nadie sepa por que. Quien decide es quien tiene el contexto.
 *
 * Corre Haiku por `claude -p`, no por la API, para no gestionar ninguna clave:
 * usa la autenticacion que ya tiene la maquina.
 */
import { execFile } from "node:child_process";

export type Verdict = { verdict: "dentro" | "fuera" | "dudoso"; why: string };

const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 20_000;
/** Por debajo de esto no hay tema que juzgar. Medido: un "OK, todo llega." salia
 *  etiquetado como "dudoso", que es ruido puro para quien lee el hilo. */
const MIN_CHARS = 40;

const PROMPT = (subject: string, text: string) => `Eres un filtro de tema. El asunto de una conversacion es:

ASUNTO: ${subject}

Este es un mensaje de esa conversacion:

MENSAJE: ${text.slice(0, 4000)}

Responde SOLO con un JSON de una linea, sin markdown ni explicacion:
{"verdict":"dentro"|"fuera"|"dudoso","why":"<media frase en espanol>"}

"dentro" si el mensaje trata del asunto o de lo necesario para resolverlo (contexto tecnico,
preguntas de aclaracion, ficheros, ramas). "fuera" solo si habla de algo claramente distinto.
"dudoso" si no lo tienes claro. Ante la duda, "dentro".`;

export function judge(subject: string, text: string): Promise<Verdict> {
  if (text.trim().length < MIN_CHARS) {
    return Promise.resolve({ verdict: "dentro", why: "demasiado corto para juzgar" });
  }
  return new Promise(resolve => {
    const fallback: Verdict = { verdict: "dentro", why: "vigilante no disponible" };
    const child = execFile(
      "claude",
      ["-p", "--model", MODEL, "--output-format", "json", "--max-turns", "1"],
      { timeout: TIMEOUT_MS, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) return resolve(fallback);
        try {
          const outer = JSON.parse(stdout);
          const raw: string = outer.result ?? "";
          const m = raw.match(/\{[\s\S]*\}/);
          if (!m) return resolve(fallback);
          const v = JSON.parse(m[0]);
          if (!["dentro", "fuera", "dudoso"].includes(v.verdict)) return resolve(fallback);
          resolve({ verdict: v.verdict, why: String(v.why ?? "").slice(0, 200) });
        } catch { resolve(fallback); }
      },
    );
    child.stdin?.end(PROMPT(subject, text));
  });
}
