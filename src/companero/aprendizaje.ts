// Lo que aprende de cada canción al oírla, para bailarla mejor la siguiente vez (y algo mejor
// cada vez que suena): su tempo, el mapa de sus partes (dónde cambia y dónde vuelve la música tras
// una pausa, el «drop») y su curva de energía (lo movido de cada tramo de 2 s). No se guarda el
// audio, solo unas cifras: menos de 1 KB por canción, en su propio archivo (canciones.json), como
// mucho MAX_CANCIONES (se olvidan las que hace más que no suenan).
//
// Cuando vuelve a sonar:
// - Le da su tempo al análisis (ritmo.rs) al empezar: va en fase desde el primer segundo.
// - Se adelanta a las partes que conoce: cambia de paso justo cuando empiezan, se va conteniendo
//   antes del «drop» y lo celebra en su momento (sin repetirlo cuando el análisis lo oye).
// - Elige los pasos con la energía del tramo que viene, no con la del que acaba de pasar.
// El mapa va por la posición de la canción: solo se usa si el reproductor la da y es la misma
// versión (la misma duración); si saltas a otro momento, se recoloca solo.
import { invoke } from "@tauri-apps/api/core";
import { cambioCancion, infoMusica, posicionMusica, type InfoMedia } from "../estado/musica";
import { guardar, leer } from "../store";
import { nuevaParte } from "./baile";
import { fijarPrevistas, hayAudio, ritmo, seccionOida, volvioLaMusica } from "./ritmo";

const ARCHIVO = "canciones.json";
const CLAVE = "aprendido";
const MAX_CANCIONES = 400;
/** Cada cuánto se apunta lo que suena (ms), y de cuánto es cada tramo de la curva. */
const MIRAR_MS = 250;
const TRAMO_MS = 2000;
/** Misma versión si la duración difiere menos que esto (un directo dura otra cosa). */
const MISMA_VERSION_MS = 3000;
/** Para aprender de una escucha hay que haber oído al menos esta parte de la canción. */
const PARTE_OIDA = 0.3;
/** En pausa más de esto, se da la escucha por terminada (y se aprende de ella). */
const PAUSA_LARGA_MS = 60_000;
/** Lo que tarda el análisis en notar una parte nueva o la vuelta de la música: las marcas se
 * guardan con este adelanto, para que caigan donde empiezan de verdad. */
const RETRASO_CAMBIO_MS = 1000;
const RETRASO_VUELTA_MS = 300;
/** Dos marcas de escuchas distintas son la misma si están así de cerca. */
const JUNTAR_MS = 2500;
/** Lo que más pesa una escucha nueva (1/5): así va afinando sin olvidar lo anterior. */
const PESO_MAX = 5;
/** Tempos que se recuerdan (la mediana de cada escucha); se baila con la mediana de todos. */
const TEMPOS = 5;
/** Ritmo así de claro para apuntar el tempo. */
const CONFIANZA_TEMPO = 0.6;
/** Antes de un «drop» conocido se va conteniendo durante este tiempo. */
const ANTES_DEL_DROP_MS = 4000;
/** Tras adelantarse a una parte, durante este tiempo no se repite si el análisis la oye. */
const PREVISTA_MS = 3000;
/** La energía del tramo que viene: lo que suena en los próximos ms. */
const VER_VENIR_MS = 6000;

type Tipo = "cambio" | "vuelta";
interface Marca {
  /** Posición en la canción (ms) */
  t: number;
  tipo: Tipo;
  /** En cuántas escuchas apareció */
  veces: number;
}

interface Aprendido {
  /** Duración de la canción (ms): para saber si es la misma versión */
  duracion: number;
  escuchas: number;
  /** Última vez que sonó (Date.now()) */
  visto: number;
  /** Tempo de cada escucha (ms entre pulsos) */
  tempos: number[];
  /** Por tramo de 2 s: lo intensa que es (0 a 100) y si suena el bombo (0 a 100); -1, sin oír */
  energia: number[];
  bombo: number[];
  marcas: Marca[];
}

/** Lo que se va oyendo de la canción que suena. */
interface Escucha {
  clave: string;
  duracion: number;
  /** Sumas por tramo y cuántas veces se miró cada uno */
  energia: number[];
  bombo: number[];
  muestras: number[];
  marcas: { t: number; tipo: Tipo }[];
  tempos: number[];
}

let memoria: Record<string, Aprendido> = {};
let escucha: Escucha | null = null;
/** Lo que se sabe de la canción que suena (null si es la primera vez o es otra versión). */
let conocida: Aprendido | null = null;
/** Marcas a las que ya se adelantó en esta pasada (por su índice). */
let hechas = new Set<number>();
let ultimaPosicion = 0;
let pausadaDesde = 0;
/** Cuándo se adelantó por última vez a cada tipo de parte. */
const previstaEn: Record<Tipo, number> = { cambio: -Infinity, vuelta: -Infinity };
let subidaPrevista = 0;
/** Última vez que la canción estaba en una pausa (el «drop» llega justo al acabar una). */
let enPausaHasta = -Infinity;
/** El «drop» se celebra si hubo pausa hace menos de esto. */
const PAUSA_RECIENTE_MS = 1500;

const claveDe = (i: Readonly<InfoMedia>) => `${i.titulo}·${i.artista}`;
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const tramosDe = (duracion: number) => Math.ceil(duracion / TRAMO_MS);

function nuevaEscucha(info: Readonly<InfoMedia>): Escucha | null {
  if (info.duracionMs <= 0) return null;
  const tramos = tramosDe(info.duracionMs);
  return {
    clave: claveDe(info),
    duracion: info.duracionMs,
    energia: Array<number>(tramos).fill(0),
    bombo: Array<number>(tramos).fill(0),
    muestras: Array<number>(tramos).fill(0),
    marcas: [],
    tempos: [],
  };
}

function vacio(duracion: number): Aprendido {
  const tramos = tramosDe(duracion);
  return { duracion, escuchas: 0, visto: 0, tempos: [], energia: Array(tramos).fill(-1), bombo: Array(tramos).fill(-1), marcas: [] };
}

function guardarMemoria(): void {
  const claves = Object.keys(memoria);
  if (claves.length > MAX_CANCIONES) {
    claves.sort((a, b) => memoria[a].visto - memoria[b].visto);
    for (const k of claves.slice(0, claves.length - MAX_CANCIONES)) delete memoria[k];
  }
  void guardar(CLAVE, memoria, ARCHIVO);
}

/** Junta lo oído en esta escucha con lo que ya se sabía de la canción. */
function aprender(): void {
  const e = escucha;
  escucha = null;
  if (!e) return;
  const tramos = tramosDe(e.duracion);
  if (e.muestras.filter((m) => m > 0).length < tramos * PARTE_OIDA) return;
  let r = memoria[e.clave];
  // Otra versión con el mismo nombre (otra duración): se empieza de nuevo
  if (!r || Math.abs(r.duracion - e.duracion) > MISMA_VERSION_MS) r = memoria[e.clave] = vacio(e.duracion);
  r.escuchas += 1;
  r.visto = Date.now();
  // Cada escucha pesa menos que la anterior, hasta 1/PESO_MAX: afina sin olvidar
  const peso = Math.min(r.escuchas, PESO_MAX);
  const media = (viejo: number, nuevo: number) => (viejo < 0 ? nuevo : Math.round(viejo + (nuevo - viejo) / peso));
  for (let i = 0; i < tramos; i++) {
    if (!e.muestras[i]) continue;
    r.energia[i] = media(r.energia[i] ?? -1, Math.round(e.energia[i] / e.muestras[i]));
    r.bombo[i] = media(r.bombo[i] ?? -1, Math.round(e.bombo[i] / e.muestras[i]));
  }
  if (e.tempos.length >= 20) {
    r.tempos.push(Math.round(mediana(e.tempos) * 10) / 10);
    if (r.tempos.length > TEMPOS) r.tempos.shift();
  }
  for (const m of e.marcas) {
    const igual = r.marcas.find((x) => x.tipo === m.tipo && Math.abs(x.t - m.t) < JUNTAR_MS);
    if (igual) {
      igual.t = Math.round(igual.t + (m.t - igual.t) / (igual.veces + 1));
      igual.veces += 1;
    } else {
      r.marcas.push({ ...m, veces: 1 });
    }
  }
  // Con varias escuchas, se olvidan las marcas que no salen ni una de cada tres veces (ruido)
  if (r.escuchas >= 3) r.marcas = r.marcas.filter((m) => m.veces / r.escuchas >= 0.34);
  r.marcas.sort((a, b) => a.t - b.t);
  guardarMemoria();
  console.info(`aprendizaje: «${e.clave}» → ${r.escuchas} escuchas, ${r.marcas.length} partes, tempo ${r.tempos.length ? mediana(r.tempos) : "?"} ms`);
}

/** Empieza otra canción: se aprende de la anterior y, si esta se conoce, se prepara. */
function alCambiarDeCancion(info: Readonly<InfoMedia>): void {
  aprender();
  escucha = nuevaEscucha(info);
  hechas = new Set();
  ultimaPosicion = 0;
  pausadaDesde = 0;
  subidaPrevista = 0;
  const r = memoria[claveDe(info)];
  const misma = r && info.duracionMs > 0 && Math.abs(r.duracion - info.duracionMs) <= MISMA_VERSION_MS;
  conocida = misma && r.escuchas > 0 ? r : null;
  // Su tempo, al análisis: va en fase desde el primer segundo
  if (conocida?.tempos.length) invoke("sembrar_tempo", { intervaloMs: mediana(conocida.tempos) }).catch(console.error);
}

/** Se adelanta a las partes que conoce: cambio de paso al empezar una parte, contenerse antes del
 * «drop» y celebrarlo en su momento. */
function adelantarse(pos: number): void {
  subidaPrevista = 0;
  if (!conocida) return;
  // Una parte nueva se nota al empezar el compás siguiente: se avisa algo más de un pulso antes
  const antesDelCambio = ritmo.intervalo * 1.2;
  conocida.marcas.forEach((m, i) => {
    const falta = m.t - pos;
    if (m.tipo === "cambio" && !hechas.has(i) && falta > 0 && falta <= antesDelCambio) {
      hechas.add(i);
      previstaEn.cambio = performance.now();
      nuevaParte();
    }
    if (m.tipo !== "vuelta" || falta <= 0) return;
    // En la pausa, cada vez más contenido hasta el «drop»
    if (falta <= ANTES_DEL_DROP_MS && ritmo.pausa) subidaPrevista = Math.max(subidaPrevista, 1 - falta / ANTES_DEL_DROP_MS);
    // Y lo celebra justo a tiempo (si venía de una pausa: si no, el mapa no encaja)
    if (!hechas.has(i) && falta <= MIRAR_MS * 1.5) {
      hechas.add(i);
      const clave = escucha?.clave;
      window.setTimeout(() => {
        const veniaDeUnaPausa = ritmo.pausa || performance.now() - enPausaHasta < PAUSA_RECIENTE_MS;
        if (escucha?.clave !== clave || !veniaDeUnaPausa) return;
        previstaEn.vuelta = performance.now();
        volvioLaMusica();
      }, falta);
    }
  });
}

/** Cada poco: se apunta lo que suena y se adelanta a lo que conoce. */
function mirar(): void {
  const info = infoMusica();
  if (!info || !escucha || claveDe(info) !== escucha.clave) return;
  const pos = posicionMusica();
  // Saltó hacia atrás (o vuelve a empezar): se puede adelantar otra vez a las partes que vienen
  if (pos < ultimaPosicion - 1500 && conocida) {
    hechas = new Set([...hechas].filter((i) => conocida!.marcas[i].t < pos));
  }
  ultimaPosicion = pos;
  if (!info.reproduciendo) {
    // Mucho rato en pausa: la escucha ha terminado
    pausadaDesde ||= performance.now();
    if (performance.now() - pausadaDesde > PAUSA_LARGA_MS) {
      aprender();
      escucha = nuevaEscucha(info);
      pausadaDesde = 0;
    }
    subidaPrevista = 0;
    return;
  }
  pausadaDesde = 0;
  if (!hayAudio()) return;
  if (ritmo.pausa) enPausaHasta = performance.now();
  const i = Math.floor(pos / TRAMO_MS);
  if (i >= 0 && i < escucha.muestras.length) {
    escucha.energia[i] += ritmo.intensidad * 100;
    escucha.bombo[i] += ritmo.presencia[0] * 100;
    escucha.muestras[i] += 1;
  }
  if (ritmo.confianza >= CONFIANZA_TEMPO && escucha.tempos.length < 2000) escucha.tempos.push(ritmo.intervalo);
  adelantarse(pos);
}

/** Lo que se sabe de la canción que suena, para el panel (null: es la primera vez que la oye). */
export function conocimientoCancion(): { escuchas: number; partes: number } | null {
  return conocida ? { escuchas: conocida.escuchas, partes: conocida.marcas.length } : null;
}

/** Subida antes de un «drop» conocido (0 a 1), para contenerse aunque el análisis aún no la note. */
export function subidaConocida(): number {
  return subidaPrevista;
}

/** Lo intensa que es la canción en los próximos segundos (0 a 1), si se conoce; si no, null. */
export function intensidadQueViene(): number | null {
  const info = infoMusica();
  if (!conocida || !info?.reproduciendo) return null;
  const pos = posicionMusica();
  let suma = 0;
  let n = 0;
  for (let i = Math.floor(pos / TRAMO_MS); i <= Math.floor((pos + VER_VENIR_MS) / TRAMO_MS); i++) {
    const v = conocida.energia[i];
    if (v !== undefined && v >= 0) {
      suma += v;
      n += 1;
    }
  }
  return n ? suma / n / 100 : null;
}

export async function iniciarAprendizaje(): Promise<void> {
  memoria = await leer<Record<string, Aprendido>>(CLAVE, {}, ARCHIVO);
  // Las partes que oye el análisis se apuntan donde empiezan de verdad (un poco antes)
  seccionOida.escuchar((tipo) => {
    const info = infoMusica();
    if (!escucha || !info || claveDe(info) !== escucha.clave) return;
    const t = posicionMusica() - (tipo === "cambio" ? RETRASO_CAMBIO_MS : RETRASO_VUELTA_MS);
    if (t > 0) escucha.marcas.push({ t: Math.round(t), tipo });
  });
  // Lo que ya se adelantó no se repite cuando el análisis lo oye
  fijarPrevistas((tipo) => performance.now() - previstaEn[tipo] < PREVISTA_MS);
  cambioCancion.escuchar(alCambiarDeCancion);
  const info = infoMusica();
  if (info) alCambiarDeCancion(info);
  window.setInterval(mirar, MIRAR_MS);
}
