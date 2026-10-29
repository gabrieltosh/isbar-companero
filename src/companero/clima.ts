// El tiempo para el compañero: lo mira cada media hora en la ciudad de Configuración y reacciona.
// Por la mañana, la primera vez que usas el PC, saluda con el tiempo del día. Si va a llover en
// las próximas horas lo avisa una vez y saca un paraguas sobre la cabeza (con gotas mientras
// llueve). Al elegir otra ciudad, cuenta el tiempo que hace allí.
import { listen } from "@tauri-apps/api/event";
import { CLIMA_POR_DEFECTO, EVENTO_AJUSTES, type ConfigClima } from "../ajustes";
import { LLUVIA_PROBABLE, describirCielo, grados, pedirClima, type Clima } from "../estado/clima";
import { EVENTO_SISTEMA, type EstadoSistema } from "../estado/sistema";
import { guardar, leer } from "../store";
import { hoy } from "../util";
import { avisar } from "./globos";

/** Cada cuánto se mira el tiempo y, si falla, cuándo se reintenta. */
const CADA_MS = 30 * 60_000;
const REINTENTO_MS = 5 * 60_000;
/** El saludo de buenos días sale entre estas horas, si estás usando el PC. */
const MANANA_DESDE = 5;
const MANANA_HASTA = 12;
const ACTIVO_MS = 60_000;
/** Día (AAAA-MM-DD) del último saludo de buenos días, en el store. */
const CLAVE_SALUDO = "climaSaludo";
/** Calor y frío que merecen un consejo en el saludo (°C). */
const CALOR = 30;
const FRIO = 3;
/** Lo que tarda el paraguas en abrirse o cerrarse. */
const ABRIR_MS = 350;

let config: ConfigClima = CLIMA_POR_DEFECTO;
let actual: Clima | null = null;
let fallo = false;
let tPedir = 0;
let ultimoSaludo = "";
let inactivo = 0;
/** Ya se avisó de esta lluvia (se olvida cuando deja de haber lluvia a la vista). */
let avisadaLluvia = false;
/** El paraguas: cuándo empezó a abrirse o a cerrarse. */
let paraguas: { abierto: boolean; desde: number } = { abierto: false, desde: -Infinity };

/** "Santiago de Chile" de "Santiago de Chile, Región Metropolitana, Chile". */
const ciudadCorta = (c: string) => c.split(",")[0];

/** El tiempo de ahora para el panel. */
export function resumenClima(): { temperatura: number; texto: string; ciudad: string } | null {
  if (!actual) return null;
  return { temperatura: actual.temperatura, texto: describirCielo(actual.codigo).texto, ciudad: ciudadCorta(actual.ciudad) };
}

function hayCiudad(c: ConfigClima): boolean {
  return c.latitud !== null && c.longitud !== null;
}

// ---------- Reacciones ----------

/** Consejo del día para el saludo: paraguas, calor o frío. */
function consejo(c: Clima): string {
  if (c.lluviaPronto) return ` Va a llover hacia las ${c.lluviaPronto.hora}:00: ¡llévate paraguas!`;
  if (c.lloviendo) return " Está lloviendo: ¡paraguas!";
  if (c.hoy.probLluvia >= LLUVIA_PROBABLE) return ` Puede llover (${c.hoy.probLluvia} %): mejor lleva paraguas.`;
  if (c.hoy.max >= CALOR) return " Hará calor: no te olvides de beber agua.";
  if (c.hoy.min <= FRIO) return " Hará frío: abrígate bien.";
  return "";
}

/** Buenos días con el tiempo de hoy: una vez al día, por la mañana y si estás usando el PC. */
function saludarSiToca(): void {
  const c = actual;
  if (!c) return;
  const h = new Date().getHours();
  if (h < MANANA_DESDE || h >= MANANA_HASTA || inactivo > ACTIVO_MS || ultimoSaludo === hoy()) return;
  ultimoSaludo = hoy();
  void guardar(CLAVE_SALUDO, ultimoSaludo);
  const cielo = describirCielo(c.hoy.codigo).texto.toLowerCase();
  avisar({
    origen: ciudadCorta(c.ciudad),
    titulo: "¡Buenos días!",
    texto: `Hoy ${cielo}, de ${grados(c.hoy.min)} a ${grados(c.hoy.max)}. Ahora, ${grados(c.temperatura)}.${consejo(c)}`,
    duracion: 10_000,
    gesto: "saludo",
  });
  // Si el saludo ya habla de la lluvia, no se avisa otra vez
  if (c.lluviaPronto || c.lloviendo) avisadaLluvia = true;
}

function abrirParaguas(abierto: boolean): void {
  if (paraguas.abierto !== abierto) paraguas = { abierto, desde: performance.now() };
}

function revisarLluvia(c: Clima, antes: Clima | null): void {
  abrirParaguas(c.lloviendo || c.lluviaPronto !== null);
  if (!c.lloviendo && !c.lluviaPronto) {
    avisadaLluvia = false;
    return;
  }
  if (avisadaLluvia) return;
  avisadaLluvia = true;
  if (c.lloviendo) {
    // Empieza a llover sin haberlo visto venir (o ya llovía al elegir la ciudad)
    avisar({
      origen: ciudadCorta(c.ciudad),
      titulo: antes && !antes.lloviendo ? "Ha empezado a llover" : "Está lloviendo",
      texto: "Si sales, coge paraguas.",
      duracion: 7000,
      gesto: "sorpresa",
    });
  } else if (c.lluviaPronto) {
    const { hora, prob } = c.lluviaPronto;
    avisar({
      origen: ciudadCorta(c.ciudad),
      titulo: "Va a llover",
      texto: prob > 0 ? `Hacia las ${hora}:00 hay un ${prob} % de lluvia. ¿Llevas paraguas?` : `Hacia las ${hora}:00. ¿Llevas paraguas?`,
      duracion: 9000,
      gesto: "preocupado",
    });
  }
}

// ---------- Pedir el tiempo ----------

function programar(ms: number): void {
  window.clearTimeout(tPedir);
  tPedir = window.setTimeout(() => void actualizar(), ms);
}

/** Pide el tiempo y reacciona. `nuevaCiudad`: se acaba de elegir, así que lo cuenta. */
async function actualizar(nuevaCiudad = false): Promise<void> {
  window.clearTimeout(tPedir);
  if (!hayCiudad(config)) return;
  const pedida = config;
  try {
    const c = await pedirClima(pedida);
    // Si mientras tanto se cambió de ciudad, esta respuesta ya no vale
    if (pedida !== config) return;
    const antes = actual;
    actual = c;
    fallo = false;
    programar(CADA_MS);
    if (nuevaCiudad) {
      avisar({
        origen: "Tiempo",
        titulo: `Ahora miro el tiempo de ${ciudadCorta(c.ciudad)}`,
        texto: `${describirCielo(c.codigo).texto}, ${grados(c.temperatura)}.`,
        duracion: 6000,
        gesto: "feliz",
      });
    }
    saludarSiToca();
    revisarLluvia(c, antes);
  } catch (e) {
    console.error("clima:", e);
    fallo = true;
    programar(REINTENTO_MS);
  }
}

async function cargarConfig(): Promise<ConfigClima> {
  return { ...CLIMA_POR_DEFECTO, ...(await leer<Partial<ConfigClima>>("climaConfig", {})) };
}

// ---------- Paraguas sobre la cabeza ----------

const BORDE = "#0B0B0C";
const AZUL = "#4D8DFF";
const n = (v: number) => v.toFixed(2);
const suave = (k: number) => k * k * (3 - 2 * k);
// Centro del paraguas: el mismo sitio que los iconos de batería y volumen
const PX = 33;
const PY = -9;
/** Tela con el borde de ondas (de izquierda a derecha por arriba y vuelta por las ondas). */
const TELA = `M${PX - 7} ${PY}A7 6 0 0 1 ${PX + 7} ${PY}q-.875 -1.4 -1.75 0q-.875 -1.4 -1.75 0q-.875 -1.4 -1.75 0q-.875 -1.4 -1.75 0q-.875 -1.4 -1.75 0q-.875 -1.4 -1.75 0q-.875 -1.4 -1.75 0q-.875 -1.4 -1.75 0z`;
const MANGO = `M${PX} ${PY - 1}V${PY + 5.2}a1.2 1.2 0 0 1 -2.4 0`;

/** Gotas cayendo alrededor del paraguas. */
function gotas(ahora: number): string {
  let s = "";
  const xs = [PX - 10, PX - 5, PX + 4, PX + 10];
  xs.forEach((x, i) => {
    const k = ((ahora / 700 + i * 0.37) % 1 + 1) % 1;
    // A los lados caen más abajo; encima, se paran en la tela
    const fin = Math.abs(x - PX) > 7 ? PY + 4 : PY - 5;
    const y = PY - 14 + k * (fin - (PY - 14));
    s += `<path d="M${n(x)} ${n(y)}v2" stroke="#8EC1FF" stroke-width="1" stroke-linecap="round" opacity="${n(1 - k * 0.6)}"/>`;
  });
  return s;
}

/** El paraguas (o nada). Se abre y se cierra despacio, y se mece un poco. */
export function iconoClima(ahora: number): string {
  const k = Math.min(1, (ahora - paraguas.desde) / ABRIR_MS);
  const apertura = paraguas.abierto ? suave(k) : 1 - suave(k);
  if (apertura <= 0.01) return "";
  const balanceo = Math.sin(ahora / 800) * 5;
  const tela =
    `<g transform="translate(${PX} ${PY}) scale(${n(0.25 + 0.75 * apertura)} ${n(apertura)}) translate(${-PX} ${-PY})">` +
    `<path d="${TELA}" fill="${AZUL}" stroke="${BORDE}" stroke-width="0.9" stroke-linejoin="round" paint-order="stroke"/>` +
    `</g>`;
  const mango =
    `<path d="${MANGO}" fill="none" stroke="${BORDE}" stroke-width="2.3" stroke-linecap="round"/>` +
    `<path d="${MANGO}" fill="none" stroke="#C9C9D0" stroke-width="1.2" stroke-linecap="round"/>`;
  const lluvia = actual?.lloviendo && apertura > 0.9 ? gotas(ahora) : "";
  return `<g transform="rotate(${n(balanceo)} ${PX} ${PY + 5})" opacity="${n(Math.min(1, apertura * 1.5))}">${mango}${tela}</g>${lluvia}`;
}

// ---------- Arranque ----------

export async function iniciarClima(): Promise<void> {
  config = await cargarConfig();
  ultimoSaludo = await leer(CLAVE_SALUDO, "");
  void actualizar();

  listen(EVENTO_AJUSTES, async () => {
    const nueva = await cargarConfig();
    if (nueva.latitud === config.latitud && nueva.longitud === config.longitud) return;
    config = nueva;
    actual = null;
    avisadaLluvia = false;
    abrirParaguas(false);
    if (hayCiudad(nueva)) void actualizar(true);
    else window.clearTimeout(tPedir);
  }).catch(console.error);

  // Al volver al PC por la mañana, saluda (si ya tiene el tiempo)
  listen<number>("companero-inactivo", ({ payload }) => {
    const volvio = payload < inactivo;
    inactivo = payload;
    if (volvio) saludarSiToca();
  }).catch(console.error);

  // Si falló por falta de internet, lo vuelve a pedir en cuanto vuelve
  let habiaInternet = true;
  listen<EstadoSistema>(EVENTO_SISTEMA, ({ payload }) => {
    const internet = payload.conexion?.internet ?? true;
    if (fallo && internet && !habiaInternet) void actualizar();
    habiaInternet = internet;
  }).catch(console.error);
}
