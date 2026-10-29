// Carácter de la canción con Jev: su tono (de muy triste a muy alegre) y su energía (de quieta a
// saltar), en dos escalas de 0 a 4, y el género de baile (rock, balada, electrónica…).
// - El tono y la energía no cambian de una parte a otra: se preguntan una vez por canción, a los
//   pocos segundos de empezar. El género se vuelve a preguntar en las partes nuevas (como mucho
//   cada CADA_MS), con su tempo e intensidad.
// - Lo que se sabe de cada canción se recuerda (en el store): al volver a oírla baila con su
//   estilo desde el primer segundo, sin preguntar el tono ni la energía otra vez.
// - Desde el panel se puede corregir (más triste, más movida, otro género): la corrección se
//   recuerda y Jev ya no la cambia.
// - Si Jev duda entre géneros (55 % rock, 40 % balada), se mezclan sus pasos en esa proporción.
// El género decide qué pasos se sortean; la energía, cuánto se mueve y si salta; el tono triste
// frena los saltos (baile.ts) y pone la cara (cara.ts). Sin Jev se baila como siempre.
// Solo sale del PC el título, el artista, el álbum, los géneros y los números del ritmo (nunca
// el audio).
import { listen } from "@tauri-apps/api/event";
import { EVENTO_AJUSTES, JEV_POR_DEFECTO, type ConfigJev } from "../ajustes";
import { emocionCancion, estiloCancion, jevDisponible, type DatosCancion, type Emocion, type Estilo, type EstiloBaile } from "../estado/jev";
import { cambiosMusica, infoMusica } from "../estado/musica";
import { guardar, leer } from "../store";
import { fijarCaracterBaile } from "./baile";
import { hayAudio, parteNueva, ritmo } from "./ritmo";

/** Lo que se espera tras empezar una canción para conocer su tempo e intensidad. */
const ESPERA_INICIO_MS = 6000;
/** Como mucho una pregunta del género cada tanto (las partes nuevas pueden llegar seguidas). */
const CADA_MS = 30_000;
/** Con menos confianza, el género más probable no se usa solo (probado con canciones reales: las
 * respuestas equivocadas venían con menos del 30 % y las buenas, casi siempre con más del 45 %). */
const CONFIANZA_ESTILO = 0.45;
/** Géneros que entran en la mezcla (probabilidad mínima) cuando Jev duda entre varios. */
const PROBABILIDAD_MEZCLA = 0.2;
/** Canciones que se recuerdan como mucho (se olvidan las que hace más que no suenan). */
const MAX_RECORDADAS = 400;
const CLAVE_MEMORIA = "caracterCanciones";

/** Lo que se recuerda de una canción. */
interface Recuerdo extends Partial<Emocion>, Partial<EstiloBaile> {
  /** Lo que se corrigió a mano: Jev ya no lo cambia */
  corregido?: { tono?: boolean; energia?: boolean; estilo?: boolean };
  /** Última vez que sonó (Date.now()) */
  visto: number;
}

/** Lo que se usa de Jev para la canción que suena. */
export interface CaracterUsable {
  tono: number | null;
  energia: number | null;
  /** Género más probable (si Jev está bastante seguro o se corrigió), o null */
  estilo: Estilo | null;
  confianzaEstilo: number;
  /** Mezcla de géneros (suman 1), o null */
  estilos: Partial<Record<Estilo, number>> | null;
  /** Qué se corrigió a mano */
  corregido: { tono?: boolean; energia?: boolean; estilo?: boolean };
}

let config: ConfigJev = JEV_POR_DEFECTO;
let memoria: Record<string, Recuerdo> = {};
let ultimaPregunta = 0;
let tInicio = 0;
/** Canción que suena (clave), para descartar respuestas que llegan tarde. */
let cancion = "";

const claveDe = (titulo: string, artista: string) => `${titulo}·${artista}`;

/** La mezcla de géneros: los que tienen probabilidad suficiente, repartidos para sumar 1. */
function mezcla(r: Recuerdo): Partial<Record<Estilo, number>> | null {
  if (!r.estilo) return null;
  if (r.corregido?.estilo) return { [r.estilo]: 1 };
  const candidatos = Object.entries(r.probabilidades ?? {}).filter(([, p]) => (p ?? 0) >= PROBABILIDAD_MEZCLA) as [Estilo, number][];
  // Si ni el más probable llega a la confianza mínima ni hay otro claro, no se usa
  if ((r.confianzaEstilo ?? 0) < CONFIANZA_ESTILO && candidatos.length === 0) return null;
  if (candidatos.length === 0) return { [r.estilo]: 1 };
  const total = candidatos.reduce((a, [, p]) => a + p, 0);
  return Object.fromEntries(candidatos.map(([e, p]) => [e, p / total]));
}

function usable(r: Recuerdo): CaracterUsable | null {
  if (r.tono === undefined && !r.estilo) return null;
  const estilos = mezcla(r);
  return {
    tono: r.tono ?? null,
    energia: r.energia ?? null,
    estilo: estilos ? (r.estilo ?? null) : null,
    confianzaEstilo: r.corregido?.estilo ? 1 : (r.confianzaEstilo ?? 0),
    estilos,
    corregido: r.corregido ?? {},
  };
}

/** Lo que se sabe de la canción que suena, o null. */
export function caracterActual(): CaracterUsable | null {
  if (!jevDisponible(config) || !config.baile) return null;
  const r = cancion ? memoria[cancion] : undefined;
  return r ? usable(r) : null;
}

/** Aplica al baile lo que se sabe de la canción que suena (o nada). */
function aplicar(): void {
  const u = caracterActual();
  fijarCaracterBaile(u ? { tono: u.tono, energia: u.energia, estilos: u.estilos } : null);
}

/** Guarda la memoria, olvidando las canciones que hace más que no suenan si hay demasiadas. */
function recordar(): void {
  const claves = Object.keys(memoria);
  if (claves.length > MAX_RECORDADAS) {
    claves.sort((a, b) => memoria[a].visto - memoria[b].visto);
    for (const k of claves.slice(0, claves.length - MAX_RECORDADAS)) delete memoria[k];
  }
  void guardar(CLAVE_MEMORIA, memoria);
}

function datosAhora(): DatosCancion | null {
  const info = infoMusica();
  if (!info) return null;
  return {
    titulo: info.titulo,
    artista: info.artista,
    album: info.album,
    generos: info.generos,
    ppm: hayAudio() ? Math.round(60_000 / ritmo.intervalo) : null,
    intensidad: hayAudio() ? ritmo.intensidad : null,
  };
}

/** Pregunta lo que falte: el tono y la energía si no se saben, y el género (si no se corrigió). */
async function preguntar(estiloSolo = false): Promise<void> {
  const datos = datosAhora();
  if (!datos || !cancion || !jevDisponible(config) || !config.baile) return;
  const pedida = cancion;
  const r = (memoria[pedida] ??= { visto: Date.now() });
  const faltaEmocion = !estiloSolo && r.tono === undefined;
  // Al empezar, el género solo si no se sabe; en una parte nueva, otra vez (con su ritmo)
  const pideEstilo = !r.corregido?.estilo && (estiloSolo || r.estilo === undefined);
  if (!faltaEmocion && !pideEstilo) return;
  ultimaPregunta = performance.now();
  try {
    const [emocion, estilo] = await Promise.all([
      faltaEmocion ? emocionCancion(config.clave, datos) : null,
      pideEstilo ? estiloCancion(config.clave, datos) : null,
    ]);
    // Lo corregido a mano no se toca
    if (emocion) {
      if (!r.corregido?.tono) Object.assign(r, { tono: emocion.tono, confianzaTono: emocion.confianzaTono });
      if (!r.corregido?.energia) Object.assign(r, { energia: emocion.energia, confianzaEnergia: emocion.confianzaEnergia });
    }
    if (estilo) Object.assign(r, estilo);
    recordar();
    console.info(`jev: «${datos.titulo}» → tono ${r.tono?.toFixed(1)}, energía ${r.energia?.toFixed(1)}, ${r.estilo} (${Math.round((r.confianzaEstilo ?? 0) * 100)} %)`);
    // Si mientras tanto cambió la canción, queda recordado, pero no se baila con ello
    if (pedida === cancion) aplicar();
  } catch (e) {
    console.warn("jev: sin carácter para la canción:", e);
  }
}

/** Corrección a mano desde el panel (más triste, más movida, otro género): se recuerda. */
export function corregirCaracter(cambios: { tono?: number; energia?: number; estilo?: Estilo }): void {
  if (!cancion) return;
  const r = (memoria[cancion] ??= { visto: Date.now() });
  r.corregido = { ...r.corregido };
  const escala = (v: number) => Math.max(0, Math.min(4, v));
  if (cambios.tono !== undefined) {
    r.tono = escala(cambios.tono);
    r.corregido.tono = true;
  }
  if (cambios.energia !== undefined) {
    r.energia = escala(cambios.energia);
    r.corregido.energia = true;
  }
  if (cambios.estilo) {
    r.estilo = cambios.estilo;
    r.confianzaEstilo = 1;
    r.probabilidades = { [cambios.estilo]: 1 };
    r.corregido.estilo = true;
  }
  recordar();
  aplicar();
}

async function cargarConfig(): Promise<void> {
  config = { ...JEV_POR_DEFECTO, ...(await leer<Partial<ConfigJev>>("jevConfig", {})) };
  // Al apagarlo, se vuelve a bailar como siempre
  aplicar();
}

export async function iniciarCaracter(): Promise<void> {
  memoria = await leer<Record<string, Recuerdo>>(CLAVE_MEMORIA, {});
  await cargarConfig();
  listen(EVENTO_AJUSTES, () => void cargarConfig()).catch(console.error);

  // Canción nueva (también la que ya sonaba al arrancar): si ya se conoce, baila con su estilo
  // desde el principio; si no, se pregunta en cuanto se conoce su ritmo
  const revisarCancion = () => {
    const info = infoMusica();
    const clave = info ? claveDe(info.titulo, info.artista) : "";
    if (clave === cancion) return;
    cancion = clave;
    window.clearTimeout(tInicio);
    const conocida = clave ? memoria[clave] : undefined;
    if (conocida) conocida.visto = Date.now();
    aplicar();
    if (clave) tInicio = window.setTimeout(() => void preguntar(), ESPERA_INICIO_MS);
  };
  cambiosMusica.escuchar(revisarCancion);
  revisarCancion();

  // Parte nueva (estribillo, puente…): solo el género, sin pasarse
  parteNueva.escuchar(() => {
    if (performance.now() - ultimaPregunta > CADA_MS) void preguntar(true);
  });
}
