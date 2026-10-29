// Ventana del globo de pensamiento: muestra lo que le pide el compañero, se coloca junto a él
// (Rust decide el lado) y avisa cuando se pulsa un botón o se cierra.
// Al pasar el ratón por encima el tiempo se para, para que dé tiempo a leerlo.
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { $, escapar } from "../util";
import {
  EVENTO_ACCION,
  EVENTO_ACTUALIZAR,
  EVENTO_CERRADO,
  EVENTO_CERRAR,
  EVENTO_MOSTRAR,
  type AccionGlobo,
  type ContenidoGlobo,
} from "./tipos";

/** Al apartar el ratón, como mínimo se queda este tiempo más. */
const TIEMPO_TRAS_HOVER = 1500;
const DURACION_SALIDA = 160;

const ICONOS: Record<NonNullable<AccionGlobo["icono"]>, string> = {
  anterior: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.5 6v12L3 12zM21 6v12l-8.5-6z" fill="currentColor"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`,
  pausa: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"/></svg>`,
  siguiente: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 6v12L21 12zM3 6v12l8.5-6z" fill="currentColor"/></svg>`,
};

const globo = $(document, "#globo");
const imagen = $<HTMLImageElement>(globo, ".imagen");
const acciones = $(globo, ".acciones");

let actual: ContenidoGlobo | null = null;
let tCierre = 0;
let finEn = 0;
let encima = false;
let tamano = { ancho: 0, alto: 0 };

function pintar(c: ContenidoGlobo): void {
  $(globo, ".origen").textContent = c.origen ?? "";
  $(globo, ".titulo").textContent = c.titulo;
  $(globo, ".texto").textContent = c.texto ?? "";
  imagen.hidden = !c.imagen;
  if (c.imagen) imagen.src = c.imagen;
  const lista = c.acciones ?? [];
  acciones.classList.toggle("iconos", lista.length > 0 && lista.every((a) => a.icono));
  acciones.innerHTML = lista
    .map(
      (a) =>
        `<button data-accion="${escapar(a.id)}" class="${a.principal ? "principal" : ""}" ${a.icono ? `aria-label="${escapar(a.texto)}" title="${escapar(a.texto)}"` : ""}>${a.icono ? ICONOS[a.icono] : escapar(a.texto)}</button>`,
    )
    .join("");
}

/** Pide a Rust que coloque la ventana con el tamaño del globo; devuelve el lado en que quedó. */
async function colocar(): Promise<void> {
  const ancho = globo.offsetWidth;
  const alto = globo.offsetHeight;
  if (ancho === tamano.ancho && alto === tamano.alto) return;
  tamano = { ancho, alto };
  const lado = await invoke<string>("mostrar_globo", { ancho, alto }).catch((e) => {
    console.error("globo:", e);
    return "der";
  });
  globo.classList.toggle("izq", lado === "izq");
  globo.classList.toggle("der", lado !== "izq");
}

function programarCierre(ms: number): void {
  window.clearTimeout(tCierre);
  if (!actual || actual.duracion <= 0) return;
  finEn = Date.now() + ms;
  tCierre = window.setTimeout(() => cerrar(), ms);
}

async function mostrar(c: ContenidoGlobo): Promise<void> {
  window.clearTimeout(tCierre);
  actual = c;
  globo.classList.remove("visible", "saliendo");
  pintar(c);
  tamano = { ancho: 0, alto: 0 };
  await colocar();
  // Entra con un pequeño rebote desde el lado del compañero
  requestAnimationFrame(() => globo.classList.add("visible"));
  if (!encima) programarCierre(c.duracion);
}

function cerrar(): void {
  if (!actual) return;
  const id = actual.id;
  actual = null;
  window.clearTimeout(tCierre);
  globo.classList.add("saliendo");
  window.setTimeout(() => {
    if (actual) return; // mientras tanto llegó otro
    globo.classList.remove("visible", "saliendo");
    invoke("ocultar_globo").catch(console.error);
    tamano = { ancho: 0, alto: 0 };
  }, DURACION_SALIDA);
  void emit(EVENTO_CERRADO, { id });
}

// ---------- Ratón ----------

globo.addEventListener("mouseenter", () => {
  encima = true;
  window.clearTimeout(tCierre);
});
globo.addEventListener("mouseleave", () => {
  encima = false;
  if (actual) programarCierre(Math.max(TIEMPO_TRAS_HOVER, finEn - Date.now()));
});

globo.addEventListener("click", (e) => {
  if (!actual) return;
  const boton = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-accion]");
  const accion = boton?.dataset.accion ?? "toque";
  void emit(EVENTO_ACCION, { id: actual.id, accion });
  // Los controles (música) no cierran el globo; el resto, sí
  const control = actual.acciones?.find((a) => a.id === accion)?.icono;
  if (!control) cerrar();
});

// ---------- Lo que pide el compañero ----------

listen<ContenidoGlobo>(EVENTO_MOSTRAR, ({ payload }) => void mostrar(payload)).catch(console.error);

listen<ContenidoGlobo>(EVENTO_ACTUALIZAR, ({ payload }) => {
  if (!actual || payload.id !== actual.id) return;
  actual = payload;
  pintar(payload);
  void colocar();
}).catch(console.error);

listen(EVENTO_CERRAR, () => cerrar()).catch(console.error);
