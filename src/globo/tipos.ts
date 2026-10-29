// Lo que el compañero le pide mostrar a la ventana del globo, y lo que el globo le responde.

/** Un botón del globo. `id` vuelve en EVENTO_ACCION al pulsarlo. */
export interface AccionGlobo {
  id: string;
  texto: string;
  /** Botón destacado */
  principal?: boolean;
  /** Icono en lugar de texto (controles de música) */
  icono?: "anterior" | "play" | "pausa" | "siguiente";
}

export interface ContenidoGlobo {
  id: number;
  /** Línea pequeña de arriba (la app, "Pomodoro"…) */
  origen?: string;
  titulo: string;
  texto?: string;
  /** Imagen pequeña a la izquierda (icono de la app, carátula), como data URL */
  imagen?: string | null;
  acciones?: AccionGlobo[];
  /** Cuánto se queda a la vista (ms). 0 = hasta que se pulse un botón o se cierre */
  duracion: number;
  /** Menú (clic derecho): sin texto, cada botón es un pensamiento suelto */
  menu?: boolean;
}

/** El compañero pide mostrar un globo (ContenidoGlobo). */
export const EVENTO_MOSTRAR = "globo-mostrar";
/** El compañero cambia el globo a la vista sin cerrarlo (mismo id). */
export const EVENTO_ACTUALIZAR = "globo-actualizar";
/** El compañero (o Rust, al arrastrarlo) pide cerrarlo. */
export const EVENTO_CERRAR = "globo-cerrar";
/** El globo avisa de que se pulsó un botón: { id, accion }. */
export const EVENTO_ACCION = "globo-accion";
/** El globo avisa de que se cerró: { id }. */
export const EVENTO_CERRADO = "globo-cerrado";
