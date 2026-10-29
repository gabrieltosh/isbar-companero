// Sonidos suaves generados con Web Audio (sin archivos): campanita de aviso y "tic" de cambio de paso.
// sonarAviso() / sonarPaso() respetan la configuración común "Sonido de los avisos".
import { listen } from "@tauri-apps/api/event";
import { EVENTO_AJUSTES, SONIDO_POR_DEFECTO, type ConfigSonido } from "./ajustes";
import { leer } from "./store";

let contexto: AudioContext | null = null;
let config: ConfigSonido = SONIDO_POR_DEFECTO;
/** Por qué no suenan ahora los avisos («No molestar», en una reunión…; el "tic" de una rutina
 * que ya empezaste, sí suena). */
const silencios = new Set<string>();

export function silenciarAvisos(motivo: string, silenciar: boolean): void {
  if (silenciar) silencios.add(motivo);
  else silencios.delete(motivo);
}

function audio(): AudioContext | null {
  try {
    contexto ??= new AudioContext();
    if (contexto.state === "suspended") void contexto.resume();
    return contexto;
  } catch (e) {
    console.warn("sonido no disponible:", e);
    return null;
  }
}

/** Una nota senoidal con entrada rápida y caída larga, como una campana. */
function nota(ctx: AudioContext, frecuencia: number, inicio: number, duracion: number, volumen: number): void {
  const osc = ctx.createOscillator();
  const ganancia = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frecuencia;
  const t = ctx.currentTime + inicio;
  ganancia.gain.setValueAtTime(0, t);
  ganancia.gain.linearRampToValueAtTime(volumen, t + 0.02);
  ganancia.gain.exponentialRampToValueAtTime(0.0001, t + duracion);
  osc.connect(ganancia).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duracion + 0.05);
}

/** Campanita de dos notas. `volumen` va de 0 a 1. */
export function campanita(volumen: number): void {
  const ctx = audio();
  if (!ctx || volumen <= 0) return;
  const v = 0.12 * volumen;
  nota(ctx, 880, 0, 1.4, v); // La5
  nota(ctx, 1318.5, 0.18, 1.6, v * 0.8); // Mi6
}

/** Toque muy corto y suave. */
export function tic(volumen: number): void {
  const ctx = audio();
  if (!ctx || volumen <= 0) return;
  nota(ctx, 1046.5, 0, 0.25, 0.06 * volumen); // Do6
}

/** Campanita de aviso (pausa que toca, fin de rutina, recordatorio de agua). */
export function sonarAviso(): void {
  if (config.activo && silencios.size === 0) campanita(config.volumen);
}

/** "Tic" al empezar cada paso de una rutina. */
export function sonarPaso(): void {
  if (config.activo) tic(config.volumen);
}

/** Carga la configuración de sonido y la mantiene al día. */
export function iniciarSonido(): void {
  const cargar = async () => {
    config = { ...SONIDO_POR_DEFECTO, ...(await leer<Partial<ConfigSonido>>("sonidoConfig", {})) };
  };
  void cargar();
  listen(EVENTO_AJUSTES, () => void cargar()).catch(console.error);
}
