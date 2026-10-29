// Prueba de Jev con canciones, notificaciones y ventanas reales: hace las mismas preguntas que la app
// (src/estado/jev.ts) y compara con lo esperado. Sirve para comprobar, al cambiar las preguntas,
// que sigue acertando. Se ejecuta con `npm run jev:probar`.
// La clave se toma de TYPESAFE_API_KEY o, si no, de la configuración local de la app (isla.json);
// nunca se muestra. Cada prueba cuesta muy poco (unos cientos de tokens por pregunta).
import { readFileSync } from "node:fs";
import {
  actividadVentana,
  emocionCancion,
  estiloCancion,
  fijarFetchJev,
  importanciaNotificacion,
  NOTIFICACIONES_EJEMPLO,
  VENTANAS_EJEMPLO,
} from "../src/estado/jev";

function claveJev(): string {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try {
    const datos = JSON.parse(readFileSync(`${process.env.APPDATA}/com.isbar.companero/isla.json`, "utf-8"));
    return datos.jevConfig?.clave ?? "";
  } catch {
    return "";
  }
}

const clave = claveJev();
if (!clave) {
  console.error("Falta la clave de Jev: pon TYPESAFE_API_KEY o guárdala en la Configuración de la app.");
  process.exit(1);
}
// Fuera de la app no hay Rust: el fetch normal de Node
fijarFetchJev((url, init) => fetch(url, init));

/** [título tal como lo da el reproductor, artista, ppm, intensidad, tono esperado, energía esperada, estilo esperado] */
type Rango = [number, number];
const CANCIONES: [string, string, number, number, Rango, Rango, string][] = [
  ["Traicionero - En Vivo en el Estadio Único", "La Beriso", 128, 0.8, [0, 1.5], [1.5, 3.5], "rock"],
  ["Someone Like You", "Adele", 68, 0.3, [0, 1.5], [0, 1.5], "balada"],
  ["Hallelujah", "Jeff Buckley", 60, 0.25, [0, 1.5], [0, 1.5], "balada"],
  ["Lamento Boliviano", "Enanitos Verdes", 98, 0.6, [0, 1.5], [1, 3], "rock"],
  ["Don't Look Back in Anger - Remastered", "Oasis", 82, 0.6, [1, 3], [1.5, 3], "rock"],
  ["Take Five", "The Dave Brubeck Quartet", 172, 0.4, [1.5, 3], [0.5, 2.5], "tranquila"],
  ["Despacito", "Luis Fonsi", 89, 0.6, [2.5, 4], [2.5, 4], "fiesta"],
  ["Gasolina", "Daddy Yankee", 96, 0.85, [2.5, 4], [3, 4], "fiesta"],
  ["Happy", "Pharrell Williams", 160, 0.7, [3, 4], [2.5, 4], "pop"],
  ["Highway to Hell", "AC/DC", 116, 0.85, [1.5, 4], [3, 4], "rock"],
  ["Strobe", "deadmau5", 128, 0.5, [1.5, 3], [2.5, 4], "electronica"],
  ["Honey", "Moby", 97, 0.55, [1, 3], [1.5, 3], "electronica"],
];

const coma = (n: number) => n.toFixed(1).replace(".", ",");
const dentro = (v: number, [a, b]: Rango) => v >= a && v <= b;
let aciertos = 0;
let total = 0;

console.log("Canciones (tono 0 muy triste → 4 muy alegre · energía 0 quieta → 4 saltar)\n");
const canciones = await Promise.all(
  CANCIONES.map(async ([titulo, artista, ppm, intensidad, tono, energia, estilo]) => {
    const datos = { titulo, artista, ppm, intensidad };
    const [e, s] = await Promise.all([emocionCancion(clave, datos), estiloCancion(clave, datos)]);
    return { titulo, artista, e, s, tono, energia, estilo };
  }),
);
for (const c of canciones) {
  const ok = [dentro(c.e.tono, c.tono), dentro(c.e.energia, c.energia), c.s.estilo === c.estilo];
  aciertos += ok.filter(Boolean).length;
  total += 3;
  const marca = (b: boolean) => (b ? "✓" : "✗");
  console.log(
    `${marca(ok[0])}${marca(ok[1])}${marca(ok[2])} ${(c.titulo.replace(/ - .*/, "") + " · " + c.artista).padEnd(42)}` +
      ` tono ${coma(c.e.tono)}  energía ${coma(c.e.energia)}  ${c.s.estilo.padEnd(11)} (${Math.round(c.s.confianzaEstilo * 100)} %)` +
      (ok[2] ? "" : `  esperado ${c.estilo}`),
  );
}

console.log("\nNotificaciones\n");
const notificaciones = await Promise.all(NOTIFICACIONES_EJEMPLO.map(async (n) => ({ n, r: await importanciaNotificacion(clave, n) })));
for (const { n, r } of notificaciones) {
  const ok = r.importancia === n.esperado;
  aciertos += Number(ok);
  total += 1;
  console.log(`${ok ? "✓" : "✗"} ${(n.app + " · " + n.titulo).padEnd(48)} ${r.importancia.padEnd(8)} (${Math.round(r.confianza * 100)} %)${ok ? "" : `  esperado ${n.esperado}`}`);
}

console.log("\nQué estás haciendo (ventana activa)\n");
const ventanas = await Promise.all(VENTANAS_EJEMPLO.map(async (v) => ({ v, r: await actividadVentana(clave, v) })));
for (const { v, r } of ventanas) {
  const ok = r.actividad === v.esperado;
  aciertos += Number(ok);
  total += 1;
  console.log(`${ok ? "✓" : "✗"} ${(v.programa + " · " + v.titulo).padEnd(66)} ${r.actividad.padEnd(12)} (${Math.round(r.confianza * 100)} %)${ok ? "" : `  esperado ${v.esperado}`}`);
}

console.log(`\nAciertos: ${aciertos} de ${total}`);
