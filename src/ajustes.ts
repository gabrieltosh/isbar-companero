// Ajustes compartidos entre el compañero y la ventana de configuración.
// Se guardan en el store; quien los cambia emite EVENTO_AJUSTES para que los demás los relean.
export const EVENTO_AJUSTES = "ajustes-cambiados";

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
  /** Opacidad del cuerpo: 1 sólido; menos, cristal que deja ver lo de detrás (hasta 0.5) */
  opacidad: number;
}

export const COMPANERO_POR_DEFECTO: ConfigCompanero = { color: "#f5f7ff", tamano: 1, tranquilo: false, opacidad: 1 };

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

/** Qué cuenta el compañero en sus globos. */
export interface ConfigGlobos {
  /** Un globo con la canción cada vez que cambia */
  cancion: boolean;
}

export const GLOBOS_POR_DEFECTO: ConfigGlobos = { cancion: true };

/** Jev (TypeSafe): decisiones con un modelo en la nube. Apagado por defecto. */
export interface ConfigJev {
  activo: boolean;
  /** Clave de API del usuario (se queda en este PC, en el store) */
  clave: string;
  /** Decide si cada notificación es urgente, normal o ruido (envía la app, el título y el texto) */
  notificaciones: boolean;
  /** Elige el ánimo y el estilo del baile de cada canción (envía título, artista y tempo) */
  baile: boolean;
  /** Sabe qué estás haciendo por la ventana activa (envía su programa y su título): en una
   * reunión se calla, con un vídeo o un juego se queda quieto… Apagado por defecto. */
  actividad: boolean;
}

export const JEV_POR_DEFECTO: ConfigJev = { activo: false, clave: "", notificaciones: true, baile: true, actividad: false };

/** Sonido común de los avisos (pausas activas y recordatorio de agua). */
export interface ConfigSonido {
  activo: boolean;
  volumen: number; // 0 a 1
}

export const SONIDO_POR_DEFECTO: ConfigSonido = { activo: true, volumen: 0.6 };

/** Ciudad para el tiempo (Open-Meteo). Sin ciudad, el compañero no mira el tiempo. */
export interface ConfigClima {
  /** Nombre que se enseña ("Santiago, Chile") */
  ciudad: string;
  latitud: number | null;
  longitud: number | null;
}

export const CLIMA_POR_DEFECTO: ConfigClima = { ciudad: "", latitud: null, longitud: null };

/** Configuración pide al compañero que enseñe una escena del tiempo un rato (para probarla). */
export const EVENTO_PROBAR_ESCENA = "probar-escena";
/** Escenas del tiempo que se pueden probar: id y nombre. */
export const ESCENAS_PRUEBA = [
  ["lluvia", "Lluvia"],
  ["tormenta", "Tormenta"],
  ["amenaza", "Va a llover"],
  ["nieve", "Nieve"],
  ["calor", "Calor"],
  ["frio", "Frío"],
  ["niebla", "Niebla"],
  ["nublado", "Nublado"],
  ["noche", "Noche despejada"],
  ["amanecer", "Buenos días"],
] as const;
export type EscenaPrueba = (typeof ESCENAS_PRUEBA)[number][0];
/** Lo que se envía con EVENTO_PROBAR_ESCENA para terminar la prueba antes de tiempo. */
export const PARAR_PRUEBA = "parar";
