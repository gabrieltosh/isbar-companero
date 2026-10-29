// Panel del compañero: Inicio (Pomodoro, agua, pausas, música), Avisos (notificaciones de
// Windows) y Música. El estado lo tiene el compañero: aquí se pinta su "foto" y se le mandan
// órdenes. Las notificaciones sí se piden directamente a Rust.
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { $, escapar, mmss } from "../util";
import { EVENTO_ESTADO, EVENTO_ORDEN, EVENTO_PEDIR, EVENTO_VISIBLE, type EstadoPanel, type OrdenPanel } from "./tipos";

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
};

const NOMBRE_MODO = { enfoque: "Enfoque", corto: "Descanso corto", largo: "Descanso largo" } as const;

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

const litros = (ml: number) => (ml / 1000).toFixed(1).replace(".", ",");

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

$(document, ".pestanas").addEventListener("click", (e) => {
  const boton = (e.target as HTMLElement).closest<HTMLElement>("[data-vista]");
  if (boton?.dataset.vista) irA(boton.dataset.vista);
});

const ajustes = $(document, "#ajustes");
ajustes.innerHTML = ICONO.ajustes;
ajustes.addEventListener("click", () => {
  invoke("abrir_configuracion_cmd").catch(console.error);
  invoke("cerrar_panel").catch(console.error);
});

// ---------- Inicio ----------

$(document, ".p-alternar").addEventListener("click", () => ordenar({ tipo: "pomodoro-alternar" }));
$(document, ".p-reiniciar").innerHTML = ICONO.reiniciar;
$(document, ".p-reiniciar").addEventListener("click", () => ordenar({ tipo: "pomodoro-reiniciar" }));
$(document, ".a-beber").addEventListener("click", () => ordenar({ tipo: "agua-beber" }));
document.querySelectorAll<HTMLElement>("[data-pausa]").forEach((b) =>
  b.addEventListener("click", () => {
    ordenar({ tipo: "pausa-empezar", pausa: b.dataset.pausa as "postura" | "vista" });
    // La rutina se sigue en el globo del compañero
    invoke("cerrar_panel").catch(console.error);
  }),
);
document.querySelectorAll<HTMLElement>("[data-musica]").forEach((b) =>
  b.addEventListener("click", () => ordenar({ tipo: "musica", accion: b.dataset.musica as "anterior" | "play" | "siguiente" })),
);
$(document, '.controles [data-musica="anterior"]').innerHTML = ICONO.anterior;
$(document, '.controles [data-musica="siguiente"]').innerHTML = ICONO.siguiente;

function pintarInicio(e: EstadoPanel): void {
  const p = e.pomodoro;
  $(document, ".p-modo").textContent = NOMBRE_MODO[p.modo];
  $(document, ".p-tiempo").textContent = mmss(p.restante);
  $(document, ".p-barra").style.width = `${Math.min(100, (1 - p.restante / p.duracion) * 100)}%`;
  $(document, "#t-pomodoro").classList.toggle("descanso", p.modo !== "enfoque");
  fijarHtml($(document, ".p-alternar"), p.corriendo ? `${ICONO.pausa}Pausar` : `${ICONO.play}${p.restante < p.duracion ? "Seguir" : "Empezar"}`);

  const a = e.agua;
  $(document, ".a-litros").textContent = `${litros(a.ml)} / ${litros(a.meta)} L`;
  $(document, ".a-barra").style.width = `${Math.min(100, (a.ml / a.meta) * 100)}%`;
  fijarHtml($(document, ".a-beber"), `${ICONO.gota}+${a.sorbo} ml`);

  const proxima = e.pausas.proxima;
  $(document, ".pa-proxima").textContent =
    e.pausas.modo === "rutina"
      ? "Rutina en marcha"
      : proxima
        ? `${proxima.nombre} ${proxima.cuando}`
        : "Sin recordatorios activados";

  const m = e.musica;
  const mini = $(document, "#t-musica");
  mini.hidden = !m;
  if (m) {
    const caratula = $<HTMLImageElement>(mini, ".m-caratula");
    if (m.caratula && caratula.src !== m.caratula) caratula.src = m.caratula;
    caratula.style.visibility = m.caratula ? "visible" : "hidden";
    $(mini, ".m-titulo").textContent = m.titulo || "Sin título";
    fijarHtml($(mini, ".m-play"), m.reproduciendo ? ICONO.pausa : ICONO.play);
  }
}

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
  $(document, ".mg-pos").textContent = mmss(m.posicion);
  $(document, ".mg-dur").textContent = mmss(m.duracionMs);
  $(document, ".mg-barra").style.width = m.duracionMs > 0 ? `${Math.min(100, (m.posicion / m.duracionMs) * 100)}%` : "0%";
  fijarHtml($(document, ".mg-play"), m.reproduciendo ? ICONO.pausa : ICONO.play);
}

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

// ---------- Estado y arranque ----------

listen<EstadoPanel>(EVENTO_ESTADO, ({ payload }) => {
  estado = payload;
  pintarInicio(payload);
  pintarMusica(payload);
}).catch(console.error);

listen<boolean>(EVENTO_VISIBLE, ({ payload }) => {
  if (!payload) return;
  pintarCabecera();
  void emit(EVENTO_PEDIR);
  void cargarAvisos();
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
if (estado) pintarInicio(estado);
