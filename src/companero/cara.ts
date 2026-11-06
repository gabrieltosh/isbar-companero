// Cara LED del compañero: ojos y boca con trazos gruesos y un brillo suave alrededor.
//
// Los ojos y la boca siempre tienen la misma forma base (una curva arriba y otra abajo entre
// dos puntas) y cada expresión es solo una lista de números ("rasgos"). Así se puede pasar de
// una cara a otra transformando los rasgos poco a poco (morph): el ojo redondo se curva hasta
// ser un "^", la sonrisa se abre... Lo que no se puede transformar (espirales, notas, "z",
// estrellas…) son "extras" que aparecen y desaparecen con un fundido.

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
  | "bostezo"
  | "mareado"
  | "preocupado"
  | "hablando"
  | "silba"
  | "dormido"
  | "celebra"
  | "saludo"
  | "musica"
  | "notificacion"
  | "curioso"
  | "juega"
  | "asiente"
  | "niega"
  | "nose"
  | "lupa"
  | "otea"
  | "asoma"
  | "frustrado"
  | "impresionado"
  /** Sin internet: mira hacia su antena buscando señal */
  | "buscasenal";

/** Un ojo: ancho, altura de la curva de arriba y de abajo (negativa = sube: "^"), giro y posición. */
export interface Ojo {
  w: number;
  t: number;
  b: number;
  giro: number;
  dx: number;
  dy: number;
}

/** La boca: ancho, curva del borde de arriba y del de abajo (positivo = hacia abajo), giro y posición. */
export interface Boca {
  w: number;
  t: number;
  b: number;
  giro: number;
  dx: number;
  dy: number;
}

export interface Rasgos {
  izq: Ojo;
  der: Ojo;
  boca: Boca;
}

/** Cómo suena la música (ritmo.ts), para cantar y sacar notitas al ritmo. */
/** Ojos al bailar: según el paso, felices, cerrados de gusto, abiertos o apretados. */
export type OjosBaile = "felices" | "cerrados" | "abiertos" | "apretados";

export interface MusicaPose {
  /** Cuánto de cada tipo de ojos (suman 1; así se pasa de unos a otros sin saltos) */
  ojos: Record<OjosBaile, number>;
  /** La boca al bailar (cerrada, según la canción: bocaMusical), ya suavizada */
  boca: Boca;
  /** Nivel de ahora (0 a 1) */
  energia: number;
  /** Nivel medio de esta parte de la canción (0 a 1): tranquila o intensa */
  intensidad: number;
  /** Notitas en el aire (ritmo.ts): cuándo nacieron, de qué lado salen, cuánto duran y lo que
   * las hace distintas (forma, tamaño, vaivén e inclinación) */
  notas: { nace: number; lado: number; vida: number; variante: number; tam: number; meceo: number; giro: number }[];
  /** Probabilidad de que la canción sea de amor (Jev): entonces salen corazones */
  amor?: number;
  /** Tono de la canción según Jev (0 muy triste … 4 muy alegre): cambia la cara al bailar, si se sabe */
  tono?: number;
  /** Canción muy triste: de vez en cuando cae una lágrima */
  lagrima?: boolean;
  /** Puño en alto, con su golpe en cada pulso (1 → 0), o nada */
  puno?: number;
}

/** Lo que no depende de la expresión: hacia dónde mira, parpadeo, cabeza y saltitos. */
export interface Pose {
  /** Desplazamiento de la mirada, en px (aprox. ±4) */
  miraX: number;
  miraY: number;
  /** 0 = ojos abiertos, 1 = cerrados */
  parpadeo: number;
  /** Inclinación de la cabeza, en grados */
  giro: number;
  /** Rebote vertical, en px */
  salto: number;
  /** Con música sonando y audio, cómo suena (ojos y boca del baile); si no, una sonrisa */
  musica?: MusicaPose;
}

/** Centros de los ojos y de la boca en la cara (64×64). */
const OJO_IZQ = { x: 21, y: 25 };
const OJO_DER = { x: 43, y: 25 };
const BOCA = { x: 32, y: 42 };
/** Constante para aproximar un cuarto de elipse con una curva de Bézier. */
const K = 0.5523;

const suave = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const limitar = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const n = (v: number) => v.toFixed(2);

const ojo = (w: number, t: number, b: number, giro = 0, dx = 0, dy = 0): Ojo => ({ w, t, b, giro, dx, dy });
const boca = (w: number, t: number, b: number, giro = 0, dx = 0, dy = 0): Boca => ({ w, t, b, giro, dx, dy });
const iguales = (o: Ojo, boca: Boca): Rasgos => ({ izq: o, der: { ...o, giro: -o.giro, dx: -o.dx }, boca });

// Formas que se repiten
const OJO_NORMAL = ojo(9.2, 4.6, 4.6);
const OJO_FELIZ = ojo(12, 4.5, -2.2);
const OJO_GRANDE = ojo(11.6, 5.8, 5.8);
const OJO_CERRADO = ojo(10, 0.6, 0.6, 0, 0, 1);
const SONRISA = boca(16, 6, 6);
const SONRISA_ABIERTA = boca(22, 0, 12);

// Bocas al bailar: siempre cerradas (abrirla para cantar casi nunca cuadraba con la canción).
// Manda el tono de la canción (de boca hacia abajo a sonrisa amplia); el género solo le da su
// toque, y lo que pasa en la canción (pausa, celebración, estribillo) la cambia un momento.

/** Curva de la boca según el tono (0 muy triste … 4 muy alegre): ancho y bordes de arriba y abajo. */
const BOCA_POR_TONO: [number, number, number][] = [
  [14, -5.5, -4], // muy triste: puchero, arco hacia abajo marcado (como la cara triste)
  [12, -2.4, -1.8], // algo triste o melancólica: claramente caída
  [11.5, 1.8, 2.4], // neutra: sonrisa suave, a gusto (seria se veía enfadado)
  [13, 3.2, 3.8], // alegre: sonrisa
  [16, 5.5, 6.5], // muy alegre: sonrisa amplia
];
/** Sin saber el tono (sin Jev): de casi neutra en las partes tranquilas a sonriente en las intensas. */
const TONO_SIN_JEV = 2.4;
/** Toque de cada género: más ancha o estrecha (px), más o menos curva (×) y la mueca de lado del
 * rock (grados y px, solo cuando sonríe). */
const TOQUE_ESTILO: Record<string, { ancho: number; curva: number; mueca: number }> = {
  rock: { ancho: 0, curva: 1, mueca: 1 },
  pop: { ancho: 0, curva: 1, mueca: 0 },
  electronica: { ancho: 0, curva: 0.6, mueca: 0 },
  balada: { ancho: -1.5, curva: 1, mueca: 0 },
  tranquila: { ancho: -1, curva: 0.9, mueca: 0 },
  fiesta: { ancho: 2, curva: 1.15, mueca: 0 },
};
/** En una pausa de la canción: recta, esperando a que vuelva. */
const BOCA_ESPERA = boca(7, 0.4, 0.6, 0, 0, 3);

/** Lo que decide la boca al bailar. */
export interface ComoSuena {
  /** Tono de la canción según Jev (0 muy triste … 4 muy alegre), si se sabe */
  tono?: number | null;
  /** Peso de cada género según Jev (suman 1), si se sabe */
  estilos?: Partial<Record<string, number>> | null;
  /** Lo intensa que es esta parte de la canción (0 a 1): en el estribillo de una canción alegre sonríe más */
  intensidad: number;
  /** Momento especial: esperando en una pausa o celebrando que vuelve la música */
  momento: "pausa" | "celebra" | null;
}

/** La boca que pide la música ahora (cerrada; sin suavizar). */
export function bocaMusical(c: ComoSuena): Boca {
  if (c.momento === "pausa") return BOCA_ESPERA;
  let tono = c.tono ?? TONO_SIN_JEV + c.intensidad * 1.2;
  // En el estribillo (la parte más intensa) de una canción alegre, algo más de sonrisa
  if (tono >= 2.5) tono += limitar((c.intensidad - 0.7) / 0.3, 0, 1) * 0.5;
  if (c.momento === "celebra") tono = Math.max(tono, 4);
  tono = limitar(tono, 0, 4);
  const i = Math.min(3, Math.floor(tono));
  const k = tono - i;
  const [a0, t0, b0] = BOCA_POR_TONO[i];
  const [a1, t1, b1] = BOCA_POR_TONO[i + 1];
  let ancho = a0 + (a1 - a0) * k;
  let arriba = t0 + (t1 - t0) * k;
  let abajo = b0 + (b1 - b0) * k;
  // El toque del género (o de la mezcla de géneros)
  const pesos = Object.entries(c.estilos ?? {}).filter(([e, w]) => TOQUE_ESTILO[e] && (w ?? 0) > 0) as [string, number][];
  const total = pesos.reduce((s, [, w]) => s + w, 0);
  let mueca = 0;
  if (total > 0) {
    let masAncho = 0;
    let curva = 0;
    for (const [e, w] of pesos) {
      const toque = TOQUE_ESTILO[e];
      masAncho += toque.ancho * (w / total);
      curva += toque.curva * (w / total);
      mueca += toque.mueca * (w / total);
    }
    ancho += masAncho;
    // Solo cambia la sonrisa: una boca triste sigue igual de triste
    if (arriba > 0) {
      arriba *= curva;
      abajo *= curva;
    }
  }
  // La mueca de lado solo cuando sonríe
  const sonrisa = limitar(arriba / 3, 0, 1);
  return boca(ancho, arriba, abajo, -10 * mueca * sonrisa, 1.5 * mueca * sonrisa, 2.5);
}

function mezclarObj<T extends object>(a: T, b: T, k: number): T {
  const r = { ...a } as Record<string, number>;
  const ra = a as Record<string, number>;
  const rb = b as Record<string, number>;
  for (const c of Object.keys(ra)) r[c] = ra[c] + (rb[c] - ra[c]) * k;
  return r as T;
}

/** Rasgos intermedios entre dos caras (k de 0 a 1). */
export function mezclar(a: Rasgos, b: Rasgos, k: number): Rasgos {
  return { izq: mezclarObj(a.izq, b.izq, k), der: mezclarObj(a.der, b.der, k), boca: mezclarObj(a.boca, b.boca, k) };
}

/** Cuánto está bostezando (0 a 1), en un ciclo de unos 9 s. */
export function bostezo(t: number): number {
  const c = (t / 37) % 240;
  return c > 150 && c < 230 ? Math.sin(((c - 150) / 80) * Math.PI) : 0;
}

/** Ojos medio cerrados de cansancio; al bostezar (b de 0 a 1) se aprietan y la boca se abre. */
function cansancio(bo: number): Rasgos {
  const o = mezclarObj(ojo(11, 0.6, 4.4, 0, 0, 1), ojo(12, 0.3, 1.4, 0, 0, 1), bo);
  const abierta = 2 + bo * 6;
  return iguales(o, boca(6 + bo * 6, -abierta * 0.6 * bo, Math.max(0.5, abierta * bo), 0, 0, 3 * bo));
}

/**
 * Los rasgos de cada expresión. `t` (ms) mueve lo que se repite; `progreso` (0 a 1), los gestos
 * de una vez; `musica`, cómo suena la canción (para cantar al ritmo).
 */
export function rasgosDe(expresion: Expresion, t: number, progreso: number, musica?: MusicaPose): Rasgos {
  switch (expresion) {
    case "feliz":
    case "saludo":
      return iguales(OJO_FELIZ, SONRISA_ABIERTA);
    case "risa":
    case "celebra":
      // Ojos apretados de risa, un poco girados hacia dentro
      return iguales(ojo(11, 2.6, -2.6, 12), boca(22, 0, 13));
    case "sorpresa":
      return iguales(OJO_GRANDE, boca(10, -6, 7, 0, 0, 1));
    case "curioso":
      // Un ojo muy abierto y el otro entornado, como quien examina algo; boquita de lado
      return { izq: OJO_GRANDE, der: ojo(9.6, 2, 4, 10, 0, 1), boca: boca(6, -2.4, 2.4, 0, 3, 3) };
    case "asiente":
      // Sí: ojos contentos y sonrisa
      return iguales(OJO_FELIZ, boca(12, -1.5, 4.5, 0, 0, 3));
    case "niega":
      // No: ojos cerrados y boca apretada
      return iguales(OJO_CERRADO, boca(10, -1.2, -1.2, 0, 0, 3));
    case "nose": {
      // No sé: una ceja arriba (un ojo más abierto) y boca torcida
      const k = Math.sin(limitar(progreso, 0, 1) * Math.PI);
      return {
        izq: ojo(9.6, 4.8 + k * 1.2, 4.6, 0, 0, -k * 1.5),
        der: ojo(9.4, 2.6, 4.2, 0, 0, 1),
        boca: boca(11, -1.4 - k, 1.4 - k, -8 * k, 1, 3),
      };
    }
    case "juega":
      // Atento a la pelota, con una sonrisita
      return iguales(ojo(9.8, 4.9, 4.4), boca(10, -1.6, 3.6, 0, 0, 3));
    case "lupa":
      // Examina con una lupa: el ojo de detrás del cristal se ve enorme
      return { izq: ojo(8.6, 3.6, 4.2, 0, 0, 1), der: ojo(13.4, 6.8, 6.8), boca: boca(7, -1, -1, 0, -2, 3) };
    case "buscasenal":
      // Ojos muy abiertos mirando hacia la antena y boquita concentrada, de lado
      return iguales(ojo(10.4, 5, 3), boca(6, -1.6, 2.2, 0, 1.5, 3));
    case "otea":
      // Mano de visera y ojos entornados, como quien mira a lo lejos
      return iguales(ojo(10, 1.8, 4, 0, 0, 1), boca(8, -1.6, 1.6, 0, 0, 3));
    case "asoma": {
      // Se asoma con los ojos entornados, desconfiado, y la boca apretada de lado a lado
      const lado = Math.sin(t / 400) * 2;
      return iguales(ojo(10.6, 1.4, 3.2, 0, 0, 1), boca(9, -0.8, -0.8, 0, lado, 3));
    }
    case "frustrado":
      // Párpados planos medio cerrados (-_-) y boca de "hmpf" torcida
      return iguales(ojo(10.5, 0.3, 2.6, 0, 0, 2), boca(11, -1, 1.2, -9, 2, 3));
    case "impresionado":
      // Ojos enormes y boca abierta de asombro
      return iguales(ojo(12.4, 6.4, 6.4), boca(9, -5, 6.5, 0, 0, 1));
    case "notificacion":
      return iguales(OJO_GRANDE, boca(7.2, -4.4, 4.4, 0, 0, 1));
    case "enojado":
      // Párpado de arriba cortado y caído hacia dentro
      return iguales(ojo(9, 1.6, 4, 20, 0, 2), boca(14, -4, -4, 0, 0, 3));
    case "triste":
      return iguales(ojo(9, 1.6, 4, -18, 0, 2), boca(14, -5, -5, 0, 0, 3));
    case "preocupado": {
      const tiembla = Math.sin(t / 70) * 1.2;
      return iguales(ojo(9, 1.8, 4, -16, 0, 2), boca(15, -1.5 + tiembla, -1.5 - tiembla, 0, 0, 3));
    }
    case "pensativo":
      return iguales(ojo(8.4, 4.2, 4.2, 0, 3, -3), boca(8, -1, -1, -14, 3, 3));
    case "cansado":
      return cansancio(bostezo(t));
    case "bostezo":
      return cansancio(Math.sin(limitar(progreso, 0, 1) * Math.PI));
    case "mareado": {
      // Los ojos se hacen pequeños (encima van las espirales) y la boca ondula
      const onda = 2.5 * Math.cos(t / 80);
      return iguales(ojo(3, 1.5, 1.5), boca(18, onda, onda, 0, 0, 3));
    }
    case "hablando": {
      const a = 1.5 + Math.abs(Math.sin(t / 48)) * 3.5;
      return iguales(OJO_NORMAL, boca(9, -a, a, 0, 0, 3));
    }
    case "musica": {
      if (!musica) return iguales(OJO_FELIZ, bocaMusical({ intensidad: 0.5, momento: null }));
      // Los ojos, según el paso de baile; la boca, cerrada, según la canción (bocaMusical)
      const formas: Record<OjosBaile, Ojo> = {
        felices: OJO_FELIZ,
        cerrados: ojo(10.5, 1.2, -1.4, 0, 0, 1),
        abiertos: ojo(10.4, 5, 2.6),
        apretados: ojo(11, 2.6, -2.6, 12),
      };
      let o = ojo(0, 0, 0);
      for (const tipo of Object.keys(formas) as OjosBaile[]) {
        const peso = musica.ojos[tipo];
        const f = formas[tipo];
        o = ojo(o.w + f.w * peso, o.t + f.t * peso, o.b + f.b * peso, o.giro + f.giro * peso, o.dx + f.dx * peso, o.dy + f.dy * peso);
      }
      // Con una canción triste (Jev), los ojos se caen un poco, como cejas tristes, y con una muy
      // triste le tiembla el labio, como a punto de llorar
      let b = musica.boca;
      if (musica.tono !== undefined) {
        const tristeza = limitar((1.5 - musica.tono) / 1.5, 0, 1);
        o = { ...o, giro: o.giro - 14 * tristeza, dy: o.dy + tristeza };
        const tiembla = Math.sin(t / 70) * 0.5 * limitar((1 - musica.tono) / 1, 0, 1);
        if (tiembla) b = { ...b, t: b.t + tiembla, b: b.b - tiembla };
      }
      return iguales(o, b);
    }
    case "silba":
      return iguales(ojo(8.4, 4.2, 4.2, 0, 0, -1), boca(5.2, -2.6, 2.6, 0, 2, 3));
    case "dormido": {
      const r = 1.5 + Math.abs(Math.sin(t / 400)) * 1.5;
      return iguales(OJO_CERRADO, boca(r * 2, -r, r, 0, 0, 2));
    }
    case "guino": {
      // Un ojo se cierra poco a poco en "^" y la boca hace una sonrisa pícara torcida
      const g = progreso;
      const c = g < 0.15 ? suave(g / 0.15) : g < 0.62 ? 1 : 1 - suave(Math.min(1, (g - 0.62) / 0.2));
      return {
        izq: ojo(9.2 + c * 0.8, 4.6 + c * 0.4, 4.6 + c * 0.4, 0, 0, -c * 0.6),
        der: mezclarObj(OJO_NORMAL, ojo(12, 3.5, -2.4, -6), c),
        boca: boca(16 + c, 6 + c, 6 + c, -12 * c, c, -c),
      };
    }
    default:
      return iguales(OJO_NORMAL, SONRISA);
  }
}

/** Contorno de dos curvas entre (-w/2, 0) y (w/2, 0): la de arriba pasa por (0, arriba) y la de abajo por (0, abajo). */
function contorno(w: number, arriba: number, abajo: number): string {
  const a = w / 2;
  return (
    `M${n(-a)} 0` +
    `C${n(-a)} ${n(arriba * K)} ${n(-a * K)} ${n(arriba)} 0 ${n(arriba)}` +
    `C${n(a * K)} ${n(arriba)} ${n(a)} ${n(arriba * K)} ${n(a)} 0` +
    `C${n(a)} ${n(abajo * K)} ${n(a * K)} ${n(abajo)} 0 ${n(abajo)}` +
    `C${n(-a * K)} ${n(abajo)} ${n(-a)} ${n(abajo * K)} ${n(-a)} 0Z`
  );
}

/** Forma rellena con trazo grueso y brillo (el trazo hace que una forma plana se vea como una línea). */
function forma(d: string, x: number, y: number, giro: number, c: string): string {
  const pieza = `<path d="${d}" fill="${c}" stroke="${c}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
  const brillo = `<path d="${d}" fill="none" stroke="${c}" stroke-opacity=".2" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>`;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(giro)})">${brillo}${pieza}</g>`;
}

/** Dibuja ojos y boca a partir de los rasgos y la pose. */
export function dibujarCara(r: Rasgos, p: Pose, c: string): string {
  const cierre = limitar(p.parpadeo, 0, 1) * 0.9;
  const parpadear = (o: Ojo): Ojo => ({ ...o, t: o.t + (Math.min(o.t, 0.6) - o.t) * cierre, b: o.b + (Math.min(o.b, 0.6) - o.b) * cierre });
  const pintarOjo = (o: Ojo, base: { x: number; y: number }) => {
    const q = parpadear(o);
    // Las curvas: hacia arriba la de arriba (negativa en SVG), hacia abajo la de abajo
    return forma(contorno(q.w, -q.t, q.b), base.x + q.dx + p.miraX, base.y + q.dy + p.miraY + p.salto, q.giro, c);
  };
  const bo = r.boca;
  const boca = forma(
    contorno(bo.w, bo.t, bo.b),
    BOCA.x + bo.dx + p.miraX * 0.4,
    BOCA.y + bo.dy + p.miraY * 0.4 + p.salto,
    bo.giro,
    c,
  );
  return `<g transform="rotate(${n(p.giro)} 32 32)">${pintarOjo(r.izq, OJO_IZQ)}${pintarOjo(r.der, OJO_DER)}${boca}</g>`;
}

// ---------- Extras (no se transforman: aparecen y desaparecen con un fundido) ----------
// Los que salen fuera del compañero llevan un borde fino oscuro para verse sobre fondos claros.

const BORDE = "#0B0B0C";
/** Grosor del borde que se ve por fuera, en px (con el tamaño mediano). */
const GROSOR_BORDE = 0.45;
/** Relleno con borde fino oscuro por fuera (el borde se pinta debajo del relleno: solo asoma la mitad). */
const conBorde = (c: string) =>
  `fill="${c}" stroke="${BORDE}" stroke-width="${n(GROSOR_BORDE * 2)}" stroke-linejoin="round" paint-order="stroke"`;

function espiral(x: number, y: number, giro: number, c: string): string {
  let d = "";
  for (let i = 0; i <= 20; i++) {
    const a = giro + i * 0.55;
    const r = 0.4 + i * 0.27;
    d += `${i ? "L" : "M"}${n(x + Math.cos(a) * r)} ${n(y + Math.sin(a) * r)}`;
  }
  return `<path d="${d}" stroke="${c}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
}

const estrellaD = (x: number, y: number, s: number) =>
  `M${n(x)} ${n(y - 6 * s)} Q${n(x + 1.2 * s)} ${n(y - 1.2 * s)} ${n(x + 6 * s)} ${n(y)} Q${n(x + 1.2 * s)} ${n(y + 1.2 * s)} ${n(x)} ${n(y + 6 * s)} Q${n(x - 1.2 * s)} ${n(y + 1.2 * s)} ${n(x - 6 * s)} ${n(y)} Q${n(x - 1.2 * s)} ${n(y - 1.2 * s)} ${n(x)} ${n(y - 6 * s)} Z`;
const estrella = (x: number, y: number, s: number, c: string) => `<path d="${estrellaD(x, y, s)}" ${conBorde(c)}/>`;

/** Notita musical que sube y se desvanece (k de 0 a 1). El palo lleva una línea oscura debajo como borde. */
const nota = (x: number, y: number, k: number, c: string) =>
  `<g opacity="${n(1 - k)}" transform="translate(${n(x + k * 10)} ${n(y - k * 26)})">` +
  `<path d="M0 0v-9l6-2v9" stroke="${BORDE}" stroke-width="${n(2 + GROSOR_BORDE * 2)}" stroke-linejoin="round" fill="none"/>` +
  `<circle cx="-1.5" cy="0" r="${n(2 + GROSOR_BORDE)}" fill="${BORDE}"/><circle cx="4.5" cy="-2" r="${n(2 + GROSOR_BORDE)}" fill="${BORDE}"/>` +
  `<path d="M0 0v-9l6-2v9" stroke="${c}" stroke-width="2" stroke-linejoin="round" fill="none"/>` +
  `<circle cx="-1.5" cy="0" r="2" fill="${c}"/><circle cx="4.5" cy="-2" r="2" fill="${c}"/></g>`;

/** Lo que sale con la música: notas de tres formas o, en una canción de amor, corazones (rotos
 * si además es triste: desamor). */
type Particula = "negra" | "corchea" | "doble" | "corazon" | "roto";
/** Desde esta probabilidad (Jev) se trata como canción de amor; por debajo de este tono, desamor. */
const AMOR = 0.6;
const TONO_DESAMOR = 1.5;

function formaParticula(variante: number, amor = 0, tono = 2): Particula {
  if (amor >= AMOR) {
    if (tono < TONO_DESAMOR) return variante < 0.45 ? "roto" : "negra";
    return variante < 0.7 ? "corazon" : variante < 0.85 ? "corchea" : "doble";
  }
  return variante < 0.35 ? "corchea" : variante < 0.7 ? "doble" : "negra";
}

/** Trazo de una nota con su borde oscuro debajo. */
const trazoNota = (d: string, c: string) =>
  `<path d="${d}" stroke="${BORDE}" stroke-width="${n(2 + GROSOR_BORDE * 2)}" stroke-linejoin="round" stroke-linecap="round" fill="none"/>` +
  `<path d="${d}" stroke="${c}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" fill="none"/>`;
const cabezaNota = (x: number, y: number, c: string) =>
  `<circle cx="${x}" cy="${y}" r="${n(2 + GROSOR_BORDE)}" fill="${BORDE}"/><circle cx="${x}" cy="${y}" r="2" fill="${c}"/>`;
const CORAZON = "M1.5 -0.5C-3.5 -3.5 -3 -9.5 1.5 -7C6 -9.5 6.5 -3.5 1.5 -0.5Z";
// Las dos mitades de un corazón roto, cortadas en zigzag
const CORAZON_IZQ = "M1.5 -0.5C-3.5 -3.5 -3 -9.5 1.5 -7L0.6 -5L2.2 -3.4Z";
const CORAZON_DER = "M1.5 -0.5C6.5 -3.5 6 -9.5 1.5 -7L0.6 -5L2.2 -3.4Z";

/** El dibujo de cada forma (k de 0 a 1: el corazón roto se va separando). */
function dibujoParticula(forma: Particula, k: number, c: string): string {
  switch (forma) {
    case "negra":
      return trazoNota("M0 0v-9", c) + cabezaNota(-1.5, 0, c);
    case "corchea":
      return trazoNota("M0 0v-9c2 1 3.5 2.5 3 5.5", c) + cabezaNota(-1.5, 0, c);
    case "doble":
      return trazoNota("M0 0v-9l6-2v9", c) + cabezaNota(-1.5, 0, c) + cabezaNota(4.5, -2, c);
    case "corazon":
      return `<path d="${CORAZON}" ${conBorde(c)}/>`;
    case "roto": {
      const s = k * 2.5;
      const g = k * 14;
      return (
        `<path d="${CORAZON_IZQ}" ${conBorde(c)} transform="translate(${n(-s)} 0) rotate(${n(-g)} 1.5 -0.5)"/>` +
        `<path d="${CORAZON_DER}" ${conBorde(c)} transform="translate(${n(s)} 0) rotate(${n(g)} 1.5 -0.5)"/>`
      );
    }
  }
}

/** Una notita (o corazón) que sube meciéndose, con un pequeño «pop» al salir, y se desvanece. */
function particula(nt: MusicaPose["notas"][number], t: number, c: string, forma: Particula): string {
  const k = (t - nt.nace) / nt.vida;
  const [x0, y0] = nt.lado > 0 ? [58, 30] : [-4, 26];
  // Pop al salir: crece un poco de más y vuelve
  const pop = k < 0.12 ? suave(k / 0.12) * 1.15 : k < 0.2 ? 1.15 - ((k - 0.12) / 0.08) * 0.15 : 1;
  const x = x0 + nt.lado * k * 8 + Math.sin(k * Math.PI * 2 + nt.giro * 3) * 3 * nt.meceo;
  const y = y0 - k * 28 * (0.85 + nt.tam * 0.2);
  const giro = nt.giro * 12 + Math.sin(k * Math.PI * 2) * 10 * nt.meceo;
  const opacidad = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  return (
    `<g opacity="${n(opacidad)}" transform="translate(${n(x)} ${n(y)}) rotate(${n(giro)}) scale(${n(nt.tam * pop)})">` +
    dibujoParticula(forma, k, c) +
    `</g>`
  );
}

/** Canción muy triste: cada pocos segundos resbala una lágrima del ojo izquierdo. */
function lagrima(t: number, p: Pose, c: string): string {
  if (!p.musica?.lagrima) return "";
  const k = (t % 5200) / 2200;
  if (k >= 1) return "";
  // Redonda: se forma en el ojo (crece un poco) y luego cae
  const x = OJO_IZQ.x - 4 + p.miraX;
  const y = OJO_IZQ.y + 8.6 + p.miraY + p.salto + k * 12;
  const r = 2 * (k < 0.15 ? 0.45 + 0.55 * suave(k / 0.15) : 1);
  return `<g transform="rotate(${n(limitar(p.giro, -80, 80))} 32 32)" opacity="${n(Math.min(1, (1 - k) * 2))}"><circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" ${conBorde(c)}/></g>`;
}

/** Puño en alto: solo un círculo (como las otras manitas) junto a la cabeza, que sube con cada
 * pulso (golpe de 1 a 0). */
function puno(golpe: number | undefined, c: string): string {
  if (golpe === undefined) return "";
  return `<circle cx="68" cy="${n(6 - golpe * 5)}" r="4.4" ${conBorde(c)}/>`;
}

/** Dónde está la pelotita al jugar (bota sobre la cabeza, de un lado a otro). */
export function pelota(t: number): { x: number; y: number; altura: number } {
  const ciclo = t / 520;
  const altura = Math.abs(Math.sin(ciclo * Math.PI));
  return { x: 32 + Math.sin(ciclo * 0.5 * Math.PI) * 10, y: -1 - altura * 15, altura };
}

/** Lo que acompaña a una expresión y no forma parte de los ojos ni la boca. */
export function dibujarExtras(expresion: Expresion, t: number, progreso: number, p: Pose, c: string): string {
  switch (expresion) {
    case "mareado":
      return `<g transform="rotate(${n(limitar(p.giro, -80, 80))} 32 32)">${espiral(OJO_IZQ.x + p.miraX, OJO_IZQ.y + p.miraY, t / 65, c)}${espiral(OJO_DER.x + p.miraX, OJO_DER.y + p.miraY, t / 65, c)}</g>`;
    case "celebra": {
      let s = "";
      for (let i = 0; i < 5; i++) {
        const a = t / 400 + i * 1.256;
        const r = 40 + Math.sin(t / 160 + i) * 3;
        s += estrella(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 0.6, c);
      }
      return s;
    }
    case "saludo": {
      // La mano: solo un círculo que se balancea de un lado a otro junto a la cara
      const a = Math.sin(t / 45) * 28;
      return `<g transform="translate(66 38) rotate(${n(a)})"><circle cx="0" cy="-13" r="4.2" ${conBorde(c)}/></g>`;
    }
    case "guino": {
      if (progreso <= 0.12 || progreso >= 0.75) return "";
      const q = (progreso - 0.12) / 0.63;
      return estrella(OJO_DER.x + p.miraX + 15 + q * 4, OJO_DER.y - 10 - q * 6, Math.sin(q * Math.PI) * 0.9, c);
    }
    case "preocupado": {
      const k = (t % 1600) / 1600;
      return `<path d="M53 ${n(12 + k * 8)}c2.2 3 3.4 4.5 3.4 6a3.4 3.4 0 0 1-6.8 0c0-1.5 1.2-3 3.4-6z" fill="#7FB8FF" stroke="${BORDE}" stroke-width="${n(GROSOR_BORDE * 2)}" paint-order="stroke" opacity="${n(1 - k * 0.6)}"/>`;
    }
    case "pensativo":
      return `<circle cx="62" cy="10" r="2.2" ${conBorde(c)}/><circle cx="69" cy="3" r="3.2" ${conBorde(c)}/>`;
    case "notificacion": {
      // Un «!» que da saltitos junto a la cabeza: hay algo que mirar
      const y = 8 - Math.abs(Math.sin(t / 220)) * 3;
      return (
        `<path d="M62 ${n(y - 9)}v6.5" stroke="${BORDE}" stroke-width="${n(3 + GROSOR_BORDE * 2)}" stroke-linecap="round"/>` +
        `<path d="M62 ${n(y - 9)}v6.5" stroke="${c}" stroke-width="3" stroke-linecap="round"/>` +
        `<circle cx="62" cy="${n(y + 2)}" r="${n(1.6 + GROSOR_BORDE)}" fill="${BORDE}"/><circle cx="62" cy="${n(y + 2)}" r="1.6" fill="${c}"/>`
      );
    }
    case "curioso": {
      // Un interrogante que aparece con un saltito y se balancea
      const s = Math.min(1, progreso / 0.12);
      const a = Math.sin(t / 260) * 10;
      const q = "M-2.6 -3.4a2.8 2.8 0 1 1 3.8 2.6c-1 .5-1.2 1-1.2 2.2";
      return (
        `<g transform="translate(60 9) rotate(${n(a)}) scale(${n(s)})">` +
        `<path d="${q}" stroke="${BORDE}" stroke-width="${n(2.4 + GROSOR_BORDE * 2)}" stroke-linecap="round" fill="none"/>` +
        `<path d="${q}" stroke="${c}" stroke-width="2.4" stroke-linecap="round" fill="none"/>` +
        `<circle cx="0" cy="5" r="1.4" ${conBorde(c)}/></g>`
      );
    }
    case "nose": {
      // Las manitas suben a los lados, con las palmas arriba
      const k = Math.sin(limitar(progreso, 0, 1) * Math.PI);
      const y = 52 - k * 14;
      return `<circle cx="${n(-3 - k * 2)}" cy="${n(y)}" r="4.2" ${conBorde(c)}/><circle cx="${n(67 + k * 2)}" cy="${n(y)}" r="4.2" ${conBorde(c)}/>`;
    }
    case "juega": {
      // Una pelotita que bota sobre su cabeza
      const { x, y } = pelota(t);
      return `<circle cx="${n(x)}" cy="${n(y)}" r="4" ${conBorde("#FF8A3D")}/>`;
    }
    case "lupa": {
      // La lupa delante del ojo derecho, siguiendo la mirada
      const x = OJO_DER.x + p.miraX;
      const y = OJO_DER.y + p.miraY + p.salto;
      return (
        `<g transform="rotate(${n(limitar(p.giro, -80, 80))} 32 32)">` +
        `<path d="M${n(x + 6.5)} ${n(y + 6.5)}l7 7" stroke="${BORDE}" stroke-width="${n(3.6 + GROSOR_BORDE * 2)}" stroke-linecap="round"/>` +
        `<path d="M${n(x + 6.5)} ${n(y + 6.5)}l7 7" stroke="${c}" stroke-width="3.6" stroke-linecap="round"/>` +
        `<circle cx="${n(x)}" cy="${n(y)}" r="9" fill="none" stroke="${BORDE}" stroke-width="${n(2.2 + GROSOR_BORDE * 2)}"/>` +
        `<circle cx="${n(x)}" cy="${n(y)}" r="9" fill="none" stroke="${c}" stroke-width="2.2"/></g>`
      );
    }
    case "otea": {
      // La mano de visera: plana, sobre el ojo del lado hacia el que mira, saliendo por el borde
      const lado = p.miraX >= 0 ? 1 : -1;
      const ojoLado = lado > 0 ? OJO_DER : OJO_IZQ;
      const x = ojoLado.x + p.miraX + lado * 4;
      const y = ojoLado.y + p.miraY - 8 + Math.sin(t / 300) * 0.5;
      return `<g transform="rotate(${n(limitar(p.giro, -80, 80))} 32 32)"><rect x="${n(x - 9)}" y="${n(y - 3)}" width="18" height="6" rx="3" transform="rotate(${-lado * 12} ${n(x)} ${n(y)})" ${conBorde(c)}/></g>`;
    }
    case "asoma": {
      // Puntos suspensivos que aparecen uno tras otro
      let r = "";
      const k = (t % 1800) / 600;
      for (let i = 0; i < 3; i++) {
        if (k >= i) r += `<circle cx="${50 + i * 5}" cy="6" r="1.6" ${conBorde(c)}/>`;
      }
      return r;
    }
    case "frustrado": {
      // Resopla: nubecitas que salen por arriba y se desvanecen
      let r = "";
      for (let i = 0; i < 2; i++) {
        const k = ((t + i * 450) % 900) / 900;
        r += `<circle cx="${n(54 + k * 6 + i * 4)}" cy="${n(10 - k * 8)}" r="${n(1.6 + k * 2)}" ${conBorde(c)} opacity="${n(1 - k)}"/>`;
      }
      return r;
    }
    case "impresionado":
    {
      // Brillos dentro de los ojos y destellos a los lados
      const brillo = (o: { x: number; y: number }) =>
        `<path d="${estrellaD(o.x + p.miraX + 1.6, o.y + p.miraY + p.salto - 1.6, 0.42 + Math.sin(t / 140) * 0.08)}" fill="${BORDE}"/>`;
      const g = `<g transform="rotate(${n(limitar(p.giro, -80, 80))} 32 32)">${brillo(OJO_IZQ)}${brillo(OJO_DER)}</g>`;
      return g + estrella(2, 10, 0.6 + Math.sin(t / 120) * 0.2, c) + estrella(62, 6, 0.6 + Math.cos(t / 120) * 0.2, c);
    }
    case "musica":
      if (p.musica) {
        // Notitas (o corazones) que salen con los golpes de la canción, cada una a su manera
        const { amor, tono } = p.musica;
        const notas = p.musica.notas
          .filter((nt) => t >= nt.nace && t < nt.nace + nt.vida)
          .map((nt) => particula(nt, t, c, formaParticula(nt.variante, amor, tono)))
          .join("");
        return notas + lagrima(t, p, c) + puno(p.musica.puno, c);
      }
      return nota(58, 30, (t % 1800) / 1800, c) + nota(-4, 26, ((t + 900) % 1800) / 1800, c);
    case "silba":
      return nota(58, 30, (t % 2000) / 2000, c);
    case "dormido": {
      const k = (t % 1800) / 1800;
      return `<text x="56" y="${n(6 - k * 15)}" ${conBorde(c)} opacity="${n(1 - k)}" font-size="12" font-weight="600" font-family="Segoe UI, sans-serif">z</text>`;
    }
    default:
      return "";
  }
}
