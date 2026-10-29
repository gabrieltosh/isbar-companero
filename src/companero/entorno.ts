// Lo que "ve" el compañero al soltarlo: según la ventana que queda debajo (programa y título)
// elige cómo curiosear y cómo reaccionar. Y recuerda los sitios donde ya ha estado.
import type { Expresion } from "./cara";
import { guardar, leer } from "../store";

/** La ventana de debajo, tal como la manda Rust (companero.rs). */
export interface Debajo {
  programa: string;
  titulo: string;
}

export type Entorno =
  | "video"
  | "juego"
  | "codigo"
  | "oficina"
  | "correo"
  | "chat"
  | "musica"
  | "navegador"
  | "carpetas"
  | "escritorio"
  | "otro";

/** Forma de curiosear (main.ts) y reacciones posibles para cada sitio. */
interface Ficha {
  curioseos: Expresion[];
  reacciones: [Expresion, number][];
}

const FICHAS: Record<Entorno, Ficha> = {
  // ¡Un vídeo o un juego! Se queda maravillado
  video: { curioseos: ["otea", "curioso"], reacciones: [["impresionado", 2200], ["celebra", 1800], ["feliz", 1600]] },
  juego: { curioseos: ["otea", "curioso"], reacciones: [["impresionado", 2200], ["celebra", 2000], ["sorpresa", 1500]] },
  // Código: lo examina con lupa y se queda pensando (o impresionado)
  codigo: { curioseos: ["lupa", "curioso"], reacciones: [["pensativo", 2200], ["impresionado", 2000], ["mareado", 2000]] },
  // Hojas de cálculo, documentos y correo: qué pereza
  oficina: { curioseos: ["lupa", "asoma"], reacciones: [["frustrado", 2200], ["cansado", 2400], ["mareado", 2000]] },
  correo: { curioseos: ["asoma", "lupa"], reacciones: [["frustrado", 2200], ["preocupado", 2000], ["sorpresa", 1500]] },
  // Conversaciones: le hacen gracia (o le dan apuro)
  chat: { curioseos: ["asoma", "curioso"], reacciones: [["risa", 1600], ["guino", 1200], ["sorpresa", 1500]] },
  musica: { curioseos: ["curioso", "otea"], reacciones: [["celebra", 2000], ["feliz", 1600], ["silba", 2200]] },
  navegador: { curioseos: ["curioso", "lupa", "otea"], reacciones: [["impresionado", 2000], ["sorpresa", 1600], ["pensativo", 2000], ["risa", 1500]] },
  carpetas: { curioseos: ["lupa", "asoma"], reacciones: [["pensativo", 2000], ["mareado", 2000], ["frustrado", 2000]] },
  // El escritorio vacío: aquí no hay nada…
  escritorio: { curioseos: ["otea", "asoma"], reacciones: [["triste", 1800], ["pensativo", 2000], ["bostezo", 2400]] },
  otro: {
    curioseos: ["curioso", "lupa", "otea", "asoma"],
    reacciones: [["impresionado", 2000], ["sorpresa", 1600], ["frustrado", 2200], ["feliz", 1600], ["pensativo", 2000], ["risa", 1500]],
  },
};

const PROGRAMAS: [Entorno, string[]][] = [
  ["video", ["vlc.exe", "mpc-hc64.exe", "mpc-hc.exe", "potplayermini64.exe", "wmplayer.exe", "video.ui.exe", "netflix.exe", "obs64.exe"]],
  ["juego", ["steam.exe", "steamwebhelper.exe", "epicgameslauncher.exe", "riotclientux.exe", "battle.net.exe", "minecraft.exe", "javaw.exe"]],
  ["codigo", ["code.exe", "cursor.exe", "devenv.exe", "idea64.exe", "pycharm64.exe", "rider64.exe", "sublime_text.exe", "notepad++.exe", "windowsterminal.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "wezterm-gui.exe", "alacritty.exe", "claude.exe"]],
  ["oficina", ["excel.exe", "winword.exe", "powerpnt.exe", "onenote.exe", "acrord32.exe", "acrobat.exe", "soffice.bin", "scalc.exe", "swriter.exe", "notepad.exe"]],
  ["correo", ["outlook.exe", "olk.exe", "thunderbird.exe", "hxoutlook.exe"]],
  ["chat", ["whatsapp.exe", "whatsapp.root.exe", "telegram.exe", "discord.exe", "slack.exe", "ms-teams.exe", "teams.exe", "signal.exe"]],
  ["musica", ["spotify.exe", "itunes.exe", "music.ui.exe", "foobar2000.exe", "aimp.exe"]],
  ["navegador", ["chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe", "vivaldi.exe", "arc.exe"]],
];

/** En el navegador (y en las apps de la Tienda, que son todas "applicationframehost.exe"), el título dice qué es. */
const TITULOS: [Entorno, RegExp][] = [
  ["video", /youtube|netflix|twitch|prime video|disney\+|max\b|vimeo|crunchyroll|películas y tv|movies & tv|reproductor multimedia|media player/i],
  ["juego", /xbox|solitaire|solitario/i],
  ["codigo", /github|gitlab|stack overflow|localhost|claude/i],
  ["correo", /gmail|outlook|correo|bandeja de entrada|inbox|proton mail/i],
  ["oficina", /google (docs|sheets|slides)|documentos de google|hojas de cálculo|excel|word|notion|\.pdf|calculadora|calculator|configuración|settings/i],
  ["chat", /whatsapp|telegram|discord|messenger|slack|teams/i],
  ["musica", /spotify|soundcloud|youtube music|deezer/i],
];

export function entornoDe(debajo: Debajo | null | undefined): Entorno {
  if (!debajo) return "escritorio";
  const { programa, titulo } = debajo;
  // El escritorio es una ventana del explorador sin título de carpeta
  if (programa === "explorer.exe") return titulo === "" || titulo === "Program Manager" ? "escritorio" : "carpetas";
  let entorno: Entorno = "otro";
  for (const [e, lista] of PROGRAMAS) {
    if (lista.includes(programa)) {
      entorno = e;
      break;
    }
  }
  if (entorno === "navegador" || entorno === "otro") {
    for (const [e, patron] of TITULOS) {
      if (patron.test(titulo)) return e;
    }
  }
  return entorno;
}

const azar = <T>(opciones: T[], evitar?: T): T => {
  const quedan = opciones.length > 1 ? opciones.filter((o) => o !== evitar) : opciones;
  return quedan[Math.floor(Math.random() * quedan.length)];
};

let ultimoCurioseo: Expresion | undefined;
let ultimaReaccion: [Expresion, number] | undefined;

/** Cómo curiosea en este sitio (sin repetir la última vez). */
export function curioseoPara(entorno: Entorno): Expresion {
  ultimoCurioseo = azar(FICHAS[entorno].curioseos, ultimoCurioseo);
  return ultimoCurioseo;
}

/** Cómo reacciona a lo que ha visto (sin repetir la última vez). */
export function reaccionPara(entorno: Entorno): [Expresion, number] {
  const opciones = FICHAS[entorno].reacciones;
  const r = azar(
    opciones,
    opciones.find((o) => o[0] === ultimaReaccion?.[0]),
  );
  ultimaReaccion = r;
  return r;
}

// Sitios donde ya ha estado: si lo dejas cerca de uno, lo reconoce
const RADIO_SITIO = 140;
const MAX_SITIOS = 12;
interface Sitio {
  x: number;
  y: number;
  veces: number;
}
let sitios: Sitio[] = [];
leer<Sitio[]>("companeroSitios", [])
  .then((s) => (sitios = Array.isArray(s) ? s : []))
  .catch(console.error);

/** Apunta que ha estado aquí y devuelve cuántas veces había estado antes (0 si es nuevo). */
export function visitar(x: number, y: number): number {
  const sitio = sitios.find((s) => Math.hypot(s.x - x, s.y - y) < RADIO_SITIO);
  const antes = sitio?.veces ?? 0;
  if (sitio) {
    sitio.veces += 1;
    sitios = [sitio, ...sitios.filter((s) => s !== sitio)];
  } else {
    sitios = [{ x, y, veces: 1 }, ...sitios].slice(0, MAX_SITIOS);
  }
  void guardar("companeroSitios", sitios);
  return antes;
}
