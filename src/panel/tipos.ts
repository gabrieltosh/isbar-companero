// Lo que se cuentan el compañero (que tiene el estado) y el panel (que lo muestra).
// El panel pide una "foto" del estado y manda órdenes; así no hay temporizadores duplicados.
import type { InfoMedia } from "../estado/musica";
import type { TipoPausa } from "../estado/pausas";
import type { Modo } from "../estado/pomodoro";

export interface EstadoPanel {
  pomodoro: {
    modo: Modo;
    corriendo: boolean;
    /** ms que quedan */
    restante: number;
    /** ms del bloque actual */
    duracion: number;
    ciclos: number;
  };
  pausas: {
    /** "reposo", "pendiente", "rutina" o "fin" */
    modo: string;
    /** La próxima pausa activada, o null si están todas apagadas */
    proxima: { tipo: TipoPausa; nombre: string; cuando: string } | null;
    /** Cada tipo de pausa: si está activada y cuándo toca */
    tipos: { tipo: TipoPausa; nombre: string; activa: boolean; cuando: string }[];
  };
  musica: (InfoMedia & { posicion: number }) | null;
  /** Ritmo reconocido mientras suena música con audio (para ver cómo va) */
  ritmo: { ppm: number; confianza: number; golpes: number; partes: number; pausa: boolean } | null;
  /** El tiempo de ahora en la ciudad de Configuración (null sin ciudad o sin respuesta) */
  clima: {
    temperatura: number;
    texto: string;
    ciudad: string;
    /** Mínima y máxima de hoy (°C) */
    min: number;
    max: number;
    /** Si va a llover en las próximas horas: a qué hora y con qué probabilidad (%) */
    lluvia: { hora: number; prob: number } | null;
  } | null;
  /** Minutos que quedan de «No molestar» (0 si no está activo) */
  noMolestar: number;
}

export type OrdenPanel =
  | { tipo: "pomodoro-alternar" }
  | { tipo: "pomodoro-reiniciar" }
  | { tipo: "pomodoro-modo"; modo: Modo }
  | { tipo: "pausa-empezar"; pausa: TipoPausa }
  | { tipo: "musica"; accion: "anterior" | "play" | "siguiente" }
  | { tipo: "musica-posicion"; ms: number };

/** El compañero manda la foto del estado (EstadoPanel). */
export const EVENTO_ESTADO = "panel-estado";
/** El panel pide la foto al abrirse. */
export const EVENTO_PEDIR = "panel-pedir-estado";
/** El panel manda una orden (OrdenPanel). */
export const EVENTO_ORDEN = "panel-orden";
/** Rust avisa al abrir o cerrar el panel (boolean). */
export const EVENTO_VISIBLE = "panel-visible";
