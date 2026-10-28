// Cara LED del compañero: ojos y boca con trazos gruesos y un brillo suave alrededor.
// Se dibuja en SVG (64×64) a partir de una expresión y de hacia dónde mira.

export type Expresion = "normal" | "feliz" | "sorpresa" | "guino";

export interface Pose {
  expresion: Expresion;
  /** Desplazamiento de la mirada, en px (aprox. ±4) */
  miraX: number;
  miraY: number;
  /** 0 = ojos abiertos, 1 = cerrados (parpadeo) */
  parpadeo: number;
  /** Inclinación de la cabeza, en grados */
  giro: number;
  /** Rebote vertical, en px */
  salto: number;
  /** Progreso del guiño (0 a 1) */
  guino: number;
}

function color(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--cara").trim() || "#f5f7ff";
}

/** Trazo con brillo: una línea ancha y tenue debajo de la línea principal. */
function trazo(d: string, c: string, ancho = 4): string {
  return `<path d="${d}" stroke="${c}" stroke-opacity=".2" stroke-width="${ancho + 5}" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" stroke="${c}" stroke-width="${ancho}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/** Forma rellena con brillo. */
function relleno(forma: string, c: string): string {
  return forma.replace("/>", ` fill="${c}" stroke="${c}" stroke-opacity=".2" stroke-width="6"/>`);
}

const ojo = (x: number, y: number, r: number, c: string, alto = 1) =>
  relleno(`<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${Math.max(0.6, r * alto)}"/>`, c);
const arco = (x: number, y: number, c: string) => trazo(`M${x - 6} ${y + 3} Q${x} ${y - 5} ${x + 6} ${y + 3}`, c);
const suave = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

/** Estrellita del guiño. */
const estrella = (x: number, y: number, s: number, c: string) =>
  `<path d="M${x} ${y - 6 * s} Q${x + 1.2 * s} ${y - 1.2 * s} ${x + 6 * s} ${y} Q${x + 1.2 * s} ${y + 1.2 * s} ${x} ${y + 6 * s} Q${x - 1.2 * s} ${y + 1.2 * s} ${x - 6 * s} ${y} Q${x - 1.2 * s} ${y - 1.2 * s} ${x} ${y - 6 * s} Z" fill="${c}"/>`;

export function dibujarCara(p: Pose): string {
  const c = color();
  const X = 32 + p.miraX;
  const Y = 25 + p.miraY + p.salto;
  const M = 32 + p.miraX * 0.4;
  const N = 41 + p.miraY * 0.4 + p.salto;
  const izq = X - 11;
  const der = X + 11;
  const abierto = 1 - p.parpadeo * 0.8;
  let ojos = "";
  let boca = "";
  let extra = "";

  switch (p.expresion) {
    case "feliz":
      ojos = arco(izq, Y, c) + arco(der, Y, c);
      boca = relleno(
        `<path d="M${M - 11} ${N - 1} L${M + 11} ${N - 1} Q${M + 11} ${N + 12} ${M} ${N + 12} Q${M - 11} ${N + 12} ${M - 11} ${N - 1} Z"/>`,
        c,
      );
      break;
    case "sorpresa":
      ojos = ojo(izq, Y, 5.8, c, abierto) + ojo(der, Y, 5.8, c, abierto);
      boca = relleno(`<ellipse cx="${M}" cy="${N + 4}" rx="5" ry="6"/>`, c);
      break;
    case "guino": {
      // Cierra un ojo poco a poco, sonrisa pícara y una estrellita que sube
      const g = p.guino;
      const cierre = g < 0.15 ? suave(g / 0.15) : g < 0.62 ? 1 : 1 - suave(Math.min(1, (g - 0.62) / 0.2));
      const alto = 1 - cierre;
      ojos =
        ojo(izq, Y - cierre * 0.6, 4.6 + cierre * 0.4, c) +
        (alto > 0.25 ? ojo(der, Y, 4.6, c, alto) : trazo(`M${der - 6} ${Y + 1} Q${der} ${Y - 5} ${der + 6} ${Y + 1}`, c));
      boca = trazo(`M${M - 8} ${N + 1 - cierre} Q${M + 1 + cierre * 2} ${N + 7 + cierre} ${M + 8 + cierre} ${N - 2 - cierre * 3}`, c);
      if (g > 0.12 && g < 0.75) {
        const q = (g - 0.12) / 0.63;
        extra = estrella(der + 15 + q * 4, Y - 10 - q * 6, Math.sin(q * Math.PI) * 0.9, c);
      }
      break;
    }
    default:
      ojos = ojo(izq, Y, 4.6, c, abierto) + ojo(der, Y, 4.6, c, abierto);
      boca = trazo(`M${M - 8} ${N} Q${M} ${N + 7} ${M + 8} ${N}`, c);
  }
  return `${extra}<g transform="rotate(${p.giro} 32 32)">${ojos}${boca}</g>`;
}
