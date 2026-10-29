// Pasos de baile con la música. Cada paso dice cómo se mueve el cuerpo y la cara según el
// pulso de la canción (ritmo.ts). Cada pocos compases cambia a otro paso, elegido según lo
// animada que sea la canción (intensidad de esa parte y tempo: una balada lenta pide mecerse
// o flotar, una rápida, saltitos o pogo). Algunos pasos solo van con ciertos tempos. Entre los
// que encajan (sin repetir los últimos) se sortea, con más probabilidad para los que mejor
// encajan, y pasa de uno a otro mezclándolos. Con cada paso decide también si canta o solo
// sonríe: cuanto más animada la música, más a menudo canta.
// Con las partes de la canción (ritmo.rs): una parte nueva cambia de paso al empezar el
// compás siguiente; en una pausa se queda esperando, y cuando vuelve la música, celebra.
import type { OjosBaile } from "./cara";

export interface Movimiento {
  /** Cuerpo: desplazamiento (px), inclinación (grados, desde abajo) y escala */
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  /** Cara dentro del cuerpo: giro (grados), bajada (px) y hacia dónde mira */
  giroCara: number;
  saltoCara: number;
  miraX: number;
}

interface Paso {
  nombre: string;
  ojos: OjosBaile;
  /** Para qué partes de la canción va: de 0 (tranquila) a 1 (intensa) */
  desde: number;
  hasta: number;
  /** Tempos (pulsos por minuto) con los que va; sin esto, con cualquiera */
  ppm?: [number, number];
  /** b: pulso (la parte decimal va de un pulso al siguiente); e: energía de ahora (0 a 1) */
  mover: (b: number, e: number) => Movimiento;
}

/** Pulsos que dura cada paso antes de cambiar (dos compases: cambia al empezar uno). */
const PULSOS_POR_PASO = 8;
/** Cuánto más se marca el primer tiempo del compás. */
const ACENTO = 1.4;
/** Lo que tarda en pasar de un paso a otro (ms). */
const MEZCLA_MS = 700;

const QUIETO: Movimiento = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, giroCara: 0, saltoCara: 0, miraX: 0 };
const mov = (m: Partial<Movimiento>): Movimiento => ({ ...QUIETO, ...m });

/** Golpe al empezar cada pulso que se apaga enseguida (1 → 0). */
const golpeDe = (b: number) => Math.exp(-(b - Math.floor(b)) * 7);
/** Suave de 0 a 1. */
const suave = (k: number) => k * k * (3 - 2 * k);
/** Más fuerte en el primer tiempo del compás (pulsos múltiplos de 4). */
const acentoDe = (b: number) => (((Math.floor(b) % 4) + 4) % 4 === 0 ? ACENTO : 1);
/** Lado que toca en este pulso: -1, 1, -1… */
const ladoDe = (b: number) => (Math.floor(b) % 2 === 0 ? -1 : 1);
/** Parte del pulso que ya ha pasado (0 a 1). */
const fraccion = (b: number) => b - Math.floor(b);

const PASOS: Paso[] = [
  {
    // Se balancea de lado a lado, un lado por pulso
    nombre: "balanceo",
    ojos: "felices",
    desde: 0,
    hasta: 0.8,
    mover: (b, e) => {
      const s = Math.sin(b * Math.PI);
      return mov({ rot: s * (8 + e * 5), x: s * 2, y: -Math.abs(s) * 2.5, giroCara: s * 6, miraX: s * 2 });
    },
  },
  {
    // Asiente con la cabeza en cada pulso, el cuerpo se aplasta un poco
    nombre: "cabeceo",
    ojos: "cerrados",
    desde: 0.2,
    hasta: 1,
    mover: (b, e) => {
      const g = golpeDe(b) * acentoDe(b);
      return mov({ saltoCara: g * (3 + e * 2.5), y: g * 2, sy: 1 - g * 0.08, sx: 1 + g * 0.05, rot: Math.sin(b * Math.PI) * 3, giroCara: Math.sin(b * Math.PI) * 5 });
    },
  },
  {
    // Saltitos: sube entre pulsos y aterriza aplastado en cada uno
    nombre: "saltitos",
    ojos: "abiertos",
    desde: 0.45,
    hasta: 1,
    mover: (b, e) => {
      const f = b - Math.floor(b);
      const g = golpeDe(b);
      // El salto que cae en el primer tiempo es más alto
      const alto = Math.sin(f * Math.PI) * (6 + e * 6) * acentoDe(b + 1);
      return mov({ y: -alto, sy: 1 - g * 0.12 + (alto / 12) * 0.06, sx: 1 + g * 0.09, saltoCara: g * 1.5 });
    },
  },
  {
    // Paso a un lado en cada pulso, mirando hacia donde va
    nombre: "lateral",
    ojos: "abiertos",
    desde: 0.3,
    hasta: 1,
    mover: (b, e) => {
      const f = b - Math.floor(b);
      const lado = ladoDe(b);
      const x = -lado * 6 + lado * 12 * suave(Math.min(1, f * 2.5));
      const g = golpeDe(b);
      return mov({ x: x * (0.7 + e * 0.3), rot: lado * 6, y: -Math.sin(Math.min(1, f * 2.5) * Math.PI) * 3.5, miraX: lado * 3, sy: 1 - g * 0.05 });
    },
  },
  {
    // Da vueltas: el cuerpo dibuja un círculo cada cuatro pulsos
    nombre: "vuelta",
    ojos: "felices",
    desde: 0,
    hasta: 0.7,
    mover: (b, e) => {
      const a = (b / 4) * Math.PI * 2;
      const r = 5 + e * 3;
      return mov({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.5 - r * 0.5, rot: -Math.cos(a) * 10, giroCara: -Math.cos(a) * 6, miraX: Math.cos(a) * 2 });
    },
  },
  {
    // Sacude la cabeza a todo ritmo (solo en las partes intensas)
    nombre: "sacudida",
    ojos: "apretados",
    desde: 0.65,
    hasta: 1,
    mover: (b, e) => {
      const g = golpeDe(b * 2) * acentoDe(b);
      const s = Math.sin(b * Math.PI);
      return mov({ saltoCara: g * (3.5 + e * 2.5), y: g * 2, rot: s * 6, giroCara: s * 8, sy: 1 - g * 0.09, sx: 1 + g * 0.06 });
    },
  },
  {
    // Partes tranquilas: se mece despacio con los ojos cerrados
    nombre: "mecerse",
    ojos: "cerrados",
    desde: 0,
    hasta: 0.4,
    mover: (b) => {
      const s = Math.sin((b / 2) * Math.PI);
      return mov({ rot: s * 9, x: s * 3, giroCara: s * 6, y: -(1 - Math.abs(s)) * 1.5 });
    },
  },
  {
    // Canciones lentas: flota arriba y abajo cada dos pulsos, como en el agua
    nombre: "flotar",
    ojos: "cerrados",
    desde: 0,
    hasta: 0.35,
    ppm: [0, 105],
    mover: (b, e) => {
      const ola = (1 - Math.cos(b * Math.PI)) / 2;
      const s = Math.sin((b / 2) * Math.PI);
      return mov({ y: -ola * (3 + e * 2), x: s * 2, rot: s * 3, giroCara: s * 4, sy: 1 + ola * 0.03, sx: 1 - ola * 0.015 });
    },
  },
  {
    // Asiente despacio, a medio tiempo (una vez cada dos pulsos)
    nombre: "asentir lento",
    ojos: "felices",
    desde: 0.1,
    hasta: 0.5,
    mover: (b, e) => {
      const g = golpeDe(b / 2) * acentoDe(b);
      const s = Math.sin((b / 2) * Math.PI);
      return mov({ saltoCara: g * (2.5 + e * 1.5), y: g * 1.2, sy: 1 - g * 0.05, giroCara: s * 4, rot: s * 2 });
    },
  },
  {
    // Metrónomo: la cabeza salta de un lado al otro justo en cada pulso
    nombre: "metronomo",
    ojos: "abiertos",
    desde: 0.3,
    hasta: 0.75,
    mover: (b, e) => {
      const lado = ladoDe(b);
      const k = suave(Math.min(1, fraccion(b) * 4));
      const angulo = (-lado + 2 * lado * k) * (6 + e * 3);
      return mov({ rot: angulo, giroCara: angulo * 1.2, miraX: lado * 3, saltoCara: golpeDe(b) * 1.2 });
    },
  },
  {
    // Rebota flexionando en cada golpe y se mece de lado cada dos pulsos
    nombre: "rebote",
    ojos: "felices",
    desde: 0.35,
    hasta: 0.85,
    mover: (b, e) => {
      const g = golpeDe(b) * acentoDe(b);
      const s = Math.sin((b / 2) * Math.PI);
      return mov({ y: g * (2 + e * 1.5), sy: 1 - g * 0.1, sx: 1 + g * 0.06, x: s * 3, rot: s * 4, giroCara: s * 3 });
    },
  },
  {
    // Pogo: saltos altos y rectos en cada pulso (solo con tempo rápido y parte intensa)
    nombre: "pogo",
    ojos: "apretados",
    desde: 0.75,
    hasta: 1,
    ppm: [110, 999],
    mover: (b, e) => {
      const g = golpeDe(b);
      const alto = Math.sin(fraccion(b) * Math.PI) * (11 + e * 6) * acentoDe(b + 1);
      return mov({ y: -alto, sy: 1 + (alto / 18) * 0.1 - g * 0.15, sx: 1 - (alto / 18) * 0.05 + g * 0.1, saltoCara: g * 2 });
    },
  },
  {
    // A contratiempo: sacudidas cortas en cada medio pulso (con tempos no muy rápidos)
    nombre: "contratiempo",
    ojos: "apretados",
    desde: 0.55,
    hasta: 1,
    ppm: [0, 125],
    mover: (b, e) => {
      const g = golpeDe(b * 2);
      const lado = ladoDe(b * 2);
      return mov({ x: lado * g * (2 + e * 1.5), rot: lado * g * 4, giroCara: lado * g * 5, saltoCara: g * 1.5, sy: 1 - g * 0.05 });
    },
  },
  {
    // Remolino: rebota y, al empezar cada dos compases, la cara da una vuelta entera
    nombre: "remolino",
    ojos: "felices",
    desde: 0.6,
    hasta: 1,
    mover: (b, e) => {
      const g = golpeDe(b) * acentoDe(b);
      const vuelta = ((Math.floor(b) % 8) + 8) % 8 === 0 ? suave(Math.min(1, fraccion(b) * 1.3)) * 360 : 0;
      return mov({ giroCara: vuelta, y: g * (2 + e * 1.5) - Math.sin(Math.min(1, fraccion(b) * 1.3) * Math.PI) * (vuelta ? 5 : 0), sy: 1 - g * 0.08, sx: 1 + g * 0.05 });
    },
  },
];

/** En una pausa de la canción: casi quieto, esperando, mirando a un lado y a otro. */
const ESPERA: Paso = {
  nombre: "espera",
  ojos: "abiertos",
  desde: 0,
  hasta: 0,
  mover: (b) => {
    const s = Math.sin((b / 4) * Math.PI);
    return mov({ miraX: s * 3, giroCara: s * 3, saltoCara: golpeDe(b) * 0.8 });
  },
};

/** Cuando vuelve la música tras una pausa: un compás de saltos grandes, de lado a lado. */
const CELEBRA: Paso = {
  nombre: "celebra",
  ojos: "apretados",
  desde: 1,
  hasta: 1,
  mover: (b, e) => {
    const f = b - Math.floor(b);
    const g = golpeDe(b);
    const alto = Math.sin(f * Math.PI) * (10 + e * 6);
    const lado = ladoDe(b);
    return mov({ y: -alto, rot: lado * 10 * Math.sin(f * Math.PI), sy: 1 - g * 0.14 + (alto / 16) * 0.08, sx: 1 + g * 0.1, saltoCara: g * 2, miraX: lado * 2 });
  },
};

let actual = PASOS[0];
let anterior: Paso | null = null;
let cambio = 0;
let bloque = -1;
let compas = -1;
const recientes: string[] = [];
/** Parte nueva: cambiar de paso al empezar el compás siguiente. */
let cambiarEnCompas = false;
/** Vuelve la música: celebrar en el siguiente fotograma, y hasta qué pulso. */
let celebrar = false;
let celebrarHasta = 0;
/** Si canta en este paso (si no, sonríe con la boca cerrada). */
let canta = false;

/** Empieza una parte nueva de la canción (estribillo, estrofa…). */
export function nuevaParte(): void {
  cambiarEnCompas = true;
}

/** Vuelve la música después de una pausa. */
export function celebrarVuelta(): void {
  celebrar = true;
}

function cambiarA(nuevo: Paso, ahora: number): void {
  if (nuevo === actual) return;
  anterior = actual;
  actual = nuevo;
  cambio = ahora;
  if (!PASOS.includes(nuevo)) return;
  recientes.push(nuevo.nombre);
  if (recientes.length > 3) recientes.shift();
}

/** Elige otro paso para lo animada que está la canción (0 a 1) y su tempo, que no sea de los
 * últimos. Se sortea entre los que encajan; los que tienen el centro de su rango más cerca de
 * lo animada que está la música salen más a menudo. */
function elegir(animado: number, ppm: number): Paso {
  const vale = (p: Paso) =>
    animado >= p.desde - 0.05 && animado <= p.hasta + 0.05 && (!p.ppm || (ppm >= p.ppm[0] && ppm <= p.ppm[1]));
  const encaja = PASOS.filter(vale);
  const nuevos = encaja.filter((p) => !recientes.includes(p.nombre));
  const opciones = nuevos.length ? nuevos : PASOS.filter((p) => p !== actual && (!p.ppm || vale(p)));
  const pesos = opciones.map((p) => 1.2 - Math.min(1, Math.abs((p.desde + p.hasta) / 2 - animado) * 2));
  let suerte = Math.random() * pesos.reduce((a, b) => a + b, 0);
  for (let i = 0; i < opciones.length; i++) {
    suerte -= pesos[i];
    if (suerte <= 0) return opciones[i];
  }
  return opciones[opciones.length - 1];
}

function mezclarMov(a: Movimiento, b: Movimiento, k: number): Movimiento {
  const r = { ...a };
  for (const c of Object.keys(r) as (keyof Movimiento)[]) r[c] = a[c] + (b[c] - a[c]) * k;
  return r;
}

/** Lo animada que es la canción (0 a 1): mitad intensidad, mitad tempo (85 a 145 pulsos por minuto). */
function animacion(intensidad: number, intervalo: number): number {
  const ppm = 60_000 / intervalo;
  const tempo = Math.max(0, Math.min(1, (ppm - 85) / 60));
  return intensidad * 0.5 + tempo * 0.5;
}

/** Cómo baila ahora: movimiento del cuerpo y de la cara, y los ojos del paso. `intervalo`: ms
 * entre pulsos; `pausa`: la canción está en una pausa. */
export function bailar(
  ahora: number,
  pulso: number,
  energia: number,
  intensidad: number,
  intervalo: number,
  pausa = false,
): { mov: Movimiento; ojos: OjosBaile; canta: boolean } {
  const b = Math.floor(pulso / PULSOS_POR_PASO);
  const c = Math.floor(pulso / 4);
  const empiezaCompas = c !== compas;
  compas = c;
  if (pausa) {
    // En una pausa espera callado
    cambiarA(ESPERA, ahora);
    canta = false;
  } else if (celebrar) {
    // Un compás entero celebrando, cantando
    celebrar = false;
    celebrarHasta = pulso + 4;
    cambiarA(CELEBRA, ahora);
    canta = true;
  } else if (actual === CELEBRA && pulso < celebrarHasta) {
    // Sigue celebrando
  } else if (actual === ESPERA || actual === CELEBRA || b !== bloque || (cambiarEnCompas && empiezaCompas)) {
    // Al empezar, cada pocos compases, en una parte nueva y al acabar una pausa. Después de
    // celebrar, un paso animado
    const animado = actual === CELEBRA ? 1 : animacion(intensidad, intervalo);
    cambiarA(elegir(animado, 60_000 / intervalo), ahora);
    // Canta a ratos: poco con música tranquila (~20 %), más con música animada (~65 %)
    canta = Math.random() < 0.2 + animado * 0.45;
    bloque = b;
    cambiarEnCompas = false;
  }
  const e = Math.max(0, Math.min(1, energia));
  const m = actual.mover(pulso, e);
  const k = anterior ? Math.min(1, (ahora - cambio) / MEZCLA_MS) : 1;
  if (k >= 1 || !anterior) return { mov: m, ojos: actual.ojos, canta };
  return { mov: mezclarMov(anterior.mover(pulso, e), m, suave(k)), ojos: k < 0.5 ? anterior.ojos : actual.ojos, canta };
}

/** Sin música, deja de bailar (la próxima vez empieza con un paso nuevo). */
export function pararBaile(): void {
  bloque = -1;
  anterior = null;
  cambiarEnCompas = false;
  celebrar = false;
  if (!PASOS.includes(actual)) actual = PASOS[0];
}

export const SIN_BAILE = QUIETO;
