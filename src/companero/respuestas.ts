// Gestos de cabeza al hacer algo con él (borrar un aviso, cambiar de canción, empezar un
// Pomodoro…): asiente (sí), niega (no) o se encoge de hombros (no sé). Cada vez con un
// ritmo un poco distinto para que no parezca siempre igual.
import { listen } from "@tauri-apps/api/event";
import { musicaSonando } from "../estado/musica";
import type { Expresion } from "./cara";
import { gesto } from "./vida";

export type Respuesta = "si" | "no" | "nose";

const GESTOS: Record<Respuesta, [Expresion, number][]> = {
  si: [
    ["asiente", 1300],
    ["asiente", 950],
    ["guino", 1100],
  ],
  no: [
    ["niega", 1300],
    ["niega", 1000],
  ],
  nose: [
    ["nose", 1600],
    ["nose", 1300],
  ],
};

let ultimo: [Expresion, number] | null = null;

export function responder(r: Respuesta): void {
  const opciones = GESTOS[r].filter((g) => g !== ultimo);
  const elegido = opciones[Math.floor(Math.random() * opciones.length)];
  ultimo = elegido;
  gesto(...elegido);
}

/** Al tocar los controles de música: reproducir (sí), pausar (no sé), saltar canción (esa no), volver (sí). */
export function responderMusica(accion: string): void {
  if (accion === "play") responder(musicaSonando() ? "nose" : "si");
  if (accion === "siguiente") responder("no");
  if (accion === "anterior") responder("si");
}

/** Borrar muchos avisos de golpe merece una celebración. */
const MUCHOS_BORRADOS = 3;

/** Cuando se borran avisos (desde el globo, el panel o Windows), asiente; si son muchos, celebra. */
export function iniciarRespuestas(): void {
  let antes: number | null = null;
  listen<number>("notification-count", ({ payload }) => {
    if (antes !== null && payload < antes) {
      if (antes - payload >= MUCHOS_BORRADOS) gesto("celebra", 1800);
      else responder("si");
    }
    antes = payload;
  }).catch(console.error);
}
