// No molestar: un rato sin globos ni campanitas de aviso (30 min, 1 h o hasta mañana).
// Mientras tanto, los avisos que esperan respuesta (fin del Pomodoro, pausas, batería muy baja)
// aguardan en la cola y salen al terminar; el resto se descarta. Se guarda en el store para que
// siga aunque se reinicie la app. El menú del clic derecho lo activa y lo quita.
import { silenciarAvisos } from "../sonido";
import { guardar, leer } from "../store";
import { silenciarGlobos } from "./globos";
import { gesto } from "./vida";

export type DuracionNoMolestar = "30" | "60" | "manana";

/** Hasta cuándo (Date.now()), en el store. */
const CLAVE = "noMolestarHasta";
/** «Hasta mañana» termina a esta hora. */
const HORA_MANANA = 7;
/** Por si el PC se suspende y el temporizador se retrasa, se revisa cada minuto. */
const REVISAR_MS = 60_000;
/** Lo máximo que admite setTimeout. */
const MAX_TIMEOUT = 2 ** 31 - 1;

let hasta = 0;
let tFin = 0;

export function noMolestar(): boolean {
  return Date.now() < hasta;
}

/** Minutos que faltan (redondeando hacia arriba). */
export function minutosNoMolestar(): number {
  return Math.max(0, Math.ceil((hasta - Date.now()) / 60_000));
}

/** Cuándo termina cada duración. «Hasta mañana» a las 7:00 (o hoy, si aún es de madrugada). */
function finDe(d: DuracionNoMolestar): number {
  if (d === "30") return Date.now() + 30 * 60_000;
  if (d === "60") return Date.now() + 60 * 60_000;
  const fin = new Date();
  if (fin.getHours() >= HORA_MANANA - 2) fin.setDate(fin.getDate() + 1);
  fin.setHours(HORA_MANANA, 0, 0, 0);
  return fin.getTime();
}

function aplicar(): void {
  const activo = noMolestar();
  silenciarGlobos("noMolestar", activo);
  silenciarAvisos("noMolestar", activo);
  window.clearTimeout(tFin);
  if (activo) tFin = window.setTimeout(() => terminar(true), Math.min(hasta - Date.now(), MAX_TIMEOUT));
}

/** Termina; `saluda`: con un gesto de «ya estoy aquí» (no al arrancar con uno ya caducado). */
function terminar(saluda: boolean): void {
  if (hasta === 0) return;
  hasta = 0;
  void guardar(CLAVE, 0);
  aplicar();
  if (saluda) gesto("feliz", 1400);
}

export function activarNoMolestar(d: DuracionNoMolestar): void {
  hasta = finDe(d);
  void guardar(CLAVE, hasta);
  aplicar();
}

export function quitarNoMolestar(): void {
  terminar(true);
}

export async function iniciarNoMolestar(): Promise<void> {
  hasta = await leer<number>(CLAVE, 0);
  if (!noMolestar()) terminar(false);
  aplicar();
  window.setInterval(() => {
    if (hasta !== 0 && !noMolestar()) terminar(true);
  }, REVISAR_MS);
}
