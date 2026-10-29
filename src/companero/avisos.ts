// Todo lo que hace hablar al compañero: notificaciones de Windows, música, Pomodoro, agua y
// pausas activas. Cada cosa llega como un globo (globos.ts) y, a veces, con un gesto.
// El estado (estado/*) vive solo en la ventana del compañero: aquí se inicia.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTO_AJUSTES, GLOBOS_POR_DEFECTO, JEV_POR_DEFECTO, type ConfigGlobos, type ConfigJev } from "../ajustes";
import { importanciaNotificacion, jevDisponible, type Importancia } from "../estado/jev";
import { responder, responderMusica } from "./respuestas";
import { beber, configAgua, iniciarAgua, mlHoy, recordatorioAgua } from "../estado/agua";
import {
  cambioCancion,
  cambiosMusica,
  cancionAnterior,
  cancionSiguiente,
  infoMusica,
  iniciarMusica,
  musicaSonando,
  reproducirPausar,
  type InfoMedia,
} from "../estado/musica";
import {
  AVISO_PAUSA,
  DURACION_FIN_PAUSA,
  NOMBRE_PAUSA,
  cambiosPausas,
  cuandoPausa,
  detenerPausa,
  estadoPausas,
  iniciarPausas,
  pasoPausa,
  pausaDetenida,
  pausaPendiente,
  pausaTerminada,
  proximaPausa,
  resolverPausa,
  siguientePaso,
} from "../estado/pausas";
import { alternarPomodoro, duracion, estadoPomodoro, iniciarPomodoro, pomodoroTerminado } from "../estado/pomodoro";
import { iniciarSonido } from "../sonido";
import { guardar, leer } from "../store";
import type { Expresion } from "./cara";
import { actualizar, avisar, cerrar, globoActual, iniciarGlobos, pideAtencion } from "./globos";
import { modoActividad } from "./actividad";
import { gesto } from "./vida";

/** Lo que tarda en irse cada tipo de globo (ms). */
const DURACION_NOTIFICACION = 7000;
const DURACION_CANCION = 5000;
const DURACION_AVISO = 9000;
/** "Más tarde" vuelve a mostrar la notificación pasado este tiempo. */
const POSPONER_NOTIFICACION = 10 * 60_000;
/** Con menos confianza que esto, la decisión de Jev no se usa y la notificación sale normal. */
const CONFIANZA_JEV = 0.55;
/** Apps cuya notificación ya se ve en el globo de la canción. */
const REPRODUCTORES = /spotify|music|música|media player|reproductor/i;

interface Notificacion {
  id: number;
  app: string;
  icono: string | null;
  titulo: string;
  texto: string;
}

// ---------- Notificaciones de Windows ----------

/** Tras la primera notificación, se sugiere una vez quitar los banners de Windows (para no verla dos veces). */
async function sugerirQuitarBanners(): Promise<void> {
  if (await leer("sugerenciaBanners", false)) return;
  void guardar("sugerenciaBanners", true);
  avisar({
    origen: "isbar",
    titulo: "¿Te las enseño solo yo?",
    texto: "Activa «No molestar» en Windows y no verás cada notificación dos veces. Yo las seguiré viendo.",
    duracion: 0,
    gesto: "guino",
    acciones: [
      { id: "ajustes", texto: "Abrir ajustes", principal: true },
      { id: "no", texto: "No, gracias" },
    ],
    alAccion: (accion) => {
      if (accion === "ajustes") invoke("abrir_ajustes_banners").catch(console.error);
    },
  });
}

// ---------- Filtro con Jev ----------

let configJev: ConfigJev = JEV_POR_DEFECTO;

async function cargarConfigJev(): Promise<void> {
  configJev = { ...JEV_POR_DEFECTO, ...(await leer<Partial<ConfigJev>>("jevConfig", {})) };
}

/**
 * Con Jev activado, decide si la notificación es urgente, normal o ruido. Si está apagado, falla,
 * tarda o duda, es «normal» (lo de siempre). Cada decisión queda en la consola para comparar.
 */
async function clasificarNotificacion(n: Notificacion): Promise<Importancia> {
  if (!jevDisponible(configJev) || !configJev.notificaciones) return "normal";
  try {
    const { importancia, confianza } = await importanciaNotificacion(configJev.clave, n);
    console.info(`jev: «${n.app} · ${n.titulo}» → ${importancia} (${Math.round(confianza * 100)} %)`);
    return confianza < CONFIANZA_JEV ? "normal" : importancia;
  } catch (e) {
    console.warn("jev: sin decisión, notificación normal:", e);
    return "normal";
  }
}

/** Globo de una notificación. Las urgentes pasan delante y esperan aunque estés fuera (hasta que respondas). */
function avisarNotificacion(n: Notificacion, urgente = false): void {
  const abrir = () => invoke("abrir_notificacion", { id: n.id }).catch(console.error);
  avisar({
    origen: urgente ? `${n.app} · urgente` : n.app,
    titulo: n.titulo || n.app,
    texto: n.texto,
    imagen: n.icono,
    duracion: urgente ? 0 : DURACION_NOTIFICACION,
    gesto: urgente ? "sorpresa" : "notificacion",
    urgente,
    // Mientras se ve, deja lo que estaba haciendo (bailar incluido) y lo atiende
    atencion: urgente,
    // Varias seguidas de la misma app: solo la última (todas siguen en la pestaña Avisos)
    grupo: urgente ? undefined : `notificacion:${n.app}`,
    acciones: [
      { id: "abrir", texto: "Abrir", principal: true },
      { id: "luego", texto: "Más tarde" },
      { id: "descartar", texto: "Descartar" },
    ],
    alAccion: (accion) => {
      if (accion === "abrir" || accion === "toque") {
        responder("si");
        void abrir();
      }
      // Se queda en Windows y vuelve a salir dentro de un rato
      if (accion === "luego") {
        responder("nose");
        window.setTimeout(() => avisarNotificacion(n, urgente), POSPONER_NOTIFICACION);
      }
      // Al borrarla, asiente cuando Windows cuenta un aviso menos (iniciarRespuestas)
      if (accion === "descartar") invoke("eliminar_notificacion", { id: n.id }).catch(console.error);
    },
  });
}

function iniciarNotificaciones(): void {
  void cargarConfigJev();
  listen(EVENTO_AJUSTES, () => void cargarConfigJev()).catch(console.error);
  listen<Notificacion>("notification-new", async ({ payload }) => {
    if (musicaSonando() && REPRODUCTORES.test(payload.app)) return;
    const importancia = await clasificarNotificacion(payload);
    // El ruido no sale en globo (sigue en Windows y en la pestaña Avisos)
    if (importancia === "ruido") return;
    avisarNotificacion(payload, importancia === "urgente");
    void sugerirQuitarBanners();
  }).catch(console.error);

  // Sin permiso: se avisa una vez con un botón para darlo. Sin paquete ("error"), en silencio
  let avisadoPermiso = false;
  listen<{ estado: string }>("notification-access", ({ payload }) => {
    if (avisadoPermiso || (payload.estado !== "denegado" && payload.estado !== "sin-decidir")) return;
    avisadoPermiso = true;
    avisar({
      origen: "isbar",
      titulo: "No puedo ver tus notificaciones",
      texto: "Dame permiso en la configuración de Windows para avisarte de ellas.",
      duracion: 0,
      gesto: "triste",
      acciones: [
        { id: "ajustes", texto: "Dar permiso", principal: true },
        { id: "no", texto: "Ahora no" },
      ],
      alAccion: (accion) => {
        if (accion === "ajustes") invoke("abrir_ajustes_notificaciones").catch(console.error);
      },
    });
  }).catch(console.error);
}

// ---------- Música ----------

let globoCancion: number | null = null;
let configGlobos: ConfigGlobos = GLOBOS_POR_DEFECTO;

async function cargarConfigGlobos(): Promise<void> {
  configGlobos = { ...GLOBOS_POR_DEFECTO, ...(await leer<Partial<ConfigGlobos>>("globosConfig", {})) };
}

function controlesMusica(info: Readonly<InfoMedia> | null) {
  return [
    { id: "anterior", texto: "Anterior", icono: "anterior" as const },
    {
      id: "play",
      texto: info?.reproduciendo ? "Pausar" : "Reproducir",
      icono: info?.reproduciendo ? ("pausa" as const) : ("play" as const),
    },
    { id: "siguiente", texto: "Siguiente", icono: "siguiente" as const },
  ];
}

function iniciarCanciones(): void {
  iniciarMusica();
  void cargarConfigGlobos();
  listen(EVENTO_AJUSTES, () => void cargarConfigGlobos()).catch(console.error);
  cambioCancion.escuchar((info) => {
    // Se puede apagar en Configuración → Globos
    if (!info.reproduciendo || !configGlobos.cancion) return;
    if (globoCancion !== null && globoActual() === globoCancion) cerrar(globoCancion);
    globoCancion = avisar({
      origen: info.app ? `Sonando en ${info.app}` : "Sonando",
      titulo: info.titulo || "Sin título",
      texto: info.artista,
      imagen: info.caratula,
      duracion: DURACION_CANCION,
      // Otra canción sustituye a la que esperaba su turno
      grupo: "cancion",
      acciones: controlesMusica(info),
      alAccion: (accion) => {
        responderMusica(accion);
        if (accion === "anterior") cancionAnterior();
        if (accion === "play") reproducirPausar();
        if (accion === "siguiente") cancionSiguiente();
      },
    });
  });
  // El botón de reproducir/pausar del globo cambia con el estado
  cambiosMusica.escuchar(() => {
    if (globoCancion !== null) actualizar(globoCancion, { acciones: controlesMusica(infoMusica()) });
  });
}

// ---------- Pomodoro ----------

function iniciarAvisosPomodoro(): void {
  iniciarPomodoro();
  pomodoroTerminado.escuchar((modo) => {
    const siguiente = estadoPomodoro().modo;
    const minutos = Math.round(duracion(siguiente) / 60_000);
    const fueEnfoque = modo === "enfoque";
    avisar({
      origen: "Pomodoro",
      titulo: fueEnfoque ? "¡Bloque de enfoque terminado!" : "Se acabó el descanso",
      texto: fueEnfoque ? `Te toca descansar ${minutos} min.` : `¿Otro bloque de ${minutos} min?`,
      duracion: 0,
      gesto: fueEnfoque ? "celebra" : "saludo",
      urgente: true,
      acciones: [
        { id: "empezar", texto: fueEnfoque ? "Descansar" : "Empezar", principal: true },
        { id: "luego", texto: "Luego" },
      ],
      alAccion: (accion) => {
        if (accion === "empezar" && !estadoPomodoro().corriendo) {
          responder("si");
          alternarPomodoro();
        }
        if (accion === "luego") responder("nose");
      },
    });
  });
}

// ---------- Agua ----------

function iniciarAvisosAgua(): void {
  iniciarAgua();
  recordatorioAgua.escuchar(() => {
    const litros = (ml: number) => (ml / 1000).toFixed(1).replace(".", ",");
    avisar({
      origen: "Agua",
      titulo: "Hora de beber agua",
      texto: `Llevas ${litros(mlHoy())} de ${litros(configAgua().meta)} L hoy.`,
      duracion: DURACION_AVISO,
      gesto: "notificacion",
      acciones: [
        { id: "beber", texto: "Bebí agua", principal: true },
        { id: "luego", texto: "Luego" },
      ],
      alAccion: (accion) => {
        if (accion !== "beber") return;
        beber();
        gesto(mlHoy() >= configAgua().meta ? "celebra" : "feliz", 1600);
      },
    });
  });
}

// ---------- Pausas activas ----------

let globoPausa: number | null = null;

/** El paso de la rutina en curso, para el globo (se actualiza cada fracción de segundo). */
function contenidoPaso() {
  const estado = estadoPausas();
  if (estado.modo !== "rutina") return null;
  const paso = estado.pasos[estado.indice];
  const total = estado.pasos[estado.pasos.length - 1].numero;
  const segundos = Math.max(0, Math.ceil((estado.finPaso - Date.now()) / 1000));
  const ultimo = estado.indice === estado.pasos.length - 1;
  return {
    origen: `${NOMBRE_PAUSA[estado.tipo]} · ejercicio ${paso.numero} de ${total} · ${segundos} s`,
    titulo: paso.ejercicio.nombre,
    texto: paso.texto,
    acciones: [
      { id: "detener", texto: "Detener" },
      { id: "siguiente", texto: ultimo ? "Terminar" : "Siguiente", principal: true },
    ],
  };
}

function iniciarAvisosPausas(): void {
  iniciarPausas();
  pausaPendiente.escuchar((tipo) => {
    globoPausa = avisar({
      origen: "Pausa activa",
      titulo: AVISO_PAUSA[tipo].titulo,
      texto: AVISO_PAUSA[tipo].detalle,
      // Se queda hasta que respondas: si no, la pausa quedaría esperando sin forma de verla
      duracion: 0,
      gesto: tipo === "postura" ? "bostezo" : "cansado",
      acciones: [
        { id: "empezar", texto: "Empezar", principal: true },
        { id: "posponer", texto: "5 min más" },
        { id: "saltar", texto: "Saltar" },
      ],
      alAccion: (accion) => resolverPausa(accion as "empezar" | "posponer" | "saltar"),
    });
  });

  // Cada paso de la rutina se sigue en el mismo globo
  pasoPausa.escuchar(() => {
    const paso = contenidoPaso();
    if (!paso) return;
    if (globoPausa !== null && globoActual() === globoPausa) {
      actualizar(globoPausa, paso);
      return;
    }
    globoPausa = avisar({
      ...paso,
      duracion: 0,
      urgente: true,
      alAccion: (accion) => {
        if (accion === "detener") {
          responder("no");
          detenerPausa();
        }
        if (accion === "siguiente") {
          responder("si");
          siguientePaso();
        }
      },
    });
  });
  cambiosPausas.escuchar(() => {
    const paso = contenidoPaso();
    if (paso && globoPausa !== null) actualizar(globoPausa, paso);
  });

  pausaTerminada.escuchar((tipo) => {
    if (globoPausa !== null) cerrar(globoPausa);
    globoPausa = null;
    avisar({
      origen: "Pausa activa",
      titulo: "¡Bien hecho!",
      texto: `Próxima pausa de ${NOMBRE_PAUSA[tipo].toLowerCase()} ${cuandoPausa(proximaPausa(tipo))}.`,
      duracion: DURACION_FIN_PAUSA,
      gesto: "celebra",
      urgente: true,
    });
  });
  pausaDetenida.escuchar(() => {
    if (globoPausa !== null) cerrar(globoPausa);
    globoPausa = null;
  });
}

// ---------- Arranque ----------

/** Lo que la app pide al compañero ahora mismo (sin contar los globos), o null. */
export function peticionApp(): Expresion | null {
  // Una urgente a la vista pasa por delante de la música: deja de bailar y la atiende
  if (pideAtencion()) return "notificacion";
  // En una reunión, con un vídeo o jugando no baila (aunque suene algo)
  if (musicaSonando() && !modoActividad().quieto) return "musica";
  return null;
}

/** Progreso del Pomodoro en curso (0 a 1) y si es de enfoque, para dibujar el anillo; o null. */
export function progresoPomodoro(): { progreso: number; enfoque: boolean } | null {
  const e = estadoPomodoro();
  if (!e.corriendo) return null;
  const total = duracion(e.modo);
  return { progreso: 1 - Math.max(0, e.finEn - Date.now()) / total, enfoque: e.modo === "enfoque" };
}

export function iniciarAvisos(): void {
  iniciarSonido();
  iniciarGlobos();
  iniciarNotificaciones();
  iniciarCanciones();
  iniciarAvisosPomodoro();
  iniciarAvisosAgua();
  iniciarAvisosPausas();
}
