// Pasos de baile con la música. Cada paso dice cómo se mueve el cuerpo y la cara según el
// pulso de la canción (ritmo.ts). Cada pocos compases cambia a otro paso, elegido según lo
// intensa que sea esa parte y sin repetir los últimos, y pasa de uno a otro mezclándolos.
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
  /** b: pulso (la parte decimal va de un pulso al siguiente); e: energía de ahora (0 a 1) */
  mover: (b: number, e: number) => Movimiento;
}

/** Pulsos que dura cada paso antes de cambiar. */
const PULSOS_POR_PASO = 8;
/** Lo que tarda en pasar de un paso a otro (ms). */
const MEZCLA_MS = 700;

const QUIETO: Movimiento = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, giroCara: 0, saltoCara: 0, miraX: 0 };
const mov = (m: Partial<Movimiento>): Movimiento => ({ ...QUIETO, ...m });

/** Golpe al empezar cada pulso que se apaga enseguida (1 → 0). */
const golpeDe = (b: number) => Math.exp(-(b - Math.floor(b)) * 7);
/** Suave de 0 a 1. */
const suave = (k: number) => k * k * (3 - 2 * k);
/** Lado que toca en este pulso: -1, 1, -1… */
const ladoDe = (b: number) => (Math.floor(b) % 2 === 0 ? -1 : 1);

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
      const g = golpeDe(b);
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
      const alto = Math.sin(f * Math.PI) * (6 + e * 6);
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
      const g = golpeDe(b * 2);
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
];

let actual = PASOS[0];
let anterior: Paso | null = null;
let cambio = 0;
let bloque = -1;
const recientes: string[] = [];

/** Elige otro paso para esta parte de la canción, que no sea de los últimos. */
function elegir(intensidad: number): Paso {
  const encaja = PASOS.filter((p) => intensidad >= p.desde - 0.05 && intensidad <= p.hasta + 0.05);
  const nuevos = encaja.filter((p) => !recientes.includes(p.nombre));
  const opciones = nuevos.length ? nuevos : PASOS.filter((p) => p !== actual);
  return opciones[Math.floor(Math.random() * opciones.length)];
}

function mezclarMov(a: Movimiento, b: Movimiento, k: number): Movimiento {
  const r = { ...a };
  for (const c of Object.keys(r) as (keyof Movimiento)[]) r[c] = a[c] + (b[c] - a[c]) * k;
  return r;
}

/** Cómo baila ahora: movimiento del cuerpo y de la cara, y los ojos del paso. */
export function bailar(ahora: number, pulso: number, energia: number, intensidad: number): { mov: Movimiento; ojos: OjosBaile } {
  const b = Math.floor(pulso / PULSOS_POR_PASO);
  if (b !== bloque) {
    // Al empezar y luego cada pocos compases
    const nuevo = elegir(intensidad);
    bloque = b;
    if (nuevo !== actual) {
      anterior = actual;
      actual = nuevo;
      cambio = ahora;
      recientes.push(nuevo.nombre);
      if (recientes.length > 3) recientes.shift();
    }
  }
  const e = Math.max(0, Math.min(1, energia));
  const m = actual.mover(pulso, e);
  const k = anterior ? Math.min(1, (ahora - cambio) / MEZCLA_MS) : 1;
  if (k >= 1 || !anterior) return { mov: m, ojos: actual.ojos };
  return { mov: mezclarMov(anterior.mover(pulso, e), m, suave(k)), ojos: k < 0.5 ? anterior.ojos : actual.ojos };
}

/** Sin música, deja de bailar (la próxima vez empieza con un paso nuevo). */
export function pararBaile(): void {
  bloque = -1;
  anterior = null;
}

export const SIN_BAILE = QUIETO;
