// Ventana del compañero: se coloca donde estaba, sigue al cursor con la mirada, tiene vida
// propia (vida.ts), reacciona al ratón y se mueve manteniéndolo pulsado.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { COMPANERO_POR_DEFECTO, EVENTO_AJUSTES, type ConfigCompanero } from "../ajustes";
import { guardar, leer } from "../store";
import { $ } from "../util";
import {
  bostezo,
  dibujarCara,
  dibujarExtras,
  mezclar,
  rasgosDe,
  type Expresion,
  type Pose,
  type Rasgos,
} from "./cara";
import { beber } from "../estado/agua";
import { alternarPomodoro } from "../estado/pomodoro";
import { iniciarAvisos, peticionApp, progresoPomodoro } from "./avisos";
import { decidir, esDeNoche, gesto, hayGesto } from "./vida";

/** Con tamaño 1; deben coincidir con MARGEN y LADO de companero.rs */
const MARGEN = 24;
const LADO = 64;
/** Mantenerlo pulsado este tiempo empieza el arrastre (un clic corto no). */
const RETARDO_ARRASTRE = 230;
const DURACION_GUINO = 1100;
/** Lo que tarda una cara en transformarse en la siguiente (morph). */
const DURACION_MORPH = 380;
/** Clics seguidos: dos rápidos = risa; cuatro en poco tiempo = se enoja. */
const DOBLE_CLIC_MS = 320;
const RAFAGA_MS = 1500;
/** Agitar el ratón cerca: tantos cambios de dirección en tan poco tiempo lo marean. */
const GIROS_MAREO = 6;
const VENTANA_MAREO_MS = 700;
const DISTANCIA_MAREO = 110;
/** Con el cursor a menos de CERCA_MIN px lo sigue del todo; a partir de CERCA_MAX, nada. */
const CERCA_MIN = 300;
const CERCA_MAX = 700;
/** Hacer círculos con el ratón alrededor: tantas vueltas en tan poco tiempo lo marean. */
const VUELTAS_MAREO = 2;
const TIEMPO_VUELTAS_MS = 3000;
const RADIO_VUELTAS = 260;
/** Balanceo al arrastrarlo (y al soltarlo): grados por cada px/ms de velocidad, muelle y freno. */
const INCLINACION_PASEO = 9;
const MAX_INCLINACION = 28;
const RIGIDEZ = 0.1;
const AMORTIGUACION = 0.16;
/** Sacudirlo así de veces mientras lo llevas lo deja mareado al soltarlo. */
const SACUDIDAS_MAREO = 4;
/** Teclado activo con el ratón quieto este tiempo = se está escribiendo. */
const ESCRIBIENDO_MS = 2500;
/** Este tiempo sin usar el PC termina la sesión (el cansancio por llevar mucho rato vuelve a cero). */
const FIN_SESION_MS = 5 * 60_000;

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
/** Última vez que se movió el cursor (para saber si se está escribiendo) */
let ultimoMovimiento = 0;
/** Desde cuándo se usa el PC sin parar (se reinicia tras un rato sin tocarlo) */
let sesionDesde = performance.now();
// Hacia dónde mira cuando está solo (cambia de vez en cuando)
let miradaLibre = { x: 0, y: 0 };
let cambioMirada = 0;
// El cuerpo se aplasta al soltarlo y vuelve solo
let escalaX = 1;
let escalaY = 1;
// Se inclina un poco hacia el cursor cuando está cerca
const inclinacion = { x: 0, y: 0 };
// Paseo: velocidad de la ventana mientras se arrastra y balanceo del cuerpo (como un péndulo)
const paseo = {
  desde: 0,
  vx: 0,
  vy: 0,
  ultima: null as { x: number; y: number; t: number } | null,
  angulo: 0,
  velAngular: 0,
  sacudidas: [] as number[],
  direccion: 0,
};
let ultimoFotograma = performance.now();
const pose: Pose = { miraX: 0, miraY: 0, parpadeo: 0, giro: 0, salto: 0 };
let expresionActual: Expresion = "normal";
let progresoActual = 0;
// Morph: al cambiar de cara, los rasgos van de los que se veían a los de la cara nueva.
// Los extras (notas, espirales, "z"…) de la cara anterior se desvanecen mientras tanto
let rasgosVistos: Rasgos = rasgosDe("normal", 0, 0);
let morph: { desde: Rasgos; extras: Expresion; progresoExtras: number; inicio: number } | null = null;

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
    arrastreMs: arrastrando ? ahora - paseo.desde : 0,
    // Hay actividad (teclado) pero el ratón lleva un rato quieto
    escribiendo: inactivo < ESCRIBIENDO_MS && ahora - ultimoMovimiento > ESCRIBIENDO_MS,
    sesion: ahora - sesionDesde,
    noche,
    tranquilo: config.tranquilo,
    peticion: peticionApp(),
  });
  if (expresion !== expresionActual) {
    // Empieza desde lo que se ve ahora (aunque estuviera a mitad de otro cambio)
    morph = { desde: rasgosVistos, extras: expresionActual, progresoExtras: progresoActual, inicio: ahora };
    // Un pequeño aplastamiento del cuerpo, como si reaccionara
    escalaX = Math.max(escalaX, 1.03);
    escalaY = Math.min(escalaY, 0.97);
  }
  expresionActual = expresion;
  progresoActual = progreso;

  // Mirada: escondido en un borde, hacia dentro; con el cursor cerca, lo sigue (ojos, cabeza
  // y se inclina un poco hacia él); solo, mira a su alrededor
  let miraX = 0;
  let miraY = 0;
  let inclinaX = 0;
  let inclinaY = 0;
  let giroCursor = 0;
  const libre = expresion === "normal" || expresion === "silba" || expresion === "sorpresa";
  const vx = cursor.x - centro();
  const vy = cursor.y - centro();
  const d = Math.hypot(vx, vy) || 1;
  // 1 con el cursor cerca del compañero; baja a 0 al alejarse
  const cerca = Math.max(0, Math.min(1, (CERCA_MAX - d / config.tamano) / (CERCA_MAX - CERCA_MIN)));
  if (arrastrando) {
    // Mira hacia donde lo llevas
    miraX = Math.max(-4, Math.min(4, paseo.vx * 3));
    miraY = Math.max(-3.5, Math.min(3.5, paseo.vy * 3));
  } else if (borde !== 0) {
    miraX = -borde * 3.5;
  } else if (libre && cerca > 0) {
    miraX = (vx / d) * 4 * cerca;
    miraY = (vy / d) * 3.5 * cerca;
    giroCursor = (vx / d) * 7 * cerca;
    inclinaX = (vx / d) * 3 * cerca;
    inclinaY = (vy / d) * 2 * cerca;
  } else if (libre && rutina === "mira") {
    if (ahora > cambioMirada) {
      miradaLibre = { x: (Math.random() * 2 - 1) * 3.5, y: (Math.random() * 2 - 1) * 2.5 };
      cambioMirada = ahora + 1400 + Math.random() * 1600;
    }
    ({ x: miraX, y: miraY } = miradaLibre);
  } else if (libre && rutina === "teclado") {
    // Mira hacia abajo, como si leyera lo que escribes
    miraX = Math.sin(ahora / 350) * 2;
    miraY = 3.5;
  }
  pose.miraX = acercar(pose.miraX, miraX, 0.15);
  pose.miraY = acercar(pose.miraY, miraY, 0.15);
  inclinacion.x = acercar(inclinacion.x, inclinaX, 0.12);
  inclinacion.y = acercar(inclinacion.y, inclinaY, 0.12);

  // Cabeza y saltitos según el gesto (en modo tranquilo, más suaves)
  const movimiento = config.tranquilo ? 0.5 : 1;
  let giro = -borde * 12 + giroCursor;
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
  } else if (expresion === "cansado" || expresion === "bostezo") {
    const b = expresion === "bostezo" ? Math.sin(progreso * Math.PI) : bostezo(ahora);
    estiraY = 1 + b * 0.08;
    estiraX = 1 - b * 0.04;
  } else if (expresion === "saludo") {
    estiraY = 1 + Math.abs(Math.sin(ahora / 260)) * 0.06;
  }
  // Paseo: se estira en la dirección en que lo mueves y se balancea como un péndulo
  const dt = Math.min(3, (ahora - ultimoFotograma) / 16.7);
  ultimoFotograma = ahora;
  if (arrastrando && paseo.ultima && ahora - paseo.ultima.t > 80) {
    // Lo tienes cogido pero quieto: la velocidad cae a cero
    paseo.vx *= 0.8;
    paseo.vy *= 0.8;
  }
  const objetivoAngulo = arrastrando
    ? Math.max(-MAX_INCLINACION, Math.min(MAX_INCLINACION, -paseo.vx * INCLINACION_PASEO))
    : 0;
  const aceleracion = (objetivoAngulo - paseo.angulo) * RIGIDEZ - paseo.velAngular * AMORTIGUACION;
  paseo.velAngular += aceleracion * dt;
  paseo.angulo += paseo.velAngular * dt;
  if (arrastrando) {
    estiraX *= 1 + Math.min(0.14, Math.abs(paseo.vx) * 0.05) - Math.min(0.07, Math.abs(paseo.vy) * 0.025);
    estiraY *= 1 + Math.min(0.14, Math.abs(paseo.vy) * 0.05) - Math.min(0.07, Math.abs(paseo.vx) * 0.025);
  }
  // Cogido (y mientras se balancea al soltarlo) gira desde arriba, como si colgara
  const colgando = arrastrando || Math.abs(paseo.angulo) > 0.4 || Math.abs(paseo.velAngular) > 0.05;
  companero.style.transformOrigin = colgando ? "50% 12%" : "50% 100%";

  // Respira: más lento de noche, más suave en modo tranquilo
  const respira = 1 + Math.sin(ahora / (noche ? 520 : 320)) * (config.tranquilo ? 0.01 : 0.018);
  const agarre = arrastrando ? 1.12 : 1;
  const sx = respira * agarre * escalaX * estiraX;
  const sy = respira * agarre * escalaY * estiraY;
  companero.style.transform = `translate(${inclinacion.x.toFixed(2)}px, ${inclinacion.y.toFixed(2)}px) rotate(${paseo.angulo.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  // De noche, dormido, se ve más tenue
  companero.style.opacity = noche && expresion === "dormido" ? "0.8" : "1";

  cara.innerHTML = anilloPomodoro() + dibujarConMorph(ahora);
  requestAnimationFrame(fotograma);
}

/** Con un Pomodoro en marcha, su progreso recorre el borde del compañero (rojo enfoque, verde descanso). */
function anilloPomodoro(): string {
  const p = progresoPomodoro();
  if (!p) return "";
  const color = p.enfoque ? "#FF453A" : "#30D158";
  const borde = `x="-3" y="-3" width="70" height="70" rx="21" fill="none" stroke-width="2.5"`;
  return (
    `<rect ${borde} stroke="${color}" stroke-opacity=".2"/>` +
    `<rect ${borde} stroke="${color}" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${(100 * (1 - p.progreso)).toFixed(2)}"/>`
  );
}

/** Curva de aceleración suave al empezar y al terminar. */
const suavizar = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** La cara actual: durante un cambio, los rasgos se transforman y los extras se funden. */
function dibujarConMorph(ahora: number): string {
  const c = config.color;
  const objetivo = rasgosDe(expresionActual, ahora, progresoActual);
  const extrasNuevos = dibujarExtras(expresionActual, ahora, progresoActual, pose, c);
  if (!morph) {
    rasgosVistos = objetivo;
    return dibujarCara(objetivo, pose, c) + extrasNuevos;
  }
  const k = Math.min(1, (ahora - morph.inicio) / DURACION_MORPH);
  const e = suavizar(k);
  rasgosVistos = mezclar(morph.desde, objetivo, e);
  const extrasViejos = dibujarExtras(morph.extras, ahora, morph.progresoExtras, pose, c);
  if (k >= 1) morph = null;
  return (
    dibujarCara(rasgosVistos, pose, c) +
    (extrasViejos ? `<g opacity="${(1 - e).toFixed(3)}">${extrasViejos}</g>` : "") +
    (extrasNuevos ? `<g opacity="${e.toFixed(3)}">${extrasNuevos}</g>` : "")
  );
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
    // Un saltito al cogerlo
    Object.assign(paseo, { desde: performance.now(), vx: 0, vy: 0, ultima: null, sacudidas: [], direccion: 0 });
    escalaX = 0.88;
    escalaY = 1.14;
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
    // Si lo sacudiste mientras lo llevabas, queda mareado
    const ahora = performance.now();
    if (paseo.sacudidas.filter((s) => ahora - s < 1500).length >= SACUDIDAS_MAREO) gesto("mareado", 2400);
  }
  pulsado = false;
  arrastrando = false;
  companero.classList.remove("arrastrando");
  // Antes de colocarlo (al fijar el tamaño al arrancar) la posición aún no vale
  if (!colocado) return;
  borde = payload.borde;
  void guardar("companeroPos", { x: payload.x, y: payload.y });
}).catch(console.error);

// Dónde va mientras lo arrastras: velocidad (para inclinarse y estirarse) y sacudidas
listen<[number, number]>("companero-moviendo", ({ payload }) => {
  const [x, y] = payload;
  const t = performance.now();
  if (paseo.ultima) {
    const dt = Math.max(8, t - paseo.ultima.t);
    const vx = (x - paseo.ultima.x) / dt;
    const vy = (y - paseo.ultima.y) / dt;
    paseo.vx = acercar(paseo.vx, vx, 0.5);
    paseo.vy = acercar(paseo.vy, vy, 0.5);
    const direccion = Math.abs(vx) > 0.5 ? Math.sign(vx) : 0;
    if (direccion !== 0 && direccion !== paseo.direccion) {
      paseo.sacudidas.push(t);
      paseo.direccion = direccion;
    }
  }
  paseo.ultima = { x, y, t };
}).catch(console.error);

listen<boolean>("companero-hover", ({ payload }) => {
  encima = payload;
}).catch(console.error);

// Dónde está el cursor (para mirarlo) y si lo agitan cerca o le hacen círculos (se marea)
let giros: number[] = [];
let direccionX = 0;
let vueltas: { t: number; giro: number }[] = [];
let anguloAntes: number | null = null;

/** Suma lo que gira el cursor alrededor del compañero; dos vueltas seguidas lo marean. */
function contarVueltas(x: number, y: number): void {
  const dx = x - centro();
  const dy = y - centro();
  if (Math.hypot(dx, dy) > RADIO_VUELTAS * config.tamano) {
    vueltas = [];
    anguloAntes = null;
    return;
  }
  const angulo = Math.atan2(dy, dx);
  if (anguloAntes !== null) {
    let giro = angulo - anguloAntes;
    if (giro > Math.PI) giro -= 2 * Math.PI;
    if (giro < -Math.PI) giro += 2 * Math.PI;
    const ahora = performance.now();
    vueltas = vueltas.filter((v) => ahora - v.t < TIEMPO_VUELTAS_MS);
    vueltas.push({ t: ahora, giro });
    const total = Math.abs(vueltas.reduce((s, v) => s + v.giro, 0));
    if (total >= VUELTAS_MAREO * 2 * Math.PI && !hayGesto()) {
      gesto("mareado", 2400);
      vueltas = [];
    }
  }
  anguloAntes = angulo;
}

listen<[number, number]>("companero-cursor", ({ payload }) => {
  const [x, y] = payload;
  const dx = x - cursor.x;
  cursor = { x, y };
  ultimoMovimiento = performance.now();
  if (arrastrando) return;
  contarVueltas(x, y);
  if (Math.hypot(x - centro(), y - centro()) > DISTANCIA_MAREO * config.tamano) return;
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
  // Tras un buen rato sin usar el PC, la sesión vuelve a empezar
  if (payload > FIN_SESION_MS) sesionDesde = performance.now();
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

// Atajos del menú de la bandeja (hasta que el compañero tenga su panel)
listen("menu-pomodoro", () => {
  alternarPomodoro();
  gesto("guino", DURACION_GUINO);
}).catch(console.error);
listen("menu-agua", () => {
  beber();
  gesto("feliz", 1400);
}).catch(console.error);

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
// Saluda al aparecer y empieza a escuchar notificaciones, música, Pomodoro, agua y pausas
gesto("saludo", 2600);
iniciarAvisos();
requestAnimationFrame(fotograma);
window.setTimeout(parpadear, 1500);
