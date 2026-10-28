// Ventana del compañero: se coloca donde estaba, sigue al cursor con la mirada, tiene vida
// propia (vida.ts), reacciona al ratón y se mueve manteniéndolo pulsado.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { COMPANERO_POR_DEFECTO, EVENTO_AJUSTES, type ConfigCompanero } from "../ajustes";
import { guardar, leer } from "../store";
import { $ } from "../util";
import { bostezo, dibujarCara, type Pose } from "./cara";
import { decidir, esDeNoche, gesto, hayGesto } from "./vida";

/** Con tamaño 1; deben coincidir con MARGEN y LADO de companero.rs */
const MARGEN = 24;
const LADO = 64;
/** Mantenerlo pulsado este tiempo empieza el arrastre (un clic corto no). */
const RETARDO_ARRASTRE = 230;
const DURACION_GUINO = 1100;
/** Clics seguidos: dos rápidos = risa; cuatro en poco tiempo = se enoja. */
const DOBLE_CLIC_MS = 320;
const RAFAGA_MS = 1500;
/** Agitar el ratón cerca: tantos cambios de dirección en tan poco tiempo lo marean. */
const GIROS_MAREO = 6;
const VENTANA_MAREO_MS = 700;
const DISTANCIA_MAREO = 110;

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

let config: ConfigCompanero = COMPANERO_POR_DEFECTO;
let borde = 0;
/** Ya está en su sitio (iniciar_companero) */
let colocado = false;
let encima = false;
let arrastrando = false;
let inactivo = 0;
let cursor = { x: 0, y: 0 };
// Hacia dónde mira cuando está solo (cambia de vez en cuando)
let miradaLibre = { x: 0, y: 0 };
let cambioMirada = 0;
// El cuerpo se aplasta al soltarlo y vuelve solo
let escalaX = 1;
let escalaY = 1;
const pose: Pose = { expresion: "normal", miraX: 0, miraY: 0, parpadeo: 0, giro: 0, salto: 0, t: 0, progreso: 0 };

const acercar = (a: number, b: number, k: number) => a + (b - a) * k;
const centro = () => (MARGEN + LADO / 2) * config.tamano;

// ---------- Animación ----------

function fotograma(ahora: number): void {
  const noche = esDeNoche();
  const { expresion, rutina, progreso } = decidir({
    ahora,
    encima,
    arrastrando,
    inactivo,
    noche,
    tranquilo: config.tranquilo,
    peticion: null,
  });
  pose.expresion = expresion;
  pose.t = ahora;
  pose.progreso = progreso;

  // Mirada: escondido en un borde, hacia dentro; solo, a su alrededor; si no, al cursor
  let miraX = 0;
  let miraY = 0;
  const libre = expresion === "normal" || expresion === "silba" || expresion === "sorpresa";
  if (borde !== 0) {
    miraX = -borde * 3.5;
  } else if (libre && rutina === "mira") {
    if (ahora > cambioMirada) {
      miradaLibre = { x: (Math.random() * 2 - 1) * 3.5, y: (Math.random() * 2 - 1) * 2.5 };
      cambioMirada = ahora + 1400 + Math.random() * 1600;
    }
    ({ x: miraX, y: miraY } = miradaLibre);
  } else if (libre) {
    const vx = cursor.x - centro();
    const vy = cursor.y - centro();
    const d = Math.hypot(vx, vy) || 1;
    const f = Math.min(1, d / 170);
    miraX = (vx / d) * 3.5 * f;
    miraY = (vy / d) * 3 * f;
  }
  pose.miraX = acercar(pose.miraX, miraX, 0.15);
  pose.miraY = acercar(pose.miraY, miraY, 0.15);

  // Cabeza y saltitos según el gesto (en modo tranquilo, más suaves)
  const movimiento = config.tranquilo ? 0.5 : 1;
  let giro = -borde * 12;
  let salto = 0;
  switch (expresion) {
    case "guino":
      giro += Math.sin(Math.min(1, progreso / 0.3) * (Math.PI / 2)) * 9 * (progreso < 0.75 ? 1 : 1 - (progreso - 0.75) / 0.25);
      salto = progreso < 0.3 ? -Math.sin((progreso / 0.3) * Math.PI) * 3 : 0;
      break;
    case "feliz":
      salto = Math.sin(ahora / 160) * 1.2 * movimiento;
      break;
    case "risa":
    case "celebra":
      giro += Math.sin(ahora / 60) * 4 * movimiento;
      salto = -Math.abs(Math.sin(ahora / 60)) * 2 * movimiento;
      break;
    case "musica":
      giro += Math.sin(ahora / 130) * 10 * movimiento;
      salto = -Math.abs(Math.sin(ahora / 130)) * 2.5 * movimiento;
      break;
    case "mareado":
      giro += Math.sin(ahora / 110) * 9;
      break;
    case "triste":
      giro -= 8;
      break;
    case "pensativo":
      giro += 10;
      break;
    case "preocupado":
      giro += Math.sin(ahora / 30) * 1.5;
      break;
  }
  pose.giro = acercar(pose.giro, giro, 0.2);
  pose.salto = salto;

  // Cuerpo: se estira, bosteza o saluda; vuelve solo a su forma tras el rebote
  escalaX = acercar(escalaX, 1, 0.1);
  escalaY = acercar(escalaY, 1, 0.1);
  let estiraX = 1;
  let estiraY = 1;
  if (rutina === "estira" && expresion === "normal") {
    const k = Math.sin(((ahora % 5300) / 5300) * Math.PI);
    estiraY = 1 + k * 0.1;
    estiraX = 1 - k * 0.05;
  } else if (expresion === "cansado") {
    const b = bostezo(ahora);
    estiraY = 1 + b * 0.08;
    estiraX = 1 - b * 0.04;
  } else if (expresion === "saludo") {
    estiraY = 1 + Math.abs(Math.sin(ahora / 260)) * 0.06;
  }
  // Respira: más lento de noche, más suave en modo tranquilo
  const respira = 1 + Math.sin(ahora / (noche ? 520 : 320)) * (config.tranquilo ? 0.01 : 0.018);
  const agarre = arrastrando ? 1.12 : 1;
  const sx = respira * agarre * escalaX * estiraX;
  const sy = respira * agarre * escalaY * estiraY;
  companero.style.transform = `scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  // De noche, dormido, se ve más tenue
  companero.style.opacity = noche && expresion === "dormido" ? "0.8" : "1";

  cara.innerHTML = dibujarCara(pose, config.color);
  requestAnimationFrame(fotograma);
}

/** Parpadea de vez en cuando, a intervalos irregulares (más despacio en modo tranquilo). */
function parpadear(): void {
  const inicio = performance.now();
  const paso = () => {
    const t = (performance.now() - inicio) / 130;
    pose.parpadeo = t < 0.5 ? t * 2 : Math.max(0, 2 - t * 2);
    if (t < 1) requestAnimationFrame(paso);
    else pose.parpadeo = 0;
  };
  paso();
  window.setTimeout(parpadear, (config.tranquilo ? 4000 : 2800) + Math.random() * 3000);
}

// ---------- Ratón ----------

let tArrastre = 0;
let pulsado = false;
let clics: number[] = [];

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
  // Si estaba escondido, sale
  if (borde !== 0) {
    invoke("salir_del_borde").catch(console.error);
    return;
  }
  // Un clic: guiño. Dos seguidos: risa. Muchos en poco tiempo: se enoja
  const ahora = performance.now();
  clics = clics.filter((c) => ahora - c < RAFAGA_MS);
  clics.push(ahora);
  if (clics.length >= 4) {
    gesto("enojado", 1800);
    clics = [];
  } else if (clics.length >= 2 && ahora - clics[clics.length - 2] < DOBLE_CLIC_MS) {
    gesto("risa", 1500);
  } else {
    gesto("guino", DURACION_GUINO);
  }
});

// Al soltarlo: rebota, recuerda dónde quedó y si está escondido en un borde
listen<Soltado>("companero-soltado", ({ payload }) => {
  if (arrastrando) {
    escalaX = 1.18;
    escalaY = 0.8;
  }
  pulsado = false;
  arrastrando = false;
  companero.classList.remove("arrastrando");
  // Antes de colocarlo (al fijar el tamaño al arrancar) la posición aún no vale
  if (!colocado) return;
  borde = payload.borde;
  void guardar("companeroPos", { x: payload.x, y: payload.y });
}).catch(console.error);

listen<boolean>("companero-hover", ({ payload }) => {
  encima = payload;
}).catch(console.error);

// Dónde está el cursor (para mirarlo) y si lo agitan cerca (se marea)
let giros: number[] = [];
let direccionX = 0;
listen<[number, number]>("companero-cursor", ({ payload }) => {
  const [x, y] = payload;
  const dx = x - cursor.x;
  cursor = { x, y };
  if (arrastrando || Math.hypot(x - centro(), y - centro()) > DISTANCIA_MAREO * config.tamano) return;
  const direccion = Math.sign(dx);
  if (direccion !== 0 && direccion !== direccionX) {
    const ahora = performance.now();
    giros = giros.filter((g) => ahora - g < VENTANA_MAREO_MS);
    giros.push(ahora);
    direccionX = direccion;
    if (giros.length >= GIROS_MAREO && !hayGesto()) {
      gesto("mareado", 2200);
      giros = [];
    }
  }
}).catch(console.error);

listen<number>("companero-inactivo", ({ payload }) => {
  inactivo = payload;
}).catch(console.error);

// ---------- Ajustes ----------

/** Color, tamaño y modo tranquilo elegidos en la configuración. */
async function aplicarAjustes(): Promise<void> {
  const nuevo = { ...COMPANERO_POR_DEFECTO, ...(await leer<Partial<ConfigCompanero>>("companeroConfig", {})) };
  const cambiaTamano = nuevo.tamano !== config.tamano;
  config = nuevo;
  document.documentElement.style.setProperty("--e", String(config.tamano));
  // Solo el compañero recibe el ratón; el resto de la ventana deja pasar los clics
  const m = MARGEN * config.tamano;
  const l = LADO * config.tamano;
  await invoke("set_companero_rects", { rects: [{ x: m, y: m, w: l, h: l }] }).catch(console.error);
  if (cambiaTamano) await invoke("fijar_tamano_companero", { escala: config.tamano }).catch(console.error);
}

listen(EVENTO_AJUSTES, () => void aplicarAjustes()).catch(console.error);

// ---------- Arranque ----------

// La posición se lee antes de fijar el tamaño (que recoloca la ventana)
const guardada = await leer<PosGuardada | null>("companeroPos", null);
await aplicarAjustes();
borde = await invoke<number>("iniciar_companero", { pos: guardada }).catch((e) => {
  console.error("compañero:", e);
  return 0;
});
colocado = true;
cursor = { x: centro(), y: centro() };
// Saluda al aparecer
gesto("saludo", 2600);
requestAnimationFrame(fotograma);
window.setTimeout(parpadear, 1500);
