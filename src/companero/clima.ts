// El tiempo para el compañero: lo mira cada media hora en la ciudad de Configuración y reacciona.
// Por la mañana, la primera vez que usas el PC, saluda con el tiempo del día. Si va a llover en
// las próximas horas lo avisa una vez. Al elegir otra ciudad, cuenta el tiempo que hace allí.
// Lo que se ve alrededor del compañero según el tiempo (paraguas, nieve, gafas…) está en tiempo.ts.
import { listen } from "@tauri-apps/api/event";
import { CLIMA_POR_DEFECTO, EVENTO_AJUSTES, EVENTO_PROBAR_ESCENA, PARAR_PRUEBA, type ConfigClima, type EscenaPrueba } from "../ajustes";
import { LLUVIA_PROBABLE, describirCielo, grados, pedirClima, type Clima } from "../estado/clima";
import { EVENTO_SISTEMA, type EstadoSistema } from "../estado/sistema";
import { guardar, leer } from "../store";
import { hoy } from "../util";
import { avisar } from "./globos";
import { mostrarCieloDeHoy, pararPrueba, ponerClima, probarEscena } from "./tiempo";

/** Cada cuánto se mira el tiempo (Open-Meteo renueva el de ahora cada 15 min) y, si falla,
 * cuándo se reintenta. */
const CADA_MS = 15 * 60_000;
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
/** Lo que se ve la escena del tiempo de hoy al dar los buenos días. */
const ESCENA_SALUDO_MS = 9000;
/** Lo que dura una escena probada desde Configuración. */
const ESCENA_PRUEBA_MS = 20_000;

let config: ConfigClima = CLIMA_POR_DEFECTO;
let actual: Clima | null = null;
let fallo = false;
let tPedir = 0;
let ultimoSaludo = "";
let inactivo = 0;
/** Ya se avisó de esta lluvia (se olvida cuando deja de haber lluvia a la vista). */
let avisadaLluvia = false;

/** "Santiago de Chile" de "Santiago de Chile, Región Metropolitana, Chile". */
const ciudadCorta = (c: string) => c.split(",")[0];

/** El tiempo de ahora para el panel. */
export function resumenClima() {
  if (!actual) return null;
  return {
    temperatura: actual.temperatura,
    texto: describirCielo(actual.codigo).texto,
    ciudad: ciudadCorta(actual.ciudad),
    min: actual.hoy.min,
    max: actual.hoy.max,
    lluvia: actual.lluviaPronto,
  };
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
  mostrarCieloDeHoy(c, ESCENA_SALUDO_MS);
  // Si el saludo ya habla de la lluvia, no se avisa otra vez
  if (c.lluviaPronto || c.lloviendo) avisadaLluvia = true;
}

function revisarLluvia(c: Clima, antes: Clima | null): void {
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
    ponerClima(c);
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
    ponerClima(null);
    avisadaLluvia = false;
    if (hayCiudad(nueva)) void actualizar(true);
    else window.clearTimeout(tPedir);
  }).catch(console.error);

  // Probar una escena desde Configuración
  listen<EscenaPrueba | typeof PARAR_PRUEBA>(EVENTO_PROBAR_ESCENA, ({ payload }) => {
    if (payload === PARAR_PRUEBA) pararPrueba();
    else probarEscena(payload, ESCENA_PRUEBA_MS);
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
