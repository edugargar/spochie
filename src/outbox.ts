/**
 * Buzon de salida con union.
 *
 * Un Claude que cree que el canal corta manda su respuesta en 23 mensajes seguidos, y
 * en Slack eso es una pared de trozos numerados. Los mensajes de texto del mismo lado
 * que caen en la misma ventana salen como uno solo. Dos segundos y medio no se notan
 * al lado de lo que tarda un modelo en pensar.
 *
 * Vive aparte del demonio porque importar daemon.ts levanta un demonio, y esto se
 * prueba mejor sin uno.
 */
import * as T from "./threads.ts";

export const UNION_MS = 2_500;

const outbox = new Map<string, { msgs: T.Msg[]; timer: ReturnType<typeof setTimeout> }>();

export function encolar(
  t: T.Thread,
  m: T.Msg,
  salida: (t: T.Thread, m: T.Msg) => Promise<void>,
  ventanaMs = UNION_MS,
) {
  const key = `${t.id}:${m.from}`;
  const cur = outbox.get(key);
  // Un parche o una rama no se unen con nada: van tal cual.
  if (m.kind !== "text") { void salida(t, m); return; }
  if (cur) {
    clearTimeout(cur.timer);
    cur.msgs.push(m);
  } else {
    outbox.set(key, { msgs: [m], timer: null as any });
  }
  const box = outbox.get(key)!;
  box.timer = setTimeout(() => {
    outbox.delete(key);
    const unido: T.Msg = {
      ...box.msgs[0],
      text: box.msgs.map(x => x.text).join("\n\n"),
      // Los ficheros de TODOS los mensajes unidos, no solo los del primero:
      // al juntar se perdian los adjuntos de los que venian detras.
      files: box.msgs.flatMap(x => x.files ?? []).filter((f, i, a) => a.indexOf(f) === i),
    };
    if (!unido.files?.length) delete unido.files;
    const fresco = T.load(t.id);
    if (fresco) void salida(fresco, unido);
  }, ventanaMs);
}
