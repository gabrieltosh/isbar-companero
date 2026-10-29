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

/** Cómo se hace la petición: en la app, con Rust (tauri-plugin-http); las pruebas fuera de la app
 * pueden poner el fetch normal. */
let pedir: (url: string, init: RequestInit) => Promise<Response> = fetch;
export function fijarFetchJev(f: (url: string, init: RequestInit) => Promise<Response>): void {
  pedir = f;
}

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

/** Puntuar en una escala: los niveles, de menos a más (la respuesta va de 0 al último). */
export interface PreguntaEscala {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type Pregunta = PreguntaEleccion | PreguntaSiNo | PreguntaEscala;

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

export interface RespuestaEscala {
  type: "score";
  /** Nivel esperado (de 0 al último nivel; con decimales: si duda, queda entre los niveles) */
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export type Respuesta = RespuestaEleccion | RespuestaSiNo | RespuestaEscala;

type RespuestaDe<Q> = Q extends PreguntaEleccion ? RespuestaEleccion : Q extends PreguntaEscala ? RespuestaEscala : RespuestaSiNo;

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
): Promise<{ modelo: string; respuestas: { [K in keyof P]: RespuestaDe<P[K]> } }> {
  const r = await pedir(URL_API, {
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

// ---------- Carácter de la canción (para el baile) ----------

export type Estilo = "rock" | "pop" | "electronica" | "balada" | "tranquila" | "fiesta";

/** Lo que se le cuenta a Jev de la canción: título, artista, álbum y géneros (si el reproductor
 * los da), y los números del ritmo (nunca el audio). */
export interface DatosCancion {
  titulo: string;
  artista: string;
  album?: string;
  generos?: string[];
  /** Pulsos por minuto, o null si aún no se sabe */
  ppm: number | null;
  /** Lo intensa que es esta parte (0 a 1), o null */
  intensidad: number | null;
}

/** El tono y la energía en dos escalas (de 0 a 4, con decimales: si Jev duda, quedan en medio,
 * así que nunca exageran). No cambian de una parte a otra: se preguntan una vez por canción. */
export interface Emocion {
  /** 0 muy triste · 1 algo triste · 2 neutra o agridulce · 3 alegre · 4 muy alegre */
  tono: number;
  /** 0 para escuchar quieto · 1 para mecerse · 2 para moverse un poco · 3 para bailar · 4 para saltar */
  energia: number;
  confianzaTono: number;
  confianzaEnergia: number;
}

/** El género de baile más probable y la probabilidad de cada uno (para mezclar si duda entre dos). */
export interface EstiloBaile {
  estilo: Estilo;
  confianzaEstilo: number;
  probabilidades: Partial<Record<Estilo, number>>;
}

export type Caracter = Emocion & EstiloBaile;

/** Los niveles de las dos escalas (probadas con canciones reales: mejor que elegir un ánimo cerrado,
 * donde la probabilidad se repartía entre ánimos parecidos como triste y nostálgica). */
const TONOS = ["Muy triste: dolor, desamor, pérdida", "Algo triste o melancólica", "Neutra o agridulce", "Alegre o positiva", "Muy alegre, eufórica"];
const ENERGIAS = ["Muy calmada, para escuchar quieto", "Tranquila, para mecerse", "Media, para moverse un poco", "Movida, para bailar", "Muy intensa, para saltar"];

const ESTILOS: Record<Estilo, string> = {
  rock: "Rock o metal: cabecear marcando el pulso",
  pop: "Pop bailable: rebotar y dar pasos a los lados",
  electronica: "Electrónica o dance: botar al compás",
  balada: "Balada lenta: mecerse despacio, como flotando",
  tranquila: "Acústica, chill o jazz: balancearse suave",
  fiesta: "Fiesta, latina o reguetón: moverse de lado a lado y dar vueltas",
};

/** Lo que se añade al título y no dice nada de la canción («- En Vivo en…», «- Remastered», «(feat. …)»). */
const COLETILLAS = [
  /\s*[-–—]\s*(en vivo|live|directo|remaster(ed|izad[oa])?|\d{4} remaster|versi[oó]n|version|acoustic|ac[uú]stic[oa]|radio edit|edit|remix|mix|single|deluxe|bonus|mono|stereo)\b.*$/i,
  /\s*[([](feat\.?|ft\.?|con|with|live|en vivo|directo|remaster[^)\]]*|versi[oó]n[^)\]]*|version[^)\]]*)[^)\]]*[)\]]/gi,
];
const EN_VIVO = /\b(en vivo|live|directo|concierto|unplugged)\b/i;

/** El título sin coletillas, y si es una versión en directo. */
export function limpiarTitulo(titulo: string): { titulo: string; enVivo: boolean } {
  let limpio = titulo;
  for (const r of COLETILLAS) limpio = limpio.replace(r, "");
  limpio = limpio.trim();
  return { titulo: limpio || titulo, enVivo: EN_VIVO.test(titulo) };
}

/** Pistas que no son la canción en sí: el álbum (limpio) y los géneros, si los hay. */
function pistas(c: DatosCancion): Record<string, string> {
  const r: Record<string, string> = {};
  if (c.album?.trim()) r.album = limpiarTitulo(c.album).titulo;
  if (c.generos?.length) r.generos = c.generos.join(", ");
  return r;
}

/**
 * Pregunta a Jev el tono y la energía de la canción, solo con el título limpio, el artista y el
 * álbum: el volumen y el tempo de un directo no dicen si la letra es triste.
 */
export async function emocionCancion(clave: string, c: DatosCancion): Promise<Emocion> {
  const { titulo } = limpiarTitulo(c.titulo);
  const { respuestas } = await preguntarJev(
    clave,
    { cancion: titulo, artista: c.artista, ...pistas(c) },
    {
      tono: {
        type: "score",
        instructions: "Qué tono emocional tiene esta canción por su letra y su tema (no por su volumen ni su ritmo)",
        criteria: TONOS,
      },
      energia: { type: "score", instructions: "Cuánta energía tiene esta canción para bailar", criteria: ENERGIAS },
    },
  );
  return {
    tono: respuestas.tono.score,
    energia: respuestas.energia.score,
    confianzaTono: respuestas.tono.confidence,
    confianzaEnergia: respuestas.energia.confidence,
  };
}

/** Pregunta a Jev qué baile le va, con todo: título, artista, álbum, géneros, tempo e intensidad. */
export async function estiloCancion(clave: string, c: DatosCancion): Promise<EstiloBaile> {
  const { titulo, enVivo } = limpiarTitulo(c.titulo);
  const parte = c.intensidad === null ? "desconocida" : c.intensidad < 0.35 ? "tranquila" : c.intensidad < 0.7 ? "media" : "intensa";
  const { respuestas } = await preguntarJev(
    clave,
    {
      cancion: titulo,
      artista: c.artista,
      ...pistas(c),
      version: enVivo ? "en vivo (el público y el volumen del directo no cambian el estilo)" : "de estudio",
      tempo: c.ppm === null ? "desconocido" : `${c.ppm} pulsos por minuto`,
      parte_de_la_cancion: parte,
    },
    { estilo: { type: "choice", instructions: "Qué género musical y forma de bailar le va a esta canción", criteria: ESTILOS } },
  );
  const e = respuestas.estilo;
  const probabilidades: Partial<Record<Estilo, number>> = {};
  for (const [k, v] of Object.entries(e.probabilities)) if (k in ESTILOS) probabilidades[k as Estilo] = v;
  return { estilo: (e.choice in ESTILOS ? e.choice : "pop") as Estilo, confianzaEstilo: e.confidence, probabilidades };
}

/** Las dos preguntas a la vez (la emoción y el estilo). */
export async function caracterCancion(clave: string, c: DatosCancion): Promise<Caracter> {
  const [emocion, estilo] = await Promise.all([emocionCancion(clave, c), estiloCancion(clave, c)]);
  return { ...emocion, ...estilo };
}

// ---------- Qué estás haciendo (ventana activa) ----------

export type Actividad = "reunion" | "concentrado" | "video" | "juego" | "charla" | "navegando" | "otro";

/** La ventana activa: programa (p. ej. "ms-teams.exe") y título. */
export interface DatosVentana {
  programa: string;
  titulo: string;
}

const ACTIVIDADES: Record<Actividad, string> = {
  reunion: "En una reunión, videollamada o llamada ahora mismo (Teams, Zoom, Meet, Webex, Discord en llamada…)",
  concentrado: "Concentrado trabajando: programando, escribiendo un documento, una hoja de cálculo, diseñando o estudiando",
  video: "Viendo un vídeo, una película, una serie o un directo",
  juego: "Jugando a un videojuego",
  charla: "Chateando o leyendo el correo o mensajes",
  navegando: "Navegando por internet, leyendo noticias o redes sociales",
  otro: "Otra cosa: explorador de archivos, ajustes, el escritorio…",
};

/** Pregunta a Jev qué está haciendo la persona según la ventana activa. */
export async function actividadVentana(clave: string, v: DatosVentana): Promise<{ actividad: Actividad; confianza: number }> {
  const { respuestas } = await preguntarJev(
    clave,
    { programa: v.programa, titulo_de_la_ventana: v.titulo },
    { actividad: { type: "choice", instructions: "Qué está haciendo ahora la persona que usa el ordenador, según la ventana que tiene delante", criteria: ACTIVIDADES } },
  );
  const r = respuestas.actividad;
  return { actividad: (r.choice in ACTIVIDADES ? r.choice : "otro") as Actividad, confianza: r.confidence };
}

/** Ventanas inventadas para probar (con lo que se espera). */
export const VENTANAS_EJEMPLO: (DatosVentana & { esperado: Actividad })[] = [
  { programa: "ms-teams.exe", titulo: "Reunión de seguimiento semanal | Microsoft Teams", esperado: "reunion" },
  { programa: "zoom.exe", titulo: "Zoom Meeting", esperado: "reunion" },
  { programa: "chrome.exe", titulo: "Meet - abc-defg-hij - Google Chrome", esperado: "reunion" },
  { programa: "code.exe", titulo: "main.ts - isbar-companero - Visual Studio Code", esperado: "concentrado" },
  { programa: "winword.exe", titulo: "Informe trimestral.docx - Word", esperado: "concentrado" },
  { programa: "excel.exe", titulo: "Presupuesto 2026.xlsx - Excel", esperado: "concentrado" },
  { programa: "chrome.exe", titulo: "Lo-fi beats para estudiar - YouTube - Google Chrome", esperado: "video" },
  { programa: "vlc.exe", titulo: "Interstellar.mkv - Reproductor multimedia VLC", esperado: "video" },
  { programa: "eldenring.exe", titulo: "ELDEN RING™", esperado: "juego" },
  { programa: "ms-teams.exe", titulo: "Chat | Ana García | Microsoft Teams", esperado: "charla" },
  { programa: "olk.exe", titulo: "Bandeja de entrada - Outlook", esperado: "charla" },
  { programa: "msedge.exe", titulo: "Últimas noticias - El País - Microsoft Edge", esperado: "navegando" },
  { programa: "explorer.exe", titulo: "Descargas", esperado: "otro" },
];
