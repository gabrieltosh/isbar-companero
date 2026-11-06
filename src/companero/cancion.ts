// Reacciones a lo que pasa con la canción, la cambie quien la cambie (el panel, el globo, el
// reproductor o las teclas multimedia): si termina entera, aplaude y hace una reverencia; si la
// saltas, se encoge de hombros; si la pausas, se queda quieto y te mira con curiosidad; al seguir,
// se alegra. Si la acción viene de sus propios botones, no reacciona dos veces (ya respondió).
// Además cuenta cuántas veces suena cada canción: con las favoritas se alegra al reconocerlas
// («¡Esta me encanta!», como mucho una vez al día por canción).
// En una reunión, un vídeo o un juego no hace nada de esto (sí cuenta las canciones).
import { cambioCancion, cambiosMusica, infoMusica, posicionMusica, type InfoMedia } from "../estado/musica";
import { guardar, leer } from "../store";
import { modoActividad } from "./actividad";
import { avisar } from "./globos";
import { accionMusicaReciente } from "./respuestas";
import { gesto } from "./vida";

/** A menos de esto del final, la canción ha terminado entera (no se ha saltado). */
const FINAL_MS = 8000;
/** Sonando al menos esto, cuenta como una vez más. */
const CUENTA_MS = 30_000;
/** Desde estas veces, es una de las favoritas. */
const VECES_FAVORITA = 5;
/** Canciones que se recuerdan como mucho (se olvidan las que hace más que no suenan). */
const MAX_RECORDADAS = 1000;
const CLAVE_CUENTAS = "reproducciones";
const APLAUSO_MS = 2600;

interface Cuenta {
  veces: number;
  /** Última vez que sonó (Date.now()) */
  visto: number;
  /** Día en que se celebró por última vez (para no repetirlo) */
  celebrada?: string;
}

let cuentas: Record<string, Cuenta> = {};
/** Lo último que se supo de la canción que sonaba (para saber, al cambiar, si terminó). */
let ultima: { clave: string; reproduciendo: boolean; posicion: number; duracion: number } | null = null;
let escuchadaMs = 0;
let contada = false;

const claveDe = (i: Readonly<InfoMedia>) => `${i.titulo}·${i.artista}`;
const hoy = () => new Date().toISOString().slice(0, 10);
/** En una reunión, un vídeo o un juego no reacciona. */
const puedeReaccionar = () => !modoActividad().quieto;

function guardarCuentas(): void {
  const claves = Object.keys(cuentas);
  if (claves.length > MAX_RECORDADAS) {
    claves.sort((a, b) => cuentas[a].visto - cuentas[b].visto);
    for (const k of claves.slice(0, claves.length - MAX_RECORDADAS)) delete cuentas[k];
  }
  void guardar(CLAVE_CUENTAS, cuentas);
}

/** ¿Estaba a punto de acabar? (sin saber la duración, no se sabe) */
const casiAlFinal = (u: NonNullable<typeof ultima>) => u.duracion > 0 && u.duracion - u.posicion <= FINAL_MS;

/** Otra canción: ¿terminó la anterior o se saltó? Y si la nueva es de las favoritas, lo celebra. */
function alCambiarDeCancion(info: InfoMedia): void {
  const antes = ultima;
  const clave = claveDe(info);
  let espera = 600;
  if (antes && antes.clave !== clave && antes.reproduciendo && puedeReaccionar()) {
    if (casiAlFinal(antes)) {
      gesto("aplaude", APLAUSO_MS);
      espera = APLAUSO_MS + 200;
    } else if (antes.duracion > 0 && !accionMusicaReciente()) {
      gesto("nose", 1400);
      espera = 1600;
    }
  }
  ultima = { clave, reproduciendo: info.reproduciendo, posicion: info.posicionMs, duracion: info.duracionMs };
  escuchadaMs = 0;
  contada = false;
  const c = cuentas[clave];
  if (!c || c.veces < VECES_FAVORITA || c.celebrada === hoy() || !info.reproduciendo) return;
  c.celebrada = hoy();
  guardarCuentas();
  window.setTimeout(() => {
    if (!puedeReaccionar()) return;
    avisar({
      origen: "Música",
      titulo: "¡Esta me encanta!",
      texto: `La has puesto ${c.veces} veces.`,
      duracion: 4000,
      gesto: "risa",
    });
  }, espera);
}

/** Pausa o sigue la misma canción. */
function alCambiarElEstado(): void {
  const info = infoMusica();
  if (!info || !ultima || claveDe(info) !== ultima.clave) return;
  const antes = ultima.reproduciendo;
  ultima.reproduciendo = info.reproduciendo;
  ultima.duracion = info.duracionMs;
  if (antes === info.reproduciendo || !puedeReaccionar()) return;
  if (!info.reproduciendo && casiAlFinal({ ...ultima, posicion: posicionMusica() })) {
    // Terminó la última canción (no hay otra detrás)
    gesto("aplaude", APLAUSO_MS);
  } else if (!accionMusicaReciente()) {
    gesto(info.reproduciendo ? "feliz" : "curioso", info.reproduciendo ? 1200 : 1800);
  }
}

/** Cada segundo: dónde va la canción (para saber si terminó) y cuánto se ha escuchado. */
function seguir(): void {
  const info = infoMusica();
  if (!info || !ultima || claveDe(info) !== ultima.clave) return;
  ultima.posicion = posicionMusica();
  ultima.duracion = info.duracionMs;
  if (!info.reproduciendo || contada) return;
  escuchadaMs += 1000;
  if (escuchadaMs < CUENTA_MS) return;
  contada = true;
  const c = (cuentas[ultima.clave] ??= { veces: 0, visto: 0 });
  c.veces += 1;
  c.visto = Date.now();
  guardarCuentas();
}

/** Veces que ha sonado la canción de ahora (0 si no se sabe). */
export function vecesCancion(): number {
  const info = infoMusica();
  return info ? (cuentas[claveDe(info)]?.veces ?? 0) : 0;
}

export async function iniciarCancion(): Promise<void> {
  cuentas = await leer<Record<string, Cuenta>>(CLAVE_CUENTAS, {});
  const info = infoMusica();
  if (info) ultima = { clave: claveDe(info), reproduciendo: info.reproduciendo, posicion: info.posicionMs, duracion: info.duracionMs };
  cambioCancion.escuchar(alCambiarDeCancion);
  cambiosMusica.escuchar(alCambiarElEstado);
  window.setInterval(seguir, 1000);
}
