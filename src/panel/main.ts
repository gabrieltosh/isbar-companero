// Panel del compañero: una barra de 7 iconos (la pestaña activa enseña su nombre). Inicio es
// solo un resumen en tarjetas compactas que llevan a su pestaña (algunas pasan de un dato a otro
// como un carrusel); Avisos (notificaciones de Windows), Música, Pomodoro, Pausas, Tareas (pronto)
// y Sistema (batería, volumen, conexión y uso del PC). El estado lo tiene el compañero: aquí se
// pinta su "foto" y se le mandan órdenes. Las notificaciones y el estado del sistema sí se piden
// directamente a Rust.
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { $, escapar, mmss } from "../util";
import { EVENTO_SISTEMA, duracionLegible, type EstadoSistema } from "../estado/sistema";
import { EVENTO_ESTADO, EVENTO_ORDEN, EVENTO_PEDIR, EVENTO_VISIBLE, type EstadoPanel, type OrdenPanel } from "./tipos";
import type { Estilo } from "../estado/jev";

interface Notificacion {
  id: number;
  fecha: number;
  app: string;
  icono: string | null;
  titulo: string;
  texto: string;
}

const svg = (d: string, relleno = false) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" ${relleno ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
const ICONO = {
  play: svg("M8 5.5v13l10.5-6.5z", true),
  pausa: svg("M6.5 5h3.6v14H6.5zM13.9 5h3.6v14h-3.6z", true),
  anterior: svg("M11.5 6v12L3 12zM21 6v12l-8.5-6z", true),
  siguiente: svg("M12.5 6v12L21 12zM3 6v12l8.5-6z", true),
  reiniciar: svg("M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"),
  gota: svg("M12 3.2c3.3 4 6 7.2 6 10.6a6 6 0 0 1-12 0c0-3.4 2.7-6.6 6-10.6z", true),
  ajustes: svg("M4 8h10M18 8h2M4 16h2M10 16h10M16 6v4M8 14v4"),
  cerrar: svg("M7 7l10 10M17 7 7 17"),
  // Pestañas
  inicio: svg("M4 11l8-6.5 8 6.5M6 9.5V19h12V9.5"),
  avisos: svg("M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"),
  musica: svg("M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"),
  pomodoro: svg("M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2.5h4"),
  pausas: svg("M12 6.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6zM5 9l7 1.5L19 9M12 10.5V15l-3 6M12 15l3 6"),
  tareas: svg("M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"),
  sistema: svg("M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"),
  volumen: svg("M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"),
  silencio: svg("M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5"),
};

const NOMBRE_MODO = { enfoque: "Enfoque", corto: "Descanso corto", largo: "Descanso largo" } as const;
/** Pausas: título de su tarjeta y del botón para empezarla. */
const PAUSA = {
  postura: { titulo: "Pausa de postura", boton: "Estirar ahora" },
  vista: { titulo: "Pausa de vista", boton: "Descansar la vista" },
} as const;
/** Cómo se dicen el tono, la energía (escalas de 0 a 4) y el estilo de la canción (Jev). */
const nombreTono = (t: number) => (t < 1 ? "muy triste" : t < 1.75 ? "triste" : t < 2.5 ? "neutra" : t < 3.25 ? "alegre" : "muy alegre");
const nombreEnergia = (e: number) => (e < 1 ? "muy calmada" : e < 1.75 ? "tranquila" : e < 2.5 ? "media" : e < 3.25 ? "movida" : "muy intensa");
const NOMBRE_ESTILO: Record<string, string> = {
  rock: "rockero",
  pop: "pop",
  electronica: "electrónico",
  balada: "de balada",
  tranquila: "tranquilo",
  fiesta: "de fiesta",
};
/** Cada cuánto pasan los datos de las tarjetas carrusel del Inicio. */
const CARRUSEL_MS = 4000;
/** Lo que dura el fundido al pasar de un dato a otro. */
const FUNDIDO_MS = 180;
/** Con la rueda, como mucho un cambio cada tanto (el touchpad manda muchos giros seguidos). */
const RUEDA_MS = 350;

let estado: EstadoPanel | null = null;
let avisos: Notificacion[] = [];

const ordenar = (o: OrdenPanel) => void emit(EVENTO_ORDEN, o);

/**
 * Cambia el contenido de un elemento solo si es distinto. El panel se repinta cada medio
 * segundo: si se reescribiera un botón mientras se pulsa, el clic se perdería.
 */
const htmlPuesto = new WeakMap<HTMLElement, string>();
function fijarHtml(el: HTMLElement, html: string): void {
  // Se compara con lo último que se puso (el navegador reescribe el SVG al guardarlo)
  if (htmlPuesto.get(el) === html) return;
  htmlPuesto.set(el, html);
  el.innerHTML = html;
}

// ---------- Cabecera y pestañas ----------

function pintarCabecera(): void {
  const h = new Date().getHours();
  $(document, "#saludo").textContent = h < 6 || h >= 20 ? "Buenas noches" : h < 12 ? "Buenos días" : "Buenas tardes";
  $(document, "#fecha").textContent = new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

function irA(vista: string): void {
  document.querySelectorAll<HTMLElement>("[data-vista]").forEach((e) => e.classList.toggle("activa", e.dataset.vista === vista));
  if (vista === "avisos") void cargarAvisos();
}

// Cada pestaña lleva su icono delante del nombre (el nombre solo se ve en la activa)
document.querySelectorAll<HTMLElement>(".pestanas [data-vista]").forEach((b) => {
  const icono = ICONO[b.dataset.vista as keyof typeof ICONO];
  if (icono) b.insertAdjacentHTML("afterbegin", icono);
});

$(document, ".pestanas").addEventListener("click", (e) => {
  const boton = (e.target as HTMLElement).closest<HTMLElement>("[data-vista]");
  if (boton?.dataset.vista) irA(boton.dataset.vista);
});

const ajustes = $(document, "#ajustes");
ajustes.innerHTML = ICONO.ajustes;
const abrirConfiguracion = () => {
  invoke("abrir_configuracion_cmd").catch(console.error);
  invoke("cerrar_panel").catch(console.error);
};
ajustes.addEventListener("click", abrirConfiguracion);

// ---------- Inicio: resumen en tarjetas ----------

/** Un dato de una tarjeta del resumen. */
interface Dato {
  etiqueta: string;
  valor: string;
  detalle?: string;
  /** Barrita de progreso (0 a 100) y su color */
  barra?: { pct: number; color: string };
}

/**
 * Tarjeta compacta del Inicio. Si tiene varios datos, pasan solos cada CARRUSEL_MS con un
 * fundido (con puntitos para saber cuál se ve) y se quedan quietos con el ratón encima.
 * También se pasan a mano: clic en un puntito o rueda del ratón sobre la tarjeta.
 */
class Tarjeta {
  private indice = 0;
  private encima = false;
  /** Último giro de rueda que cambió de dato (para no saltar varios de golpe con el touchpad) */
  private ultimaRueda = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly datos: () => Dato[],
  ) {
    el.innerHTML =
      `<small class="t-etiqueta"></small><b class="t-valor"></b>` +
      `<div class="barra" hidden><i></i></div><small class="t-detalle"></small><span class="puntos"></span>`;
    el.addEventListener("mouseenter", () => (this.encima = true));
    el.addEventListener("mouseleave", () => (this.encima = false));
    // Clic en un puntito: va a ese dato (y no abre la pestaña)
    $(el, ".puntos").addEventListener("click", (e) => {
      e.stopPropagation();
      const i = (e.target as HTMLElement).closest<HTMLElement>("[data-i]")?.dataset.i;
      if (i !== undefined) this.ir(Number(i));
    });
    el.addEventListener(
      "wheel",
      (e) => {
        if (this.datos().length < 2) return;
        e.preventDefault();
        const ahora = performance.now();
        if (ahora - this.ultimaRueda < RUEDA_MS || e.deltaY === 0) return;
        this.ultimaRueda = ahora;
        this.ir(this.indice + Math.sign(e.deltaY));
      },
      { passive: false },
    );
  }

  pintar(): void {
    const lista = this.datos();
    if (lista.length === 0) return;
    this.indice %= lista.length;
    const d = lista[this.indice];
    $(this.el, ".t-etiqueta").textContent = d.etiqueta;
    $(this.el, ".t-valor").textContent = d.valor;
    $(this.el, ".t-detalle").textContent = d.detalle ?? "";
    const barra = $(this.el, ".barra");
    barra.hidden = !d.barra;
    if (d.barra) {
      const i = $(barra, "i");
      i.style.width = `${Math.min(100, Math.max(0, d.barra.pct))}%`;
      i.style.background = d.barra.color;
    }
    fijarHtml(
      $(this.el, ".puntos"),
      lista.length > 1
        ? lista
            .map((d, i) => `<button data-i="${i}" class="${i === this.indice ? "activo" : ""}" title="${escapar(d.etiqueta)}" aria-label="${escapar(d.etiqueta)}"><i></i></button>`)
            .join("")
        : "",
    );
  }

  /** Pasa solo al siguiente dato (si hay más de uno y el ratón no está encima). */
  avanzar(): void {
    if (this.encima || this.datos().length < 2) return;
    this.ir(this.indice + 1);
  }

  /** Va al dato `i` (da la vuelta por los extremos) con el fundido. */
  private ir(i: number): void {
    const n = this.datos().length;
    if (n < 2) return;
    const destino = ((i % n) + n) % n;
    if (destino === this.indice) return;
    this.el.classList.add("cambiando");
    window.setTimeout(() => {
      this.indice = destino;
      this.pintar();
      this.el.classList.remove("cambiando");
    }, FUNDIDO_MS);
  }
}

const pct = (n: number, de: number) => (de > 0 ? (n / de) * 100 : 0);

function datosRecursos(): Dato[] {
  const u = sistema?.uso;
  const b = sistema?.bateria;
  const datos: Dato[] = [];
  if (u) {
    datos.push({ etiqueta: "Procesador", valor: `${u.cpu} %`, barra: { pct: u.cpu, color: colorUso(u.cpu) } });
    datos.push({
      etiqueta: "Memoria",
      valor: `${u.memoria} %`,
      detalle: `${decimal(u.memoriaUsada)} de ${decimal(u.memoriaTotal)} GB`,
      barra: { pct: u.memoria, color: colorUso(u.memoria) },
    });
  }
  if (b) {
    const detalle = b.cargando ? "Cargando" : b.enchufado ? "Enchufada" : b.minutosRestantes !== null ? `Quedan ${duracionLegible(b.minutosRestantes)}` : "Con batería";
    datos.push({
      etiqueta: "Batería",
      valor: `${b.porcentaje} %`,
      detalle,
      barra: { pct: b.porcentaje, color: b.porcentaje <= 20 && !b.enchufado ? "var(--rojo)" : "var(--verde)" },
    });
  }
  return datos.length > 0 ? datos : [{ etiqueta: "Recursos", valor: "—", detalle: "Leyendo el PC…" }];
}

function datosPomodoro(): Dato[] {
  const p = estado?.pomodoro;
  if (!p) return [{ etiqueta: "Pomodoro", valor: "—" }];
  const empezado = p.corriendo || p.restante < p.duracion;
  return [
    {
      etiqueta: `Pomodoro · ${NOMBRE_MODO[p.modo]}`,
      valor: mmss(p.restante),
      detalle: p.corriendo ? "En marcha" : empezado ? "En pausa" : "Listo para empezar",
      barra: empezado ? { pct: pct(p.duracion - p.restante, p.duracion), color: p.modo === "enfoque" ? "var(--rojo)" : "var(--verde)" } : undefined,
    },
  ];
}

function datosPausas(): Dato[] {
  const pa = estado?.pausas;
  if (!pa) return [{ etiqueta: "Pausas", valor: "—" }];
  if (pa.modo === "rutina") return [{ etiqueta: "Pausas", valor: "En marcha", detalle: "Síguela en el globo" }];
  if (!pa.proxima) return [{ etiqueta: "Pausas", valor: "Apagadas", detalle: "Actívalas en Configuración" }];
  return [{ etiqueta: "Próxima pausa", valor: pa.proxima.nombre, detalle: pa.proxima.cuando }];
}

function datosAvisos(): Dato[] {
  const n = avisos.length;
  if (n === 0) return [{ etiqueta: "Avisos", valor: "Al día", detalle: "Sin notificaciones" }];
  const ultimo = avisos[0];
  return [{ etiqueta: n === 1 ? "1 aviso" : `${n} avisos`, valor: ultimo.app, detalle: ultimo.titulo || ultimo.texto }];
}

function datosTiempo(): Dato[] {
  const c = estado?.clima;
  if (!c) return [{ etiqueta: "Tiempo", valor: "—", detalle: "Elige tu ciudad" }];
  const datos: Dato[] = [
    { etiqueta: `Ahora · ${c.ciudad}`, valor: `${Math.round(c.temperatura)} °C`, detalle: c.texto },
    { etiqueta: "Hoy", valor: `${Math.round(c.min)}–${Math.round(c.max)} °C`, detalle: c.ciudad },
  ];
  if (c.lluvia) {
    datos.push({
      etiqueta: "Va a llover",
      valor: `${c.lluvia.hora}:00`,
      detalle: c.lluvia.prob > 0 ? `${c.lluvia.prob} % de probabilidad` : "Lleva paraguas",
    });
  }
  return datos;
}

const tarjetas = [
  new Tarjeta($(document, "#r-recursos"), datosRecursos),
  new Tarjeta($(document, "#r-pomodoro"), datosPomodoro),
  new Tarjeta($(document, "#r-pausas"), datosPausas),
  new Tarjeta($(document, "#r-avisos"), datosAvisos),
  new Tarjeta($(document, "#r-tiempo"), datosTiempo),
  new Tarjeta($(document, "#r-tareas"), () => [{ etiqueta: "Tareas", valor: "Pronto", detalle: "Tareas y recordatorios" }]),
];
window.setInterval(() => tarjetas.forEach((t) => t.avanzar()), CARRUSEL_MS);

// Cada tarjeta lleva a su pestaña; la del tiempo sin ciudad, a Configuración para elegirla
$(document, ".resumen").addEventListener("click", (e) => {
  const tarjeta = (e.target as HTMLElement).closest<HTMLElement>(".tarjeta");
  if (!tarjeta) return;
  if (tarjeta.dataset.ir) irA(tarjeta.dataset.ir);
  else if (tarjeta.id === "r-tiempo" && !estado?.clima) abrirConfiguracion();
});

/** Línea de estado sobre las tarjetas, solo cuando hay algo que contar. */
function pintarEstadoLinea(): void {
  const partes: string[] = [];
  const nm = estado?.noMolestar ?? 0;
  if (nm > 0) partes.push(`No molestar · quedan ${nm < 60 ? `${nm} min` : `${Math.round(nm / 60)} h`}`);
  if (sistema?.conexion && !sistema.conexion.internet) partes.push("Sin internet");
  // Lo que hace el compañero según lo que estás haciendo (Jev)
  const ACTIVIDAD: Partial<Record<string, string>> = {
    reunion: "En una reunión · me callo",
    video: "Viendo un vídeo · quieto y callado",
    juego: "Jugando · quieto y callado",
    concentrado: "Concentrado · modo tranquilo",
  };
  const actividad = estado?.actividad ? ACTIVIDAD[estado.actividad] : undefined;
  if (actividad) partes.push(actividad);
  const linea = $(document, "#estado-linea");
  linea.hidden = partes.length === 0;
  linea.textContent = partes.join(" · ");
}

function pintarResumen(): void {
  tarjetas.forEach((t) => t.pintar());
  $(document, "#r-tiempo").classList.toggle("sin-enlace", !!estado?.clima);
  pintarEstadoLinea();
  const m = estado?.musica;
  const mini = $(document, "#r-musica");
  mini.hidden = !m;
  if (m) {
    // Sin carátula no deja hueco
    const caratula = $<HTMLImageElement>(mini, ".m-caratula");
    if (m.caratula && caratula.src !== m.caratula) caratula.src = m.caratula;
    caratula.style.display = m.caratula ? "" : "none";
    // "Sonando · Queen" arriba y la canción debajo
    $(mini, ".m-estado").textContent = [m.reproduciendo ? "Sonando" : "En pausa", m.artista].filter(Boolean).join(" · ");
    $(mini, ".m-titulo").textContent = m.titulo || "Sin título";
  }
}

// ---------- Pomodoro ----------

$(document, ".p-alternar").addEventListener("click", () => ordenar({ tipo: "pomodoro-alternar" }));
$(document, ".p-reiniciar").innerHTML = ICONO.reiniciar;
$(document, ".p-reiniciar").addEventListener("click", () => ordenar({ tipo: "pomodoro-reiniciar" }));
$(document, ".modos").addEventListener("click", (e) => {
  const modo = (e.target as HTMLElement).closest<HTMLElement>("[data-modo]")?.dataset.modo;
  if (modo === "enfoque" || modo === "corto" || modo === "largo") ordenar({ tipo: "pomodoro-modo", modo });
});

function pintarPomodoro(e: EstadoPanel): void {
  const p = e.pomodoro;
  document.querySelectorAll<HTMLElement>("[data-modo]").forEach((b) => b.classList.toggle("activo", b.dataset.modo === p.modo));
  $(document, ".p-tiempo").textContent = mmss(p.restante);
  $(document, ".p-barra").style.width = `${Math.min(100, (1 - p.restante / p.duracion) * 100)}%`;
  $(document, "#pomodoro").classList.toggle("descanso", p.modo !== "enfoque");
  $(document, ".p-ciclos").textContent = p.ciclos === 0 ? "Aún no has terminado ningún bloque" : p.ciclos === 1 ? "1 bloque de enfoque terminado" : `${p.ciclos} bloques de enfoque terminados`;
  fijarHtml($(document, ".p-alternar"), p.corriendo ? `${ICONO.pausa}Pausar` : `${ICONO.play}${p.restante < p.duracion ? "Seguir" : "Empezar"}`);
}

// ---------- Pausas ----------

$(document, "#pa-tipos").addEventListener("click", (e) => {
  const tipo = (e.target as HTMLElement).closest<HTMLElement>("[data-pausa]")?.dataset.pausa;
  if (tipo !== "postura" && tipo !== "vista") return;
  ordenar({ tipo: "pausa-empezar", pausa: tipo });
  // La rutina se sigue en el globo del compañero
  invoke("cerrar_panel").catch(console.error);
});

function pintarPausas(e: EstadoPanel): void {
  const enRutina = e.pausas.modo === "rutina";
  $(document, "#pa-rutina").hidden = !enRutina;
  fijarHtml(
    $(document, "#pa-tipos"),
    e.pausas.tipos
      .map(
        (t) => `<article class="tarjeta ancha">
          <small>${PAUSA[t.tipo].titulo}</small>
          <b class="pa-cuando">${t.activa ? `Toca ${escapar(t.cuando)}` : "Recordatorio apagado"}</b>
          <div class="fila"><button class="boton" data-pausa="${t.tipo}" ${enRutina ? "disabled" : ""}>${PAUSA[t.tipo].boton}</button></div>
        </article>`,
      )
      .join(""),
  );
}

// ---------- Música: botones ----------

document.querySelectorAll<HTMLElement>("[data-musica]").forEach((b) =>
  b.addEventListener("click", () => ordenar({ tipo: "musica", accion: b.dataset.musica as "anterior" | "play" | "siguiente" })),
);
$(document, '.controles [data-musica="anterior"]').innerHTML = ICONO.anterior;
$(document, '.controles [data-musica="siguiente"]').innerHTML = ICONO.siguiente;

// ---------- Música ----------

function pintarMusica(e: EstadoPanel): void {
  const m = e.musica;
  $(document, "#musica").hidden = !m;
  $(document, "#sin-musica").hidden = !!m;
  if (!m) return;
  const caratula = $<HTMLImageElement>(document, ".mg-caratula");
  if (m.caratula && caratula.src !== m.caratula) caratula.src = m.caratula;
  caratula.style.visibility = m.caratula ? "visible" : "hidden";
  $(document, ".mg-titulo").textContent = m.titulo || "Sin título";
  $(document, ".mg-artista").textContent = m.artista;
  $(document, ".mg-dur").textContent = mmss(m.duracionMs);
  // Mientras se arrastra, la barra la mueve el ratón
  if (!buscando) pintarPosicion(m.duracionMs > 0 ? m.posicion / m.duracionMs : 0, m.posicion);
  fijarHtml($(document, ".mg-play"), m.reproduciendo ? ICONO.pausa : ICONO.play);
  // Lo que dice Jev de la canción (tono, energía y estilo de baile; con «a mano» lo corregido).
  // Pulsándolo se abre la corrección
  const c = e.caracter;
  const caracter = $(document, ".mg-caracter");
  caracter.hidden = !c;
  if (!c) $(document, ".mg-corregir").hidden = true;
  if (c) {
    const coma = (n: number) => n.toFixed(1).replace(".", ",");
    const mano = (k: "tono" | "energia" | "estilo") => (c.corregido[k] ? " · a mano" : "");
    const tono = c.tono === null ? "tono sin saber" : `${nombreTono(c.tono)} (${coma(c.tono)}${mano("tono")})`;
    const energia = c.energia === null ? "energía sin saber" : `energía ${nombreEnergia(c.energia)} (${coma(c.energia)}${mano("energia")})`;
    // Con mezcla: «rockero 60 % + de balada 35 %»
    const mezcla = c.estilos ? Object.entries(c.estilos).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) : [];
    const estilo =
      mezcla.length > 1
        ? `baile ${mezcla.map(([k, w]) => `${NOMBRE_ESTILO[k] ?? k} ${Math.round((w ?? 0) * 100)} %`).join(" + ")}`
        : c.estilo
          ? `baile ${NOMBRE_ESTILO[c.estilo] ?? c.estilo} (${c.corregido.estilo ? "a mano" : `${Math.round(c.confianzaEstilo * 100)} %`})`
          : "baile según el ritmo";
    caracter.textContent = `Jev: ${tono} · ${energia} · ${estilo}`;
    caracterAhora = c;
  }
  const r = e.ritmo;
  const ritmo = $(document, ".mg-ritmo");
  ritmo.hidden = !r;
  if (r) {
    const claro = r.confianza >= 0.6 ? "claro" : r.confianza >= 0.3 ? "regular" : "dudoso";
    const parte = r.pausa ? "en pausa" : `${r.partes} ${r.partes === 1 ? "parte" : "partes"}`;
    ritmo.textContent = `${r.ppm} ppm · ritmo ${claro} (${Math.round(r.confianza * 100)} %) · ${parte} · paso: ${r.paso}`;
  }
}

// Corregir a Jev: pulsar su línea abre unos botones (más triste/alegre, más calmada/movida, otro
// género). El compañero lo recuerda para esa canción
let caracterAhora: EstadoPanel["caracter"] = null;
const corregir = $(document, ".mg-corregir");
$(document, ".mg-caracter").addEventListener("click", () => {
  corregir.hidden = !corregir.hidden;
});
fijarHtml(
  $(document, ".estilos-corregir"),
  Object.entries(NOMBRE_ESTILO)
    .map(([k, nombre]) => `<button class="boton" data-corregir="estilo" data-estilo="${k}">${nombre.replace(/^de /, "")}</button>`)
    .join(""),
);
corregir.addEventListener("click", (ev) => {
  const b = (ev.target as HTMLElement).closest<HTMLElement>("[data-corregir]");
  if (!b) return;
  const que = b.dataset.corregir;
  if (que === "estilo") {
    ordenar({ tipo: "caracter-corregir", estilo: b.dataset.estilo as Estilo });
    return;
  }
  // Más o menos que lo que hay (si aún no se sabe, desde el medio)
  const paso = Number(b.dataset.paso);
  const actual = (que === "tono" ? caracterAhora?.tono : caracterAhora?.energia) ?? 2;
  const valor = Math.max(0, Math.min(4, actual + paso));
  ordenar(que === "tono" ? { tipo: "caracter-corregir", tono: valor } : { tipo: "caracter-corregir", energia: valor });
});

/** Barra de la canción (fracción de 0 a 1) y el tiempo de la izquierda. */
function pintarPosicion(fraccion: number, ms: number): void {
  const pct = `${Math.min(100, Math.max(0, fraccion * 100))}%`;
  $(document, ".mg-barra").style.width = pct;
  $(document, "#busqueda .pomo").style.left = pct;
  $(document, ".mg-pos").textContent = mmss(ms);
}

// Pulsar o arrastrar la barra para ir a otro momento de la canción
const busqueda = $(document, "#busqueda");
let buscando = false;

function fraccionEn(x: number): number {
  const r = busqueda.getBoundingClientRect();
  return Math.min(1, Math.max(0, (x - r.left) / r.width));
}

busqueda.addEventListener("pointerdown", (e) => {
  const dur = estado?.musica?.duracionMs ?? 0;
  if (dur <= 0) return;
  buscando = true;
  busqueda.classList.add("arrastrando");
  busqueda.setPointerCapture(e.pointerId);
  const f = fraccionEn(e.clientX);
  pintarPosicion(f, f * dur);
});
busqueda.addEventListener("pointermove", (e) => {
  if (!buscando) return;
  const f = fraccionEn(e.clientX);
  pintarPosicion(f, f * (estado?.musica?.duracionMs ?? 0));
});
busqueda.addEventListener("pointerup", (e) => {
  if (!buscando) return;
  buscando = false;
  busqueda.classList.remove("arrastrando");
  const dur = estado?.musica?.duracionMs ?? 0;
  ordenar({ tipo: "musica-posicion", ms: Math.round(fraccionEn(e.clientX) * dur) });
});

// ---------- Avisos ----------

function hace(fecha: number): string {
  const min = Math.floor((Date.now() - fecha) / 60_000);
  if (!fecha || min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  return horas < 24 ? `hace ${horas} h` : new Date(fecha).toLocaleDateString("es", { day: "numeric", month: "short" });
}

function pintarAvisos(): void {
  const lista = $(document, "#avisos");
  const n = avisos.length;
  const insignia = $(document, "#insignia");
  insignia.hidden = n === 0;
  insignia.textContent = String(n);
  $(document, "#avisos-cuenta").textContent = n === 0 ? "" : n === 1 ? "1 notificación" : `${n} notificaciones`;
  $(document, "#borrar-todo").hidden = n === 0;
  lista.innerHTML =
    n === 0
      ? `<li class="vacio">No tienes notificaciones</li>`
      : avisos
          .map(
            (a) => `<li class="aviso" data-id="${a.id}" title="Abrir ${escapar(a.app)}">
              <span class="aviso-icono">${a.icono ? `<img src="${escapar(a.icono)}" alt="">` : escapar(a.app.charAt(0).toUpperCase())}</span>
              <div><small>${escapar(a.app)} · ${hace(a.fecha)}</small><b>${escapar(a.titulo || a.app)}</b>${a.texto ? `<p>${escapar(a.texto)}</p>` : ""}</div>
              <button class="quitar" title="Descartar" aria-label="Descartar">${ICONO.cerrar}</button>
            </li>`,
          )
          .join("");
  pintarResumen();
}

async function cargarAvisos(): Promise<void> {
  try {
    avisos = await invoke<Notificacion[]>("listar_notificaciones");
  } catch (e) {
    console.error("avisos:", e);
    avisos = [];
  }
  pintarAvisos();
}

$(document, "#avisos").addEventListener("click", async (e) => {
  const objetivo = e.target as HTMLElement;
  const fila = objetivo.closest<HTMLElement>(".aviso");
  if (!fila) return;
  const id = Number(fila.dataset.id);
  const abrir = !objetivo.closest(".quitar");
  fila.classList.add("saliendo");
  await new Promise((r) => window.setTimeout(r, 200));
  avisos = avisos.filter((a) => a.id !== id);
  pintarAvisos();
  await invoke(abrir ? "abrir_notificacion" : "eliminar_notificacion", { id }).catch(console.error);
  if (abrir) invoke("cerrar_panel").catch(console.error);
});

$(document, "#borrar-todo").addEventListener("click", async () => {
  avisos = [];
  pintarAvisos();
  await invoke("eliminar_notificaciones").catch(console.error);
});

// ---------- Sistema ----------

let sistema: EstadoSistema | null = null;
/** Mientras se arrastra el volumen, la barra la mueve el ratón (no el estado que llega). */
let moviendoVolumen = false;

const decimal = (n: number) => n.toLocaleString("es", { maximumFractionDigits: 1 });
/** Color de una barra de uso: verde, amarillo o rojo según lo llena que esté. */
const colorUso = (pct: number) => (pct >= 85 ? "var(--rojo)" : pct >= 60 ? "#ffd60a" : "var(--verde)");

function pintarSistema(): void {
  const s = sistema;
  const b = s?.bateria;
  $(document, "#s-bateria").hidden = !b;
  if (b) {
    $(document, ".s-b-porcentaje").textContent = `${b.porcentaje} %`;
    const barra = $(document, ".s-b-barra");
    barra.style.width = `${b.porcentaje}%`;
    barra.style.background = b.porcentaje <= 20 && !b.enchufado ? "var(--rojo)" : "var(--verde)";
    $(document, ".s-b-ahorro").hidden = !b.ahorro;
    const w = b.vatios ? `${decimal(b.vatios)} W` : "";
    let detalle: string;
    if (b.cargando) {
      detalle = ["Cargando", b.minutosParaLlenar !== null ? `llena en ${duracionLegible(b.minutosParaLlenar)}` : "", w].filter(Boolean).join(" · ");
    } else if (b.enchufado) {
      detalle = b.porcentaje >= 99 ? "Enchufada · carga completa" : "Enchufada";
    } else {
      const queda = b.minutosRestantes !== null ? `Quedan ${duracionLegible(b.minutosRestantes)}` : "Con batería";
      detalle = [queda, w ? `gastando ${w}` : ""].filter(Boolean).join(" · ");
    }
    $(document, ".s-b-detalle").textContent = detalle;
  }

  const v = s?.volumen;
  $(document, "#s-volumen").hidden = !v;
  if (v) {
    $(document, ".s-v-dispositivo").textContent = v.dispositivo || "Volumen";
    const silencio = $(document, ".s-v-silencio");
    fijarHtml(silencio, v.silencio ? ICONO.silencio : ICONO.volumen);
    silencio.title = v.silencio ? "Quitar el silencio" : "Silenciar";
    if (!moviendoVolumen) {
      $<HTMLInputElement>(document, ".s-v-nivel").value = String(v.nivel);
      $(document, ".s-v-valor").textContent = v.silencio ? "Mudo" : `${v.nivel} %`;
    }
  }

  const c = s?.conexion;
  $(document, "#s-conexion").hidden = !c;
  if (c) {
    const punto = $(document, ".s-c-estado .punto");
    punto.className = `punto${!c.conectado ? " mal" : !c.internet ? " regular" : ""}`;
    const red = c.nombre ? `${c.wifi ? "Wifi" : "Red"} · ${c.nombre}` : c.wifi ? "Wifi" : "Por cable";
    $(document, ".s-c-texto").textContent = !c.conectado ? "Sin conexión" : !c.internet ? `${red} · sin internet` : red;
  }

  const u = s?.uso;
  $(document, "#s-cpu").hidden = !u;
  $(document, "#s-memoria").hidden = !u;
  if (u) {
    $(document, ".s-u-cpu").textContent = `${u.cpu} %`;
    const cpu = $(document, ".s-u-cpu-barra");
    cpu.style.width = `${u.cpu}%`;
    cpu.style.background = colorUso(u.cpu);
    $(document, ".s-u-memoria").textContent = `${u.memoria} %`;
    const memoria = $(document, ".s-u-memoria-barra");
    memoria.style.width = `${u.memoria}%`;
    memoria.style.background = colorUso(u.memoria);
    $(document, ".s-u-memoria-gb").textContent = `${decimal(u.memoriaUsada)} de ${decimal(u.memoriaTotal)} GB`;
  }
  pintarResumen();
}

const nivelVolumen = $<HTMLInputElement>(document, ".s-v-nivel");
nivelVolumen.addEventListener("input", () => {
  moviendoVolumen = true;
  $(document, ".s-v-valor").textContent = `${nivelVolumen.value} %`;
  invoke("fijar_volumen", { nivel: Number(nivelVolumen.value) }).catch(console.error);
});
nivelVolumen.addEventListener("change", () => {
  moviendoVolumen = false;
});
$(document, ".s-v-silencio").addEventListener("click", () => {
  invoke("alternar_silencio").catch(console.error);
});

async function cargarSistema(): Promise<void> {
  sistema = await invoke<EstadoSistema | null>("estado_sistema").catch(() => null);
  pintarSistema();
}

listen<EstadoSistema>(EVENTO_SISTEMA, ({ payload }) => {
  sistema = payload;
  pintarSistema();
}).catch(console.error);

// ---------- Estado y arranque ----------

listen<EstadoPanel>(EVENTO_ESTADO, ({ payload }) => {
  estado = payload;
  pintarResumen();
  pintarPomodoro(payload);
  pintarPausas(payload);
  pintarMusica(payload);
}).catch(console.error);

listen<boolean>(EVENTO_VISIBLE, ({ payload }) => {
  if (!payload) return;
  pintarCabecera();
  void emit(EVENTO_PEDIR);
  void cargarAvisos();
  void cargarSistema();
  // La animación de entrada vuelve a empezar cada vez que se abre
  const panel = $(document, ".panel");
  panel.style.animation = "none";
  void panel.offsetWidth;
  panel.style.animation = "";
}).catch(console.error);

listen("notification-count", () => void cargarAvisos()).catch(console.error);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") invoke("cerrar_panel").catch(console.error);
});

pintarCabecera();
void emit(EVENTO_PEDIR);
void cargarAvisos();
void cargarSistema();
pintarResumen();
