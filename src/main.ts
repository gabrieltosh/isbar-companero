// Arranque de la isla: estados compacta/expandida, carrusel de vistas, reloj y avisos.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AJUSTES_POR_DEFECTO, EVENTO_AJUSTES, NOMBRES_VISTAS, leerAjustes, type Ajustes } from "./ajustes";
import { alAviso, alCompacta, alTerminarAviso } from "./bus";
import { hayMusica, musicaSonando } from "./estado/musica";
import { barras, icono } from "./icons";
import { iniciarSonido } from "./sonido";
import { guardar, leer } from "./store";
import { $ } from "./util";
import { avisos } from "./widgets/avisos";
import { calendario } from "./widgets/calendar";
import { claude } from "./widgets/claude";
import { media } from "./widgets/media";
import { iniciarNotificaciones } from "./widgets/notification";
import { pausas } from "./widgets/pausas";
import { pomodoro } from "./widgets/pomodoro";
import { bandeja } from "./widgets/shelf";
import type { Compacta, Vista } from "./widgets/tipos";
import { tareasVista } from "./widgets/todo";
import { agua } from "./widgets/water";

const VISTAS: Vista[] = [media, pomodoro, agua, bandeja, tareasVista, calendario, claude, pausas, avisos];

// Icono de cada vista en la navegación de la cabecera (Música usa las barritas animadas)
const ICONO_VISTA: Record<string, string> = {
  pomodoro: icono.cronometro,
  agua: icono.gota,
  bandeja: icono.bandeja,
  tareas: icono.lista,
  calendario: icono.calendario,
  claude: icono.claude,
  pausas: icono.postura,
};

// Deben coincidir con los tamaños de styles.css
const TAM = {
  compacta: { w: 150, h: 34 },
  expandida: { w: 510, h: 180 },
};
/** Vistas que necesitan la isla más alta. Una vista también puede pedirlo según su estado (Vista.alto). */
const ALTO_VISTA: Record<string, number> = {
  calendario: 270, // para que el mes se lea bien
};
/** Píldora compacta sin iconos a los lados: solo la hora. */
const ANCHO_COMPACTA_SOLA = 88;
/** Píldora compacta con "N notificaciones" en lugar de la hora. */
const ANCHO_COMPACTA_ANCHA = 184;
/** Durante una notificación la isla se ajusta al aviso. */
const ALTO_NOTIFICACION = 116;
/** Vista que se abre si no hay ninguna guardada (o la guardada no está disponible). */
const VISTA_POR_DEFECTO = "calendario";
const RETARDO_SALIDA = 400;
const DURACION_TRANSICION = 380;

const isla = $(document, "#isla");
const contVistas = $(document, "#vistas");
const puntos = $(document, "#puntos");
const titulo = $(document, "#titulo");

let abierta = false;
let raton = false; // el cursor está sobre la píldora (lo dice Rust)
let avisoHasta = 0;
// Vistas activas, en el orden de la configuración (índices de VISTAS)
let orden: number[] = VISTAS.map((_, i) => i);
let posicion = 0;
let escala = 1;
let ajustes: Ajustes = AJUSTES_POR_DEFECTO;
let habiaMusica = false;
let pendientes = 0; // notificaciones sin descartar
let tSalida = 0;
// Hasta restaurar la última vista guardada no se guarda ninguna (el arranque no cuenta)
let vistaRestaurada = false;

// ---------- Estados compacta / expandida ----------

/** Informa a Rust del rectángulo de la píldora para el click-through. */
/** Alto de la isla expandida para la vista actual, sin contar notificaciones. */
function altoVista(): number {
  const id = isla.dataset.vista ?? "";
  return VISTAS.find((v) => v.id === id)?.alto?.() ?? ALTO_VISTA[id] ?? TAM.expandida.h;
}

/** Alto que le corresponde a la isla expandida por la vista actual (o por una notificación). */
function altoNatural(): number {
  return isla.classList.contains("con-notificacion") ? ALTO_NOTIFICACION : altoVista();
}

/** El alto lo decide este archivo: se le pasa al CSS (--alto-vista) y a Rust (rect). */
let altoAplicado = 0;
function actualizarAlto(): void {
  const alto = altoVista();
  if (alto === altoAplicado) return;
  altoAplicado = alto;
  isla.style.setProperty("--alto-vista", `${alto}px`);
  if (abierta) informarRect("expandida");
}

function informarRect(estado: keyof typeof TAM): void {
  const alto = estado === "expandida" ? altoNatural() : TAM[estado].h;
  let ancho = TAM[estado].w;
  if (estado === "compacta" && isla.classList.contains("sola")) ancho = ANCHO_COMPACTA_SOLA;
  if (estado === "compacta" && isla.classList.contains("ancha")) ancho = ANCHO_COMPACTA_ANCHA;
  const w = ancho * escala;
  const h = alto * escala;
  invoke("set_island_rect", { x: (window.innerWidth - w) / 2, y: 0, w, h }).catch(console.error);
}

function abrir(): void {
  if (abierta) return;
  abierta = true;
  isla.classList.add("abierta");
  informarRect("expandida");
}

function cerrar(): void {
  const escribiendo = document.activeElement instanceof HTMLInputElement;
  if (!abierta || raton || escribiendo || Date.now() < avisoHasta) return;
  abierta = false;
  isla.classList.remove("abierta", "aviso");
  // Mantiene el área grande hasta que termina la animación
  window.setTimeout(() => {
    if (!abierta) informarRect("compacta");
  }, DURACION_TRANSICION);
}

function programarCierre(): void {
  window.clearTimeout(tSalida);
  tSalida = window.setTimeout(cerrar, RETARDO_SALIDA);
}

listen<boolean>("isla-hover", ({ payload }) => {
  raton = payload;
  // Sin el cursor encima, la ventana no recibe el ratón y el webview se quedaría con el
  // último :hover puesto (un icono "encendido"); así se suelta
  isla.classList.toggle("sin-raton", !raton);
  window.clearTimeout(tSalida);
  if (raton) abrir();
  else programarCierre();
}).catch(console.error);

// Al perder el foco (clic fuera de la isla) se suelta el campo de texto
window.addEventListener("blur", () => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});
document.addEventListener("focusout", () => {
  if (!raton) programarCierre();
});

// Un aviso cerrado antes de tiempo (botón "Cerrar" de una notificación) deja cerrar la isla
alTerminarAviso(() => {
  avisoHasta = 0;
  cerrar();
});

alAviso(({ vista, duracion = 5000 }) => {
  if (vista) irAVista(vista);
  avisoHasta = Date.now() + duracion;
  abrir();
  // Reinicia la animación de aviso aunque ya estuviera puesta
  isla.classList.remove("aviso");
  void isla.offsetWidth;
  isla.classList.add("aviso");
  window.setTimeout(() => {
    if (!raton) cerrar();
  }, duracion + 50);
});

// ---------- Carrusel de vistas ----------

const paneles = VISTAS.map((v) => {
  const panel = document.createElement("section");
  panel.className = "vista";
  contVistas.append(panel);
  v.montar(panel);
  return panel;
});

/** Va a la posición n dentro de las vistas activas (con vuelta al principio). */
function ir(n: number): void {
  posicion = (n + orden.length) % orden.length;
  const activa = orden[posicion];
  paneles.forEach((p, i) => {
    p.classList.toggle("activa", i === activa);
    p.classList.toggle("antes", orden.indexOf(i) < posicion);
  });
  isla.dataset.vista = VISTAS[activa].id;
  titulo.innerHTML = VISTAS[activa].titulo;
  marcarIconoActivo();
  // El alto cambia según la vista (Calendario es más alto)
  actualizarAlto();
  // Se recuerda para la próxima vez que se abra la isla o la app
  if (vistaRestaurada) void guardar("ultimaVista", VISTAS[activa].id);
}

/** Va a una vista por su id, si está activa. */
function irAVista(id: string): void {
  const p = orden.findIndex((i) => VISTAS[i].id === id);
  if (p >= 0) ir(p);
}

puntos.addEventListener("click", (e) => {
  const boton = (e.target as HTMLElement).closest<HTMLElement>("[data-pos]");
  if (boton) ir(Number(boton.dataset.pos));
});

let ultimaRueda = 0;
isla.addEventListener(
  "wheel",
  (e) => {
    // Dentro de una lista con desplazamiento (notificaciones, tareas) la rueda la desplaza
    if (dentroDeScroll(e.target)) return;
    // Solo la rueda vertical cambia de sección (el desplazamiento horizontal no)
    if (e.deltaY === 0) return;
    const ahora = Date.now();
    if (!abierta || ahora - ultimaRueda < 300) return;
    ultimaRueda = ahora;
    ir(posicion + (e.deltaY > 0 ? 1 : -1));
  },
  { passive: true },
);

/** El elemento está dentro de algo que se desplaza en vertical y tiene contenido de sobra. */
function dentroDeScroll(objetivo: EventTarget | null): boolean {
  for (let el = objetivo instanceof Element ? objetivo : null; el && el !== isla; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return true;
  }
  return false;
}

// ---------- Reloj y vista compacta ----------

const fmtFecha = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtHora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });
let horaActual = "";

function pintarReloj(): void {
  const ahora = new Date();
  horaActual = fmtHora.format(ahora);
  $(document, "#fecha").textContent = fmtFecha.format(ahora).replace(/,/g, "");
  $(document, "#hora").textContent = horaActual;
  pintarCompacta();
  // Siguiente actualización justo al cambiar de minuto
  window.setTimeout(pintarReloj, 60_000 - (Date.now() % 60_000) + 50);
}

const cIzq = $(document, "#c-izq");
const cCentro = $(document, "#c-centro");
const cDer = $(document, "#c-der");

function fijarHtml(el: HTMLElement, html: string): void {
  // Solo se reescribe si cambia, para no reiniciar animaciones
  if (el.innerHTML !== html) el.innerHTML = html;
}

function pintarCompacta(): void {
  let c: Required<Compacta> = {
    // La campana solo aparece si hay notificaciones pendientes, y entonces en lugar de la
    // hora se avisa de cuántas hay (salvo que una vista muestre algo más importante)
    izq: pendientes > 0 ? `<span class="campana pendientes">${icono.campana}</span>` : "",
    centro:
      pendientes > 0
        ? `<span class="c-notif">${pendientes} ${pendientes === 1 ? "notificación" : "notificaciones"}</span>`
        : `<span class="c-hora">${horaActual}</span>`,
    der: "",
  };
  for (const v of VISTAS) c = { ...c, ...v.compacta?.() };
  fijarHtml(cIzq, c.izq);
  fijarHtml(cCentro, c.centro);
  fijarHtml(cDer, c.der);
  // Sin iconos a los lados la píldora se estrecha; con "N notificaciones" se ensancha.
  // El rect se reenvía por el MutationObserver
  isla.classList.toggle("sola", !c.izq && !c.der);
  isla.classList.toggle("ancha", c.centro.includes("c-notif"));
  // Sin sesión de música tampoco se muestra la vista de Música (ni su icono abajo)
  const musica = hayMusica();
  if (musica !== habiaMusica) {
    habiaMusica = musica;
    calcularOrden();
  }
  // Las barritas de Música se animan mientras suena
  const iconoMusica = puntos.querySelector<HTMLElement>('[data-vista="media"]');
  if (iconoMusica) fijarHtml(iconoMusica, barras(musicaSonando()));
}

alCompacta(() => {
  pintarCompacta();
  // Una vista puede cambiar de alto según su estado (p. ej. al empezar una rutina de pausas)
  actualizarAlto();
});

// ---------- Ajustes ----------

/** Vistas activas según la configuración y si hay música. */
function calcularOrden(preferida = VISTAS[orden[posicion]]?.id): void {
  orden = ajustes.vistas
    .filter((id) => !ajustes.ocultas.includes(id) && (id !== "media" || hayMusica()))
    .map((id) => VISTAS.findIndex((v) => v.id === id))
    .filter((i) => i >= 0);
  // Siempre queda al menos una vista (la primera que no sea Música)
  if (orden.length === 0) orden = [VISTAS.findIndex((v) => v.id !== "media")];
  // Notificaciones: no está en la configuración; aparece mientras haya pendientes (o si se está
  // viendo, para que al borrarlas todas no salte de vista) y se abre con la campana
  if (pendientes > 0 || preferida === "avisos") orden.push(VISTAS.indexOf(avisos));
  // Barra de navegación: un icono por vista activa, en el orden de la configuración.
  // El Calendario no lleva icono: se abre pulsando la fecha de arriba (y con la rueda)
  puntos.innerHTML = orden
    .map((i, p) => {
      const id = VISTAS[i].id;
      if (id === "calendario" || id === "avisos") return "";
      const nombre = NOMBRES_VISTAS[id] ?? "";
      const simbolo = id === "media" ? barras(musicaSonando()) : (ICONO_VISTA[id] ?? "");
      return `<button class="icono-cab" data-pos="${p}" data-vista="${id}" title="${nombre}" aria-label="${nombre}">${simbolo}</button>`;
    })
    .join("");
  const buscar = (id?: string) => orden.findIndex((i) => VISTAS[i].id === id);
  const p = buscar(preferida);
  const porDefecto = buscar(VISTA_POR_DEFECTO);
  ir(p >= 0 ? p : porDefecto >= 0 ? porDefecto : 0);
}

/** El icono de la vista que se está viendo va en blanco y subrayado. */
function marcarIconoActivo(): void {
  const actual = isla.dataset.vista;
  puntos.querySelectorAll<HTMLElement>("[data-vista]").forEach((b) => {
    const activo = b.dataset.vista === actual;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-current", activo ? "true" : "false");
  });
  // En el Calendario, lo que se marca es la fecha de arriba (su acceso)
  const fecha = $(document, "#reloj");
  fecha.classList.toggle("activo", actual === "calendario");
  fecha.setAttribute("aria-current", actual === "calendario" ? "true" : "false");
  // En Notificaciones, la campana
  $(document, "#campana").classList.toggle("activo", actual === "avisos");
}

async function aplicarAjustes(): Promise<void> {
  const a = await leerAjustes();
  ajustes = a;
  if (vistaRestaurada) {
    calcularOrden();
  } else {
    const guardada = await leer("ultimaVista", VISTA_POR_DEFECTO);
    // Si mientras tanto saltó un aviso (p. ej. una pausa vencida al arrancar), manda su vista
    calcularOrden(Date.now() < avisoHasta ? undefined : guardada);
    vistaRestaurada = true;
  }

  escala = a.escala;
  document.documentElement.style.setProperty("--escala", String(escala));
  // Rust redimensiona y recoloca la ventana; el rect se reenvía al cambiar de tamaño
  await invoke("aplicar_ajustes_ventana", {
    ajustes: { escala: a.escala, desplazamiento: a.desplazamiento, monitor: a.monitor },
  }).catch(console.error);
  informarRect(abierta ? "expandida" : "compacta");
  // Rust muestra la isla o el compañero según el estilo elegido
  await invoke("aplicar_estilo", { estilo: a.estilo }).catch(console.error);
}

window.addEventListener("resize", () => informarRect(abierta ? "expandida" : "compacta"));
listen(EVENTO_AJUSTES, () => void aplicarAjustes()).catch(console.error);

// ---------- Arranque ----------

// Campana: solo visible (con punto rojo) mientras haya notificaciones sin descartar.
// Abre la vista de Notificaciones, donde se leen y se descartan
const campana = $(document, "#campana");
campana.innerHTML = icono.campana;
campana.addEventListener("click", () => irAVista("avisos"));
function fijarPendientes(total: number): void {
  const habia = pendientes > 0;
  pendientes = total;
  // La vista de Notificaciones entra o sale de la rueda (si no se está viendo)
  if (habia !== total > 0 && isla.dataset.vista !== "avisos") calcularOrden();
  campana.hidden = total === 0;
  campana.classList.toggle("pendientes", total > 0);
  campana.title = total > 0 ? `Notificaciones (${total} sin leer)` : "Notificaciones";
  pintarCompacta();
}
listen<number>("notification-count", ({ payload }) => fijarPendientes(payload)).catch(console.error);
invoke<number>("contar_notificaciones").then(fijarPendientes).catch(console.error);
$(document, "#reloj").addEventListener("click", () => irAVista("calendario"));
const engranaje = $(document, "#engranaje");
engranaje.innerHTML = icono.engranaje;
engranaje.addEventListener("click", () => {
  invoke("abrir_configuracion_cmd").catch(console.error);
});
iniciarSonido();
iniciarNotificaciones(isla, $(document, "#notificacion"));
// Cambia el tamaño al empezar o terminar una notificación, o al estrecharse la píldora: se reenvía el rect
new MutationObserver(() => {
  informarRect(abierta ? "expandida" : "compacta");
}).observe(isla, { attributes: true, attributeFilter: ["class"] });
calcularOrden();
pintarReloj();
informarRect("compacta");
void aplicarAjustes();
