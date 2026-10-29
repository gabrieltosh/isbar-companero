// Estado del PC que manda Rust (sistema.rs) cuando cambia algo: lo usan el panel (pestaña
// Sistema) y el compañero (sus reacciones).

/** Rust emite este evento con EstadoSistema. */
export const EVENTO_SISTEMA = "sistema-estado";

export interface Bateria {
  /** 0 a 100 */
  porcentaje: number;
  enchufado: boolean;
  cargando: boolean;
  /** Ahorro de batería de Windows activado */
  ahorro: boolean;
  minutosRestantes: number | null;
  minutosParaLlenar: number | null;
  /** Consumo (descargando) o potencia de carga */
  vatios: number | null;
}

export interface Volumen {
  /** 0 a 100 */
  nivel: number;
  silencio: boolean;
  /** Nombre del dispositivo de salida */
  dispositivo: string;
}

export interface Conexion {
  conectado: boolean;
  internet: boolean;
  wifi: boolean;
  nombre: string | null;
}

export interface Uso {
  /** Procesador y memoria, 0 a 100 */
  cpu: number;
  memoria: number;
  /** GB */
  memoriaUsada: number;
  memoriaTotal: number;
}

export interface EstadoSistema {
  /** Sin batería (PC de sobremesa), null */
  bateria: Bateria | null;
  volumen: Volumen | null;
  conexion: Conexion | null;
  uso: Uso | null;
}

/** "2 h 15 min" o "40 min". */
export function duracionLegible(min: number): string {
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}
