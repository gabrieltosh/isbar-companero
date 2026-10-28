// Estado del agua, sin interfaz: litros de hoy, meta y recordatorio periódico.
// Solo la ventana del compañero debe llamar a iniciar(), para no duplicar el recordatorio.
import { listen } from "@tauri-apps/api/event";
import { AGUA_POR_DEFECTO, EVENTO_AJUSTES, type ConfigAgua } from "../ajustes";
import { sonarAviso } from "../sonido";
import { guardar, leer } from "../store";
import { hoy } from "../util";
import { crearSenal } from "./senal";

export interface RegistroAgua {
  fecha: string;
  ml: number;
}

/** Ajustes que se cambian con − y +: [paso, mínimo, máximo] */
export const PASOS_AGUA: Record<"meta" | "intervalo" | "sorbo", [number, number, number]> = {
  meta: [250, 500, 6000],
  intervalo: [15, 15, 240],
  sorbo: [50, 50, 1000],
};

let config: ConfigAgua = AGUA_POR_DEFECTO;
let registro: RegistroAgua = { fecha: hoy(), ml: 0 };
let ultimoAviso = Date.now();
let iniciado = false;

/** Cambió lo bebido o la configuración (o el día). */
export const cambiosAgua = crearSenal();
/** Toca beber agua (el sonido ya ha sonado). */
export const recordatorioAgua = crearSenal();

export function configAgua(): Readonly<ConfigAgua> {
  return config;
}

/** Mililitros bebidos hoy. */
export function mlHoy(): number {
  comprobarDia();
  return registro.ml;
}

function comprobarDia(): void {
  if (registro.fecha !== hoy()) {
    registro = { fecha: hoy(), ml: 0 };
    void guardar("agua", registro);
  }
}

export function beber(): void {
  comprobarDia();
  registro = { ...registro, ml: registro.ml + config.sorbo };
  ultimoAviso = Date.now();
  void guardar("agua", registro);
  cambiosAgua.emitir();
}

function guardarConfig(): void {
  void guardar("aguaConfig", config);
  cambiosAgua.emitir();
}

export function fijarRecordatoriosAgua(activos: boolean): void {
  config = { ...config, recordatorios: activos };
  ultimoAviso = Date.now();
  guardarConfig();
}

/** Sube o baja un ajuste un paso, dentro de sus límites. */
export function ajustarAgua(clave: keyof typeof PASOS_AGUA, direccion: 1 | -1): void {
  const [paso, min, max] = PASOS_AGUA[clave];
  config = { ...config, [clave]: Math.min(max, Math.max(min, config[clave] + paso * direccion)) };
  guardarConfig();
}

/** Carga lo guardado, revisa el recordatorio y el cambio de día. Se puede llamar varias veces. */
export function iniciarAgua(): void {
  if (iniciado) return;
  iniciado = true;

  // Recordatorio y cambio de día: basta con revisar cada 30 s
  window.setInterval(() => {
    if (config.recordatorios && Date.now() - ultimoAviso >= config.intervalo * 60_000) {
      ultimoAviso = Date.now();
      sonarAviso();
      recordatorioAgua.emitir();
    }
    comprobarDia();
    cambiosAgua.emitir();
  }, 30_000);

  void (async () => {
    config = await leer("aguaConfig", config);
    registro = await leer("agua", registro);
    cambiosAgua.emitir();
  })();

  // Meta, trago o recordatorio cambiados en la configuración
  listen(EVENTO_AJUSTES, async () => {
    config = await leer("aguaConfig", config);
    cambiosAgua.emitir();
  }).catch(console.error);
}
