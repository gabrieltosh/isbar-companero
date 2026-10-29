// Cola de globos de pensamiento del compañero: se muestran de uno en uno en la ventana del globo.
// Cada globo puede tener botones; al pulsarlos se llama a su función.
// Con «No molestar» solo salen los menús: los que esperan respuesta (urgentes o sin tiempo
// límite) aguardan en la cola y los demás se descartan.
// Para que no se amontonen: los pasajeros (los que se van solos) no se guardan si estás ausente,
// caducan si llevan mucho esperando su turno, y uno nuevo del mismo grupo (otra canción, otra
// notificación de la misma app) sustituye al que esperaba.
import { emit, listen } from "@tauri-apps/api/event";
import {
  EVENTO_ACCION,
  EVENTO_ACTUALIZAR,
  EVENTO_CERRADO,
  EVENTO_CERRAR,
  EVENTO_MOSTRAR,
  type ContenidoGlobo,
} from "../globo/tipos";
import type { Expresion } from "./cara";
import { gesto } from "./vida";

/** Un globo pedido por alguna parte del compañero. */
export interface Aviso extends Omit<ContenidoGlobo, "id"> {
  /** Qué hacer al pulsar un botón ("toque" = tocar el globo fuera de los botones) */
  alAccion?: (accion: string) => void;
  /** Gesto del compañero al aparecer el globo */
  gesto?: Expresion;
  /** Pasa delante de los que esperan */
  urgente?: boolean;
  /** Uno nuevo del mismo grupo sustituye al que esperaba (y al que se ve, si es pasajero) */
  grupo?: string;
  /** Mientras se ve, el compañero lo atiende (deja de bailar y pone cara de alerta) */
  atencion?: boolean;
}

type EnCola = Aviso & { id: number; creado: number };

/** Pausa entre un globo y el siguiente. */
const PAUSA_ENTRE_GLOBOS = 350;
const DURACION_GESTO = 1400;
/** Un pasajero que lleva esto esperando su turno ya no se enseña (ms). */
const CADUCA_MS = 60_000;
/** Sin tocar el ratón ni el teclado este tiempo, estás ausente (ms). */
const AUSENTE_MS = 2 * 60_000;

let siguienteId = 1;
const cola: EnCola[] = [];
let actual: EnCola | null = null;
let tSiguiente = 0;
/** Con el panel abierto los globos esperan en la cola. */
let pausados = false;
/** «No molestar» activo. */
let silencio = false;
/** Llevas un rato sin tocar el PC. */
let ausente = false;

/** Los que esperan respuesta no se pierden (con «No molestar» o ausente): aguardan su turno. */
const esperaRespuesta = (a: Aviso) => a.urgente === true || a.duracion === 0;
/** Se va solo y no pide nada: se puede descartar sin perder nada importante. */
const pasajero = (a: Aviso) => !a.menu && !esperaRespuesta(a);

/** Quita de la cola los pasajeros que cumplan `quitar`. */
function descartarPasajeros(quitar: (a: EnCola) => boolean): void {
  for (let i = cola.length - 1; i >= 0; i--) {
    if (pasajero(cola[i]) && quitar(cola[i])) cola.splice(i, 1);
  }
}

function contenido(a: EnCola): ContenidoGlobo {
  return {
    id: a.id,
    origen: a.origen,
    titulo: a.titulo,
    texto: a.texto,
    imagen: a.imagen,
    acciones: a.acciones,
    duracion: a.duracion,
    menu: a.menu,
  };
}

function mostrarSiguiente(): void {
  if (pausados || actual) return;
  const ahora = Date.now();
  descartarPasajeros((a) => ahora - a.creado > CADUCA_MS);
  if (cola.length === 0) return;
  const i = silencio ? cola.findIndex((a) => a.menu) : 0;
  if (i < 0) return;
  actual = cola.splice(i, 1)[0] ?? null;
  if (!actual) return;
  if (actual.gesto) gesto(actual.gesto, DURACION_GESTO);
  void emit(EVENTO_MOSTRAR, contenido(actual));
}

/** Pide un globo. Devuelve su id (para actualizarlo o cerrarlo). */
export function avisar(aviso: Aviso): number {
  const nuevo: EnCola = { ...aviso, id: siguienteId++, creado: Date.now() };
  if ((silencio || ausente) && pasajero(aviso)) return nuevo.id;
  if (aviso.grupo) {
    descartarPasajeros((a) => a.grupo === aviso.grupo);
    if (actual && actual.grupo === aviso.grupo && pasajero(actual)) void emit(EVENTO_CERRAR, { id: actual.id });
  }
  if (aviso.urgente) cola.unshift(nuevo);
  else cola.push(nuevo);
  mostrarSiguiente();
  return nuevo.id;
}

/** Cambia un globo que está a la vista (o esperando) sin cerrarlo. */
export function actualizar(id: number, cambios: Partial<Aviso>): void {
  const enCola = cola.find((a) => a.id === id);
  if (enCola) Object.assign(enCola, cambios);
  if (actual?.id === id) {
    Object.assign(actual, cambios);
    void emit(EVENTO_ACTUALIZAR, contenido(actual));
  }
}

/** Quita un globo, esté a la vista o esperando. */
export function cerrar(id: number): void {
  const i = cola.findIndex((a) => a.id === id);
  if (i >= 0) cola.splice(i, 1);
  if (actual?.id === id) void emit(EVENTO_CERRAR, { id });
}

/** Para (o reanuda) los globos; al reanudar sale el siguiente que esperaba. */
export function pausarGlobos(pausar: boolean): void {
  pausados = pausar;
  // Si había uno a la vista, Rust ya lo cerró al abrir el panel: vuelve a la cola
  if (pausar && actual) {
    cola.unshift(actual);
    actual = null;
  }
  if (!pausar) mostrarSiguiente();
}

/** Activa o quita «No molestar»; al quitarlo salen los que esperaban. */
export function silenciarGlobos(silenciar: boolean): void {
  silencio = silenciar;
  if (!silenciar) mostrarSiguiente();
}

/** ¿Hay a la vista un globo que pide atención (una notificación urgente)? */
export function pideAtencion(): boolean {
  return actual?.atencion === true;
}

export function globoActual(): number | null {
  return actual?.id ?? null;
}

export function iniciarGlobos(): void {
  listen<{ id: number; accion: string }>(EVENTO_ACCION, ({ payload }) => {
    if (actual?.id === payload.id) actual.alAccion?.(payload.accion);
  }).catch(console.error);

  // Al irte, los pasajeros que esperaban ya no tienen sentido; los que llegan, tampoco se guardan
  listen<number>("companero-inactivo", ({ payload }) => {
    ausente = payload >= AUSENTE_MS;
    if (ausente) descartarPasajeros(() => true);
  }).catch(console.error);

  listen<{ id: number }>(EVENTO_CERRADO, ({ payload }) => {
    if (actual?.id !== payload.id) return;
    actual = null;
    window.clearTimeout(tSiguiente);
    tSiguiente = window.setTimeout(mostrarSiguiente, PAUSA_ENTRE_GLOBOS);
  }).catch(console.error);
}
