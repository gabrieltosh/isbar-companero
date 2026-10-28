// Ajustes compartidos entre la isla y la ventana de configuración.
// Se guardan en el store; quien los cambia emite EVENTO_AJUSTES para que los demás los relean.
import { leer } from "./store";

export const EVENTO_AJUSTES = "ajustes-cambiados";

/** Vistas de la isla, en el orden por defecto. */
export const NOMBRES_VISTAS: Record<string, string> = {
  media: "Música",
  pomodoro: "Pomodoro",
  agua: "Agua",
  bandeja: "Bandeja",
  tareas: "Tareas",
  calendario: "Calendario",
  claude: "Claude",
  pausas: "Pausas activas",
};

/** Cómo se muestra isbar: la isla arriba o el compañero que se mueve por la pantalla. */
export type Estilo = "isla" | "companero";

export interface Ajustes {
  estilo: Estilo;
  /** Orden de las vistas (ids); también el de los iconos de la barra de abajo */
  vistas: string[];
  /** Vistas desactivadas */
  ocultas: string[];
  /** Tamaño de la isla (1 = 100 %) */
  escala: number;
  /** Separación del borde superior, en px */
  desplazamiento: number;
  /** Nombre del monitor, o null para el principal */
  monitor: string | null;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  estilo: "isla",
  vistas: Object.keys(NOMBRES_VISTAS),
  ocultas: [],
  escala: 1,
  desplazamiento: 0,
  monitor: null,
};

export interface ConfigPomodoro {
  enfoque: number; // minutos
  corto: number;
  largo: number;
  cadaLargo: number; // descanso largo cada N enfoques
}

export const POMODORO_POR_DEFECTO: ConfigPomodoro = { enfoque: 25, corto: 5, largo: 15, cadaLargo: 4 };

export interface ConfigAgua {
  meta: number; // ml
  sorbo: number; // ml por cada "Beber"
  intervalo: number; // minutos entre recordatorios
  recordatorios: boolean;
}

export const AGUA_POR_DEFECTO: ConfigAgua = { meta: 2000, sorbo: 250, intervalo: 60, recordatorios: false };

export interface ConfigPausas {
  posturaActiva: boolean;
  posturaIntervalo: number; // minutos
  vistaActiva: boolean;
  vistaIntervalo: number; // minutos
}

export const PAUSAS_POR_DEFECTO: ConfigPausas = {
  posturaActiva: true,
  posturaIntervalo: 45,
  vistaActiva: true,
  vistaIntervalo: 20,
};

/** Aspecto y carácter del compañero. */
export interface ConfigCompanero {
  /** Color de la cara (CSS) */
  color: string;
  /** 0.8 pequeño, 1 mediano, 1.25 grande */
  tamano: number;
  /** Sin rutinas llamativas (silbar, estirarse) y con menos movimiento */
  tranquilo: boolean;
}

export const COMPANERO_POR_DEFECTO: ConfigCompanero = { color: "#f5f7ff", tamano: 1, tranquilo: false };

/** Colores de cara que se pueden elegir: [valor, nombre], en este orden. */
export const COLORES_COMPANERO: [string, string][] = [
  ["#f5f7ff", "Blanco"],
  ["#4d8dff", "Azul"],
  ["#ff7a1a", "Naranja"],
  ["#c6f432", "Lima"],
];

export const TAMANOS_COMPANERO: [string, string][] = [
  ["0.8", "Pequeño"],
  ["1", "Mediano"],
  ["1.25", "Grande"],
];

/** Sonido común de los avisos (pausas activas y recordatorio de agua). */
export interface ConfigSonido {
  activo: boolean;
  volumen: number; // 0 a 1
}

export const SONIDO_POR_DEFECTO: ConfigSonido = { activo: true, volumen: 0.6 };

/** Lee los ajustes y completa lo que falte (p. ej. vistas nuevas). */
export async function leerAjustes(): Promise<Ajustes> {
  const a = { ...AJUSTES_POR_DEFECTO, ...(await leer<Partial<Ajustes>>("ajustes", {})) };
  const conocidas = Object.keys(NOMBRES_VISTAS);
  const vistas = a.vistas.filter((id) => conocidas.includes(id));
  for (const id of conocidas) if (!vistas.includes(id)) vistas.push(id);
  // Se descartan campos de versiones anteriores (p. ej. los iconos de la cabecera)
  return {
    estilo: a.estilo === "companero" ? "companero" : "isla",
    vistas,
    ocultas: a.ocultas.filter((id) => conocidas.includes(id)),
    escala: a.escala,
    desplazamiento: a.desplazamiento,
    monitor: a.monitor,
  };
}
