// Pasos de baile con la música. Cada paso dice cómo se mueve el cuerpo y la cara según el
// pulso de la canción (ritmo.ts). Mantiene el paso mientras la canción no cambia: cambia cuando
// cambia la música (entra la batería, suben las guitarras, llega el estribillo) y, si no, solo de
// tarde en tarde para variar (más tarde aún en las canciones calmadas); siempre al empezar un
// compás y pasando de uno a otro poco a poco. El paso nuevo se elige según lo animada que sea la
// canción (intensidad de esa parte y tempo: una balada lenta pide mecerse
// o flotar, una rápida, saltitos o pogo). Algunos pasos solo van con ciertos tempos. Entre los
// que encajan (sin repetir los últimos) se sortea, con más probabilidad para los que mejor
// encajan, y pasa de uno a otro mezclándolos.
// Con Jev (caracter.ts), el género de la canción manda: solo se sortean los pasos de ese género
// (cada paso dice a cuáles pertenece; hay pasos propios de rock, electrónica, balada…). La
// energía (escala de 0 a 4) dice lo animada que es y cuánto se mueve; solo salta desde 2,5. El
// tono (de triste a alegre) frena: con una canción triste no salta ni celebra con saltos, aunque
// tenga energía (rock triste: encendedor, cabeceo lento, guitarra, cabeceo). Sin Jev, o si duda,
// se elige solo por la intensidad y el tempo.
// Con las partes de la canción (ritmo.rs): una parte nueva cambia de paso al empezar el
// compás siguiente; en una pausa se queda esperando (si la música va creciendo, se agacha y se
// contiene cada vez más), y cuando vuelve la música, celebra. Al empezar una canción, primero la
// escucha un par de compases. Cada instrumento mueve su parte: con bombo, el cuerpo rebota más;
// con caja, la cabeza asiente más; si uno no suena, su parte se mueve menos. Siempre al ritmo
// del pulso, nunca con cada golpe suelto (un arpegio rápido haría que pareciera temblar).
import type { Estilo } from "../estado/jev";
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
  /** Géneros a los que pertenece (con Jev, solo se sortean los del género de la canción) */
  estilos: Estilo[];
  /** Salta: no va con canciones tristes, románticas o relajadas */
  salta?: boolean;
  /** b: pulso (la parte decimal va de un pulso al siguiente); e: energía de ahora (0 a 1) */
  mover: (b: number, e: number) => Movimiento;
}

/** Compases que mantiene un paso si la canción no cambia: para variar, con música animada; con
 * música calmada (por debajo de MUSICA_CALMADA), más aún. */
const COMPASES_ANIMADA = 8;
const COMPASES_CALMADA = 16;
const MUSICA_CALMADA = 0.4;
/** Al cambiar la canción (una parte nueva u otro género), como mínimo estos compases con el paso. */
const COMPASES_ENTRE_PARTES = 2;
/** Cuánto más se marca el primer tiempo del compás. */
const ACENTO = 1.4;
/** Lo que tarda en pasar de un paso a otro: unos dos pulsos, entre estos límites (ms). */
const MEZCLA_MIN_MS = 900;
const MEZCLA_MAX_MS = 1600;

const QUIETO: Movimiento = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, giroCara: 0, saltoCara: 0, miraX: 0 };
const mov = (m: Partial<Movimiento>): Movimiento => ({ ...QUIETO, ...m });

/** Golpe al empezar cada pulso que se apaga enseguida (1 → 0). */
/** Suave de 0 a 1. */
const suave = (k: number) => k * k * (3 - 2 * k);
/** Parte del pulso que tarda el golpe en llegar a su máximo (si fuera instantáneo, daría un tirón). */
const SUBIDA_GOLPE = 0.05;
const golpeDe = (b: number) => {
  const f = b - Math.floor(b);
  return f < SUBIDA_GOLPE ? suave(f / SUBIDA_GOLPE) : Math.exp(-(f - SUBIDA_GOLPE) * 7);
};
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
    estilos: ["pop", "tranquila", "fiesta"],
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
    estilos: ["rock", "pop"],
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
    salta: true,
    estilos: ["electronica", "pop"],
    ojos: "abiertos",
    desde: 0.45,
    hasta: 1,
    mover: (b, e) => {
      const f = b - Math.floor(b);
      const g = golpeDe(b);
      // El salto que cae en el primer tiempo es más alto
      const alto = Math.sin(f * Math.PI) * (3.5 + e * 2.5) * acentoDe(b + 1);
      return mov({ y: -alto, sy: 1 - g * 0.12 + (alto / 12) * 0.06, sx: 1 + g * 0.09, saltoCara: g * 1.5 });
    },
  },
  {
    // Paso a un lado en cada pulso, mirando hacia donde va
    nombre: "lateral",
    estilos: ["pop", "fiesta"],
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
    estilos: ["fiesta", "tranquila"],
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
    estilos: ["rock"],
    ojos: "apretados",
    desde: 0.65,
    hasta: 1,
    // Va a doble tiempo: con canciones más rápidas sería sacudir la cabeza sin parar
    ppm: [0, 130],
    mover: (b, e) => {
      const g = golpeDe(b * 2) * acentoDe(b);
      const s = Math.sin(b * Math.PI);
      return mov({ saltoCara: g * (3.5 + e * 2.5), y: g * 2, rot: s * 6, giroCara: s * 8, sy: 1 - g * 0.09, sx: 1 + g * 0.06 });
    },
  },
  {
    // Partes tranquilas: se mece despacio con los ojos cerrados
    nombre: "mecerse",
    estilos: ["balada", "tranquila"],
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
    estilos: ["balada"],
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
    estilos: ["balada", "tranquila"],
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
    estilos: ["rock", "electronica"],
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
    estilos: ["pop", "electronica"],
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
    salta: true,
    estilos: ["rock", "electronica"],
    ojos: "apretados",
    desde: 0.75,
    hasta: 1,
    ppm: [110, 999],
    mover: (b, e) => {
      const g = golpeDe(b);
      const alto = Math.sin(fraccion(b) * Math.PI) * (5.5 + e * 3.5) * acentoDe(b + 1);
      return mov({ y: -alto, sy: 1 + (alto / 18) * 0.1 - g * 0.15, sx: 1 - (alto / 18) * 0.05 + g * 0.1, saltoCara: g * 2 });
    },
  },
  {
    // A contratiempo: sacudidas cortas en cada medio pulso (con tempos no muy rápidos)
    nombre: "contratiempo",
    estilos: ["electronica", "fiesta"],
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
    estilos: ["fiesta", "pop"],
    ojos: "felices",
    desde: 0.6,
    hasta: 1,
    mover: (b, e) => {
      const g = golpeDe(b) * acentoDe(b);
      const vuelta = ((Math.floor(b) % 8) + 8) % 8 === 0 ? suave(Math.min(1, fraccion(b) * 1.3)) * 360 : 0;
      return mov({ giroCara: vuelta, y: g * (2 + e * 1.5) - Math.sin(Math.min(1, fraccion(b) * 1.3) * Math.PI) * (vuelta ? 5 : 0), sy: 1 - g * 0.08, sx: 1 + g * 0.05 });
    },
  },
  // ---------- Propios de un género ----------
  {
    // Rock: cabezazo fuerte en cada pulso, con todo el cuerpo
    nombre: "headbang",
    estilos: ["rock"],
    ojos: "apretados",
    desde: 0.4,
    hasta: 1,
    mover: (b, e) => {
      const g = golpeDe(b) * acentoDe(b);
      return mov({ saltoCara: g * (5 + e * 3), y: g * 3.5, sy: 1 - g * 0.12, sx: 1 + g * 0.07, rot: g * 4 });
    },
  },
  {
    // Rock: guitarra imaginaria, echado hacia atrás y rasgueando en cada medio pulso
    nombre: "guitarra",
    estilos: ["rock"],
    ojos: "cerrados",
    desde: 0.3,
    hasta: 1,
    // Rasguea en cada medio pulso: más rápido parecería que tiembla
    ppm: [0, 120],
    mover: (b, e) => {
      const s = Math.sin((b / 4) * Math.PI * 2);
      const g = golpeDe(b * 2);
      return mov({ rot: -8 + s * 4, x: -2 + s * 2, saltoCara: g * (1.5 + e), giroCara: -6 + s * 3, sy: 1 - g * 0.04 });
    },
  },
  {
    // Electrónica: bombea hacia abajo en cada golpe, como en la pista
    nombre: "bote",
    estilos: ["electronica"],
    ojos: "apretados",
    desde: 0.3,
    hasta: 1,
    mover: (b, e) => {
      const g = golpeDe(b);
      return mov({ y: g * (3 + e * 2) - 1.5, sy: 1 - g * 0.14, sx: 1 + g * 0.1, giroCara: ladoDe(b) * 4 * g, saltoCara: g * 2 });
    },
  },
  {
    // Electrónica: robot, salta de una postura a otra en seco en cada pulso
    nombre: "robot",
    estilos: ["electronica"],
    ojos: "abiertos",
    desde: 0.4,
    hasta: 1,
    mover: (b) => {
      const posturas: [number, number][] = [[-4, -8], [4, 8], [0, 0], [-3, 6]];
      const i = ((Math.floor(b) % 4) + 4) % 4;
      const [x0, r0] = posturas[(i + 3) % 4];
      const [x1, r1] = posturas[i];
      const k = suave(Math.min(1, fraccion(b) * 6));
      const x = x0 + (x1 - x0) * k;
      const rot = r0 + (r1 - r0) * k;
      return mov({ x, rot, giroCara: -rot * 0.8, miraX: Math.sign(x) * 2, sy: 1 - golpeDe(b) * 0.05 });
    },
  },
  {
    // Pop: mueve los hombros deprisa, con un rebote suave
    nombre: "hombros",
    estilos: ["pop"],
    ojos: "felices",
    desde: 0.3,
    hasta: 1,
    mover: (b, e) => {
      const s = Math.sin(b * Math.PI * 4);
      return mov({ rot: s * (4 + e * 2), sx: 1 + Math.abs(s) * 0.03, y: -Math.abs(Math.sin(b * Math.PI)) * 2, giroCara: -s * 3 });
    },
  },
  {
    // Balada: se abraza y se mece muy despacio
    nombre: "abrazo",
    estilos: ["balada"],
    ojos: "cerrados",
    desde: 0,
    hasta: 0.6,
    mover: (b) => {
      const s = Math.sin((b / 4) * Math.PI * 2);
      const k = (1 - Math.cos((b / 2) * Math.PI)) / 2;
      return mov({ rot: s * 7, x: s * 2.5, sx: 1 - k * 0.04, sy: 1 + k * 0.03, giroCara: s * 5, y: -k });
    },
  },
  {
    // Tranquila (jazz, acústica, chill): asiente en el segundo y el cuarto tiempo, como chasqueando
    nombre: "chasquido",
    estilos: ["tranquila"],
    ojos: "felices",
    desde: 0,
    hasta: 0.8,
    mover: (b) => {
      const contra = ((Math.floor(b) % 2) + 2) % 2 === 1 ? golpeDe(b) : 0;
      const s = Math.sin((b / 2) * Math.PI);
      return mov({ saltoCara: contra * 2.5, rot: s * 4, giroCara: s * 4 + contra * 3, x: s * 1.5 });
    },
  },
  {
    // Lento: balanceo amplio y muy despacio, con los ojos cerrados y la cara hacia arriba, como en
    // un recital con el encendedor en alto
    nombre: "encendedor",
    estilos: ["rock", "balada", "pop"],
    ojos: "cerrados",
    desde: 0,
    hasta: 0.6,
    mover: (b) => {
      const s = Math.sin((b / 4) * Math.PI);
      return mov({ rot: s * 11, x: s * 4, y: -(1 - Math.abs(s)) * 1.5, giroCara: s * 7, saltoCara: -1.5, miraX: s * 1.5 });
    },
  },
  {
    // Lento: cabeceo hondo una vez cada dos pulsos, sintiendo la canción
    nombre: "cabeceo lento",
    estilos: ["rock", "pop", "tranquila"],
    ojos: "cerrados",
    desde: 0,
    hasta: 0.6,
    mover: (b, e) => {
      const g = golpeDe(b / 2) * acentoDe(b);
      const s = Math.sin((b / 4) * Math.PI);
      return mov({ saltoCara: g * (4 + e * 1.5), y: g * 1.5, sy: 1 - g * 0.05, rot: s * 4, giroCara: s * 4 });
    },
  },
  {
    // Fiesta (latina, reguetón): mueve la cadera de lado a lado, girando al contrario
    nombre: "cadera",
    estilos: ["fiesta"],
    ojos: "felices",
    desde: 0.4,
    hasta: 1,
    mover: (b, e) => {
      const s = Math.sin(b * Math.PI);
      return mov({ x: s * (4 + e * 2), rot: -s * (7 + e * 3), y: -Math.abs(Math.cos(b * Math.PI * 2)) * 1.5, giroCara: s * 5, miraX: s * 2 });
    },
  },
];

/** En una pausa de la canción: casi quieto, esperando, mirando a un lado y a otro. */
const ESPERA: Paso = {
  nombre: "espera",
  estilos: [],
  ojos: "abiertos",
  desde: 0,
  hasta: 0,
  mover: (b) => {
    const s = Math.sin((b / 4) * Math.PI);
    return mov({ miraX: s * 3, giroCara: s * 3, saltoCara: golpeDe(b) * 0.8 });
  },
};

/** Al empezar una canción: la escucha un momento, atento, asintiendo un poco con cada pulso. */
const ESCUCHA: Paso = {
  nombre: "escucha",
  estilos: [],
  ojos: "abiertos",
  desde: 0,
  hasta: 0,
  mover: (b) => {
    const s = Math.sin((b / 4) * Math.PI);
    return mov({ saltoCara: golpeDe(b) * 1.4, giroCara: 4 + s * 2, miraX: 1.5 + s, rot: s * 1.5 });
  },
};
/** Compases que escucha una canción antes de soltarse a bailar. */
const COMPASES_ESCUCHA = 2;

/** Cuando vuelve la música tras una pausa: un compás de saltos grandes, de lado a lado. */
const CELEBRA: Paso = {
  nombre: "celebra",
  estilos: [],
  ojos: "apretados",
  desde: 1,
  hasta: 1,
  mover: (b, e) => {
    const f = b - Math.floor(b);
    const g = golpeDe(b);
    const alto = Math.sin(f * Math.PI) * (5.5 + e * 3.5);
    const lado = ladoDe(b);
    return mov({ y: -alto, rot: lado * 10 * Math.sin(f * Math.PI), sy: 1 - g * 0.14 + (alto / 16) * 0.08, sx: 1 + g * 0.1, saltoCara: g * 2, miraX: lado * 2 });
  },
};

let actual = PASOS[0];
let anterior: Paso | null = null;
let cambio = 0;
/** Si ya está bailando (si no, el primer paso se elige enseguida) y en qué pulso empezó el paso. */
let empezado = false;
let desdePulso = 0;
/** Hasta qué pulso escucha la canción antes de bailar. */
let escucharHasta = 0;

/** Lo que se oye ahora de cada instrumento (ritmo.ts) y cuánto bailar. */
export interface Oido {
  /** Si están sonando bombo, caja y platillos (0 a 1) */
  presencia: readonly [number, number, number];
  /** En una pausa, la subida antes del «drop» (0 a 1) */
  subida: number;
  /** Cuánto se mueve: por la configuración y por lo que hace el usuario (1, normal) */
  factor: number;
}

/** Empieza otra canción: la escuchará un momento antes de bailar. */
export function empezarCancion(): void {
  empezado = false;
  cambiarEnCompas = false;
}

/** Cada instrumento mueve su parte, con el movimiento del paso (al ritmo del pulso): con bombo,
 * el cuerpo rebota más; con caja, la cabeza asiente más. Si uno no está sonando (una parte solo
 * con guitarra no tiene bombo), su parte se mueve menos. */
function seguirInstrumentos(m: Movimiento, o: Oido): Movimiento {
  const cuerpo = 0.55 + 0.45 * o.presencia[0];
  const cabeza = 0.6 + 0.4 * o.presencia[1];
  return {
    ...m,
    y: m.y * cuerpo,
    sy: 1 + (m.sy - 1) * cuerpo,
    sx: 1 + (m.sx - 1) * cuerpo,
    saltoCara: m.saltoCara * cabeza,
  };
}

/** Subida antes del «drop»: se agacha y se contiene cada vez más, temblando un poco. */
function contenerse(m: Movimiento, subida: number, ahora: number): Movimiento {
  if (subida < 0.02) return m;
  return {
    ...m,
    y: m.y + subida * 3,
    sy: m.sy * (1 - subida * 0.09),
    sx: m.sx * (1 + subida * 0.05),
    x: m.x + Math.sin(ahora / 35) * subida * 0.7,
    saltoCara: m.saltoCara + subida * 1.5,
  };
}
let compas = -1;
const recientes: string[] = [];
/** Parte nueva: cambiar de paso al empezar el compás siguiente. */
let cambiarEnCompas = false;
/** Vuelve la música: celebrar en el siguiente fotograma, y hasta qué pulso. */
let celebrar = false;
let celebrarHasta = 0;
/** Cómo es la canción según Jev: tono y energía (escalas de 0 a 4) y mezcla de géneros (null si
 * duda), o null (se baila solo por intensidad y tempo). */
export interface CaracterBaile {
  /** 0 muy triste … 4 muy alegre */
  tono: number | null;
  /** 0 para escuchar quieto … 4 para saltar */
  energia: number | null;
  /** Peso de cada género (suman 1): normalmente uno solo; si Jev duda, varios */
  estilos: Partial<Record<Estilo, number>> | null;
}
let caracter: CaracterBaile | null = null;

/** Medio tiempo: con energía por debajo y un tempo medido por encima, se baila a la mitad. */
const ENERGIA_MEDIO_TIEMPO = 1.75;
const PPM_MEDIO_TIEMPO = 100;
/** Por debajo de este tono es triste: no salta ni celebra con saltos, aunque tenga energía. */
const TONO_TRISTE = 1.5;
/** Por debajo de esta energía no salta; por debajo de la de calma, solo pasos lentos. */
const ENERGIA_SALTA = 2.5;
const ENERGIA_CALMA = 1.5;
/** Con poca energía, solo los pasos de partes tranquilas (empiezan por debajo de esto); triste, sin
 * los de partes muy intensas. */
const DESDE_CALMA = 0.35;
const DESDE_TRISTE = 0.5;

const triste = () => caracter?.tono != null && caracter.tono < TONO_TRISTE;
const enCalma = () => caracter?.energia != null && caracter.energia < ENERGIA_CALMA;
/** Sin saltos: canción triste o sin energía para saltar. */
const sinSaltos = () => triste() || (caracter?.energia != null && caracter.energia < ENERGIA_SALTA);

/** Amplitud de los movimientos según el género (1 = como siempre). */
const AMPLITUD_ESTILO: Record<Estilo, number> = {
  rock: 1.35,
  electronica: 1.4,
  fiesta: 1.3,
  pop: 1.2,
  tranquila: 0.9,
  balada: 0.85,
};

/** Amplitud: la del género, por la energía (de ×0,75 sin energía a ×1,35 para saltar); si es
 * triste, contenida (como mucho ×1, aunque sea rock). */
function amplitudBaile(): number {
  if (!caracter) return 1;
  // La del género, o la media de los géneros de la mezcla
  let a = caracter.estilos
    ? Object.entries(caracter.estilos).reduce((s, [e, w]) => s + AMPLITUD_ESTILO[e as Estilo] * (w ?? 0), 0)
    : 1;
  if (caracter.energia != null) a *= 0.75 + 0.15 * caracter.energia;
  return triste() ? Math.min(1, a * 0.8) : a;
}

/** El género que más pesa (o null). */
function generoPrincipal(c: CaracterBaile | null): Estilo | null {
  const lista = Object.entries(c?.estilos ?? {}) as [Estilo, number][];
  return lista.length ? lista.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : null;
}

/** Cómo es la canción (Jev); null para volver a bailar solo por el ritmo. */
export function fijarCaracterBaile(c: CaracterBaile | null): void {
  const antes = generoPrincipal(caracter);
  caracter = c;
  // Solo si cambia el género, y al empezar el compás siguiente (no a mitad de un paso)
  if (c && generoPrincipal(c) !== antes) cambiarEnCompas = true;
}

/** Hasta dónde puede llegar el cuerpo (px) y cuánto puede estirarse: la ventana deja 24 px de
 * margen y encima van notas y extras (con más, al saltar se salía del marco). */
const MAX_SUBIDA = 9;
const MAX_LADO = 12;
const MAX_ESTIRON = 1.06;

/** Hasta dónde se mueve la cabeza dentro del cuerpo: el salto (px) y la inclinación (grados). Por
 * encima, con la música animada parecía agitarla demasiado. */
const MAX_SALTO_CARA = 3.5;
const MAX_GIRO_CARA = 10;
const limitar = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/** La cabeza, dentro de sus límites (algo más o menos según cuánto baila). El remolino gira la
 * cara entera a propósito: su giro no se toca. */
function contenerCabeza(m: Movimiento, vueltaEntera: boolean, factor = 1): Movimiento {
  const escala = Math.max(0.5, Math.min(1.3, factor));
  return {
    ...m,
    saltoCara: limitar(m.saltoCara, MAX_SALTO_CARA * escala),
    giroCara: vueltaEntera ? m.giroCara : limitar(m.giroCara, MAX_GIRO_CARA * escala),
  };
}

/** Más grandes o más pequeños los movimientos del cuerpo y la cabeza (no los giros enteros de la
 * cara), sin salirse de la ventana. */
function ampliar(m: Movimiento, a: number): Movimiento {
  // Los topes valen siempre, también con la amplitud normal
  return {
    ...m,
    x: Math.max(-MAX_LADO, Math.min(MAX_LADO, m.x * a)),
    y: Math.max(-MAX_SUBIDA, Math.min(MAX_LADO, m.y * a)),
    rot: m.rot * a,
    saltoCara: m.saltoCara * a,
    sx: 1 + (m.sx - 1) * a,
    sy: Math.min(MAX_ESTIRON, 1 + (m.sy - 1) * a),
  };
}

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
  // Sin saltos con canciones tristes o sin energía; con calma, solo pasos lentos; triste, sin los
  // de partes muy intensas
  const saltar = !sinSaltos();
  const desdeMax = enCalma() ? DESDE_CALMA : triste() ? DESDE_TRISTE : 1;
  const disponible = (p: Paso) =>
    (!p.ppm || (ppm >= p.ppm[0] && ppm <= p.ppm[1])) && (saltar || !p.salta) && p.desde <= desdeMax;
  // Con el género de Jev, solo los pasos de ese género (sin repetir los últimos mientras se pueda)
  // Si hay mezcla (Jev duda entre géneros), cada vez se sortea uno según su peso
  const estilo = caracter?.estilos ? sortearGenero(caracter.estilos) : null;
  if (estilo) {
    const genero = PASOS.filter((p) => p.estilos.includes(estilo) && disponible(p));
    if (genero.length >= 2) {
      const sinRepetir = genero.filter((p) => !recientes.slice(-Math.min(3, genero.length - 2)).includes(p.nombre));
      const opciones = sinRepetir.length ? sinRepetir : genero.filter((p) => p !== actual);
      return sortear(opciones, animado);
    }
  }
  const vale = (p: Paso) => animado >= p.desde - 0.05 && animado <= p.hasta + 0.05 && disponible(p);
  const encaja = PASOS.filter(vale);
  const nuevos = encaja.filter((p) => !recientes.includes(p.nombre));
  const opciones = nuevos.length ? nuevos : PASOS.filter((p) => p !== actual && disponible(p));
  return sortear(opciones.length ? opciones : PASOS.filter((p) => p !== actual), animado);
}

/** Un género de la mezcla, al azar según su peso. */
function sortearGenero(estilos: Partial<Record<Estilo, number>>): Estilo | null {
  const lista = Object.entries(estilos) as [Estilo, number][];
  let suerte = Math.random() * lista.reduce((a, [, w]) => a + w, 0);
  for (const [e, w] of lista) {
    suerte -= w;
    if (suerte <= 0) return e;
  }
  return lista.length ? lista[lista.length - 1][0] : null;
}

/** Sortea entre las opciones: más a menudo las que tienen el centro de su rango más cerca de lo animada que está la música. */
function sortear(opciones: Paso[], animado: number): Paso {
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

/** Lo animada que es la canción (0 a 1): mitad intensidad, mitad tempo (85 a 145 pulsos por
 * minuto); con la energía de Jev, sobre todo ella (una canción movida de tempo medio sí es animada). */
function animacion(intensidad: number, intervalo: number): number {
  const ppm = 60_000 / intervalo;
  const tempo = Math.max(0, Math.min(1, (ppm - 85) / 60));
  const local = intensidad * 0.5 + tempo * 0.5;
  if (caracter?.energia == null) return local;
  return Math.max(0, Math.min(1, local * 0.4 + (caracter.energia / 4) * 0.6));
}

/** Cómo baila ahora: movimiento del cuerpo y de la cara, y los ojos del paso. `intervalo`: ms
 * entre pulsos; `pausa`: la canción está en una pausa; `oido`: lo que suena de cada instrumento
 * (sin él, como al bailar solo sin música, no escucha antes ni sigue instrumentos). */
export function bailar(
  ahora: number,
  pulso: number,
  energia: number,
  intensidad: number,
  intervalo: number,
  pausa = false,
  oido?: Oido,
): { mov: Movimiento; ojos: OjosBaile } {
  // Medio tiempo: si Jev dice que la canción es calmada pero el ritmo medido es rápido (pasa a
  // menudo en directos y baladas con mucha percusión), se baila a la mitad
  if (caracter?.energia != null && caracter.energia < ENERGIA_MEDIO_TIEMPO && 60_000 / intervalo > PPM_MEDIO_TIEMPO) {
    pulso /= 2;
    intervalo *= 2;
  }
  const c = Math.floor(pulso / 4);
  const empiezaCompas = c !== compas;
  compas = c;
  // El pulso puede volver atrás (al pasar a medio tiempo): se cuenta desde ahí
  if (pulso < desdePulso) desdePulso = pulso;
  const compasesConElPaso = (pulso - desdePulso) / 4;
  const animado = animacion(intensidad, intervalo);
  // Cambia al empezar un compás: si la canción ha cambiado, o para variar tras un buen rato
  const paraVariar = animado < MUSICA_CALMADA ? COMPASES_CALMADA : COMPASES_ANIMADA;
  const toca =
    empiezaCompas &&
    ((cambiarEnCompas && compasesConElPaso >= COMPASES_ENTRE_PARTES) || compasesConElPaso >= paraVariar);
  if (pausa) {
    // En una pausa espera
    cambiarA(ESPERA, ahora);
  } else if (celebrar && sinSaltos()) {
    // Con una canción triste o tranquila, al volver la música no salta: cambia de paso
    celebrar = false;
    cambiarEnCompas = true;
  } else if (celebrar) {
    // Un compás entero celebrando
    celebrar = false;
    celebrarHasta = pulso + 4;
    cambiarA(CELEBRA, ahora);
  } else if (actual === CELEBRA && pulso < celebrarHasta) {
    // Sigue celebrando
  } else if (!empezado && oido) {
    // Empieza la canción: primero la escucha un par de compases
    cambiarA(ESCUCHA, ahora);
    empezado = true;
    escucharHasta = (c + COMPASES_ESCUCHA) * 4;
  } else if (actual === ESCUCHA && pulso < escucharHasta) {
    // Sigue escuchando
  } else if (!empezado || actual === ESCUCHA || actual === ESPERA || actual === CELEBRA || toca) {
    // Al empezar, al acabar una pausa o una celebración (después, un paso animado), y cuando toca
    cambiarA(elegir(actual === CELEBRA ? 1 : animado, 60_000 / intervalo), ahora);
    empezado = true;
    // Se cuenta desde el principio del compás (si no, el siguiente cambio llegaría un compás tarde)
    desdePulso = empiezaCompas ? c * 4 : pulso;
    cambiarEnCompas = false;
  }
  const e = Math.max(0, Math.min(1, energia));
  // En el estribillo (parte intensa) se mueve más; en las estrofas, algo menos
  const factor = oido?.factor ?? 1;
  const amplitud = amplitudBaile() * (0.85 + 0.3 * Math.max(0, Math.min(1, intensidad))) * factor;
  const mezclaMs = Math.max(MEZCLA_MIN_MS, Math.min(MEZCLA_MAX_MS, intervalo * 2));
  const k = anterior ? Math.min(1, (ahora - cambio) / mezclaMs) : 1;
  const vuelta = actual.nombre === "remolino" || (k < 1 && anterior?.nombre === "remolino");
  let m = k >= 1 || !anterior ? actual.mover(pulso, e) : mezclarMov(anterior.mover(pulso, e), actual.mover(pulso, e), suave(k));
  let ojos = k >= 1 || !anterior || k >= 0.5 ? actual.ojos : anterior.ojos;
  if (oido) {
    m = seguirInstrumentos(m, oido);
    // En la pausa, si la música va creciendo, se contiene; justo antes del «drop», ojos apretados
    if (actual === ESPERA) {
      m = contenerse(m, oido.subida, ahora);
      if (oido.subida > 0.5) ojos = "apretados";
    }
  }
  return { mov: contenerCabeza(ampliar(m, amplitud), vuelta, factor), ojos };
}

/** Nombre del paso que está bailando (para verlo en el panel). */
export function pasoActual(): string {
  return actual.nombre;
}

/** Sin música, deja de bailar (la próxima vez empieza con un paso nuevo). */
export function pararBaile(): void {
  empezado = false;
  anterior = null;
  cambiarEnCompas = false;
  celebrar = false;
  if (!PASOS.includes(actual)) actual = PASOS[0];
}

export const SIN_BAILE = QUIETO;
