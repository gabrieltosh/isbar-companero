// Ritmo de la música a partir del nivel de sonido (audio.rs). La música actual viene muy
// comprimida (el nivel casi no baja), así que no se buscan picos absolutos sino subidas
// bruscas respecto a lo que sonaba justo antes, comparadas con lo normal en esta canción.
// Con los golpes se estima el tempo y se lleva un pulso continuo: el baile sigue el compás
// aunque algún golpe no se detecte.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cambiosMusica, musicaSonando } from "../estado/musica";
import { crearSenal } from "../estado/senal";

/** Un golpe: la subida supera lo normal en tantas desviaciones, y no antes de este tiempo. */
const DESVIACIONES_GOLPE = 1.3;
const MINIMO_SUBIDA = 0.012;
const SEPARACION_MINIMA = 240;
/** Tempo aceptado (ms entre pulsos): de 67 a 170 pulsos por minuto. */
const PULSO_MIN = 350;
const PULSO_MAX = 900;
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
  /** Nivel de ahora respecto al rango de la canción, de 0 a 1 */
  energia: 0,
  /** Si esta parte de la canción es tranquila (0) o intensa (1) */
  intensidad: 0.5,
  /** 1 justo en un golpe detectado; baja a 0 enseguida */
  latido: 0,
  /** Lado de la última notita */
  lado: 1,
  /** Milisegundos entre pulsos (tempo estimado) */
  intervalo: 500,
  notas: [] as Nota[],
};

/** Hubo un golpe en la música. */
export const golpe = crearSenal();

let ultimoNivel = 0;
let ultimoGolpe = 0;
let rapida = 0;
let lenta = 0;
let larga = 0;
let maximo = 0.1;
let minimo = 0;
let subidaMedia = 0;
let subidaVar = 0.0004;
let subidaAnterior = 0;
let golpes = 0;
/** Pulsos contados (con decimales) hasta el último nivel recibido. */
let pulso = 0;

/** Hay audio sonando (llegan niveles y no es silencio). */
export function hayAudio(): boolean {
  return performance.now() - ultimoNivel < SIN_AUDIO_MS && lenta > 0.02;
}

/** Pulso de la canción ahora mismo: la parte entera cuenta pulsos, la decimal va de un pulso al siguiente. */
export function pulsoAhora(): number {
  const pasado = Math.min(SIN_AUDIO_MS, performance.now() - ultimoNivel);
  return pulso + pasado / ritmo.intervalo;
}

/** Ajusta el tempo con el tiempo entre dos golpes (llevándolo al rango aceptado). */
function ajustarTempo(d: number): void {
  while (d > PULSO_MAX) d /= 2;
  while (d < PULSO_MIN) d *= 2;
  if (d > PULSO_MAX) return;
  // Si se parece al tempo actual, se afina; si no, se acerca despacio (puede haber cambiado)
  const parecido = Math.abs(d - ritmo.intervalo) / ritmo.intervalo < 0.2;
  ritmo.intervalo += (d - ritmo.intervalo) * (parecido ? 0.25 : 0.06);
}

/** El sonido más fuerte de hace poco: con él se ajusta la escala (ganancia automática). */
let pico = 0;
/** Por debajo de esto (sin ajustar) se considera silencio. */
const SILENCIO = 0.004;

function procesar(bruto: number): void {
  const ahora = performance.now();
  // Ganancia automática: el nivel se mide respecto a lo más fuerte que ha sonado hace poco
  // (baja despacio, unos segundos). Así da igual el dispositivo o el volumen
  pico = Math.max(bruto, pico * 0.997);
  const nivel = bruto < SILENCIO ? 0 : Math.min(1, bruto / Math.max(pico, 0.02));
  const paso = ultimoNivel ? Math.min(SIN_AUDIO_MS, ahora - ultimoNivel) : 33;
  ultimoNivel = ahora;
  pulso += paso / ritmo.intervalo;

  rapida += (nivel - rapida) * 0.55;
  lenta += (nivel - lenta) * 0.12;
  // La media larga empieza en el primer nivel (si no, tarda mucho en llegar)
  larga = larga ? larga + (nivel - larga) * 0.004 : nivel;
  // Rango de la canción: sube enseguida y se relaja despacio
  maximo = Math.max(nivel, maximo - 0.0008);
  minimo = Math.min(nivel, minimo + 0.0008);
  const rango = Math.max(0.05, maximo - minimo);
  const energia = (rapida - minimo) / rango;
  ritmo.energia += (energia - ritmo.energia) * (energia > ritmo.energia ? 0.6 : 0.2);
  const intensidad = Math.max(0, Math.min(1, (larga - minimo) / rango));
  ritmo.intensidad += (intensidad - ritmo.intensidad) * 0.03;

  // Subida respecto a lo que sonaba antes, comparada con lo normal en esta canción
  const subida = Math.max(0, rapida - lenta);
  const desviacion = Math.sqrt(subidaVar);
  const umbral = subidaMedia + desviacion * DESVIACIONES_GOLPE;
  const cresta = subida < subidaAnterior && subidaAnterior > umbral && subidaAnterior > MINIMO_SUBIDA;
  subidaAnterior = subida;
  subidaMedia += (subida - subidaMedia) * 0.03;
  subidaVar += ((subida - subidaMedia) ** 2 - subidaVar) * 0.03;

  const separacion = Math.max(SEPARACION_MINIMA, ritmo.intervalo * 0.55);
  if (!cresta || ahora - ultimoGolpe < separacion) return;
  if (ultimoGolpe) ajustarTempo(ahora - ultimoGolpe);
  ultimoGolpe = ahora;
  // El pulso se acerca al golpe (sin saltar de golpe)
  const desfase = pulso - Math.round(pulso);
  pulso -= desfase * 0.5;
  ritmo.latido = 1;
  golpes += 1;
  // Una notita cada dos golpes, alternando el lado
  if (golpes % 2 === 0) {
    ritmo.lado = -ritmo.lado;
    ritmo.notas = ritmo.notas.filter((n) => ahora - n.nace < VIDA_NOTA).slice(-(MAX_NOTAS - 1));
    ritmo.notas.push({ nace: ahora, lado: ritmo.lado });
  }
  golpe.emitir();
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
