// Estado de la música, sin interfaz. Los datos llegan desde Rust (media.rs) con `media-update`.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { crearSenal } from "./senal";

export interface InfoMedia {
  titulo: string;
  artista: string;
  reproduciendo: boolean;
  duracionMs: number;
  posicionMs: number;
  app: string;
  /** Carátula como data URL, o null */
  caratula: string | null;
}

let info: InfoMedia | null = null;
// La posición avanza localmente entre actualizaciones de Rust
let posicionBase = 0;
let marcaBase = 0;
let iniciado = false;

/** Llegó información nueva (o dejó de haber sesión). */
export const cambiosMusica = crearSenal();
/** Empezó otra canción; lleva la información nueva. */
export const cambioCancion = crearSenal<InfoMedia>();

export function infoMusica(): Readonly<InfoMedia> | null {
  return info;
}

/** Hay una sesión de música (sonando o en pausa). */
export function hayMusica(): boolean {
  return info !== null;
}

export function musicaSonando(): boolean {
  return info?.reproduciendo ?? false;
}

export function posicionMusica(): number {
  if (!info) return 0;
  const p = posicionBase + (info.reproduciendo ? performance.now() - marcaBase : 0);
  return info.duracionMs > 0 ? Math.min(p, info.duracionMs) : p;
}

function comando(nombre: string): void {
  invoke(nombre).catch((e) => console.warn(`${nombre} no disponible:`, e));
}

export const reproducirPausar = (): void => comando("media_play_pause");
export const cancionSiguiente = (): void => comando("media_next");
export const cancionAnterior = (): void => comando("media_previous");

/** Salta a una posición (ms). Se ve al momento; si el reproductor no lo permite, vuelve donde estaba. */
export function irAPosicion(ms: number): void {
  if (!info) return;
  const antes = { base: posicionBase, marca: marcaBase };
  posicionBase = Math.max(0, info.duracionMs > 0 ? Math.min(ms, info.duracionMs) : ms);
  marcaBase = performance.now();
  cambiosMusica.emitir();
  invoke<boolean>("media_seek", { posicionMs: Math.round(posicionBase) })
    .then((aceptado) => {
      if (aceptado) return;
      posicionBase = antes.base;
      marcaBase = antes.marca;
      cambiosMusica.emitir();
    })
    .catch((e) => console.warn("media_seek no disponible:", e));
}

/** Empieza a escuchar a Rust. Se puede llamar varias veces. */
export function iniciarMusica(): void {
  if (iniciado) return;
  iniciado = true;
  listen<InfoMedia | null>("media-update", ({ payload }) => {
    const antes = info;
    info = payload;
    posicionBase = payload?.posicionMs ?? 0;
    marcaBase = performance.now();
    if (payload && (payload.titulo !== antes?.titulo || payload.artista !== antes?.artista)) {
      cambioCancion.emitir(payload);
    }
    cambiosMusica.emitir();
  }).catch(console.error);
}
