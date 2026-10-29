// Qué estás haciendo, según la ventana activa (programa y título, que manda Rust: activa.rs), y
// cómo se comporta el compañero:
// - En una reunión o llamada: se calla (los globos que se van solos no salen; los que esperan
//   respuesta, aguardan) y no baila aunque suene algo.
// - Viendo un vídeo o jugando: igual, quieto y callado, para no tapar ni distraer.
// - Concentrado (programando, escribiendo, una hoja de cálculo): modo tranquilo, sin ocurrencias
//   ni rutinas llamativas.
// - Chateando, navegando u otra cosa: normal.
// Lo decide Jev (con su interruptor en Configuración, apagado por defecto: el título de la ventana
// sale del PC); si Jev falla o duda, unas reglas por programa y título. Cada ventana se pregunta
// una vez (cuando lleva un momento delante) y se recuerda mientras la app está abierta; no se
// guarda en disco, porque los títulos pueden ser privados.
import { listen } from "@tauri-apps/api/event";
import { EVENTO_AJUSTES, JEV_POR_DEFECTO, type ConfigJev } from "../ajustes";
import { actividadVentana, jevDisponible, type Actividad, type DatosVentana } from "../estado/jev";
import { silenciarAvisos } from "../sonido";
import { leer } from "../store";
import { entornoDe, type Entorno } from "./entorno";
import { silenciarGlobos } from "./globos";

/** La ventana tiene que estar delante este tiempo para preguntar (así un Alt+Tab no gasta). */
const ESTABLE_MS = 1500;
/** Con menos confianza, la respuesta de Jev no se usa (se tiran de las reglas). */
const CONFIANZA_MINIMA = 0.5;
/** Ventanas que se recuerdan como mucho (solo mientras la app está abierta). */
const MAX_RECORDADAS = 300;

/** Sin Jev: lo que dicen las reglas de siempre por programa (entorno.ts). */
const POR_ENTORNO: Record<Entorno, Actividad> = {
  video: "video",
  juego: "juego",
  codigo: "concentrado",
  oficina: "concentrado",
  correo: "charla",
  chat: "charla",
  musica: "otro",
  navegador: "navegando",
  carpetas: "otro",
  escritorio: "otro",
  otro: "otro",
};
/** Títulos que delatan una reunión aunque el programa no lo diga. */
const REUNION = /\b(reuni[oó]n|meeting|llamada|call|videollamada|meet -|zoom|webex)\b/i;

let config: ConfigJev = JEV_POR_DEFECTO;
let actual: Actividad | null = null;
let tEstable = 0;
/** Ventana activa ahora (clave), para descartar respuestas que llegan tarde. */
let ventana = "";
const recordadas = new Map<string, Actividad>();

const claveDe = (v: DatosVentana) => `${v.programa}\u0001${v.titulo}`;
const activado = () => jevDisponible(config) && config.actividad;

/** Lo que estás haciendo ahora (null si está apagado o aún no se sabe). */
export function actividadActual(): Actividad | null {
  return activado() ? actual : null;
}

/** Cómo debe comportarse el compañero con la actividad de ahora. */
export function modoActividad(): { callar: boolean; quieto: boolean; tranquilo: boolean } {
  const a = actividadActual();
  const callar = a === "reunion" || a === "video" || a === "juego";
  return { callar, quieto: callar, tranquilo: a === "concentrado" };
}

function fijar(a: Actividad | null): void {
  actual = a;
  const { callar } = modoActividad();
  silenciarGlobos("actividad", callar);
  silenciarAvisos("actividad", callar);
}

function porReglas(v: DatosVentana): Actividad {
  if (REUNION.test(v.titulo)) return "reunion";
  return POR_ENTORNO[entornoDe(v)];
}

async function clasificar(v: DatosVentana): Promise<void> {
  const clave = claveDe(v);
  const sabida = recordadas.get(clave);
  if (sabida) {
    fijar(sabida);
    return;
  }
  let a = porReglas(v);
  try {
    const r = await actividadVentana(config.clave, v);
    if (r.confianza >= CONFIANZA_MINIMA) a = r.actividad;
    console.info(`jev: «${v.programa} · ${v.titulo}» → ${r.actividad} (${Math.round(r.confianza * 100)} %)`);
  } catch (e) {
    console.warn("jev: sin actividad, con las reglas:", e);
  }
  if (recordadas.size >= MAX_RECORDADAS) recordadas.delete(recordadas.keys().next().value ?? "");
  recordadas.set(clave, a);
  // Si mientras tanto cambiaste de ventana, ya no vale para ahora
  if (clave === ventana) fijar(a);
}

async function cargarConfig(): Promise<void> {
  config = { ...JEV_POR_DEFECTO, ...(await leer<Partial<ConfigJev>>("jevConfig", {})) };
  // Al apagarlo, vuelve a ser como siempre
  if (!activado()) fijar(null);
}

export function iniciarActividad(): void {
  void cargarConfig();
  listen(EVENTO_AJUSTES, () => void cargarConfig()).catch(console.error);
  listen<DatosVentana>("ventana-activa", ({ payload }) => {
    ventana = claveDe(payload);
    window.clearTimeout(tEstable);
    if (!activado()) return;
    tEstable = window.setTimeout(() => void clasificar(payload), ESTABLE_MS);
  }).catch(console.error);
}
