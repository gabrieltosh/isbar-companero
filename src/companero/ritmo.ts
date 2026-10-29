// Ritmo de la música a partir del nivel de sonido (audio.rs): cuánto suena ahora (energía),
// cuánto suena de media (intensidad de la parte de la canción) y los golpes (cuando el
// sonido sube de golpe por encima de la media: bombo, acentos). Así el compañero baila
// con la canción y no con un ciclo fijo.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cambiosMusica, musicaSonando } from "../estado/musica";
import { crearSenal } from "../estado/senal";

/** Un golpe: el nivel supera la media en este factor (y un mínimo), y no antes de este tiempo. */
const FACTOR_GOLPE = 1.3;
const MINIMO_GOLPE = 0.06;
const SEPARACION_GOLPES = 220;
/** Sin niveles nuevos en este tiempo, se considera que no hay audio. */
const SIN_AUDIO_MS = 500;
/** Notitas a la vez, como mucho, y lo que tarda cada una en subir y desvanecerse. */
const MAX_NOTAS = 4;
export const VIDA_NOTA = 1600;

export interface Nota {
  nace: number;
  /** -1 sale por la izquierda, 1 por la derecha */
  lado: number;
}

export const ritmo = {
  /** Nivel suavizado (sube rápido, baja despacio), de 0 a 1 */
  energia: 0,
  /** Media del último segundo: con ella se detectan los golpes */
  media: 0,
  /** Media de varios segundos: si la parte de la canción es tranquila o intensa */
  intensidad: 0,
  /** 1 justo en un golpe; baja a 0 enseguida */
  latido: 0,
  /** Lado hacia el que se balancea (cambia en cada golpe) */
  lado: 1,
  notas: [] as Nota[],
};

/** Hubo un golpe en la música. */
export const golpe = crearSenal();

let ultimoNivel = 0;
let ultimoGolpe = 0;
let anterior = 0;
let golpes = 0;

/** Hay audio sonando (llegan niveles y no es silencio). */
export function hayAudio(): boolean {
  return performance.now() - ultimoNivel < SIN_AUDIO_MS && ritmo.media > 0.02;
}

function procesar(nivel: number): void {
  const ahora = performance.now();
  ultimoNivel = ahora;
  // Sube rápido y baja despacio, como un vúmetro
  ritmo.energia += (nivel - ritmo.energia) * (nivel > ritmo.energia ? 0.6 : 0.15);
  ritmo.media += (nivel - ritmo.media) * 0.04;
  ritmo.intensidad += (nivel - ritmo.intensidad) * 0.01;

  const sube = nivel - anterior > 0.03;
  anterior = nivel;
  if (
    sube &&
    nivel > ritmo.media * FACTOR_GOLPE + 0.02 &&
    nivel > MINIMO_GOLPE &&
    ahora - ultimoGolpe > SEPARACION_GOLPES
  ) {
    ultimoGolpe = ahora;
    ritmo.latido = 1;
    ritmo.lado = -ritmo.lado;
    golpes += 1;
    // Una notita cada dos golpes, alternando el lado
    if (golpes % 2 === 0) {
      ritmo.notas = ritmo.notas.filter((n) => ahora - n.nace < VIDA_NOTA).slice(-(MAX_NOTAS - 1));
      ritmo.notas.push({ nace: ahora, lado: ritmo.lado });
    }
    golpe.emitir();
  }
}

/** El latido se apaga poco a poco (llamar en cada fotograma; dt en fotogramas de 60 Hz). */
export function apagarLatido(dt: number): void {
  ritmo.latido *= Math.pow(0.86, dt);
}

export function iniciarRitmo(): void {
  // Solo se escucha el nivel mientras suena música
  let escuchando = false;
  const actualizar = () => {
    const sonando = musicaSonando();
    if (sonando === escuchando) return;
    escuchando = sonando;
    invoke("escuchar_audio", { activo: sonando }).catch(console.error);
  };
  cambiosMusica.escuchar(actualizar);
  actualizar();
  listen<number>("audio-nivel", ({ payload }) => procesar(payload)).catch(console.error);
}
