// Escenas del tiempo: el compañero vive el tiempo que hace con el cuerpo y la cara, no con un
// icono. Con lluvia saca un paraguas que se abre con rebote, las gotas salpican en la tela y
// forman un charquito bajo los pies; con tormenta, relámpagos y sustos con cada trueno; la nieve
// se le posa en la cabeza; con calor, gafas de sol y sudor; con frío, bufanda, vaho y tiritona;
// y además niebla, nubes que pasan, estrellas de noche y el sol saliendo en los buenos días.
// Todo entra y sale con fundidos suaves y en modo tranquilo hay menos partículas y movimiento.
//
// Estilo minimalista, con solo dos colores como la cara: el del LED (el que elijas) y el negro
// del cristal. Las piezas son negras con el contorno LED, o LED con un borde negro fino.
//
// Para no estar siempre cargado, la escena completa sale por ratos: al cambiar el tiempo (o al
// despertarse) durante un minuto y medio, y luego un momento cada 12 minutos. El resto del rato
// queda un detalle discreto: el paraguas cerrado, la bufanda, las gafas, la nieve.
//
// Se dibuja en tres capas, con las mismas coordenadas que la cara (64×64 y 24 px de margen):
// - fondo: detrás del cuerpo y quieto (sol, nubes, rayos, estrellas)
// - cuerpo: encima de la cara y moviéndose con ella (paraguas, gafas, bufanda, nieve en la cabeza)
// - frente: delante de todo y quieto (gotas, copos, niebla)
import type { EscenaPrueba } from "../ajustes";
import { describirCielo, type Clima } from "../estado/clima";
import type { Pose } from "./cara";
import { gesto } from "./vida";

type Escena = "lluvia" | "tormenta" | "nieve" | "amenaza" | "calor" | "niebla" | "nublado" | "noche" | "amanecer";
const ESCENAS: Escena[] = ["lluvia", "tormenta", "nieve", "amenaza", "calor", "niebla", "nublado", "noche", "amanecer"];

/** Lo que se ve: la escena, cuánto llueve o nieva (0 a 1), si hace frío y si luce el sol. */
interface Cielo {
  escena: Escena | null;
  fuerza: number;
  frio: boolean;
  sol: boolean;
}

/** Lo que el compañero está haciendo, para saber qué se puede dibujar. */
export interface Contexto {
  pose: Pose;
  color: string;
  tranquilo: boolean;
  dormido: boolean;
  /** Con la cara a su aire (sin gesto ni expresión especial): gafas, entornar, mirar al cielo */
  caraLibre: boolean;
  /** Escondido en un borde de la pantalla */
  oculto: boolean;
  arrastrando: boolean;
  /** Hay un icono del sistema (batería, volumen) sobre la cabeza: tiene prioridad */
  icono: boolean;
}

export interface Tiempo {
  fondo: string;
  cuerpo: string;
  frente: string;
  /** Desplazamiento lateral del cuerpo al tiritar (px) */
  temblor: number;
  /** Cuánto entrecierra los ojos (0 a 1) */
  entorna: number;
  /** Hacia dónde quiere mirar (al cielo, a la nube), o null */
  mira: { x: number; y: number } | null;
}

const BORDE = "#0B0B0C";
/** Color LED del compañero (el de la cara): junto al negro, el único de las escenas. */
let C = "#f5f7ff";
/** Temperaturas (°C) desde las que hace calor (gafas) o frío (bufanda). */
const CALOR = 28;
const FRIO = 5;
/** Lo que tarda una escena en aparecer o irse. */
const FUNDIDO_MS = 700;
/** Escena completa: lo que dura al cambiar el tiempo, cada cuánto vuelve y lo que dura entonces. */
const ESCENA_MS = 90_000;
const REPITE_MS = 12 * 60_000;
const RATO_MS = 45_000;
/** Altura del suelo, justo bajo los pies. */
const SUELO = 67;
/** Paraguas: largo del mango, medio ancho y alto de la tela (sin abrir del todo, se estrecha). */
const LARGO = 54;
const MEDIO_ANCHO = 31;
const ALTO_TELA = 13;
/** Al parar de llover: lo que tarda en cerrarlo y lo que dura la sacudida. */
const CERRAR_MS = 450;
const SACUDE_MS = 900;
/** Lluvia: inclinación (px a un lado por px de caída) y lo que dura la salpicadura. */
const VIENTO = 0.28;
const SALPICA_MS = 220;

/** Códigos WMO de lluvia fuerte y moderada (el resto es lluvia débil). */
const LLUVIA_FUERTE = new Set([65, 67, 82]);
const LLUVIA_MEDIA = new Set([63, 66, 81]);

const n = (v: number) => v.toFixed(2);
const acercar = (a: number, b: number, k: number) => a + (b - a) * k;
const limitar = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const suave = (k: number) => k * k * (3 - 2 * k);
/** Número pseudoaleatorio fijo (0 a 1) para cada pareja: así cada gota o copo es siempre igual. */
const azar = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Relleno con borde fino oscuro por fuera, para verse sobre fondos claros. */
const conBorde = (c: string, grosor = 0.9) => `fill="${c}" stroke="${BORDE}" stroke-width="${grosor}" stroke-linejoin="round" paint-order="stroke"`;
/** Pieza negra con el contorno LED (como el cristal del compañero). */
const pieza = (grosor = 1.3) => `fill="${BORDE}" stroke="${C}" stroke-width="${grosor}" stroke-linejoin="round"`;
/** Un trazo con su borde oscuro debajo. */
const trazo = (d: string, c: string, ancho: number, extra = "") =>
  `<path d="${d}" fill="none" stroke="${BORDE}" stroke-width="${n(ancho + 1)}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>` +
  `<path d="${d}" fill="none" stroke="${c}" stroke-width="${ancho}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;

// ---------- Qué tiempo hace ----------

let clima: Clima | null = null;
/** Una escena puesta a propósito un rato (los buenos días), aunque ahora haga otro tiempo. */
let especial: { cielo: Cielo; desde: number; hasta: number; prueba?: Restos } | null = null;
/** Nieve en la cabeza que había antes de probar una escena: al acabar la prueba se vuelve a ella. */
interface Restos {
  capa: number;
}
let restos: Restos | null = null;

function cieloDe(codigo: number, temperatura: number, dia: boolean, lluviaPronto: boolean): Cielo {
  const tipo = describirCielo(codigo).tipo;
  let escena: Escena | null = null;
  let fuerza = 0;
  switch (tipo) {
    case "tormenta":
      escena = "tormenta";
      fuerza = 1;
      break;
    case "lluvia":
      escena = "lluvia";
      fuerza = LLUVIA_FUERTE.has(codigo) ? 1 : LLUVIA_MEDIA.has(codigo) ? 0.65 : 0.4;
      break;
    case "llovizna":
      escena = "lluvia";
      fuerza = 0.15;
      break;
    case "nieve":
      escena = "nieve";
      fuerza = codigo === 75 || codigo === 86 ? 1 : 0.5;
      break;
    case "niebla":
      escena = "niebla";
      break;
    default:
      if (lluviaPronto) escena = "amenaza";
      else if (temperatura >= CALOR && dia) escena = "calor";
      else if (tipo === "nubes") escena = "nublado";
      else if (!dia) escena = "noche";
  }
  return { escena, fuerza, frio: temperatura <= FRIO && escena !== "calor", sol: tipo === "sol" };
}

const SIN_CIELO: Cielo = { escena: null, fuerza: 0, frio: false, sol: false };

function cieloAhora(ahora: number): Cielo {
  if (especial && ahora < especial.hasta) return especial.cielo;
  // Al acabar una prueba, la nieve que dejó se va rápido
  if (especial?.prueba) restos = especial.prueba;
  especial = null;
  if (!clima) return SIN_CIELO;
  return cieloDe(clima.codigo, clima.temperatura, clima.dia, clima.lluviaPronto !== null);
}

/** El tiempo de ahora (o null si no hay ciudad). */
export function ponerClima(c: Clima | null): void {
  clima = c;
}

/** Los buenos días: el tiempo de hoy durante un rato (si hace sol, sale por detrás). */
export function mostrarCieloDeHoy(c: Clima, ms: number): void {
  const ahora = performance.now();
  const cielo: Cielo =
    describirCielo(c.hoy.codigo).tipo === "sol"
      ? { escena: "amanecer", fuerza: 0, frio: false, sol: true }
      : cieloDe(c.hoy.codigo, c.hoy.max, true, false);
  especial = { cielo, desde: ahora, hasta: ahora + ms };
}

/** Lo que se ve al probar cada escena desde Configuración. */
const PRUEBAS: Record<EscenaPrueba, Cielo> = {
  lluvia: { escena: "lluvia", fuerza: 0.65, frio: false, sol: false },
  tormenta: { escena: "tormenta", fuerza: 1, frio: false, sol: false },
  amenaza: { escena: "amenaza", fuerza: 0, frio: false, sol: false },
  nieve: { escena: "nieve", fuerza: 0.6, frio: true, sol: false },
  calor: { escena: "calor", fuerza: 0, frio: false, sol: true },
  frio: { escena: null, fuerza: 0, frio: true, sol: false },
  niebla: { escena: "niebla", fuerza: 0, frio: false, sol: false },
  nublado: { escena: "nublado", fuerza: 0, frio: false, sol: false },
  noche: { escena: "noche", fuerza: 0, frio: false, sol: false },
  amanecer: { escena: "amanecer", fuerza: 0, frio: false, sol: true },
};

/** Enseña una escena un rato aunque haga otro tiempo (para probarla). Con nieve,
 * empieza ya con algo de nieve en la cabeza para que se vea entera. */
export function probarEscena(id: EscenaPrueba, ms: number): void {
  const cielo = PRUEBAS[id];
  if (!cielo) return;
  const ahora = performance.now();
  // Si ya se estaba probando otra, se recuerda lo de antes de la primera
  const prueba = especial?.prueba ?? { capa };
  especial = { cielo, desde: ahora, hasta: ahora + ms, prueba };
  restos = null;
  if (cielo.escena === "nieve") capa = Math.max(capa, 0.6);
}

/** Termina la prueba en curso, si la hay. */
export function pararPrueba(): void {
  if (especial?.prueba) especial.hasta = 0;
}

// ---------- Estado de las escenas ----------

/** Cuánto se ve cada escena (0 a 1): sube y baja suave al cambiar el tiempo. */
const peso = Object.fromEntries(ESCENAS.map((e) => [e, 0])) as Record<Escena, number>;
let pesoFrio = 0;
let pesoGafas = 0;
let pesoEntorna = 0;
let pesoCompleta = 0;
let fuerza = 0;
let ultimo = 0;

const paraguas = { presencia: 0, apertura: 0, vel: 0, abierto: false, sacudeDesde: -Infinity, sonrisa: false };
/** Nieve en la cabeza (0 a 1): se queda aunque duerma y se derrite despacio. */
let capa = 0;
let sacudidaNieve = -Infinity;
let proximaSacudidaNieve = 0;
let rayo: { desde: number; x: number; semilla: number; trueno: boolean } | null = null;
let proximoRayo = 0;
let temblores: { desde: number; ms: number; fuerza: number }[] = [];
let proximoTiriton = 0;
/** La escena (y si hace frío) de la última vez y desde cuándo, para saber si toca la completa. */
let escenaVista = "";
let completaDesde = 0;

function temblar(ahora: number, ms: number, f: number): void {
  temblores.push({ desde: ahora, ms, fuerza: f });
}

function temblorAhora(ahora: number): number {
  temblores = temblores.filter((t) => ahora < t.desde + t.ms);
  let s = 0;
  for (const t of temblores) {
    const k = (ahora - t.desde) / t.ms;
    s += Math.sin((ahora - t.desde) / 22) * t.fuerza * (1 - k);
  }
  return s;
}

// ---------- Paraguas ----------

interface Geometria {
  x: number;
  y: number;
  /** Grados (negativo: inclinado hacia la cabeza) */
  angulo: number;
  /** Ancho y largo de la tela según lo abierto que esté */
  sx: number;
  sy: number;
}

/** Con lluvia lo abre durante la escena completa; el resto del rato lo lleva cerrado. */
function moverParaguas(ahora: number, dt: number, cielo: Cielo, activo: boolean, completa: boolean, icono: boolean): void {
  const p = paraguas;
  const llueve = activo && (cielo.escena === "lluvia" || cielo.escena === "tormenta");
  const amenaza = activo && cielo.escena === "amenaza";
  if (p.abierto && !llueve) {
    // Deja de llover: lo cierra, lo sacude y sonríe (dormido o escondido, solo lo guarda)
    p.sacudeDesde = activo ? ahora + CERRAR_MS : -Infinity;
    p.sonrisa = activo;
  }
  p.abierto = llueve;
  const sacudiendo = ahora < p.sacudeDesde + SACUDE_MS;
  const presente = (llueve || amenaza || sacudiendo) && !icono;
  p.presencia = acercar(p.presencia, presente ? 1 : 0, 1 - Math.exp(-dt / 180));
  // Sale cerrado y se abre al llegar arriba; un muelle hace que se pase un poco y vuelva
  const abrir = llueve && completa && p.presencia > 0.85 ? 1 : 0;
  const pasos = Math.min(6, Math.max(1, Math.round(dt / 16.7)));
  for (let i = 0; i < pasos; i++) {
    p.vel += (abrir - p.apertura) * 0.07 - p.vel * 0.26;
    p.apertura += p.vel;
  }
  if (p.sonrisa && ahora >= p.sacudeDesde) {
    p.sonrisa = false;
    gesto("feliz", 1800);
  }
}

function geometriaParaguas(ahora: number, tranquilo: boolean): Geometria {
  const a = limitar(paraguas.apertura, 0, 1);
  const abierta = Math.max(0.12, 0.12 + 0.88 * paraguas.apertura);
  const balanceo = Math.sin(ahora / 900) * (1.5 + fuerza * 2.5) * a * (tranquilo ? 0.5 : 1);
  // La sacudida al cerrarlo: un meneo rápido que se va calmando
  const s = (ahora - paraguas.sacudeDesde) / SACUDE_MS;
  const sacude = s >= 0 && s < 1 ? Math.sin(s * Math.PI * 9) * 16 * (1 - s) * (tranquilo ? 0.5 : 1) : 0;
  return {
    x: acercar(69, 57, a),
    // Sube desde abajo al aparecer
    y: acercar(46, 47, a) + (1 - suave(paraguas.presencia)) * 34,
    angulo: acercar(7, -22, a) + balanceo + sacude,
    sx: abierta,
    sy: 1 + 1.7 * (1 - a),
  };
}

/** ¿El punto (x, y) cae dentro de la tela abierta? */
function bajoParaguas(x: number, y: number, g: Geometria): boolean {
  if (paraguas.apertura < 0.7 || paraguas.presencia < 0.9) return false;
  const r = (-g.angulo * Math.PI) / 180;
  const dx = x - g.x;
  const dy = y - g.y;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r) + LARGO;
  const medio = MEDIO_ANCHO * g.sx;
  if (Math.abs(lx) > medio) return false;
  return ly >= -1 + 14 * (lx / medio) ** 2 && ly <= ALTO_TELA * g.sy;
}

/** La tela: cúpula con el borde de ondas, gajos de dos azules y la punta. */
function tela(g: Geometria): string {
  const w = MEDIO_ANCHO;
  const h = ALTO_TELA;
  const gajos = 4;
  const paso = (w * 2) / gajos;
  let ondas = "";
  for (let i = 0; i < gajos; i++) ondas += `q${n(-paso / 2)} -3.6 ${n(-paso)} 0`;
  const cupula = `M${-w} ${h}C${-w} 3 ${n(-w * 0.5)} -1 0 -1C${n(w * 0.5)} -1 ${w} 3 ${w} ${h}${ondas}z`;
  let varillas = "";
  for (let i = 1; i < gajos; i++) {
    const x = -w + i * paso;
    varillas += `M0 -1Q${n(x * 0.7)} 2 ${n(x)} ${n(h - 0.6)}`;
  }
  return (
    `<g transform="translate(0 ${-LARGO}) scale(${n(g.sx)} ${n(g.sy)})">` +
    `<path d="${cupula}" ${pieza(1.6)}/>` +
    `<path d="${varillas}" fill="none" stroke="${C}" stroke-width=".8"/>` +
    `</g>`
  );
}

function dibujarParaguas(ahora: number, g: Geometria, c: string, tranquilo: boolean): string {
  if (paraguas.presencia < 0.01) return "";
  const mango = `M0 ${-LARGO - 3.5}V5.5a2.8 2.8 0 0 1 -5.6 0`;
  let gotitas = "";
  // Al sacudirlo salen gotitas volando
  const s = (ahora - paraguas.sacudeDesde) / SACUDE_MS;
  if (s >= 0 && s < 1.2 && !tranquilo) {
    let d = "";
    for (let i = 0; i < 7; i++) {
      const lado = i % 2 ? 1 : -1;
      const q = limitar((s - i * 0.06) / 0.6, 0, 1);
      if (q <= 0 || q >= 1) continue;
      const x = lado * (3 + q * (10 + azar(i, 3) * 10));
      const y = -LARGO * 0.6 + azar(i, 4) * 18 - Math.sin(q * Math.PI) * 9 + q * 8;
      d += `M${n(x)} ${n(y)}h0`;
    }
    if (d) gotitas = `<path d="${d}" stroke="${BORDE}" stroke-width="3" stroke-linecap="round"/><path d="${d}" stroke="${C}" stroke-width="1.9" stroke-linecap="round"/>`;
  }
  return (
    `<g opacity="${n(limitar(paraguas.presencia * 1.4, 0, 1))}" transform="translate(${n(g.x)} ${n(g.y)}) rotate(${n(g.angulo)})">` +
    trazo(mango, C, 1.4) +
    tela(g) +
    gotitas +
    // La mano que lo sujeta
    `<circle cx="0" cy="0" r="4.2" ${conBorde(c)}/>` +
    `</g>`
  );
}

// ---------- Lluvia y tormenta ----------

/** Gotas que caen en diagonal y salpican al chocar con la tela, la cabeza o el suelo. */
function lluvia(ahora: number, g: Geometria, tranquilo: boolean): string {
  const cantidad = Math.round((7 + 12 * fuerza) * (tranquilo ? 0.5 : 1));
  const vel = 0.2 + 0.1 * fuerza;
  let gotas = "";
  let salpicaduras = "";
  for (let i = 0; i < cantidad; i++) {
    // Lo justo para caer de arriba abajo y salpicar, más un respiro distinto para cada gota
    const periodo = (SUELO + 26) / vel + SALPICA_MS + azar(i, 0) * 250;
    const t = ahora + azar(i, 1) * periodo;
    const ciclo = Math.floor(t / periodo);
    const local = t - ciclo * periodo;
    const x0 = -42 + azar(i, ciclo + 2) * 120;
    // Dónde choca: la tela, el cuerpo o el suelo
    let yChoque = SUELO;
    for (let y = -26; y < SUELO; y += 2) {
      const x = x0 + VIENTO * (y + 26);
      if (bajoParaguas(x, y, g) || (x > 1 && x < 63 && y >= 0)) {
        yChoque = y;
        break;
      }
    }
    const caida = (yChoque + 26) / vel;
    if (local < caida) {
      const y = -26 + vel * local;
      const x = x0 + VIENTO * (y + 26);
      gotas += `M${n(x - VIENTO * 7)} ${n(y - 7)}L${n(x)} ${n(y)}`;
    } else if (local < caida + SALPICA_MS) {
      const q = (local - caida) / SALPICA_MS;
      const x = x0 + VIENTO * (yChoque + 26);
      // Dos gotitas que saltan a los lados
      const alto = Math.sin(q * Math.PI) * 3;
      salpicaduras += `M${n(x - 1 - q * 4)} ${n(yChoque - alto)}h0M${n(x + 1 + q * 4)} ${n(yChoque - alto)}h0`;
    }
  }
  const frente =
    (gotas ? `<path d="${gotas}" stroke="${BORDE}" stroke-width="2.1" stroke-linecap="round"/><path d="${gotas}" stroke="${C}" stroke-width="1.1" stroke-linecap="round"/>` : "") +
    (salpicaduras ? `<path d="${salpicaduras}" stroke="${BORDE}" stroke-width="2.4" stroke-linecap="round"/><path d="${salpicaduras}" stroke="${C}" stroke-width="1.4" stroke-linecap="round"/>` : "");
  return frente;
}

/** Relámpagos cada 8–20 s: destello en el cristal, un rayo detrás y un susto con el trueno. */
function moverTormenta(ahora: number, ctx: Contexto, activo: boolean): void {
  if (activo && peso.tormenta > 0.5) {
    if (proximoRayo === 0) proximoRayo = ahora + 2500;
    else if (ahora >= proximoRayo) {
      const lado = Math.random() < 0.5 ? -1 : 1;
      rayo = { desde: ahora, x: lado < 0 ? -16 + Math.random() * 12 : 68 + Math.random() * 12, semilla: Math.random() * 100, trueno: false };
      proximoRayo = ahora + 8000 + Math.random() * 12_000;
    }
  } else {
    proximoRayo = 0;
  }
  if (!rayo) return;
  const p = ahora - rayo.desde;
  if (!rayo.trueno && p > 450) {
    rayo.trueno = true;
    if (activo) {
      if (ctx.caraLibre) gesto("sorpresa", 900);
      temblar(ahora, 700, ctx.tranquilo ? 0.5 : 1.3);
    }
  }
  if (p > 1000) rayo = null;
}

/** Cuánto brilla el relámpago ahora (parpadea dos veces y se apaga). */
function destello(ahora: number): number {
  if (!rayo) return 0;
  const p = ahora - rayo.desde;
  if (p < 60) return 1;
  if (p < 110) return 0.15;
  if (p < 170) return 0.85;
  return Math.max(0, 0.85 * (1 - (p - 170) / 350));
}

function dibujarRayo(ahora: number): string {
  if (!rayo) return "";
  const p = ahora - rayo.desde;
  if (p > 260 || (p > 60 && p < 110)) return "";
  let x = rayo.x;
  let d = `M${n(x)} -24`;
  for (let y = -15, i = 0; y <= 36; y += 9, i++) {
    x += (azar(rayo.semilla, i) - 0.5) * 11;
    d += `L${n(x)} ${y}`;
  }
  return (
    trazo(d, C, 1.5)
  );
}

// ---------- Nieve ----------

/** Copos que bajan meciéndose; la mitad pasa por delante y la otra se posa en la cabeza. */
function copos(ahora: number, tranquilo: boolean): string {
  const cantidad = Math.round((6 + 6 * fuerza) * (tranquilo ? 0.5 : 1));
  const alto = -1 - capa * 2.6;
  let grandes = "";
  let chicos = "";
  for (let i = 0; i < cantidad; i++) {
    const periodo = 5200 + azar(i, 5) * 2600;
    const t = ahora + azar(i, 6) * periodo;
    const ciclo = Math.floor(t / periodo);
    const local = t - ciclo * periodo;
    const y = -26 + local * 0.022;
    const x = -22 + azar(i, ciclo + 7) * 106 + Math.sin(local / 700 + i) * 5;
    // Se posa en la cabeza o en el suelo
    if ((i % 2 === 0 && x > 3 && x < 61 && y >= alto) || y >= SUELO) continue;
    const punto = `M${n(x)} ${n(y)}h0`;
    if (i % 3 === 0) grandes += punto;
    else chicos += punto;
  }
  return (
    (grandes ? `<path d="${grandes}" stroke="${BORDE}" stroke-width="4.4" stroke-linecap="round"/><path d="${grandes}" stroke="${C}" stroke-width="3.4" stroke-linecap="round"/>` : "") +
    (chicos ? `<path d="${chicos}" stroke="${BORDE}" stroke-width="3.2" stroke-linecap="round"/><path d="${chicos}" stroke="${C}" stroke-width="2.2" stroke-linecap="round"/>` : "")
  );
}

/** Una capita fina de nieve sobre la cabeza: sigue el borde de arriba, con dos bultitos. */
function capaNieve(ahora: number): string {
  let s = "";
  if (capa > 0.02) {
    const h = 1 + capa * 2.6;
    const d =
      `M8 5C11 1.4 14 0 18 0H46C50 0 53 1.4 56 5` +
      `C53 ${n(1.4 - h)} 50 ${n(-h)} 46 ${n(-h)}` +
      `Q40 ${n(-h - 1.6)} 34 ${n(-h)}H27Q22 ${n(-h - 1.2)} 18 ${n(-h)}` +
      `C14 ${n(-h)} 11 ${n(1.4 - h)} 8 5Z`;
    s += `<path d="${d}" ${conBorde(C)}/>`;
  }
  // Al sacudírsela salen copos volando a los lados
  const q = (ahora - sacudidaNieve) / 800;
  if (q >= 0 && q < 1) {
    let d = "";
    for (let i = 0; i < 9; i++) {
      const x0 = 8 + i * 6;
      const x = x0 + ((x0 - 32) / 32) * 22 * q;
      const y = -3 - Math.sin(q * Math.PI) * 10 + q * 10;
      d += `M${n(x)} ${n(y)}h0`;
    }
    s += `<g opacity="${n(1 - q)}"><path d="${d}" stroke="${BORDE}" stroke-width="3.6" stroke-linecap="round"/><path d="${d}" stroke="${C}" stroke-width="2.6" stroke-linecap="round"/></g>`;
  }
  return s;
}

// ---------- Calor ----------

function sol(x: number, y: number, r: number, giro: number): string {
  let rayos = "";
  for (let i = 0; i < 8; i++) {
    const a = giro + (i * Math.PI) / 4;
    rayos += `M${n(x + Math.cos(a) * (r + 2.5))} ${n(y + Math.sin(a) * (r + 2.5))}L${n(x + Math.cos(a) * (r + 5.5))} ${n(y + Math.sin(a) * (r + 5.5))}`;
  }
  return trazo(rayos, C, 1.4) + `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" ${pieza(1.6)}/>`;
}

const LENTE = "M-9 -5.5H9Q9.6 1.5 5 5H-5Q-9.6 1.5 -9 -5.5Z";

/** Gafas de sol LED: bajan desde arriba, siguen la cara y un brillo recorre el cristal. */
function gafas(ahora: number, p: Pose, c: string): string {
  if (pesoGafas < 0.01) return "";
  const ox = p.miraX;
  const oy = p.miraY + p.salto - (1 - suave(pesoGafas)) * 24;
  const lente = (x: number) => `<path transform="translate(${x} 25)" d="${LENTE}"`;
  const k = (ahora % 3800) / 700;
  const brillo =
    k < 1
      ? `<clipPath id="gafas-lentes">${lente(21)}/>${lente(43)}/></clipPath>` +
        `<path d="M${n(6 + k * 54)} 18l-5 14" stroke="${c}" stroke-width="1.6" clip-path="url(#gafas-lentes)"/>`
      : "";
  return (
    `<g opacity="${n(Math.min(1, pesoGafas * 1.4))}" transform="rotate(${n(p.giro)} 32 32) translate(${n(ox)} ${n(oy)})">` +
    `<path d="M12 21.5L2 22.5M52 21.5L62 22.5M30 21.5Q32 20 34 21.5" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` +
    `${lente(21)} fill="none" stroke="${c}" stroke-opacity=".2" stroke-width="4.5"/>${lente(43)} fill="none" stroke="${c}" stroke-opacity=".2" stroke-width="4.5"/>` +
    `${lente(21)} fill="${BORDE}" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>` +
    `${lente(43)} fill="${BORDE}" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>` +
    brillo +
    `</g>`
  );
}

/** Una gota de sudor que resbala por la frente de vez en cuando. */
function sudor(ahora: number): string {
  const k = (ahora % 4800) / 1600;
  if (k >= 1) return "";
  const y = 8 + suave(k) * 12;
  return `<path d="M7 ${n(y)}c1.8 2.4 2.8 3.6 2.8 4.8a2.8 2.8 0 0 1 -5.6 0c0 -1.2 1 -2.4 2.8 -4.8z" ${conBorde(C)}/>`;
}

// ---------- Frío ----------

/** Bufanda lisa alrededor del cuerpo, con la punta colgando (dos rayas) que se mece. */
function bufanda(ahora: number, temblor: number): string {
  if (pesoFrio < 0.01) return "";
  const banda = "M-1.5 54Q32 59.5 65.5 54L64.5 61.5Q32 66 -0.5 61.5Z";
  const meneo = Math.sin(ahora / 700) * 3 + temblor * 2;
  return (
    `<g opacity="${n(pesoFrio)}" transform="translate(${n((1 - suave(pesoFrio)) * -8)} 0)">` +
    `<g transform="rotate(${n(8 + meneo)} 50 58)">` +
    `<rect x="46.5" y="57" width="7.5" height="15" rx="2" ${conBorde(C)}/>` +
    `<path d="M46.5 61.5h7.5M46.5 66h7.5" stroke="${BORDE}" stroke-width="1.4"/>` +
    `<path d="M47.5 72v2.4M49.5 72v2.8M51.5 72v2.4M53 72v2.6" stroke="${C}" stroke-width="1.1" stroke-linecap="round"/>` +
    `</g>` +
    `<path d="${banda}" ${conBorde(C)}/>` +
    `</g>`
  );
}

/** Vaho al respirar: una nubecita que sale de la boca y se deshace. */
function vaho(ahora: number, p: Pose): string {
  const k = (ahora % 2600) / 1500;
  if (k >= 1) return "";
  const x = 45 + p.miraX * 0.4 + k * 18;
  const y = 44 + p.salto - k * 12;
  const r = 2 + k * 4.5;
  // Solo el contorno LED: es aire
  const bola = (cx: number, cy: number, radio: number) =>
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radio)}" fill="none" stroke="${C}" stroke-width=".9"/>`;
  return (
    `<g opacity="${n(Math.sin(Math.min(1, k * 4) * (Math.PI / 2)) * (1 - k) * pesoFrio)}">` +
    bola(x, y, r) +
    bola(x + r * 0.9, y - r * 0.4, r * 0.8) +
    `</g>`
  );
}

// ---------- Cielo: nubes, niebla, noche ----------

const NUBE = "M-11 5a5 5 0 0 1 1.5 -9.6a7.5 7.5 0 0 1 13.6 -1.6a6.8 6.8 0 0 1 7 11.2z";

/** Nube negra con el contorno LED (y borde oscuro por fuera para fondos claros). */
/** `aparece` (0 a 1): entra y sale creciendo y encogiendo, sin transparencias (que la volverían gris). */
function nube(x: number, y: number, s: number, aparece: number): string {
  if (aparece < 0.02) return "";
  const g = 1.3 / s;
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s * suave(aparece))})">` +
    `<path d="${NUBE}" fill="${BORDE}" stroke="${BORDE}" stroke-width="${n(g + 1.2 / s)}" stroke-linejoin="round"/>` +
    `<path d="${NUBE}" fill="none" stroke="${C}" stroke-width="${n(g)}" stroke-linejoin="round"/>` +
    `</g>`
  );
}

/** Visibilidad de algo que cruza de un lado a otro: aparece y desaparece en los extremos. */
const enExtremos = (k: number) => Math.min(1, k * 6, (1 - k) * 6);

/** Nubecita que pasa por detrás; una de cada dos veces se para un rato encima. */
function nubesPasando(ahora: number): string {
  const ciclo = Math.floor(ahora / 24_000);
  const k = (ahora % 24_000) / 24_000;
  const para = azar(ciclo, 9) < 0.5;
  let x: number;
  if (para && k > 0.35 && k < 0.65) {
    x = 32;
  } else if (para) {
    x = k <= 0.35 ? acercar(-8, 32, suave(k / 0.35)) : acercar(32, 72, suave((k - 0.65) / 0.35));
  } else {
    x = acercar(-8, 72, k);
  }
  return nube(x, -11, 1.1, enExtremos(k));
}

/** Niebla: líneas onduladas (el símbolo de la niebla, ≋) que flotan y se mecen de lado a lado:
 * una sobre la cabeza y otra delante del cuerpo, por debajo de la boca. */
const BANDAS_NIEBLA: { y: number; desde: number; hasta: number }[] = [
  { y: -9, desde: 6, hasta: 50 },
  { y: 59, desde: -14, hasta: 70 },
];

function niebla(ahora: number): string {
  let s = "";
  BANDAS_NIEBLA.forEach(({ y, desde, hasta }, i) => {
    const dx = Math.sin(ahora / (2400 + i * 700) + i * 2) * 6;
    const dy = Math.sin(ahora / (1700 + i * 500) + i) * 0.8;
    let d = `M${n(desde + dx)} ${n(y + dy)}q2 -1.8 4 0`;
    for (let x = desde + 4; x < hasta; x += 4) d += "t4 0";
    s += trazo(d, C, 1.6);
  });
  return s;
}

const ESTRELLAS: [number, number][] = [
  [8, -16],
  [74, -14],
  [82, 22],
];

function noche(ahora: number): string {
  const luna = `<path d="M-12 -18a7 7 0 1 0 7 10a5.4 5.4 0 1 1 -7 -10z" ${conBorde(C)}/>`;
  let estrellas = "";
  ESTRELLAS.forEach(([x, y], i) => {
    const brillo = 0.5 + 0.5 * Math.sin(ahora / (700 + i * 230) + i * 1.7);
    const s = 0.22 + brillo * 0.25;
    estrellas += `<path d="M${x} ${n(y - 6 * s)}Q${n(x + 1.2 * s)} ${n(y - 1.2 * s)} ${n(x + 6 * s)} ${y}Q${n(x + 1.2 * s)} ${n(y + 1.2 * s)} ${x} ${n(y + 6 * s)}Q${n(x - 1.2 * s)} ${n(y + 1.2 * s)} ${n(x - 6 * s)} ${y}Q${n(x - 1.2 * s)} ${n(y - 1.2 * s)} ${x} ${n(y - 6 * s)}Z" ${conBorde(C, 0.7)}/>`;
  });
  return luna + estrellas;
}

// ---------- Todo junto ----------

const capaCon = (p: number, dibujo: string) => (p > 0.01 && dibujo ? `<g opacity="${n(Math.min(1, p))}">${dibujo}</g>` : "");

/** Mueve las escenas y las dibuja. Se llama en cada fotograma. */
export function dibujarTiempo(ahora: number, ctx: Contexto): Tiempo {
  const dt = Math.min(100, Math.max(0, ahora - ultimo));
  ultimo = ahora;
  C = ctx.color;
  const cielo = cieloAhora(ahora);
  const activo = !ctx.dormido && !ctx.oculto;
  const cara = activo && ctx.caraLibre;
  // Escena completa al cambiar el tiempo o al despertarse, y luego un rato cada tanto
  const clave = activo ? `${cielo.escena}|${cielo.frio}` : "";
  if (clave !== escenaVista) {
    escenaVista = clave;
    completaDesde = ahora;
  }
  const t = ahora - completaDesde;
  const completa = activo && (especial !== null || t < ESCENA_MS || t % REPITE_MS < RATO_MS);
  const k = 1 - Math.exp(-dt / (FUNDIDO_MS / 3));
  for (const e of ESCENAS) peso[e] = acercar(peso[e], completa && cielo.escena === e ? 1 : 0, k);
  pesoCompleta = acercar(pesoCompleta, completa ? 1 : 0, k);
  pesoFrio = acercar(pesoFrio, activo && cielo.frio ? 1 : 0, k);
  pesoGafas = acercar(pesoGafas, cara && cielo.escena === "calor" && cielo.sol ? 1 : 0, k);
  pesoEntorna = acercar(pesoEntorna, cara && completa && cielo.escena === "niebla" ? 1 : 0, k);
  fuerza = acercar(fuerza, cielo.fuerza, k);
  const mojado = Math.min(1, peso.lluvia + peso.tormenta);

  // La nieve se posa en la cabeza y luego se derrite despacio
  if (activo && cielo.escena === "nieve") capa = Math.min(1, capa + (dt / 80_000) * (0.5 + fuerza * 0.5));
  else capa = Math.max(0, capa - dt / 150_000);
  if (restos) {
    const r = 1 - Math.exp(-dt / 400);
    capa = acercar(capa, Math.min(capa, restos.capa), r);
    if (capa - restos.capa < 0.01) restos = null;
  }

  // De vez en cuando se sacude la nieve de la cabeza
  if (cara && completa && capa > 0.45 && !ctx.tranquilo) {
    if (proximaSacudidaNieve === 0) proximaSacudidaNieve = ahora + 20_000;
    else if (ahora >= proximaSacudidaNieve) {
      sacudidaNieve = ahora;
      capa *= 0.25;
      temblar(ahora, 600, 2);
      proximaSacudidaNieve = ahora + 25_000 + Math.random() * 15_000;
    }
  }
  // Tirita en ráfagas cortas con frío o nieve
  if (completa && (cielo.frio || cielo.escena === "nieve")) {
    if (ahora >= proximoTiriton) {
      if (proximoTiriton !== 0) temblar(ahora, 800, ctx.tranquilo ? 0.35 : 0.8);
      proximoTiriton = ahora + 4500 + Math.random() * 4000;
    }
  } else {
    proximoTiriton = 0;
  }

  moverParaguas(ahora, dt, cielo, activo, completa, ctx.icono);
  moverTormenta(ahora, ctx, activo);
  const g = geometriaParaguas(ahora, ctx.tranquilo);
  const temblor = temblorAhora(ahora);

  // Fondo
  let fondo = "";
  if (peso.calor > 0.01 && cielo.sol) fondo += capaCon(peso.calor, sol(76, -12, 6, ahora / 4000));
  if (peso.amanecer > 0.01) {
    const q = especial ? suave(Math.min(1, (ahora - especial.desde) / 2200)) : 1;
    fondo += capaCon(peso.amanecer, sol(32, acercar(34, -8, q), 8, ahora / 3000));
  }
  if (peso.nublado > 0.01) fondo += capaCon(peso.nublado, nubesPasando(ahora));
  let nubeAmenaza = 32;
  if (peso.amenaza > 0.01 || mojado > 0.01) {
    // Nube que cruza despacio (con lluvia, se queda más o menos encima)
    const k1 = (ahora % 16_000) / 16_000;
    nubeAmenaza = acercar(-6, 70, k1);
    fondo += capaCon(peso.amenaza, nube(nubeAmenaza, -12, 1.25, enExtremos(k1)));
    fondo += capaCon(mojado, nube(6 + Math.sin(ahora / 4000) * 4, -14, 1, 1));
  }
  if (peso.tormenta > 0.01) fondo += dibujarRayo(ahora);
  if (peso.noche > 0.01) fondo += capaCon(peso.noche, noche(ahora));

  // Delante
  let frente = "";
  if (mojado > 0.01) {
    frente += capaCon(mojado, lluvia(ahora, g, ctx.tranquilo));
  }
  if (peso.nieve > 0.01) frente += capaCon(peso.nieve, copos(ahora, ctx.tranquilo));
  if (peso.niebla > 0.01) frente += capaCon(peso.niebla, niebla(ahora));

  // Sobre el cuerpo
  let cuerpo = "";
  cuerpo += bufanda(ahora, temblor);
  if (pesoFrio > 0.01 && pesoCompleta > 0.01) cuerpo += capaCon(pesoCompleta, vaho(ahora, ctx.pose));
  cuerpo += capaNieve(ahora);
  if (peso.calor > 0.01) cuerpo += capaCon(peso.calor, sudor(ahora));
  cuerpo += gafas(ahora, ctx.pose, ctx.color);
  cuerpo += dibujarParaguas(ahora, g, ctx.color, ctx.tranquilo);
  const f = destello(ahora);
  // El relámpago enciende el borde del cristal en LED (sin teñir la cara)
  if (f > 0.3) cuerpo += `<rect x=".75" y=".75" width="62.5" height="62.5" rx="17.5" fill="none" stroke="${C}" stroke-width="1.5"/>`;

  // Mira al cielo de vez en cuando si va a llover o nieva
  let mira: Tiempo["mira"] = null;
  if (cara && completa && (cielo.escena === "amenaza" || cielo.escena === "nieve") && ahora % 7000 < 1600) {
    mira = { x: cielo.escena === "amenaza" ? limitar((nubeAmenaza - 32) / 8, -3.5, 3.5) : 0, y: -4 };
  }

  return {
    fondo,
    cuerpo,
    frente,
    temblor: temblor * (ctx.tranquilo ? 0.5 : 1),
    entorna: pesoEntorna * 0.45,
    mira,
  };
}
