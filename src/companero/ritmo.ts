// Ritmo de la música. Rust escucha lo que suena (audio.rs) y lo analiza (ritmo.rs): manda unas
// 30 veces por segundo el nivel, las bandas, si hubo golpe, el tempo, el pulso y las partes de
// la canción. Aquí se lleva el pulso entre mensaje y mensaje (sin saltos), se calculan la
// energía y la intensidad de esta parte, se sacan las notitas con los golpes y se avisa al
// baile de las partes nuevas, las pausas y la vuelta de la música. De cada instrumento (bombo,
// caja, platillos) se lleva si está sonando, para que el baile siga lo que suena (no cada golpe:
// con un arpegio rápido parecería que tiembla).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { cambioCancion, cambiosMusica, musicaSonando } from "../estado/musica";
import { crearSenal } from "../estado/senal";
import { celebrarVuelta, empezarCancion, nuevaParte, pasoActual } from "./baile";

/** Sin mensajes nuevos en este tiempo, se considera que no hay audio. */
const SIN_AUDIO_MS = 500;
/** El baile va este tiempo por delante de lo analizado (mensaje y dibujo tardan un poco). */
const ADELANTO_MS = 25;
/** Notitas a la vez, como mucho, y lo que tarda cada una en subir y desvanecerse (varía). */
const MAX_NOTAS = 2;
const VIDA_NOTA = 1600;
/** Tiempo entre una notita y la siguiente (ms): en las partes tranquilas y en las intensas (con
 * algo de azar). Muchas a la vez distraían: son un detalle de vez en cuando. */
const ENTRE_NOTAS_TRANQUILA = 4500;
const ENTRE_NOTAS_INTENSA = 2000;

/** Lo que manda Rust (ritmo.rs). */
interface EstadoAudio {
  nivel: number;
  graves: number;
  medios: number;
  agudos: number;
  golpe: boolean;
  intervalo: number;
  pulso: number;
  confianza: number;
  pausa: boolean;
  /** Golpes de bombo, caja y platillos desde el mensaje anterior */
  golpes: [boolean, boolean, boolean];
  /** En una pausa, cuánto ha crecido la música (0 a 1): la subida antes del «drop» */
  subida: number;
  /** Momento de la canción, si lo hubo desde el mensaje anterior */
  seccion: "cambio" | "pausa" | "vuelta" | null;
}

export interface Nota {
  nace: number;
  /** -1 sale por la izquierda, 1 por la derecha */
  lado: number;
  /** Lo que tarda en subir y desvanecerse (ms) */
  vida: number;
  /** Para que cada una sea distinta: qué forma tiene (0 a 1), su tamaño, cuánto se mece al
   * subir (0 a 1) y hacia dónde se inclina (-1 a 1) */
  variante: number;
  tam: number;
  meceo: number;
  giro: number;
}

export const ritmo = {
  /** Nivel de ahora respecto al rango de la canción, de 0 a 1 */
  energia: 0,
  /** Si esta parte de la canción es tranquila (0) o intensa (1) */
  intensidad: 0.5,
  /** 1 justo en un golpe detectado; baja a 0 enseguida */
  latido: 0,
  /** Milisegundos entre pulsos (tempo estimado) */
  intervalo: 500,
  /** Qué claro está el ritmo (0 a 1) */
  confianza: 0,
  /** La canción está en una pausa (sin graves): espera quieto */
  pausa: false,
  /** Energía de graves, medios y agudos (0 a 1) */
  bandas: [0, 0, 0] as [number, number, number],
  /** Si cada instrumento (bombo, caja, platillos) está sonando: sube poco a poco con sus golpes
   * y baja a 0 en un par de segundos sin ellos (una parte solo con guitarra no tiene bombo) */
  presencia: [0, 0, 0] as [number, number, number],
  /** En una pausa, cuánto ha crecido la música (0 a 1): la subida antes del «drop» */
  subida: 0,
  /** Lo movida que suena la canción (escala de Jev, 0 quieta … 4 para saltar), por el tempo, lo
   * claro que es el ritmo y si suena batería. Cambia despacio (unos segundos) */
  energiaOida: 0,
  notas: [] as Nota[],
};

/** Hubo un golpe en la música. */
export const golpe = crearSenal();
/** Empieza una parte nueva de la canción (estribillo, puente…). */
export const parteNueva = crearSenal();

let ultimoNivel = 0;
let rapida = 0;
let lenta = 0;
let larga = 0;
let maximo = 0.1;
let minimo = 0;
let golpes = 0;
let partes = 0;
/** Pulso en el último mensaje (llevado sin saltos) y cuándo llegó. */
let pulso = 0;
let pulsoEn = 0;

/** Hay audio sonando (llegan niveles y no es silencio). */
export function hayAudio(): boolean {
  return performance.now() - ultimoNivel < SIN_AUDIO_MS && lenta > 0.02;
}

/** Pulso al ritmo de la canción: la parte entera cuenta pulsos (múltiplos de 4 = primer
 * tiempo del compás), la decimal va de un pulso al siguiente. */
export function pulsoAhora(): number {
  const pasado = Math.min(SIN_AUDIO_MS, performance.now() - pulsoEn);
  return pulso + (pasado + ADELANTO_MS) / ritmo.intervalo;
}

/** Pulsos por minuto y aciertos, para ver en el panel cómo va el reconocimiento. */
export function resumenRitmo(): {
  ppm: number;
  confianza: number;
  golpes: number;
  partes: number;
  pausa: boolean;
  paso: string;
  energia: number;
} | null {
  if (!hayAudio()) return null;
  return {
    ppm: Math.round(60_000 / ritmo.intervalo),
    confianza: ritmo.confianza,
    golpes,
    partes,
    pausa: ritmo.pausa,
    paso: pasoActual(),
    energia: ritmo.energiaOida,
  };
}

/** Cuándo puede salir la siguiente notita. */
let siguienteNota = 0;

/** Saca una notita por un lado, cada una con su forma, tamaño y vaivén (como mucho MAX_NOTAS a
 * la vez). `retraso`: para que salga un poco después (ms). */
function sacarNota(ahora: number, lado: number, retraso = 0): void {
  ritmo.notas = ritmo.notas.filter((n) => ahora - n.nace < n.vida).slice(-(MAX_NOTAS - 1));
  ritmo.notas.push({
    nace: ahora + retraso,
    lado,
    vida: VIDA_NOTA * (0.8 + Math.random() * 0.45),
    variante: Math.random(),
    tam: 0.75 + Math.random() * 0.4,
    meceo: 0.3 + Math.random() * 0.7,
    giro: Math.random() * 2 - 1,
  });
  // La siguiente, dentro de un rato: más pronto cuanto más intensa es esta parte
  const espera = ENTRE_NOTAS_TRANQUILA + (ENTRE_NOTAS_INTENSA - ENTRE_NOTAS_TRANQUILA) * ritmo.intensidad;
  siguienteNota = ahora + retraso + espera * (0.75 + Math.random() * 0.5);
}

/** El sonido más fuerte de hace poco: con él se ajusta la escala (ganancia automática). */
let pico = 0;
/** Por debajo de esto (sin ajustar) se considera silencio. */
const SILENCIO = 0.004;

function procesar(e: EstadoAudio): void {
  const ahora = performance.now();
  // Ganancia automática: el nivel se mide respecto a lo más fuerte que ha sonado hace poco
  // (baja despacio, unos segundos). Así da igual el dispositivo o el volumen
  pico = Math.max(e.nivel, pico * 0.997);
  const nivel = e.nivel < SILENCIO ? 0 : Math.min(1, e.nivel / Math.max(pico, 0.02));
  ultimoNivel = ahora;

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
  ritmo.bandas = [e.graves, e.medios, e.agudos];
  ritmo.confianza = e.confianza;
  ritmo.pausa = e.pausa;
  ritmo.subida += (e.subida - ritmo.subida) * 0.2;
  // Energía oída: tempo (de 90 a 140 ppm), ritmo claro y batería (bombo o caja), en la escala de Jev
  const tempo = Math.max(0, Math.min(1, (60_000 / e.intervalo - 90) / 50));
  const bateria = Math.max(ritmo.presencia[0], ritmo.presencia[1]);
  const oida = 4 * (0.4 * tempo + 0.3 * e.confianza + 0.3 * bateria);
  ritmo.energiaOida += (oida - ritmo.energiaOida) * 0.01;
  // Cada golpe acerca su presencia a 1 (poco a poco: sin saltos cuando empieza a sonar)
  e.golpes.forEach((g, i) => {
    if (g) ritmo.presencia[i] += (1 - ritmo.presencia[i]) * 0.35;
  });
  if (e.seccion === "cambio" || e.seccion === "vuelta") partes += 1;
  if (e.seccion === "cambio") {
    nuevaParte();
    parteNueva.emitir();
  }
  if (e.seccion === "vuelta") {
    // Vuelve la música: celebra con un latido fuerte y notitas por los dos lados
    celebrarVuelta();
    ritmo.latido = 1;
    sacarNota(ahora, -1);
    sacarNota(ahora, 1);
  }

  // Pulso: entre mensajes avanza solo; con cada uno se acerca a lo que dice Rust. Si la
  // diferencia es grande (cambio de tempo o de compás), salta directamente
  const previsto = pulsoAhora() - ADELANTO_MS / ritmo.intervalo;
  const error = e.pulso - previsto;
  pulso = Math.abs(error) > 0.5 ? e.pulso : previsto + error * 0.35;
  pulsoEn = ahora;
  ritmo.intervalo = e.intervalo;

  if (!e.golpe) return;
  ritmo.latido = 1;
  golpes += 1;
  // Notitas de vez en cuando (no en cada golpe): cada pocos segundos, más seguidas en las partes
  // intensas, siempre en un golpe y por un lado u otro al azar. Ninguna en una pausa
  if (!ritmo.pausa && ahora >= siguienteNota) sacarNota(ahora, Math.random() < 0.5 ? -1 : 1);
  golpe.emitir();
}

/** El latido se apaga poco a poco (llamar en cada fotograma; dt en fotogramas de 60 Hz). */
export function apagarLatido(dt: number): void {
  ritmo.latido *= Math.pow(0.86, dt);
  // Sin golpes de un instrumento, su presencia se apaga en un par de segundos
  for (let i = 0; i < 3; i++) ritmo.presencia[i] *= Math.pow(0.985, dt);
}

export function iniciarRitmo(): void {
  // Solo se escucha mientras suena música
  let escuchando = false;
  const actualizar = () => {
    const sonando = musicaSonando();
    if (sonando === escuchando) return;
    escuchando = sonando;
    invoke("escuchar_audio", { activo: sonando }).catch(console.error);
  };
  cambiosMusica.escuchar(actualizar);
  // Otra canción: primero la escucha un momento antes de soltarse a bailar
  cambioCancion.escuchar(() => empezarCancion());
  actualizar();
  listen<EstadoAudio>("audio-ritmo", ({ payload }) => procesar(payload)).catch(console.error);
}
