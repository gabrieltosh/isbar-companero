// Vida propia del compañero: decide qué cara pone en cada momento.
// Prioridad: un gesto pasajero (guiño, risa…) > lo que pasa ahora (lo arrastras, el ratón encima)
// > lo que pide la app (música, avisos; fases siguientes) > cómo está él (rutinas, cansancio, sueño).
import type { Expresion } from "./cara";

/** Tiempo sin usar el PC a partir del cual hace cosas solo, se cansa y se duerme. */
const RUTINAS_DESDE = 20_000;
const CANSADO_DESDE = 3 * 60_000;
const DORMIDO_DESDE = 6 * 60_000;
/** De noche todo llega antes. */
const FACTOR_NOCHE = 0.5;
/** Cada cuánto elige una rutina nueva cuando está solo. */
const DURACION_RUTINA = 8_000;

export type Rutina = "mira" | "silba" | "estira" | null;

export interface Contexto {
  ahora: number;
  /** El ratón está encima */
  encima: boolean;
  arrastrando: boolean;
  /** Tiempo sin tocar el ratón ni el teclado, en ms */
  inactivo: number;
  noche: boolean;
  /** Modo tranquilo: sin rutinas llamativas */
  tranquilo: boolean;
  /** Lo que pide la app (música, un aviso…), o null */
  peticion: Expresion | null;
}

export interface Decision {
  expresion: Expresion;
  rutina: Rutina;
  /** Progreso (0 a 1) del gesto pasajero, si lo hay */
  progreso: number;
}

let pasajero: { expresion: Expresion; desde: number; hasta: number } | null = null;
let rutina: Rutina = null;
let cambioRutina = 0;
let estabaDormido = false;

/** Un gesto que dura un momento (guiño, risa, enfado…) y tapa todo lo demás. */
export function gesto(expresion: Expresion, ms: number): void {
  const ahora = performance.now();
  pasajero = { expresion, desde: ahora, hasta: ahora + ms };
}

export function hayGesto(): boolean {
  return pasajero !== null && performance.now() < pasajero.hasta;
}

/** Es de noche entre las 22:00 y las 6:00. */
export function esDeNoche(fecha = new Date()): boolean {
  const h = fecha.getHours();
  return h >= 22 || h < 6;
}

function elegirRutina(tranquilo: boolean): Rutina {
  const r = Math.random();
  if (tranquilo) return r < 0.5 ? null : "mira";
  if (r < 0.35) return null;
  if (r < 0.55) return "mira";
  if (r < 0.8) return "silba";
  return "estira";
}

export function decidir(ctx: Contexto): Decision {
  // Al despertar (vuelves a usar el PC mientras dormía) se lleva un pequeño susto
  const factor = ctx.noche ? FACTOR_NOCHE : 1;
  const dormido = ctx.inactivo > DORMIDO_DESDE * factor;
  if (estabaDormido && !dormido) gesto("sorpresa", 900);
  estabaDormido = dormido;

  if (pasajero && ctx.ahora < pasajero.hasta) {
    const progreso = (ctx.ahora - pasajero.desde) / (pasajero.hasta - pasajero.desde);
    return { expresion: pasajero.expresion, rutina: null, progreso };
  }
  pasajero = null;

  if (ctx.arrastrando) return { expresion: "sorpresa", rutina: null, progreso: 0 };
  if (ctx.encima) return { expresion: "feliz", rutina: null, progreso: 0 };
  if (ctx.peticion) return { expresion: ctx.peticion, rutina: null, progreso: 0 };

  if (dormido) return { expresion: "dormido", rutina: null, progreso: 0 };
  if (ctx.inactivo > CANSADO_DESDE * factor) return { expresion: "cansado", rutina: null, progreso: 0 };

  if (ctx.inactivo > RUTINAS_DESDE) {
    if (ctx.ahora > cambioRutina) {
      rutina = elegirRutina(ctx.tranquilo);
      cambioRutina = ctx.ahora + DURACION_RUTINA;
    }
    return { expresion: rutina === "silba" ? "silba" : "normal", rutina, progreso: 0 };
  }
  rutina = null;
  return { expresion: "normal", rutina: null, progreso: 0 };
}
