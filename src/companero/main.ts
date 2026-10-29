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
  pelota,
  dibujarExtras,
  mezclar,
  rasgosDe,
  type Expresion,
  type OjosBaile,
  type Pose,
  type Rasgos,
} from "./cara";
import { beber } from "../estado/agua";
import { alternarPomodoro } from "../estado/pomodoro";
import { iniciarAvisos, peticionApp, progresoPomodoro } from "./avisos";
import { iniciarPuente } from "./puente";
import { VIDA_NOTA, apagarLatido, hayAudio, iniciarRitmo, pulsoAhora, ritmo } from "./ritmo";
import { SIN_BAILE, bailar, pararBaile, type Movimiento } from "./baile";
import { curioseoPara, entornoDe, reaccionPara, visitar, type Debajo } from "./entorno";
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
  /** La ventana que queda debajo (programa y título), si se sabe */
  debajo: Debajo | null;
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
/** Cómo se mueve el cuerpo al bailar (se acerca suave al paso de ahora) */
const baile: Movimiento = { ...SIN_BAILE };
/** Ojos del baile, mezclados para pasar de un paso a otro sin saltos */
const ojosBaile: Record<OjosBaile, number> = { felices: 1, cerrados: 0, abiertos: 0, apretados: 0 };
let expresionActual: Expresion = "normal";
let progresoActual = 0;
// Morph: al cambiar de cara, los rasgos van de los que se veían a los de la cara nueva.
// Los extras (notas, espirales, "z"…) de la cara anterior se desvanecen mientras tanto
let rasgosVistos: Rasgos = rasgosDe("normal", 0, 0);
let morph: { desde: Rasgos; extras: Expresion; progresoExtras: number; inicio: number } | null = null;

const acercar = (a: number, b: number, k: number) => a + (b - a) * k;
const centro = () => (MARGEN + LADO / 2) * config.tamano;

// ---------- Animación ----------

/** Dormido o cansado se mueve despacio: basta con menos fotogramas por segundo (gasta menos). */
const MS_DORMIDO = 1000 / 15;
const MS_CANSADO = 1000 / 30;
let ultimoDibujo = 0;
let dibujoCara = "";

function fotograma(ahora: number): void {
  const lento = !arrastrando && !encima && !morph;
  const espera = !lento ? 0 : expresionActual === "dormido" ? MS_DORMIDO : expresionActual === "cansado" ? MS_CANSADO : 0;
  if (ahora - ultimoDibujo < espera - 2) {
    requestAnimationFrame(fotograma);
    return;
  }
  ultimoDibujo = ahora;
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
  // Con música que se oye, baila al pulso de la canción; sin volumen (o en silencio), no
  const conRitmo = expresion === "musica" && hayAudio();
  let objetivoBaile = SIN_BAILE;
  let ojosObjetivo: OjosBaile = "felices";
  if (conRitmo) {
    const paso = bailar(ahora, pulsoAhora(), ritmo.energia, ritmo.intensidad, ritmo.intervalo);
    objetivoBaile = paso.mov;
    ojosObjetivo = paso.ojos;
  } else if (expresion === "feliz" && rutina === "baila") {
    // Baila solo, sin música, a su aire
    objetivoBaile = bailar(ahora, ahora / 560, 0.5, 0.35, 560).mov;
  } else if (rutina === "lados" && expresion === "normal") {
    // Estira hacia un lado y hacia el otro, despacio
    const k = Math.sin(ahora / 1100);
    objetivoBaile = { ...SIN_BAILE, rot: k * 11, x: k * 2, giroCara: k * 6, sy: 1 + Math.abs(k) * 0.04 };
    pararBaile();
  } else {
    pararBaile();
  }
  for (const tipo of Object.keys(ojosBaile) as OjosBaile[]) {
    ojosBaile[tipo] = acercar(ojosBaile[tipo], tipo === ojosObjetivo ? 1 : 0, 0.08);
  }
  pose.musica =
    expresion === "musica"
      ? {
          ojos: ojosBaile,
          energia: conRitmo ? ritmo.energia : 0,
          intensidad: ritmo.intensidad,
          notas: ritmo.notas,
          vidaNota: VIDA_NOTA,
        }
      : undefined;

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
  } else if (expresion === "juega") {
    // Sigue la pelota con la mirada
    const b = pelota(ahora);
    miraX = (b.x - 32) / 3;
    miraY = -1.5 - b.altura * 2.5;
  } else if (curioseoActual && expresion === curioseoActual.expresion) {
    // Examina su nuevo sitio: mira a un lado y a otro, inclinándose hacia donde mira
    const miradas = curioseoActual.miradas;
    const tramo = miradas[Math.min(miradas.length - 1, Math.floor(progreso * miradas.length))];
    [miraX, miraY] = tramo;
    inclinaX = miraX * 0.9;
    inclinaY = miraY * 0.6;
    giroCursor = miraX * 2.5;
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
      // La cabeza sigue el paso de baile; mira hacia donde va
      giro += objetivoBaile.giroCara * movimiento;
      salto = objetivoBaile.saltoCara * movimiento;
      pose.miraX = acercar(pose.miraX, objetivoBaile.miraX, 0.2);
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
    case "curioso":
    case "lupa":
    case "otea":
    case "asoma":
      // Ladea la cabeza, con un saltito al mirar a otro sitio
      if (curioseoActual) {
        giro += curioseoActual.ladeo;
        salto = -Math.max(0, Math.sin(progreso * curioseoActual.miradas.length * Math.PI * 2)) * 1.2 * movimiento;
      }
      break;
    case "juega": {
      // Cabezazo a la pelota cada vez que baja
      const b = pelota(ahora);
      salto = -Math.max(0, 1 - b.altura * 6) * 2.5 * movimiento;
      break;
    }
    case "frustrado":
      // Se desinfla un poco
      giro -= 5;
      salto = 1.5;
      break;
    case "impresionado":
      salto = -Math.abs(Math.sin(ahora / 110)) * 1.5 * movimiento;
      break;
    case "preocupado":
      giro += Math.sin(ahora / 30) * 1.5;
      break;
  }
  pose.giro = acercar(pose.giro, giro, expresion === "musica" ? 0.45 : 0.2);
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
  apagarLatido(dt);
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

  // Baile: el cuerpo sigue el paso (y vuelve suave a su sitio al acabar la música)
  for (const c of Object.keys(baile) as (keyof Movimiento)[]) {
    const quieto = c === "sx" || c === "sy" ? 1 : 0;
    baile[c] = acercar(baile[c], quieto + (objetivoBaile[c] - quieto) * movimiento, 0.4);
  }

  // Respira: más lento de noche, más suave en modo tranquilo
  const respira = 1 + Math.sin(ahora / (noche ? 520 : 320)) * (config.tranquilo ? 0.01 : 0.018);
  const agarre = arrastrando ? 1.12 : 1;
  const sx = respira * agarre * escalaX * estiraX * baile.sx;
  const sy = respira * agarre * escalaY * estiraY * baile.sy;
  const tx = inclinacion.x + baile.x;
  const ty = inclinacion.y + baile.y;
  const rot = paseo.angulo + baile.rot;
  companero.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
  // De noche, dormido, se ve más tenue
  companero.style.opacity = noche && expresion === "dormido" ? "0.8" : "1";

  // Solo se reescribe la cara si ha cambiado algo
  const dibujo = anilloPomodoro() + dibujarConMorph(ahora);
  if (dibujo !== dibujoCara) {
    cara.innerHTML = dibujo;
    dibujoCara = dibujo;
  }
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
  const objetivo = rasgosDe(expresionActual, ahora, progresoActual, pose.musica);
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
/** Reacciones al doble clic (no repite la anterior). */
const DOBLE_CLIC: [Expresion, number][] = [
  ["risa", 1500],
  ["celebra", 1700],
  ["guino", DURACION_GUINO],
  ["sorpresa", 900],
  ["impresionado", 1500],
];
let ultimoDobleClic = -1;
let tPanel = 0;

companero.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  pulsado = true;
  const { clientX, clientY } = e;
  tArrastre = window.setTimeout(() => {
    arrastrando = true;
    companero.classList.add("arrastrando");
    // Un saltito al cogerlo
    Object.assign(paseo, { desde: performance.now(), vx: 0, vy: 0, ultima: null, sacudidas: [], direccion: 0 });
    // Si estaba curioseando, lo deja
    if (curioseoActual && expresionActual === curioseoActual.expresion) {
      curioseo += 1;
      gesto("normal", 0);
    }
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
  // Un clic: abre o cierra el panel (con un guiño). Dos seguidos: risa, celebra, guiño o susto
  // (cada vez uno). Muchos: se enoja o se frustra.
  // El panel espera un momento por si llega un segundo clic
  const ahora = performance.now();
  clics = clics.filter((c) => ahora - c < RAFAGA_MS);
  clics.push(ahora);
  window.clearTimeout(tPanel);
  if (clics.length >= 4) {
    gesto(Math.random() < 0.6 ? "enojado" : "frustrado", 1800);
    clics = [];
    invoke("cerrar_panel").catch(console.error);
  } else if (clics.length >= 2 && ahora - clics[clics.length - 2] < DOBLE_CLIC_MS) {
    let i = Math.floor(Math.random() * DOBLE_CLIC.length);
    if (i === ultimoDobleClic) i = (i + 1) % DOBLE_CLIC.length;
    ultimoDobleClic = i;
    gesto(...DOBLE_CLIC[i]);
  } else {
    tPanel = window.setTimeout(() => {
      invoke<boolean>("alternar_panel")
        .then((abierto) => {
          if (abierto) gesto("guino", DURACION_GUINO);
        })
        .catch(console.error);
    }, DOBLE_CLIC_MS);
  }
});

// Tras moverlo a otro sitio, curiosea lo que hay alrededor y reacciona (cada vez distinto)
/** Formas de examinar el nuevo sitio: cara, cuánto dura, hacia dónde mira por tramos y cuánto ladea la cabeza. */
interface Curioseo {
  expresion: Expresion;
  ms: number;
  miradas: [number, number][];
  ladeo: number;
}
const CURIOSEOS: Curioseo[] = [
  // Con un interrogante: abajo a un lado, al otro, al frente y arriba
  { expresion: "curioso", ms: 3000, miradas: [[-3.8, 3], [-3.8, 3.4], [3.8, 3], [3.8, 2.6], [0, 4], [2.5, -2.5]], ladeo: 9 },
  // Con lupa: barre despacio de un lado a otro mirando de cerca
  { expresion: "lupa", ms: 3400, miradas: [[-3, 3.5], [-1.5, 3.8], [0, 4], [1.5, 3.8], [3, 3.5], [0, 2]], ladeo: 4 },
  // De visera: mira a lo lejos, muy a un lado y al otro
  { expresion: "otea", ms: 2800, miradas: [[-4, -1], [-4, -1.5], [4, -1], [4, -1.5]], ladeo: 0 },
  // Se asoma desconfiado: mira abajo, de reojo a los lados
  { expresion: "asoma", ms: 2600, miradas: [[0, 4], [-3.5, 3.5], [0, 4], [3.5, 3.5]], ladeo: -6 },
];
/** Lo mínimo que hay que llevarlo para que curiosee al soltarlo (ms). */
const MINIMO_PASEO_CURIOSEO = 350;
let curioseo = 0;
/** Cómo está curioseando ahora (o null). */
let curioseoActual: Curioseo | null = null;
/** Al dejarlo en un sitio donde ya ha estado varias veces, a veces lo reconoce sin curiosear. */
const RECONOCE_DESDE = 2;
const RECONOCIMIENTOS: [Expresion, number][] = [
  ["guino", DURACION_GUINO],
  ["feliz", 1400],
  ["silba", 2000],
];

/** Examina el sitio donde lo dejaste según lo que hay debajo, y reacciona a lo que "ve". */
function curiosear(debajo: Debajo | null, x: number, y: number): void {
  const id = ++curioseo;
  const visitas = visitar(x, y);
  if (visitas >= RECONOCE_DESDE && Math.random() < 0.5) {
    // "Ah, aquí otra vez"
    const [expresion, ms] = RECONOCIMIENTOS[Math.floor(Math.random() * RECONOCIMIENTOS.length)];
    curioseoActual = null;
    gesto(expresion, ms);
    return;
  }
  const entorno = entornoDe(debajo);
  const elegida = curioseoPara(entorno);
  const forma = CURIOSEOS.find((c) => c.expresion === elegida) ?? CURIOSEOS[0];
  curioseoActual = forma;
  gesto(forma.expresion, forma.ms);
  setTimeout(() => {
    // Si lo volviste a coger (u otra cosa lo interrumpió), no reacciona
    if (id !== curioseo || arrastrando || expresionActual !== forma.expresion) return;
    const [expresion, ms] = reaccionPara(entorno);
    gesto(expresion, ms);
  }, forma.ms);
}

// Al soltarlo: rebota, recuerda dónde quedó y si está escondido en un borde
listen<Soltado>("companero-soltado", ({ payload }) => {
  if (arrastrando) {
    escalaX = 1.18;
    escalaY = 0.8;
    // Si lo sacudiste mientras lo llevabas, queda mareado
    const ahora = performance.now();
    if (paseo.sacudidas.filter((s) => ahora - s < 1500).length >= SACUDIDAS_MAREO) gesto("mareado", 2400);
    // Si no, tras un paseo, curiosea su nuevo sitio (no si está escondido en un borde)
    else if (ahora - paseo.desde > MINIMO_PASEO_CURIOSEO && payload.borde === 0) curiosear(payload.debajo, payload.x, payload.y);
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

// Se intentó abrir la app otra vez: el compañero que ya está saluda
listen("otra-copia", () => gesto("saludo", 2200)).catch(console.error);
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
iniciarPuente();
iniciarRitmo();
requestAnimationFrame(fotograma);
window.setTimeout(parpadear, 1500);

