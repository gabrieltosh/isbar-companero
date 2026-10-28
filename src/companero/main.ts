// Ventana del compañero: se coloca donde estaba, sigue al cursor con la mirada,
// se mueve manteniéndolo pulsado y se esconde a medias junto a los bordes.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { guardar, leer } from "../store";
import { $ } from "../util";
import { dibujarCara, type Expresion, type Pose } from "./cara";

/** Debe coincidir con MARGEN y LADO de companero.rs */
const MARGEN = 24;
const LADO = 64;
const CENTRO = MARGEN + LADO / 2;
/** Mantenerlo pulsado este tiempo empieza el arrastre (un clic corto no). */
const RETARDO_ARRASTRE = 230;
const DURACION_GUINO = 1100;

interface PosGuardada {
  x: number;
  y: number;
}

interface Soltado extends PosGuardada {
  /** -1 escondido a la izquierda, 1 a la derecha, 0 libre */
  borde: number;
}

const companero = $(document, "#companero");
const cara = $(document, "#cara");

let borde = 0;
let encima = false;
let arrastrando = false;
let cursor = { x: CENTRO, y: CENTRO };
let temporal: { expresion: Expresion; hasta: number; desde: number } | null = null;
// Animación del cuerpo: se aplasta al soltarlo y vuelve solo
let escalaX = 1;
let escalaY = 1;
const pose: Pose = { expresion: "normal", miraX: 0, miraY: 0, parpadeo: 0, giro: 0, salto: 0, guino: 0 };

const acercar = (a: number, b: number, k: number) => a + (b - a) * k;

function ponerTemporal(expresion: Expresion, ms: number): void {
  temporal = { expresion, desde: performance.now(), hasta: performance.now() + ms };
}

function expresionActual(ahora: number): Expresion {
  if (temporal && ahora < temporal.hasta) return temporal.expresion;
  temporal = null;
  if (arrastrando) return "sorpresa";
  return encima ? "feliz" : "normal";
}

// ---------- Animación ----------

function fotograma(ahora: number): void {
  const expresion = expresionActual(ahora);
  pose.expresion = expresion;

  // Mirada: hacia el cursor; escondido en un borde, hacia dentro de la pantalla
  let miraX = 0;
  let miraY = 0;
  if (borde !== 0) {
    miraX = -borde * 3.5;
  } else if (expresion === "normal" || expresion === "sorpresa") {
    const vx = cursor.x - CENTRO;
    const vy = cursor.y - CENTRO;
    const d = Math.hypot(vx, vy) || 1;
    const f = Math.min(1, d / 170);
    miraX = (vx / d) * 3.5 * f;
    miraY = (vy / d) * 3 * f;
  }
  pose.miraX = acercar(pose.miraX, miraX, 0.15);
  pose.miraY = acercar(pose.miraY, miraY, 0.15);

  // Guiño: saltito y cabeza ladeada mientras dura
  let giro = -borde * 12;
  let salto = 0;
  if (expresion === "guino" && temporal) {
    const g = Math.min(1, (ahora - temporal.desde) / DURACION_GUINO);
    pose.guino = g;
    giro += Math.sin(Math.min(1, g / 0.3) * (Math.PI / 2)) * 9 * (g < 0.75 ? 1 : 1 - (g - 0.75) / 0.25);
    salto = g < 0.3 ? -Math.sin((g / 0.3) * Math.PI) * 3 : 0;
  } else if (expresion === "feliz") {
    salto = Math.sin(ahora / 160) * 1.2;
  }
  pose.giro = acercar(pose.giro, giro, 0.2);
  pose.salto = salto;

  // Respira (crece y encoge muy poco) y recupera la forma tras el rebote
  escalaX = acercar(escalaX, 1, 0.1);
  escalaY = acercar(escalaY, 1, 0.1);
  const respira = 1 + Math.sin(ahora / 320) * 0.018;
  const agarre = arrastrando ? 1.12 : 1;
  companero.style.transform = `scale(${respira * agarre * escalaX}, ${respira * agarre * escalaY})`;

  cara.innerHTML = dibujarCara(pose);
  requestAnimationFrame(fotograma);
}

/** Parpadea de vez en cuando, a intervalos irregulares. */
function parpadear(): void {
  const inicio = performance.now();
  const paso = () => {
    const t = (performance.now() - inicio) / 130;
    pose.parpadeo = t < 0.5 ? t * 2 : Math.max(0, 2 - t * 2);
    if (t < 1) requestAnimationFrame(paso);
    else pose.parpadeo = 0;
  };
  paso();
  window.setTimeout(parpadear, 2800 + Math.random() * 3000);
}

// ---------- Ratón ----------

let tArrastre = 0;
let pulsado = false;

companero.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  pulsado = true;
  const { clientX, clientY } = e;
  tArrastre = window.setTimeout(() => {
    arrastrando = true;
    companero.classList.add("arrastrando");
    // Rust mueve la ventana con el cursor hasta que se suelta el botón
    invoke("arrastrar_companero", { dx: clientX, dy: clientY }).catch((err) => {
      console.error("compañero:", err);
      arrastrando = false;
      companero.classList.remove("arrastrando");
    });
  }, RETARDO_ARRASTRE);
});

window.addEventListener("pointerup", () => {
  window.clearTimeout(tArrastre);
  if (!pulsado || arrastrando) return;
  pulsado = false;
  // Clic corto: si estaba escondido, sale; si no, guiña
  if (borde !== 0) {
    invoke("salir_del_borde").catch(console.error);
  } else {
    ponerTemporal("guino", DURACION_GUINO);
  }
});

// Al soltarlo: rebota, recuerda dónde quedó y si está escondido en un borde
listen<Soltado>("companero-soltado", ({ payload }) => {
  pulsado = false;
  arrastrando = false;
  companero.classList.remove("arrastrando");
  borde = payload.borde;
  escalaX = 1.18;
  escalaY = 0.8;
  void guardar("companeroPos", { x: payload.x, y: payload.y });
}).catch(console.error);

listen<boolean>("companero-hover", ({ payload }) => {
  encima = payload;
}).catch(console.error);

listen<[number, number]>("companero-cursor", ({ payload }) => {
  cursor = { x: payload[0], y: payload[1] };
}).catch(console.error);

// ---------- Arranque ----------

// Solo el compañero recibe el ratón; el resto de la ventana deja pasar los clics
invoke("set_companero_rects", { rects: [{ x: MARGEN, y: MARGEN, w: LADO, h: LADO }] }).catch(console.error);
const guardada = await leer<PosGuardada | null>("companeroPos", null);
borde = await invoke<number>("iniciar_companero", { pos: guardada }).catch((e) => {
  console.error("compañero:", e);
  return 0;
});
requestAnimationFrame(fotograma);
window.setTimeout(parpadear, 1500);
