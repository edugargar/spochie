/**
 * El aviso de un spoochie que llega, fuera de cualquier terminal.
 *
 * La invitacion entraba en la sesion de Claude donde la persona estaba trabajando, y
 * eso ensuciaba justo la terminal que no habia que tocar: su Claude se ponia a hablar
 * del spoochie en mitad de otra cosa. Ahora, en macOS, el aviso es un dialogo del
 * sistema: quien lo abre, el asunto, la pregunta, y tres botones. Aceptar abre la
 * ventana del Claude aparte; Rechazar cierra el tunel; Ver en Slack abre el hilo, donde
 * tambien se puede aceptar escribiendo. Ninguna sesion interactiva se entera.
 *
 * Sin escritorio (Linux, tests) se vuelve a la entrega en la terminal. SPOOCHIE_AVISO
 * lo fija: "terminal", "dialogo", o un programa que recibe el texto y responde con el
 * nombre del boton (para los tests).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import * as T from "./threads.ts";
// El logo, como icono del dialogo. Con `type: "file"` Bun lo empaqueta dentro del binario
// compilado y aqui llega una ruta valida en los dos casos, fuente o binario.
import poochie from "../docs/spoochie.png" with { type: "file" };

export type Respuesta = "acepto" | "rechazo" | "slack" | null;
export type Modo = "dialogo" | "terminal";

export function modoAviso(): Modo {
  const v = process.env.SPOOCHIE_AVISO;
  if (v === "terminal") return "terminal";
  if (v && v !== "dialogo") return "dialogo";
  return process.platform === "darwin" ? "dialogo" : "terminal";
}

const MAX_CUERPO = 500;

/** Poochie murio volviendo a su planeta. Aqui vuelve cada vez que alguien llama. */
const ENTRADAS = [
  (q: string) => `Poochie ha vuelto de su planeta con un recado: ${q} quiere abrir un spoochie contigo.`,
  (q: string) => `Guau. ${q} quiere abrir un spoochie contigo. Poochie trae el hueso.`,
  (q: string) => `${q} rasca la puerta: quiere abrir un spoochie contigo.`,
  (q: string) => `Poochie, gafas de sol puestas, anuncia que ${q} quiere abrir un spoochie contigo.`,
  (q: string) => `Interrumpimos esta programacion: ${q} quiere abrir un spoochie contigo.`,
];

export function textoDialogo(t: T.Thread): string {
  const quien = t.from.human ?? t.from.name;
  const cuerpo = (t.messages[0]?.text ?? "").trim();
  const recorte = cuerpo.length > MAX_CUERPO ? cuerpo.slice(0, MAX_CUERPO) + " [...]" : cuerpo;
  const n = [...t.id].reduce((a, c) => a + c.charCodeAt(0), 0) % ENTRADAS.length;
  return [
    ENTRADAS[n](quien),
    ``,
    `Asunto: ${t.subject}`,
    t.context.branch ? `Rama: ${t.context.branch}` : null,
    ``,
    recorte,
    ``,
    `"${BOTONES.aceptar}" abre una ventana de Terminal aparte con un Claude de solo lectura que le contesta desde tu repo. Tus terminales siguen a lo suyo; Poochie no las toca.`,
  ].filter(x => x !== null).join("\n");
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export const BOTONES = { rechazar: "Ahora no", slack: "Ver en Slack", aceptar: "Que pase" };

function interpretar(salida: string, codigo: number | null): Respuesta {
  if (/gave up:true/.test(salida)) return null;
  if (salida.includes(`button returned:${BOTONES.aceptar}`) || /^\s*(Aceptar|Que pase)\s*$/m.test(salida)) return "acepto";
  if (salida.includes(`button returned:${BOTONES.slack}`) || /^\s*Ver en Slack\s*$/m.test(salida)) return "slack";
  if (salida.includes(`button returned:${BOTONES.rechazar}`) || /^\s*(Rechazar|Ahora no)\s*$/m.test(salida)) return "rechazo";
  // El boton de cancelar hace que osascript termine con error "User canceled".
  if (codigo !== 0 && /canceled|cancelled|-128/i.test(salida)) return "rechazo";
  return null;
}

/** Muestra el aviso y espera al boton. Hasta una hora; si nadie pulsa, null. */
export function preguntar(t: T.Thread, esperaSeg = 3600): { child: ChildProcess; respuesta: Promise<Respuesta> } {
  const texto = textoDialogo(t);
  const custom = process.env.SPOOCHIE_AVISO;
  const child = custom && custom !== "dialogo"
    ? spawn(custom, [texto], { stdio: ["ignore", "pipe", "pipe"] })
    : spawn("osascript", ["-e",
        `display dialog "${esc(texto)}" with title "spoochie"${existsSync(poochie) ? ` with icon POSIX file "${esc(poochie)}"` : ""} buttons {"${BOTONES.rechazar}", "${BOTONES.slack}", "${BOTONES.aceptar}"} default button "${BOTONES.aceptar}" cancel button "${BOTONES.rechazar}" giving up after ${esperaSeg}`,
      ], { stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  child.stdout?.on("data", d => { salida += d.toString(); });
  child.stderr?.on("data", d => { salida += d.toString(); });
  const respuesta = new Promise<Respuesta>(resolve => {
    child.on("error", () => resolve(null));
    child.on("close", codigo => resolve(interpretar(salida, codigo)));
  });
  return { child, respuesta };
}

/** Abre el hilo del spoochie en la app de Slack. */
export function abrirEnSlack(teamId: string | null, channel: string, ts: string) {
  const url = teamId
    ? `slack://channel?team=${teamId}&id=${channel}&message=${ts.replace(".", "")}`
    : `https://slack.com/app_redirect?channel=${channel}`;
  const p = spawn("open", [url], { detached: true, stdio: "ignore" });
  p.on("error", () => {});
  p.unref();
}
