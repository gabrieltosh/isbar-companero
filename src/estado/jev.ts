// Jev (TypeSafe): un modelo que recibe un estado y preguntas cerradas y devuelve respuestas con su
// probabilidad, nunca texto. Es una capa opcional encima de las reglas: apagado por defecto, con
// la clave del usuario, y si falla (sin internet, sin clave, lento) todo sigue con las reglas.
// La petición la hace Rust (tauri-plugin-http): la API no admite llamadas desde el navegador.
// Documentación: https://docs.typesafe.ai
import { fetch } from "@tauri-apps/plugin-http";
import type { ConfigJev } from "../ajustes";

const URL_API = "https://api.typesafe.ai/v1/systemone";
const MODELO = "jev-latest";
/** Si tarda más, se sigue con las reglas (Jev suele contestar en menos de medio segundo). */
const ESPERA_MS = 4000;

/** Elegir una opción: id → qué significa. */
export interface PreguntaEleccion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

/** Sí o no. */
export interface PreguntaSiNo {
  type: "noul";
  instructions: string;
}

export type Pregunta = PreguntaEleccion | PreguntaSiNo;

export interface RespuestaEleccion {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface RespuestaSiNo {
  type: "noul";
  /** Probabilidad de que sea «sí» (0 a 1) */
  noul: number;
}

export type Respuesta = RespuestaEleccion | RespuestaSiNo;

interface RespuestaApi {
  model: string;
  answers: Record<string, Respuesta>;
}

/** ¿Se puede usar? (activado y con clave) */
export function jevDisponible(c: ConfigJev): boolean {
  return c.activo && c.clave.trim() !== "";
}

/**
 * Hace las preguntas sobre el estado. Lanza un error si no responde a tiempo o la API se queja
 * (quien llama debe seguir con sus reglas). `clave` es la del usuario, de Configuración.
 */
export async function preguntarJev<P extends Record<string, Pregunta>>(
  clave: string,
  estado: unknown,
  preguntas: P,
): Promise<{ modelo: string; respuestas: { [K in keyof P]: P[K] extends PreguntaEleccion ? RespuestaEleccion : RespuestaSiNo } }> {
  const r = await fetch(URL_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${clave.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODELO, state: estado, questions: preguntas }),
    signal: AbortSignal.timeout(ESPERA_MS),
  });
  if (!r.ok) {
    if (r.status === 401) throw new Error("La clave no es válida");
    if (r.status === 429 || r.status === 529) throw new Error("Jev está ocupado; prueba en un momento");
    throw new Error(`Jev respondió ${r.status}`);
  }
  const datos = (await r.json()) as RespuestaApi;
  return { modelo: datos.model, respuestas: datos.answers as never };
}
