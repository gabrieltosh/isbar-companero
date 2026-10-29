// Cola de globos de pensamiento del compañero: se muestran de uno en uno en la ventana del globo.
// Cada globo puede tener botones; al pulsarlos se llama a su función.
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
}

/** Pausa entre un globo y el siguiente. */
const PAUSA_ENTRE_GLOBOS = 350;
const DURACION_GESTO = 1400;

let siguienteId = 1;
const cola: (Aviso & { id: number })[] = [];
let actual: (Aviso & { id: number }) | null = null;
let tSiguiente = 0;
/** Con el panel abierto los globos esperan en la cola. */
let pausados = false;

function contenido(a: Aviso & { id: number }): ContenidoGlobo {
  return {
    id: a.id,
    origen: a.origen,
    titulo: a.titulo,
    texto: a.texto,
    imagen: a.imagen,
    acciones: a.acciones,
    duracion: a.duracion,
  };
}

function mostrarSiguiente(): void {
  if (pausados || actual || cola.length === 0) return;
  actual = cola.shift() ?? null;
  if (!actual) return;
  if (actual.gesto) gesto(actual.gesto, DURACION_GESTO);
  void emit(EVENTO_MOSTRAR, contenido(actual));
}

/** Pide un globo. Devuelve su id (para actualizarlo o cerrarlo). */
export function avisar(aviso: Aviso): number {
  const nuevo = { ...aviso, id: siguienteId++ };
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

export function globoActual(): number | null {
  return actual?.id ?? null;
}

export function iniciarGlobos(): void {
  listen<{ id: number; accion: string }>(EVENTO_ACCION, ({ payload }) => {
    if (actual?.id === payload.id) actual.alAccion?.(payload.accion);
  }).catch(console.error);

  listen<{ id: number }>(EVENTO_CERRADO, ({ payload }) => {
    if (actual?.id !== payload.id) return;
    actual = null;
    window.clearTimeout(tSiguiente);
    tSiguiente = window.setTimeout(mostrarSiguiente, PAUSA_ENTRE_GLOBOS);
  }).catch(console.error);
}
