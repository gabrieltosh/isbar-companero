// Cara LED del compañero: ojos y boca con trazos gruesos y un brillo suave alrededor.
// Se dibuja en SVG (64×64) a partir de una expresión, hacia dónde mira y el tiempo
// (para lo que se mueve solo: cantar, marearse, respirar dormido…).

export type Expresion =
  | "normal"
  | "feliz"
  | "risa"
  | "guino"
  | "sorpresa"
  | "enojado"
  | "triste"
  | "pensativo"
  | "cansado"
  | "mareado"
  | "preocupado"
  | "hablando"
  | "silba"
  | "dormido"
  | "celebra"
  | "saludo"
  | "musica";

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
  /** Tiempo en ms (animaciones que se repiten) */
  t: number;
  /** Progreso (0 a 1) de las animaciones de una sola vez, como el guiño */
  progreso: number;
}

const suave = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const limitar = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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
/** Ojo contento "^" */
const arcoArriba = (x: number, y: number, c: string) => trazo(`M${x - 6} ${y + 3} Q${x} ${y - 5} ${x + 6} ${y + 3}`, c);
/** Ojo apretado hacia abajo (bostezo) */
const arcoAbajo = (x: number, y: number, c: string) => trazo(`M${x - 6} ${y - 1} Q${x} ${y + 4} ${x + 6} ${y - 1}`, c);
const linea = (x: number, y: number, c: string) => trazo(`M${x - 5} ${y} L${x + 5} ${y}`, c);
/** Ojo con el párpado a la mitad (media luna) */
const mediaLuna = (x: number, y: number, c: string) =>
  relleno(`<path d="M${x - 5.5} ${y - 1} L${x + 5.5} ${y - 1} A5.5 5.5 0 0 1 ${x - 5.5} ${y - 1} Z"/>`, c);
const sonrisaAbierta = (m: number, n: number, c: string) =>
  relleno(`<path d="M${m - 11} ${n - 1} L${m + 11} ${n - 1} Q${m + 11} ${n + 12} ${m} ${n + 12} Q${m - 11} ${n + 12} ${m - 11} ${n - 1} Z"/>`, c);
const sonrisa = (m: number, n: number, c: string) => trazo(`M${m - 8} ${n} Q${m} ${n + 7} ${m + 8} ${n}`, c);

function espiral(x: number, y: number, giro: number, c: string): string {
  let d = "";
  for (let i = 0; i <= 20; i++) {
    const a = giro + i * 0.55;
    const r = 0.4 + i * 0.27;
    d += `${i ? "L" : "M"}${(x + Math.cos(a) * r).toFixed(1)} ${(y + Math.sin(a) * r).toFixed(1)}`;
  }
  return `<path d="${d}" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
}

/** Estrella de cuatro puntas (guiño y celebración). */
const estrella = (x: number, y: number, s: number, c: string) =>
  `<path d="M${x} ${y - 6 * s} Q${x + 1.2 * s} ${y - 1.2 * s} ${x + 6 * s} ${y} Q${x + 1.2 * s} ${y + 1.2 * s} ${x} ${y + 6 * s} Q${x - 1.2 * s} ${y + 1.2 * s} ${x - 6 * s} ${y} Q${x - 1.2 * s} ${y - 1.2 * s} ${x} ${y - 6 * s} Z" fill="${c}"/>`;

/** Notita musical que sube y se desvanece (k de 0 a 1). */
const nota = (x: number, y: number, k: number, c: string) =>
  `<g opacity="${(1 - k).toFixed(2)}" transform="translate(${(x + k * 10).toFixed(1)} ${(y - k * 26).toFixed(1)})"><path d="M0 0v-9l6-2v9" stroke="${c}" stroke-width="2" fill="none"/><circle cx="-1.5" cy="0" r="2" fill="${c}"/><circle cx="4.5" cy="-2" r="2" fill="${c}"/></g>`;

/** Cuánto está bostezando (0 a 1), en un ciclo de unos 9 s. */
export function bostezo(t: number): number {
  const c = (t / 37) % 240;
  return c > 150 && c < 230 ? Math.sin(((c - 150) / 80) * Math.PI) : 0;
}

export function dibujarCara(p: Pose, c: string): string {
  const X = 32 + p.miraX;
  const Y = 25 + p.miraY + p.salto;
  const M = 32 + p.miraX * 0.4;
  const N = 41 + p.miraY * 0.4 + p.salto;
  const izq = X - 11;
  const der = X + 11;
  const abierto = 1 - p.parpadeo * 0.8;
  const t = p.t;
  let ojos = "";
  let boca = "";
  let extra = "";

  switch (p.expresion) {
    case "feliz":
    case "saludo":
      ojos = arcoArriba(izq, Y, c) + arcoArriba(der, Y, c);
      boca = sonrisaAbierta(M, N, c);
      if (p.expresion === "saludo") {
        // Una manita que saluda a un lado
        const a = Math.sin(t / 45) * 25;
        extra = `<g transform="translate(66 34) rotate(${a.toFixed(1)})"><path d="M0 0 L0 -12" stroke="${c}" stroke-width="3.4" stroke-linecap="round"/><circle cx="0" cy="-14" r="3.4" fill="${c}"/></g>`;
      }
      break;
    case "risa":
    case "celebra":
      ojos =
        trazo(`M${izq - 5} ${Y - 4} L${izq + 4} ${Y} L${izq - 5} ${Y + 4}`, c) +
        trazo(`M${der + 5} ${Y - 4} L${der - 4} ${Y} L${der + 5} ${Y + 4}`, c);
      boca = sonrisaAbierta(M, N, c);
      if (p.expresion === "celebra") {
        for (let i = 0; i < 5; i++) {
          const a = t / 400 + i * 1.256;
          const r = 40 + Math.sin(t / 160 + i) * 3;
          extra += estrella(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 0.6, c);
        }
      }
      break;
    case "guino": {
      // Cierra un ojo poco a poco, sonrisa pícara y una estrellita que sube
      const g = p.progreso;
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
    case "sorpresa":
      ojos = ojo(izq, Y, 5.8, c, abierto) + ojo(der, Y, 5.8, c, abierto);
      boca = relleno(`<ellipse cx="${M}" cy="${N + 4}" rx="5" ry="6"/>`, c);
      break;
    case "enojado":
      ojos =
        trazo(`M${izq - 6} ${Y - 6} L${izq + 5} ${Y - 2}`, c) +
        trazo(`M${der + 6} ${Y - 6} L${der - 5} ${Y - 2}`, c) +
        ojo(izq, Y + 3, 3.6, c, abierto) +
        ojo(der, Y + 3, 3.6, c, abierto);
      boca = trazo(`M${M - 7} ${N + 5} Q${M} ${N} ${M + 7} ${N + 5}`, c);
      break;
    case "triste":
    case "preocupado":
      ojos =
        trazo(`M${izq - 6} ${Y - 2} L${izq + 5} ${Y - 6}`, c) +
        trazo(`M${der + 6} ${Y - 2} L${der - 5} ${Y - 6}`, c) +
        ojo(izq, Y + 3, 3.6, c, abierto) +
        ojo(der, Y + 3, 3.6, c, abierto);
      if (p.expresion === "triste") {
        boca = trazo(`M${M - 7} ${N + 5} Q${M} ${N - 1} ${M + 7} ${N + 5}`, c);
      } else {
        // Boca temblorosa y una gota de sudor que cae
        let d = `M${M - 8} ${N + 3}`;
        for (let i = 1; i <= 4; i++) d += ` Q${M - 8 + i * 4 - 2} ${N + 3 + (i % 2 ? -3 : 3)} ${M - 8 + i * 4} ${N + 3}`;
        boca = trazo(d, c, 3.2);
        const k = (t % 1600) / 1600;
        extra = `<path d="M53 ${(12 + k * 8).toFixed(1)}c2.2 3 3.4 4.5 3.4 6a3.4 3.4 0 0 1-6.8 0c0-1.5 1.2-3 3.4-6z" fill="#7FB8FF" opacity="${(1 - k * 0.6).toFixed(2)}"/>`;
      }
      break;
    case "pensativo":
      ojos = ojo(izq + 3, Y - 3, 4.2, c, abierto) + ojo(der + 3, Y - 3, 4.2, c, abierto);
      boca = trazo(`M${M - 1} ${N + 3} L${M + 7} ${N + 1}`, c);
      extra = relleno(`<circle cx="62" cy="10" r="2"/>`, c) + relleno(`<circle cx="69" cy="3" r="3"/>`, c);
      break;
    case "cansado": {
      // Párpados a media altura y, cada pocos segundos, un bostezo
      const b = bostezo(t);
      ojos =
        b > 0.3 ? arcoAbajo(izq, Y + 1, c) + arcoAbajo(der, Y + 1, c) : mediaLuna(izq, Y + 1, c) + mediaLuna(der, Y + 1, c);
      boca =
        b > 0.05
          ? relleno(`<ellipse cx="${M}" cy="${N + 4}" rx="${(3 + b * 3).toFixed(2)}" ry="${(2 + b * 6).toFixed(2)}"/>`, c)
          : trazo(`M${M - 5} ${N + 3} L${M + 5} ${N + 3}`, c);
      break;
    }
    case "mareado": {
      ojos = espiral(izq, Y, t / 65, c) + espiral(der, Y, t / 65, c);
      let d = `M${M - 9} ${N + 3}`;
      for (let i = 1; i <= 6; i++) d += ` L${M - 9 + i * 3} ${(N + 3 + (i % 2 ? -2.5 : 2.5) * Math.cos(t / 80)).toFixed(1)}`;
      boca = trazo(d, c);
      break;
    }
    case "hablando": {
      ojos = ojo(izq, Y, 4.6, c, abierto) + ojo(der, Y, 4.6, c, abierto);
      const a = 1.5 + Math.abs(Math.sin(t / 48)) * 3.5;
      boca = relleno(`<ellipse cx="${M}" cy="${N + 3}" rx="4.5" ry="${a.toFixed(2)}"/>`, c);
      break;
    }
    case "musica": {
      // Ojos contentos y canta: la boca se abre al ritmo y salen notitas
      ojos = arcoArriba(izq, Y, c) + arcoArriba(der, Y, c);
      const a = 2 + Math.abs(Math.sin(t / 55)) * 4;
      boca = relleno(`<ellipse cx="${M}" cy="${N + 3}" rx="5" ry="${a.toFixed(2)}"/>`, c);
      extra = nota(58, 30, (t % 1800) / 1800, c) + nota(-4, 26, ((t + 900) % 1800) / 1800, c);
      break;
    }
    case "silba":
      ojos = ojo(izq, Y - 1, 4.2, c, abierto) + ojo(der, Y - 1, 4.2, c, abierto);
      boca = relleno(`<circle cx="${M + 2}" cy="${N + 3}" r="2.6"/>`, c);
      extra = nota(58, 30, (t % 2000) / 2000, c);
      break;
    case "dormido": {
      ojos = linea(izq, Y + 1, c) + linea(der, Y + 1, c);
      const r = 1.5 + Math.abs(Math.sin(t / 400)) * 1.5;
      boca = relleno(`<circle cx="${M}" cy="${N + 2}" r="${r.toFixed(2)}"/>`, c);
      const k = (t % 1800) / 1800;
      extra = `<text x="56" y="${(6 - k * 15).toFixed(1)}" fill="${c}" opacity="${(1 - k).toFixed(2)}" font-size="12" font-family="Segoe UI, sans-serif">z</text>`;
      break;
    }
    default:
      ojos = ojo(izq, Y, 4.6, c, abierto) + ojo(der, Y, 4.6, c, abierto);
      boca = sonrisa(M, N, c);
  }
  return `${extra}<g transform="rotate(${limitar(p.giro, -80, 80).toFixed(2)} 32 32)">${ojos}${boca}</g>`;
}
