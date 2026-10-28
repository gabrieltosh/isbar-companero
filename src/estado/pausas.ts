// Estado de las pausas activas, sin interfaz: cuándo toca estirar la postura o descansar la vista,
// y la rutina guiada paso a paso (con sus sonidos).
// Solo la ventana del compañero debe llamar a iniciar(), para no duplicar los avisos.
import { listen } from "@tauri-apps/api/event";
import { EVENTO_AJUSTES, PAUSAS_POR_DEFECTO, type ConfigPausas } from "../ajustes";
import { sonarAviso, sonarPaso } from "../sonido";
import { guardar, leer } from "../store";
import { elegirRutina, type Ejercicio, type TipoPausa } from "./ejercicios";
import { crearSenal } from "./senal";

export type { TipoPausa };

interface Programa {
  /** Epoch ms de la próxima pausa de cada tipo */
  proxima: Record<TipoPausa, number>;
  /** Cuántas rutinas se han hecho, para rotar los ejercicios */
  turno: Record<TipoPausa, number>;
}

export interface Paso {
  ejercicio: Ejercicio;
  /** Posición del ejercicio en la rutina (desde 1) */
  numero: number;
  texto: string;
  segundos: number;
}

export type EstadoPausas =
  | { modo: "reposo" }
  | { modo: "pendiente"; tipo: TipoPausa }
  | { modo: "rutina"; tipo: TipoPausa; pasos: Paso[]; indice: number; finPaso: number }
  | { modo: "fin"; tipo: TipoPausa };

export const TIPOS_PAUSA: TipoPausa[] = ["vista", "postura"];
export const NOMBRE_PAUSA: Record<TipoPausa, string> = { postura: "Postura", vista: "Vista" };
export const AVISO_PAUSA: Record<TipoPausa, { titulo: string; detalle: string }> = {
  postura: { titulo: "Hora de estirar", detalle: "Unos estiramientos para el cuello, la espalda y los hombros." },
  vista: { titulo: "Descansa la vista", detalle: "Un minuto lejos de la pantalla para relajar los ojos." },
};
const POSPONER_MS = 5 * 60_000;
/** Cuánto se muestra el "¡Bien hecho!" antes de volver al reposo. */
export const DURACION_FIN_PAUSA = 4_000;

let config: ConfigPausas = PAUSAS_POR_DEFECTO;
let programa: Programa = {
  proxima: { postura: Date.now() + 45 * 60_000, vista: Date.now() + 20 * 60_000 },
  turno: { postura: 0, vista: 0 },
};
let estado: EstadoPausas = { modo: "reposo" };
let temporizador = 0;
let iniciado = false;

/** Cambió el estado (también cada tic de la rutina y cada 15 s en reposo). */
export const cambiosPausas = crearSenal();
/** Toca una pausa (el sonido ya ha sonado). */
export const pausaPendiente = crearSenal<TipoPausa>();
/** Empieza un paso de la rutina; lleva su duración en ms. */
export const pasoPausa = crearSenal<number>();
/** Rutina completada. */
export const pausaTerminada = crearSenal<TipoPausa>();
/** La rutina se canceló a mitad. */
export const pausaDetenida = crearSenal();

export function estadoPausas(): Readonly<EstadoPausas> {
  return estado;
}

export const intervaloPausa = (tipo: TipoPausa): number => config[`${tipo}Intervalo`] * 60_000;
export const pausaActiva = (tipo: TipoPausa): boolean => config[`${tipo}Activa`];
export const proximaPausa = (tipo: TipoPausa): number => programa.proxima[tipo];

/** "en 23 min", "en 1 h 05 min" o "ahora". */
export function cuandoPausa(ms: number): string {
  const falta = Math.max(0, ms - Date.now());
  if (falta < 60_000) return "ahora";
  const minutos = Math.round(falta / 60_000);
  if (minutos < 60) return `en ${minutos} min`;
  return `en ${Math.floor(minutos / 60)} h ${String(minutos % 60).padStart(2, "0")} min`;
}

function reprogramar(tipo: TipoPausa, dentroDe: number): void {
  programa = { ...programa, proxima: { ...programa.proxima, [tipo]: Date.now() + dentroDe } };
  void guardar("pausas", programa);
}

/** Si toca alguna pausa (y no hay otra en curso), avisa. Primero la más atrasada. */
function comprobar(): void {
  if (estado.modo !== "reposo") return;
  const vencidas = TIPOS_PAUSA.filter((t) => pausaActiva(t) && Date.now() >= programa.proxima[t]).sort(
    (a, b) => programa.proxima[a] - programa.proxima[b],
  );
  const tipo = vencidas[0];
  if (!tipo) return;
  estado = { modo: "pendiente", tipo };
  sonarAviso();
  pausaPendiente.emitir(tipo);
  cambiosPausas.emitir();
}

export function empezarPausa(tipo: TipoPausa): void {
  const rutina = elegirRutina(tipo, programa.turno[tipo]);
  programa = { ...programa, turno: { ...programa.turno, [tipo]: programa.turno[tipo] + 1 } };
  const pasos = rutina.flatMap((ejercicio, i) =>
    ejercicio.pasos.map((p) => ({ ejercicio, numero: i + 1, texto: p.texto, segundos: p.segundos })),
  );
  estado = { modo: "rutina", tipo, pasos, indice: 0, finPaso: 0 };
  iniciarPaso();
}

/** Empieza (o vuelve a empezar) el paso actual de la rutina. */
export function iniciarPaso(): void {
  if (estado.modo !== "rutina") return;
  const paso = estado.pasos[estado.indice];
  estado.finPaso = Date.now() + paso.segundos * 1000;
  sonarPaso();
  pasoPausa.emitir(paso.segundos * 1000);
  window.clearInterval(temporizador);
  temporizador = window.setInterval(tictac, 250);
  cambiosPausas.emitir();
}

function tictac(): void {
  if (estado.modo !== "rutina") return;
  if (Date.now() >= estado.finPaso) {
    siguientePaso();
    return;
  }
  cambiosPausas.emitir();
}

export function siguientePaso(): void {
  if (estado.modo !== "rutina") return;
  if (estado.indice < estado.pasos.length - 1) {
    estado.indice += 1;
    iniciarPaso();
  } else {
    terminar();
  }
}

/** Cancela la rutina: vuelve al reposo y la próxima pausa cuenta desde ahora. */
export function detenerPausa(): void {
  if (estado.modo !== "rutina") return;
  window.clearInterval(temporizador);
  reprogramar(estado.tipo, intervaloPausa(estado.tipo));
  estado = { modo: "reposo" };
  cambiosPausas.emitir();
  pausaDetenida.emitir();
}

function terminar(): void {
  if (estado.modo !== "rutina") return;
  const tipo = estado.tipo;
  window.clearInterval(temporizador);
  reprogramar(tipo, intervaloPausa(tipo));
  estado = { modo: "fin", tipo };
  sonarAviso();
  pausaTerminada.emitir(tipo);
  cambiosPausas.emitir();
  window.setTimeout(() => {
    if (estado.modo === "fin") {
      estado = { modo: "reposo" };
      cambiosPausas.emitir();
      comprobar();
    }
  }, DURACION_FIN_PAUSA);
}

/** Respuesta al aviso de una pausa pendiente. */
export function resolverPausa(accion: "empezar" | "posponer" | "saltar"): void {
  if (estado.modo !== "pendiente") return;
  const tipo = estado.tipo;
  if (accion === "empezar") {
    empezarPausa(tipo);
    return;
  }
  reprogramar(tipo, accion === "posponer" ? POSPONER_MS : intervaloPausa(tipo));
  estado = { modo: "reposo" };
  cambiosPausas.emitir();
}

/** Activa o desactiva la alarma de un tipo (el mismo ajuste que en la configuración). */
export function fijarAlarmaPausa(tipo: TipoPausa, activa: boolean): void {
  config = { ...config, [`${tipo}Activa`]: activa };
  void guardar("pausasConfig", config);
  // Al activarla, la próxima pausa cuenta desde ahora
  if (activa) reprogramar(tipo, intervaloPausa(tipo));
  cambiosPausas.emitir();
}

/** Carga lo guardado y revisa cada 15 s si toca una pausa. Se puede llamar varias veces. */
export function iniciarPausas(): void {
  if (iniciado) return;
  iniciado = true;

  void (async () => {
    config = await leer("pausasConfig", config);
    programa = await leer("pausas", programa);
    cambiosPausas.emitir();
    comprobar();
  })();

  // Intervalos cambiados en la configuración
  listen(EVENTO_AJUSTES, async () => {
    config = await leer("pausasConfig", config);
    // Si el intervalo se acortó, la próxima pausa no puede quedar más lejos que el nuevo intervalo
    for (const tipo of TIPOS_PAUSA) {
      if (programa.proxima[tipo] > Date.now() + intervaloPausa(tipo)) reprogramar(tipo, intervaloPausa(tipo));
    }
    cambiosPausas.emitir();
  }).catch(console.error);

  // Basta con revisar cada 15 s; también refresca los "en N min"
  window.setInterval(() => {
    comprobar();
    if (estado.modo === "reposo") cambiosPausas.emitir();
  }, 15_000);
}
