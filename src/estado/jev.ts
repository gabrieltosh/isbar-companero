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

// ---------- Notificaciones ----------

export type Importancia = "urgente" | "normal" | "ruido";

/** Lo que se le cuenta a Jev de una notificación (nada más sale del PC). */
export interface DatosNotificacion {
  app: string;
  titulo: string;
  texto: string;
}

/**
 * Pregunta a Jev si la notificación es urgente, normal o ruido, con su confianza (0 a 1).
 * La usan el compañero (con cada notificación) y Configuración (al probar con ejemplos).
 */
export async function importanciaNotificacion(
  clave: string,
  n: DatosNotificacion,
): Promise<{ importancia: Importancia; confianza: number }> {
  const { respuestas } = await preguntarJev(
    clave,
    { app: n.app, titulo: n.titulo, texto: n.texto, hora: new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) },
    {
      importancia: {
        type: "choice",
        instructions: "Qué importancia tiene esta notificación del ordenador para la persona que lo está usando",
        criteria: {
          urgente:
            "Hay que verla ya: alguien espera una respuesta inmediata, una reunión o llamada empieza ahora, un error grave, un aviso de seguridad o un pago",
          normal: "Un mensaje o aviso que conviene leer, pero puede esperar unos minutos",
          ruido: "Publicidad, promociones, novedades o consejos de una app, avisos automáticos sin importancia",
        },
      },
    },
  );
  const r = respuestas.importancia;
  const importancia: Importancia = r.choice === "urgente" || r.choice === "ruido" ? r.choice : "normal";
  return { importancia, confianza: r.confidence };
}

/** Notificaciones inventadas para probar el filtro desde Configuración (con lo que se espera). */
export const NOTIFICACIONES_EJEMPLO: (DatosNotificacion & { esperado: Importancia })[] = [
  { app: "Microsoft Teams", titulo: "Ana García", texto: "¿Puedes entrar ya a la llamada? Te estamos esperando", esperado: "urgente" },
  { app: "Outlook", titulo: "Recordatorio: Reunión de equipo", texto: "Empieza en 5 minutos · Sala 2", esperado: "urgente" },
  { app: "Seguridad de Windows", titulo: "Amenaza detectada", texto: "Se ha bloqueado un archivo peligroso en Descargas", esperado: "urgente" },
  { app: "WhatsApp", titulo: "Mamá", texto: "¿Vienes a comer el domingo?", esperado: "normal" },
  { app: "Outlook", titulo: "Pedro Ruiz", texto: "Te mando el informe revisado, échale un vistazo cuando puedas", esperado: "normal" },
  { app: "Microsoft Store", titulo: "¡Ofertas de otoño!", texto: "Hasta un 50 % de descuento en juegos y apps", esperado: "ruido" },
  { app: "Microsoft Edge", titulo: "Novedades de Edge", texto: "Descubre las nuevas funciones de la barra lateral", esperado: "ruido" },
  { app: "OneDrive", titulo: "Todo al día", texto: "Tus archivos están sincronizados", esperado: "ruido" },
];
