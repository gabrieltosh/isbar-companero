// Carácter de la canción con Jev: su tono (de muy triste a muy alegre) y su energía (de quieta a
// saltar), en dos escalas de 0 a 4, y el género de baile (rock, balada, electrónica…). Se
// pregunta a los pocos segundos de empezar cada canción (cuando ya se sabe el tempo y la
// intensidad) y otra vez en las partes nuevas, como mucho cada CADA_MS. El género decide qué pasos
// se sortean; la energía, cuánto se mueve y si salta; el tono triste frena los saltos (baile.ts) y
// pone la cara (cara.ts). Las escalas se usan siempre (si Jev duda, quedan en medio y no exageran);
// el género, solo si está bastante seguro. Sin Jev se baila como siempre.
// Solo sale del PC el título, el artista y los números del ritmo (nunca el audio).
import { listen } from "@tauri-apps/api/event";
import { EVENTO_AJUSTES, JEV_POR_DEFECTO, type ConfigJev } from "../ajustes";
import { caracterCancion, jevDisponible, type Caracter, type Estilo } from "../estado/jev";
import { cambiosMusica, infoMusica } from "../estado/musica";
import { leer } from "../store";
import { fijarCaracterBaile } from "./baile";
import { hayAudio, parteNueva, ritmo } from "./ritmo";

/** Lo que se espera tras empezar una canción para conocer su tempo e intensidad. */
const ESPERA_INICIO_MS = 6000;
/** Como mucho una pregunta cada tanto (las partes nuevas pueden llegar seguidas). */
const CADA_MS = 30_000;
/** Con menos confianza, el género no se usa (probado con canciones reales: las respuestas
 * equivocadas venían con menos del 30 % y las buenas, casi siempre con más del 45 %). */
const CONFIANZA_ESTILO = 0.45;

/** Lo que se usa de Jev: tono y energía siempre; el género, solo si está bastante seguro. */
export interface CaracterUsable {
  tono: number;
  energia: number;
  estilo: Estilo | null;
  confianzaTono: number;
  confianzaEnergia: number;
  confianzaEstilo: number;
}

function usable(c: Caracter): CaracterUsable {
  return { ...c, estilo: c.confianzaEstilo >= CONFIANZA_ESTILO ? c.estilo : null };
}

let config: ConfigJev = JEV_POR_DEFECTO;
let actual: (Caracter & { cancion: string }) | null = null;
let ultimaPregunta = 0;
let tInicio = 0;
/** Canción por la que se pregunta (para descartar respuestas que llegan tarde). */
let cancion = "";

const claveDe = (titulo: string, artista: string) => `${titulo}·${artista}`;

/** Lo que Jev sabe con confianza de la canción que suena, o null. */
export function caracterActual(): CaracterUsable | null {
  if (!actual || actual.cancion !== cancion) return null;
  return usable(actual);
}

async function preguntar(): Promise<void> {
  const info = infoMusica();
  if (!info || !jevDisponible(config) || !config.baile) return;
  const pedida = claveDe(info.titulo, info.artista);
  ultimaPregunta = performance.now();
  try {
    const c = await caracterCancion(config.clave, {
      titulo: info.titulo,
      artista: info.artista,
      ppm: hayAudio() ? Math.round(60_000 / ritmo.intervalo) : null,
      intensidad: hayAudio() ? ritmo.intensidad : null,
    });
    // Si mientras tanto cambió la canción, la respuesta ya no vale
    if (pedida !== cancion) return;
    actual = { ...c, cancion: pedida };
    console.info(`jev: «${info.titulo}» → tono ${c.tono.toFixed(1)}, energía ${c.energia.toFixed(1)}, ${c.estilo} (${Math.round(c.confianzaEstilo * 100)} %)`);
    const u = usable(c);
    fijarCaracterBaile({ tono: u.tono, energia: u.energia, estilo: u.estilo });
  } catch (e) {
    console.warn("jev: sin carácter para la canción:", e);
  }
}

async function cargarConfig(): Promise<void> {
  config = { ...JEV_POR_DEFECTO, ...(await leer<Partial<ConfigJev>>("jevConfig", {})) };
  // Al apagarlo, se vuelve a bailar como siempre
  if (!jevDisponible(config) || !config.baile) {
    actual = null;
    fijarCaracterBaile(null);
  }
}

export function iniciarCaracter(): void {
  void cargarConfig();
  listen(EVENTO_AJUSTES, () => void cargarConfig()).catch(console.error);

  // Canción nueva (también la que ya sonaba al arrancar): se olvida lo anterior y se pregunta en
  // cuanto se conoce su ritmo
  const revisarCancion = () => {
    const info = infoMusica();
    const clave = info ? claveDe(info.titulo, info.artista) : "";
    if (clave === cancion) return;
    cancion = clave;
    actual = null;
    fijarCaracterBaile(null);
    window.clearTimeout(tInicio);
    if (clave) tInicio = window.setTimeout(() => void preguntar(), ESPERA_INICIO_MS);
  };
  cambiosMusica.escuchar(revisarCancion);
  revisarCancion();

  // Parte nueva (estribillo, puente…): se vuelve a preguntar, sin pasarse
  parteNueva.escuchar(() => {
    if (performance.now() - ultimaPregunta > CADA_MS) void preguntar();
  });
}
