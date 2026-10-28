// Estado del Pomodoro, sin interfaz: lo usan la isla y el compañero.
// Solo la ventana del compañero debe llamar a iniciar(), para no duplicar el temporizador.
import { listen } from "@tauri-apps/api/event";
import { EVENTO_AJUSTES, POMODORO_POR_DEFECTO, type ConfigPomodoro } from "../ajustes";
import { guardar, leer } from "../store";
import { crearSenal } from "./senal";

export type Modo = "enfoque" | "corto" | "largo";

export interface EstadoPomodoro {
  modo: Modo;
  corriendo: boolean;
  /** Momento (epoch ms) en que termina, si está corriendo */
  finEn: number;
  /** Tiempo restante cuando está en pausa */
  restante: number;
  ciclos: number;
}

export const ETIQUETA_MODO: Record<Modo, string> = {
  enfoque: "Tiempo de enfoque",
  corto: "Descanso corto",
  largo: "Descanso largo",
};

let config: ConfigPomodoro = POMODORO_POR_DEFECTO;
let estado: EstadoPomodoro = { modo: "enfoque", corriendo: false, finEn: 0, restante: 25 * 60_000, ciclos: 0 };
let temporizador = 0;
let iniciado = false;

/** Cualquier cambio (también cada tic mientras corre). */
export const cambiosPomodoro = crearSenal();
/** Terminó un bloque; lleva el modo que acaba de terminar. */
export const pomodoroTerminado = crearSenal<Modo>();

export const duracion = (m: Modo): number => config[m] * 60_000;

export function restante(): number {
  return estado.corriendo ? Math.max(0, estado.finEn - Date.now()) : estado.restante;
}

export function estadoPomodoro(): Readonly<EstadoPomodoro> {
  return estado;
}

function persistir(): void {
  void guardar("pomodoro", estado);
}

function tic(): void {
  if (estado.corriendo && restante() <= 0) terminar();
  cambiosPomodoro.emitir();
}

function arrancarReloj(): void {
  window.clearInterval(temporizador);
  if (estado.corriendo) temporizador = window.setInterval(tic, 250);
}

export function cambiarModo(modo: Modo): void {
  estado = { ...estado, modo, corriendo: false, restante: duracion(modo) };
  arrancarReloj();
  persistir();
  tic();
}

/** Vuelve a empezar el bloque actual (parado). */
export function reiniciarPomodoro(): void {
  cambiarModo(estado.modo);
}

export function alternarPomodoro(): void {
  if (estado.corriendo) {
    estado = { ...estado, corriendo: false, restante: restante() };
  } else {
    estado = { ...estado, corriendo: true, finEn: Date.now() + estado.restante };
  }
  arrancarReloj();
  persistir();
  tic();
}

function terminar(): void {
  const terminado = estado.modo;
  let siguiente: Modo = "enfoque";
  let ciclos = estado.ciclos;
  if (estado.modo === "enfoque") {
    ciclos += 1;
    siguiente = ciclos % config.cadaLargo === 0 ? "largo" : "corto";
  }
  estado = { modo: siguiente, corriendo: false, finEn: 0, restante: duracion(siguiente), ciclos };
  arrancarReloj();
  persistir();
  pomodoroTerminado.emitir(terminado);
}

/** Carga el estado guardado y escucha la configuración. Se puede llamar varias veces. */
export function iniciarPomodoro(): void {
  if (iniciado) return;
  iniciado = true;
  void (async () => {
    config = await leer("pomodoroConfig", config);
    estado = await leer("pomodoro", { ...estado, restante: duracion("enfoque") });
    arrancarReloj();
    tic();
  })();

  // Duraciones cambiadas en la configuración
  listen(EVENTO_AJUSTES, async () => {
    const duracionAntes = duracion(estado.modo);
    config = await leer("pomodoroConfig", config);
    // Si estaba parado sin empezar, se ajusta a la nueva duración
    if (!estado.corriendo && estado.restante === duracionAntes) {
      estado = { ...estado, restante: duracion(estado.modo) };
      persistir();
    }
    tic();
  }).catch(console.error);
}
