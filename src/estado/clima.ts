// El tiempo de la ciudad elegida en Configuración, con Open-Meteo (gratis y sin clave).
// Solo sale del PC la posición de la ciudad (o su nombre, al buscarla); nada del usuario.
import type { ConfigClima } from "../ajustes";

const PREVISION = "https://api.open-meteo.com/v1/forecast";
const BUSCADOR = "https://geocoding-api.open-meteo.com/v1/search";
/** Si Open-Meteo no responde en este tiempo, se da por fallido. */
const ESPERA_MS = 10_000;
/** Horas que se miran por delante para avisar de la lluvia. */
const HORAS_PREVISION = 4;
/** Probabilidad de lluvia (%) desde la que se avisa. */
export const LLUVIA_PROBABLE = 60;

export type TipoCielo = "sol" | "nubes" | "niebla" | "llovizna" | "lluvia" | "nieve" | "tormenta";

export interface Clima {
  ciudad: string;
  /** °C */
  temperatura: number;
  /** Código WMO del tiempo de ahora */
  codigo: number;
  dia: boolean;
  /** Ahora mismo llueve (o nieva) */
  lloviendo: boolean;
  hoy: { codigo: number; max: number; min: number; probLluvia: number };
  /** Primera hora de las próximas en la que es probable que llueva, o null */
  lluviaPronto: { hora: number; prob: number } | null;
  /** Cuándo se pidió (Date.now()) */
  actualizado: number;
}

/** Una ciudad encontrada por el buscador. */
export interface Lugar {
  nombre: string;
  latitud: number;
  longitud: number;
}

/** Qué cielo es cada código WMO de Open-Meteo, y cómo se dice. */
export function describirCielo(codigo: number): { tipo: TipoCielo; texto: string } {
  if (codigo === 0) return { tipo: "sol", texto: "Despejado" };
  if (codigo === 1) return { tipo: "sol", texto: "Casi despejado" };
  if (codigo === 2) return { tipo: "nubes", texto: "Algo nublado" };
  if (codigo === 3) return { tipo: "nubes", texto: "Nublado" };
  if (codigo === 45 || codigo === 48) return { tipo: "niebla", texto: "Niebla" };
  if (codigo >= 51 && codigo <= 57) return { tipo: "llovizna", texto: "Llovizna" };
  if (codigo >= 61 && codigo <= 67) return { tipo: "lluvia", texto: codigo === 65 ? "Lluvia fuerte" : "Lluvia" };
  if (codigo >= 71 && codigo <= 77) return { tipo: "nieve", texto: "Nieve" };
  if (codigo >= 80 && codigo <= 82) return { tipo: "lluvia", texto: "Chubascos" };
  if (codigo === 85 || codigo === 86) return { tipo: "nieve", texto: "Chubascos de nieve" };
  if (codigo >= 95) return { tipo: "tormenta", texto: "Tormenta" };
  return { tipo: "nubes", texto: "Variable" };
}

/** ¿Este cielo moja? (llovizna, lluvia, nieve o tormenta) */
export function moja(codigo: number): boolean {
  const t = describirCielo(codigo).tipo;
  return t === "llovizna" || t === "lluvia" || t === "nieve" || t === "tormenta";
}

/** "18 °C" */
export const grados = (t: number) => `${Math.round(t)} °C`;

async function pedir<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ESPERA_MS) });
  if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
  return (await r.json()) as T;
}

interface RespuestaPrevision {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  hourly: { time: string[]; weather_code: number[]; precipitation_probability: (number | null)[] };
  daily: {
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
  };
}

/** Pide el tiempo de ahora, el de hoy y el de las próximas horas. */
export async function pedirClima(c: ConfigClima): Promise<Clima> {
  if (c.latitud === null || c.longitud === null) throw new Error("Sin ciudad");
  const parametros = new URLSearchParams({
    latitude: String(c.latitud),
    longitude: String(c.longitud),
    current: "temperature_2m,weather_code,is_day",
    hourly: "weather_code,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "2",
    // La primera es la hora en curso
    forecast_hours: String(HORAS_PREVISION),
  });
  const r = await pedir<RespuestaPrevision>(`${PREVISION}?${parametros}`);

  let lluviaPronto: Clima["lluviaPronto"] = null;
  // Desde la hora siguiente (la de ahora ya la dice el tiempo actual)
  for (let i = 1; i < r.hourly.time.length; i++) {
    const prob = r.hourly.precipitation_probability[i] ?? 0;
    if (prob >= LLUVIA_PROBABLE || moja(r.hourly.weather_code[i])) {
      // "2026-10-29T15:00" en la hora de la ciudad
      lluviaPronto = { hora: Number(r.hourly.time[i].slice(11, 13)), prob };
      break;
    }
  }

  return {
    ciudad: c.ciudad,
    temperatura: r.current.temperature_2m,
    codigo: r.current.weather_code,
    dia: r.current.is_day === 1,
    lloviendo: moja(r.current.weather_code),
    hoy: {
      codigo: r.daily.weather_code[0],
      max: r.daily.temperature_2m_max[0],
      min: r.daily.temperature_2m_min[0],
      probLluvia: r.daily.precipitation_probability_max[0] ?? 0,
    },
    lluviaPronto,
    actualizado: Date.now(),
  };
}

interface RespuestaBuscador {
  results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[];
}

/** Busca ciudades por su nombre (en español). */
export async function buscarCiudad(nombre: string): Promise<Lugar[]> {
  const parametros = new URLSearchParams({ name: nombre, count: "6", language: "es", format: "json" });
  const r = await pedir<RespuestaBuscador>(`${BUSCADOR}?${parametros}`);
  return (r.results ?? []).map((l) => ({
    // "Santiago de Chile, Región Metropolitana, Chile" (sin repetir partes)
    nombre: [l.name, l.admin1, l.country].filter((p, i, todas) => p && todas.indexOf(p) === i).join(", "),
    latitud: l.latitude,
    longitud: l.longitude,
  }));
}
