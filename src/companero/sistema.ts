// Reacciones del compañero al estado del PC (sistema.rs): se queda sin internet, poca batería,
// lo enchufas o se carga del todo, el PC va a tope, cambias el volumen o por dónde suena.
// Sin internet le sale una antena: busca señal (se inclina y las ondas se apagan en rojo), se
// queda con la antena caída y lo reintenta de vez en cuando; al volver, la antena se ilumina y
// se recoge. Con poca batería lleva un icono sobre la cabeza; al cambiar el volumen, un momento.
// Para no ser pesado: los cortes breves se ignoran y cada aviso sale una vez por episodio.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTO_SISTEMA, duracionLegible, type EstadoSistema } from "../estado/sistema";
import { iconoClima } from "./clima";
import { avisar, cerrar } from "./globos";
import { gesto } from "./vida";

/** Sin internet, lo que se espera antes de reaccionar (los cortes breves no cuentan). */
const ESPERA_SIN_INTERNET = 10_000;
/** Lo que busca señal la primera vez, cada cuánto lo reintenta y lo que dura cada reintento. */
const BUSCA_MS = 4200;
const REINTENTO_CADA = 60_000;
const REINTENTO_MS = 2600;
/** Lo que se ve la antena encendida al volver internet, antes de recogerse. */
const VUELVE_MS = 2600;
const BATERIA_BAJA = 20;
const BATERIA_MUY_BAJA = 10;
/** Al cargarse del todo, solo se celebra si venía de por debajo de esto. */
const CARGA_DESDE = 80;
/** El procesador o la memoria a tope durante un rato (ms); por debajo de lo normal, se olvida. */
const CPU_ALTA = 90;
const CPU_NORMAL = 60;
const ESPERA_CPU = 20_000;
const MEMORIA_ALTA = 92;
const MEMORIA_NORMAL = 80;
const ESPERA_MEMORIA = 30_000;
/** Como mucho un aviso de uso del PC cada tanto. */
const ENTRE_AVISOS_USO = 15 * 60_000;
/** Lo que se ve el icono del volumen tras cambiarlo. */
const ICONO_VOLUMEN_MS = 1800;
const GESTO_MS = 1400;

let anterior: EstadoSistema | null = null;

let tSinInternet = 0;
let tReintento = 0;
let sinInternet = false;
let globoSinInternet: number | null = null;
/** Qué hace la antena y desde cuándo: buscando señal, caída (sin internet) o encendida (vuelve). */
type FaseAntena = "buscando" | "caida" | "vuelve";
let antena: { fase: FaseAntena; desde: number; hasta: number } | null = null;

function ponerAntena(fase: FaseAntena, ms = Infinity): void {
  const ahora = performance.now();
  antena = { fase, desde: ahora, hasta: ahora + ms };
}

let avisadaBaja = false;
let avisadaMuyBaja = false;
/** Porcentaje al que se enchufó (para celebrar si se carga del todo) */
let cargaDesde: number | null = null;

let cpuAltaDesde = 0;
let memoriaAltaDesde = 0;
let ultimoAvisoUso = -Infinity;

let volumenHasta = 0;

// ---------- Internet ----------

/** Busca señal un rato con la antena y después la deja caída. */
function buscarSenal(ms: number, alAcabar?: () => void): void {
  ponerAntena("buscando", ms);
  gesto("buscasenal", ms);
  window.clearTimeout(tReintento);
  tReintento = window.setTimeout(() => {
    if (!sinInternet) return;
    ponerAntena("caida");
    alAcabar?.();
    // De vez en cuando lo vuelve a intentar (sin globo)
    tReintento = window.setTimeout(() => buscarSenal(REINTENTO_MS), REINTENTO_CADA);
  }, ms);
}

function revisarInternet(e: EstadoSistema): void {
  const c = e.conexion;
  if (!c) return;
  const antes = anterior?.conexion;
  if (!c.internet && (!antes || antes.internet)) {
    // Se ha ido: se espera un poco por si vuelve enseguida
    window.clearTimeout(tSinInternet);
    tSinInternet = window.setTimeout(() => {
      sinInternet = true;
      const red = c.nombre ? `«${c.nombre}»` : "la red";
      // Primero busca señal; si no la encuentra, se entristece y lo cuenta
      buscarSenal(BUSCA_MS, () => {
        globoSinInternet = avisar({
          origen: "Conexión",
          titulo: "No encuentro internet",
          texto: c.conectado ? `Sigo conectado a ${red}, pero no llega internet.` : "No hay ninguna red conectada.",
          duracion: 8000,
          gesto: "triste",
        });
      });
    }, ESPERA_SIN_INTERNET);
  } else if (c.internet && antes && !antes.internet) {
    window.clearTimeout(tSinInternet);
    window.clearTimeout(tReintento);
    if (!sinInternet) return;
    sinInternet = false;
    if (globoSinInternet !== null) cerrar(globoSinInternet);
    globoSinInternet = null;
    // La antena se endereza y se ilumina, celebra, y luego se recoge
    ponerAntena("vuelve", VUELVE_MS);
    avisar({ origen: "Conexión", titulo: "¡Vuelve internet!", duracion: 3500, gesto: "celebra" });
  }
}

// ---------- Batería ----------

function revisarBateria(e: EstadoSistema): void {
  const b = e.bateria;
  if (!b) return;
  const antes = anterior?.bateria;
  if (b.enchufado) {
    if (antes && !antes.enchufado) {
      // Lo enchufan: contento; si había avisado de poca batería, da las gracias
      if (avisadaBaja) avisar({ origen: "Batería", titulo: "¡Gracias!", texto: "Ya me estoy cargando.", duracion: 3500, gesto: "feliz" });
      else gesto("feliz", GESTO_MS);
    }
    avisadaBaja = false;
    avisadaMuyBaja = false;
    cargaDesde ??= b.porcentaje;
    if (b.porcentaje >= 100 && cargaDesde < CARGA_DESDE) {
      cargaDesde = 100;
      avisar({ origen: "Batería", titulo: "Batería cargada del todo", texto: "Ya me puedes desenchufar.", duracion: 6000, gesto: "celebra" });
    }
    return;
  }
  cargaDesde = null;
  const queda = b.minutosRestantes !== null ? ` (unos ${duracionLegible(b.minutosRestantes)})` : "";
  if (b.porcentaje <= BATERIA_MUY_BAJA && !avisadaMuyBaja) {
    avisadaMuyBaja = true;
    avisadaBaja = true;
    avisar({
      origen: "Batería",
      titulo: `¡Solo queda un ${b.porcentaje} %!`,
      texto: `Enchúfame pronto o se apagará${queda}.`,
      duracion: 0,
      urgente: true,
      gesto: "sorpresa",
      acciones: [{ id: "vale", texto: "Vale", principal: true }],
    });
  } else if (b.porcentaje <= BATERIA_BAJA && !avisadaBaja) {
    avisadaBaja = true;
    avisar({
      origen: "Batería",
      titulo: "Me queda poca batería",
      texto: `Queda un ${b.porcentaje} %${queda}. ¿Me enchufas?`,
      duracion: 9000,
      gesto: "preocupado",
    });
  }
}

// ---------- Uso del PC ----------

function revisarUso(e: EstadoSistema): void {
  const u = e.uso;
  if (!u) return;
  const ahora = performance.now();
  if (u.cpu >= CPU_ALTA) cpuAltaDesde ||= ahora;
  else if (u.cpu < CPU_NORMAL) cpuAltaDesde = 0;
  if (u.memoria >= MEMORIA_ALTA) memoriaAltaDesde ||= ahora;
  else if (u.memoria < MEMORIA_NORMAL) memoriaAltaDesde = 0;
  if (ahora - ultimoAvisoUso < ENTRE_AVISOS_USO) return;
  // Suda: el procesador lleva un rato a tope
  if (cpuAltaDesde && ahora - cpuAltaDesde >= ESPERA_CPU) {
    ultimoAvisoUso = ahora;
    avisar({ origen: "Sistema", titulo: "Uf, el PC va a tope", texto: `El procesador lleva un rato al ${u.cpu} %.`, duracion: 7000, gesto: "preocupado" });
  } else if (memoriaAltaDesde && ahora - memoriaAltaDesde >= ESPERA_MEMORIA) {
    ultimoAvisoUso = ahora;
    const gb = (n: number) => n.toLocaleString("es", { maximumFractionDigits: 1 });
    avisar({
      origen: "Sistema",
      titulo: "Casi no queda memoria",
      texto: `Hay ${gb(u.memoriaUsada)} de ${gb(u.memoriaTotal)} GB en uso. Cerrar alguna app ayudaría.`,
      duracion: 8000,
      gesto: "preocupado",
    });
  }
}

// ---------- Volumen ----------

function revisarVolumen(e: EstadoSistema): void {
  const v = e.volumen;
  const antes = anterior?.volumen;
  if (!v || !antes) return;
  if (v.dispositivo !== antes.dispositivo && v.dispositivo && antes.dispositivo) {
    // Cambia por dónde suena (cascos, altavoces…)
    avisar({ origen: "Sonido", titulo: "Ahora sueno por aquí", texto: v.dispositivo, duracion: 4000, gesto: "feliz" });
    return;
  }
  if (v.nivel === antes.nivel && v.silencio === antes.silencio) return;
  volumenHasta = performance.now() + ICONO_VOLUMEN_MS;
  // Muy alto, se sorprende (una vez al pasar del umbral)
  if (!v.silencio && v.nivel >= 90 && antes.nivel < 90) gesto("sorpresa", 900);
}

// ---------- Icono sobre la cabeza ----------

const BORDE = "#0B0B0C";
/** Trazo con un borde oscuro alrededor (para verse sobre fondos claros). */
const trazo = (d: string, color: string, ancho = 1.6) =>
  `<path d="${d}" fill="none" stroke="${BORDE}" stroke-width="${ancho + 1}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${ancho}" stroke-linecap="round" stroke-linejoin="round"/>`;
const relleno = (d: string, color: string) =>
  `<path d="${d}" fill="${color}" stroke="${BORDE}" stroke-width="0.9" stroke-linejoin="round" paint-order="stroke"/>`;

const ALTAVOZ = "M25.5 -11.2h2.4l3.1 -2.6v9.2l-3.1 -2.6h-2.4z";

function iconoVolumen(nivel: number, silencio: boolean): string {
  if (silencio || nivel === 0) return relleno(ALTAVOZ, "#F5F7FF") + trazo("M33.5 -11.5l4.4 4.4M37.9 -11.5l-4.4 4.4", "#FF453A", 1.4);
  const ancho = 8 * (nivel / 100);
  return (
    relleno(ALTAVOZ, "#F5F7FF") +
    `<rect x="33" y="-10.2" width="8" height="2.4" rx="1.2" fill="#3A3A40" stroke="${BORDE}" stroke-width="0.9" paint-order="stroke"/>` +
    (ancho > 0.3 ? `<rect x="33" y="-10.2" width="${ancho.toFixed(2)}" height="2.4" rx="1.2" fill="#F5F7FF"/>` : "")
  );
}

// La antena nace arriba a la derecha de la cabeza (dentro del cuerpo: se mueve con él)
const ANTENA_X = 44;
const ANTENA_Y = 1.5;
const LARGO_ANTENA = 11;
const n = (v: number) => v.toFixed(2);
const suave = (k: number) => k * k * (3 - 2 * k);

/** Bolita de la punta. */
const bola = (x: number, y: number, color: string, r = 2.1) =>
  `<circle cx="${n(x)}" cy="${n(y)}" r="${r}" fill="${color}" stroke="${BORDE}" stroke-width="0.9" paint-order="stroke"/>`;

/** Onda de wifi alrededor de (x, y), abierta hacia arriba. */
function onda(x: number, y: number, r: number, color: string, opacidad: number): string {
  const a = (50 * Math.PI) / 180;
  const d = `M${n(x - r * Math.sin(a))} ${n(y - r * Math.cos(a))}A${n(r)} ${n(r)} 0 0 1 ${n(x + r * Math.sin(a))} ${n(y - r * Math.cos(a))}`;
  return `<g opacity="${n(opacidad)}">${trazo(d, color, 1.3)}</g>`;
}

/** Antena recta (de largo `largo`) girada `angulo` grados, con lo que lleve en la punta. */
function antenaRecta(largo: number, angulo: number, punta: (x: number, y: number) => string): string {
  const yPunta = ANTENA_Y - largo;
  return (
    `<g transform="rotate(${n(angulo)} ${ANTENA_X} ${ANTENA_Y})">` +
    trazo(`M${ANTENA_X} ${ANTENA_Y}V${n(yPunta)}`, "#C9C9D0", 1.4) +
    punta(ANTENA_X, yPunta - 1.6) +
    `</g>`
  );
}

function dibujarAntena(ahora: number): string {
  if (!antena) return "";
  const pasado = ahora - antena.desde;
  if (ahora >= antena.hasta) {
    if (antena.fase === "vuelve") antena = null;
    return "";
  }
  switch (antena.fase) {
    case "buscando": {
      // Sale, se mueve buscando, y las ondas aparecen una a una hasta apagarse en rojo
      const largo = LARGO_ANTENA * suave(Math.min(1, pasado / 300));
      const angulo = Math.sin(ahora / 140) * 14;
      const ciclo = (pasado % 1200) / 1200;
      const fallo = ciclo >= 0.75;
      const cuantas = fallo ? 3 : Math.floor(ciclo / 0.25) + 1;
      const color = fallo ? "#FF453A" : "#F5F7FF";
      const opacidad = fallo ? 1 - (ciclo - 0.75) / 0.25 : 1;
      return antenaRecta(largo, angulo, (x, y) => {
        let s = bola(x, y, cuantas === 3 && !fallo ? "#F5F7FF" : "#9A9AA3");
        for (let i = 0; i < cuantas; i++) s += onda(x, y, 4 + i * 2.6, color, opacidad);
        return s;
      });
    }
    case "caida": {
      // Doblada hacia un lado y apagada, meciéndose despacio
      const balanceo = Math.sin(ahora / 900) * 3;
      const d = `M${ANTENA_X} ${ANTENA_Y}C${ANTENA_X} ${ANTENA_Y - 6} ${ANTENA_X + 3} ${ANTENA_Y - 9} ${ANTENA_X + 7} ${ANTENA_Y - 7.5}`;
      return (
        `<g transform="rotate(${n(balanceo)} ${ANTENA_X} ${ANTENA_Y})">` +
        trazo(d, "#8A8A92", 1.4) +
        bola(ANTENA_X + 8, ANTENA_Y - 6.8, "#6E6E76", 1.9) +
        `</g>`
      );
    }
    case "vuelve": {
      // Se endereza de golpe, la punta brilla y salen ondas hacia fuera; al final se recoge
      const total = antena.hasta - antena.desde;
      const recoge = Math.max(0, (pasado - (total - 400)) / 400);
      const largo = LARGO_ANTENA * (1 - suave(recoge));
      const angulo = Math.sin(pasado / 60) * 10 * Math.max(0, 1 - pasado / 500);
      return antenaRecta(largo, angulo, (x, y) => {
        let s = "";
        for (let i = 0; i < 3; i++) {
          const k = (pasado / 700 + i / 3) % 1;
          s += onda(x, y, 3 + k * 9, "#30D158", (1 - k) * (1 - recoge));
        }
        return s + bola(x, y, "#F5F7FF", 2.1 * (1 - recoge * 0.6));
      });
    }
  }
}

function iconoBateriaBaja(porcentaje: number): string {
  const lleno = Math.max(1, 8.4 * (porcentaje / 100));
  return (
    `<rect x="26" y="-12.6" width="11" height="6.2" rx="1.4" fill="none" stroke="${BORDE}" stroke-width="2.4"/>` +
    `<rect x="26" y="-12.6" width="11" height="6.2" rx="1.4" fill="none" stroke="#F5F7FF" stroke-width="1.3"/>` +
    relleno("M37.6 -10.9h1.3a.4 .4 0 0 1 .4 .4v1.9a.4 .4 0 0 1 -.4 .4h-1.3z", "#F5F7FF") +
    `<rect x="27.3" y="-11.3" width="${lleno.toFixed(2)}" height="3.6" rx=".6" fill="#FF453A"/>`
  );
}

/** Lo que lleva sobre la cabeza ahora: la antena (sin internet) y un icono (volumen recién
 * cambiado; si no, poca batería; si no, el paraguas cuando llueve). */
export function iconoSistema(ahora: number): string {
  const v = anterior?.volumen;
  const b = anterior?.bateria;
  let icono = "";
  if (v && ahora < volumenHasta) icono = iconoVolumen(v.nivel, v.silencio);
  else if (b && !b.enchufado && b.porcentaje <= BATERIA_BAJA) icono = iconoBateriaBaja(b.porcentaje);
  else icono = iconoClima(ahora);
  return dibujarAntena(ahora) + icono;
}

function revisar(e: EstadoSistema): void {
  revisarInternet(e);
  revisarBateria(e);
  revisarUso(e);
  revisarVolumen(e);
  anterior = e;
}

export function iniciarSistema(): void {
  listen<EstadoSistema>(EVENTO_SISTEMA, ({ payload }) => revisar(payload)).catch(console.error);
  // Lo que ya pasaba al arrancar (p. ej. sin internet o con poca batería) también cuenta
  invoke<EstadoSistema | null>("estado_sistema")
    .then((e) => {
      if (e && !anterior) revisar(e);
    })
    .catch(console.error);
}
