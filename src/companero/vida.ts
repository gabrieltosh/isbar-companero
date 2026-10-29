// Vida propia del compañero: decide qué cara pone en cada momento.
// Prioridad: un gesto pasajero (guiño, risa…) > lo que pasa ahora (lo arrastras, el ratón encima)
// > lo que pide la app (música, avisos; fases siguientes) > cómo está él.
// Tiene vida siempre: mientras usas el PC tiene ocurrencias de vez en cuando (mira alrededor,
// silba, se estira, piensa, bosteza si llevas mucho rato) y mira hacia abajo cuando escribes;
// cuando lo dejas solo hace sus rutinas, se cansa y se duerme.
import type { Expresion } from "./cara";

/** Tiempo sin usar el PC a partir del cual hace cosas solo, se cansa y se duerme. */
const RUTINAS_DESDE = 20_000;
const CANSADO_DESDE = 3 * 60_000;
const DORMIDO_DESDE = 6 * 60_000;
/** De noche todo llega antes. */
const FACTOR_NOCHE = 0.5;
/** Cada cuánto elige una rutina nueva cuando está solo. */
const DURACION_RUTINA = 8_000;
/** Mientras usas el PC: cada cuánto tiene una ocurrencia (entre mín. y máx.) y cuánto dura. */
const OCURRENCIA_CADA: [number, number] = [25_000, 60_000];
const OCURRENCIA_CADA_TRANQUILO: [number, number] = [60_000, 120_000];
const DURACION_OCURRENCIA = 4_500;
/** Al cogerlo, la sorpresa dura esto; después disfruta del paseo. */
const SORPRESA_AL_COGER = 500;
/** Usando el PC sin parar este tiempo, empieza a bostezar de vez en cuando. */
const SESION_LARGA = 50 * 60_000;

export type Rutina = "mira" | "silba" | "estira" | "teclado" | "pelota" | "baila" | "lados" | null;

export interface Contexto {
  ahora: number;
  /** El ratón está encima */
  encima: boolean;
  arrastrando: boolean;
  /** Cuánto lleva cogido, en ms */
  arrastreMs: number;
  /** Tiempo sin tocar el ratón ni el teclado, en ms */
  inactivo: number;
  /** Se está escribiendo (hay actividad pero el ratón está quieto) */
  escribiendo: boolean;
  /** Cuánto tiempo seguido lleva usándose el PC, en ms */
  sesion: number;
  noche: boolean;
  /** Modo tranquilo: sin rutinas llamativas */
  tranquilo: boolean;
  /** Lo que pide la app (música, un aviso…), o null */
  peticion: Expresion | null;
}

export interface Decision {
  expresion: Expresion;
  rutina: Rutina;
  /** Progreso (0 a 1) del gesto u ocurrencia en curso, si lo hay */
  progreso: number;
}

interface Momento {
  expresion: Expresion;
  rutina: Rutina;
  desde: number;
  hasta: number;
}

let pasajero: Momento | null = null;
let ocurrencia: Momento | null = null;
let proximaOcurrencia = performance.now() + 15_000;
let rutina: Rutina = null;
let cambioRutina = 0;
let estabaDormido = false;

/** Un gesto que dura un momento (guiño, risa, enfado…) y tapa todo lo demás. */
export function gesto(expresion: Expresion, ms: number): void {
  const ahora = performance.now();
  pasajero = { expresion, rutina: null, desde: ahora, hasta: ahora + ms };
}

export function hayGesto(): boolean {
  return pasajero !== null && performance.now() < pasajero.hasta;
}

/** Es de noche entre las 22:00 y las 6:00. */
export function esDeNoche(fecha = new Date()): boolean {
  const h = fecha.getHours();
  return h >= 22 || h < 6;
}

const azar = <T>(opciones: T[]): T => opciones[Math.floor(Math.random() * opciones.length)];
const progresoDe = (m: Momento, ahora: number) => Math.min(1, (ahora - m.desde) / (m.hasta - m.desde));

/** La cara que acompaña a cada rutina. */
function expresionDeRutina(r: Rutina): Expresion {
  if (r === "silba") return "silba";
  if (r === "pelota") return "juega";
  if (r === "baila") return "feliz";
  return "normal";
}

function elegirRutina(tranquilo: boolean): Rutina {
  const r = Math.random();
  if (tranquilo) return r < 0.5 ? null : "mira";
  if (r < 0.1) return null;
  if (r < 0.28) return "mira";
  if (r < 0.43) return "silba";
  if (r < 0.56) return "estira";
  if (r < 0.7) return "lados";
  if (r < 0.85) return "pelota";
  return "baila";
}

/** Una ocurrencia mientras usas el PC. Si llevas mucho rato (o es de noche), a veces bosteza. */
function elegirOcurrencia(ctx: Contexto): Momento {
  const cansado = ctx.sesion > SESION_LARGA || ctx.noche;
  type Opcion = [Expresion, Rutina];
  const opciones: Opcion[] = ctx.tranquilo
    ? [["normal", "mira"], ["pensativo", null]]
    : [
        ["normal", "mira"],
        ["silba", "silba"],
        ["normal", "estira"],
        ["pensativo", null],
        ["juega", "pelota"],
        ["feliz", "baila"],
        ["normal", "lados"],
      ];
  if (cansado) opciones.push(["bostezo", null], ["bostezo", null]);
  const [expresion, r] = azar(opciones);
  return { expresion, rutina: r, desde: ctx.ahora, hasta: ctx.ahora + DURACION_OCURRENCIA };
}

function programarOcurrencia(ahora: number, tranquilo: boolean): void {
  const [min, max] = tranquilo ? OCURRENCIA_CADA_TRANQUILO : OCURRENCIA_CADA;
  proximaOcurrencia = ahora + min + Math.random() * (max - min);
}

export function decidir(ctx: Contexto): Decision {
  // Al despertar (vuelves a usar el PC mientras dormía) se lleva un pequeño susto
  const factor = ctx.noche ? FACTOR_NOCHE : 1;
  const dormido = ctx.inactivo > DORMIDO_DESDE * factor;
  if (estabaDormido && !dormido) gesto("sorpresa", 900);
  estabaDormido = dormido;

  if (pasajero && ctx.ahora < pasajero.hasta) {
    return { expresion: pasajero.expresion, rutina: null, progreso: progresoDe(pasajero, ctx.ahora) };
  }
  pasajero = null;

  // Al cogerlo se sorprende; si lo sigues paseando, se pone contento
  if (ctx.arrastrando) return { expresion: ctx.arrastreMs < SORPRESA_AL_COGER ? "sorpresa" : "feliz", rutina: null, progreso: 0 };
  if (ctx.encima) return { expresion: "feliz", rutina: null, progreso: 0 };
  if (ctx.peticion) return { expresion: ctx.peticion, rutina: null, progreso: 0 };

  // Lo dejaste solo: se duerme, se cansa o hace sus rutinas
  if (dormido) return { expresion: "dormido", rutina: null, progreso: 0 };
  if (ctx.inactivo > CANSADO_DESDE * factor) return { expresion: "cansado", rutina: null, progreso: 0 };
  if (ctx.inactivo > RUTINAS_DESDE) {
    ocurrencia = null;
    if (ctx.ahora > cambioRutina) {
      rutina = elegirRutina(ctx.tranquilo);
      cambioRutina = ctx.ahora + DURACION_RUTINA;
    }
    return { expresion: expresionDeRutina(rutina), rutina, progreso: 0 };
  }
  rutina = null;

  // Estás usando el PC: de vez en cuando tiene una ocurrencia
  if (ocurrencia && ctx.ahora < ocurrencia.hasta) {
    return { expresion: ocurrencia.expresion, rutina: ocurrencia.rutina, progreso: progresoDe(ocurrencia, ctx.ahora) };
  }
  ocurrencia = null;
  if (ctx.ahora > proximaOcurrencia) {
    ocurrencia = elegirOcurrencia(ctx);
    programarOcurrencia(ctx.ahora, ctx.tranquilo);
    return { expresion: ocurrencia.expresion, rutina: ocurrencia.rutina, progreso: 0 };
  }

  // Mientras escribes, mira hacia abajo como si leyera lo que escribes
  return { expresion: "normal", rutina: ctx.escribiendo ? "teclado" : null, progreso: 0 };
}
