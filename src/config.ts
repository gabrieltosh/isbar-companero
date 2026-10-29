// Ventana de configuración: cada cambio se guarda al momento y se avisa al compañero.
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  AGUA_POR_DEFECTO,
  CLIMA_POR_DEFECTO,
  GLOBOS_POR_DEFECTO,
  JEV_POR_DEFECTO,
  COLORES_COMPANERO,
  COMPANERO_POR_DEFECTO,
  ESCENAS_PRUEBA,
  EVENTO_AJUSTES,
  EVENTO_PROBAR_ESCENA,
  PARAR_PRUEBA,
  PAUSAS_POR_DEFECTO,
  POMODORO_POR_DEFECTO,
  SONIDO_POR_DEFECTO,
  TAMANOS_COMPANERO,
  type ConfigAgua,
  type ConfigClima,
  type ConfigCompanero,
  type ConfigGlobos,
  type ConfigJev,
  type ConfigPausas,
  type ConfigPomodoro,
  type ConfigSonido,
} from "./ajustes";
import { buscarCiudad, type Lugar } from "./estado/clima";
import { NOTIFICACIONES_EJEMPLO, importanciaNotificacion, preguntarJev } from "./estado/jev";
import { campanita } from "./sonido";
import { guardar, leer } from "./store";
import { $, escapar } from "./util";

// Cada grupo de campos se guarda bajo su clave del store
const grupos: {
  pomodoro: ConfigPomodoro;
  agua: ConfigAgua;
  pausas: ConfigPausas;
  sonido: ConfigSonido;
  companero: ConfigCompanero;
  clima: ConfigClima;
  globos: ConfigGlobos;
  jev: ConfigJev;
} = {
  pomodoro: await leer("pomodoroConfig", POMODORO_POR_DEFECTO),
  agua: await leer("aguaConfig", AGUA_POR_DEFECTO),
  pausas: { ...PAUSAS_POR_DEFECTO, ...(await leer<Partial<ConfigPausas>>("pausasConfig", {})) },
  sonido: { ...SONIDO_POR_DEFECTO, ...(await leer<Partial<ConfigSonido>>("sonidoConfig", {})) },
  companero: { ...COMPANERO_POR_DEFECTO, ...(await leer<Partial<ConfigCompanero>>("companeroConfig", {})) },
  clima: { ...CLIMA_POR_DEFECTO, ...(await leer<Partial<ConfigClima>>("climaConfig", {})) },
  globos: { ...GLOBOS_POR_DEFECTO, ...(await leer<Partial<ConfigGlobos>>("globosConfig", {})) },
  jev: { ...JEV_POR_DEFECTO, ...(await leer<Partial<ConfigJev>>("jevConfig", {})) },
};
const CLAVES: Record<keyof typeof grupos, string> = {
  pomodoro: "pomodoroConfig",
  agua: "aguaConfig",
  pausas: "pausasConfig",
  sonido: "sonidoConfig",
  companero: "companeroConfig",
  clima: "climaConfig",
  globos: "globosConfig",
  jev: "jevConfig",
};

async function guardarGrupo(grupo: keyof typeof grupos): Promise<void> {
  await guardar(CLAVES[grupo], grupos[grupo]);
  await emit(EVENTO_AJUSTES);
}

// ---------- Campos numéricos, rangos e interruptores ----------

function pintarValores(): void {
  $(document, "#v-volumen").textContent = `${Math.round(grupos.sonido.volumen * 100)} %`;
  const opacidad = Math.round(grupos.companero.opacidad * 100);
  $(document, "#v-opacidad").textContent = opacidad >= 100 ? "Sólido" : `${opacidad} %`;
}

document.querySelectorAll<HTMLInputElement>("[data-campo]").forEach((input) => {
  const [grupo, campo] = (input.dataset.campo ?? "").split(".") as [keyof typeof grupos, string];
  const datos = grupos[grupo] as unknown as Record<string, number | boolean>;
  const factor = Number(input.dataset.factor ?? 1);

  if (input.type === "checkbox") input.checked = Boolean(datos[campo]);
  else input.value = String(Number(datos[campo]) / factor);

  // Los rangos guardan al soltar; los números, al confirmar el valor
  input.addEventListener(input.type === "range" ? "input" : "change", () => {
    if (input.type === "checkbox") {
      datos[campo] = input.checked;
    } else {
      const valor = Number(input.value);
      if (!Number.isFinite(valor) || !input.checkValidity()) {
        input.value = String(Number(datos[campo]) / factor);
        return;
      }
      datos[campo] = Math.round(valor * factor * 100) / 100;
    }
    pintarValores();
    void guardarGrupo(grupo);
  });
});

pintarValores();

// Escuchar el aviso de pausa con el volumen elegido
$(document, "#probar-sonido").addEventListener("click", () => campanita(grupos.sonido.volumen));

// ---------- Compañero ----------

/** Rellena un selector con sus opciones y guarda el valor elegido en el compañero. */
function selectorCompanero(id: string, opciones: [string, string][], valor: string, fijar: (v: string) => void): void {
  const selector = $<HTMLSelectElement>(document, id);
  selector.innerHTML = opciones
    .map(([v, nombre]) => `<option value="${v}">${escapar(nombre)}</option>`)
    .join("");
  selector.value = valor;
  selector.addEventListener("change", () => {
    fijar(selector.value);
    void guardarGrupo("companero");
  });
}

selectorCompanero("#companero-color", COLORES_COMPANERO, grupos.companero.color, (v) => {
  grupos.companero.color = v;
});
selectorCompanero("#companero-tamano", TAMANOS_COMPANERO, String(grupos.companero.tamano), (v) => {
  grupos.companero.tamano = Number(v);
});

// ---------- Tiempo ----------
// Se busca la ciudad por su nombre y se guarda su posición; el compañero mira el tiempo allí

const climaCiudad = $(document, "#clima-ciudad");
const climaQuitar = $(document, "#clima-quitar");
const climaBuscar = $<HTMLInputElement>(document, "#clima-buscar");
const climaBoton = $<HTMLButtonElement>(document, "#clima-boton");
const climaFila = $(document, "#clima-fila");
const climaResultados = $<HTMLSelectElement>(document, "#clima-resultados");
let encontrados: Lugar[] = [];

function pintarCiudad(): void {
  climaCiudad.textContent = grupos.clima.ciudad || "Ninguna";
  climaQuitar.hidden = !grupos.clima.ciudad;
}

function elegirCiudad(l: Lugar | null): void {
  grupos.clima = l ? { ciudad: l.nombre, latitud: l.latitud, longitud: l.longitud } : { ...CLIMA_POR_DEFECTO };
  climaFila.hidden = true;
  climaBuscar.value = "";
  pintarCiudad();
  void guardarGrupo("clima");
}

async function buscar(): Promise<void> {
  const nombre = climaBuscar.value.trim();
  if (nombre.length < 2) return;
  climaBoton.disabled = true;
  climaBoton.textContent = "Buscando…";
  try {
    encontrados = await buscarCiudad(nombre);
    if (encontrados.length === 1) {
      elegirCiudad(encontrados[0]);
    } else {
      climaResultados.innerHTML = encontrados.length
        ? `<option value="" disabled selected>${encontrados.length} encontradas</option>` +
          encontrados.map((l, i) => `<option value="${i}">${escapar(l.nombre)}</option>`).join("")
        : `<option value="" disabled selected>No la encuentro</option>`;
      climaFila.hidden = false;
    }
  } catch (e) {
    console.error("clima:", e);
    climaResultados.innerHTML = `<option value="" disabled selected>Sin conexión con Open-Meteo</option>`;
    climaFila.hidden = false;
  } finally {
    climaBoton.disabled = false;
    climaBoton.textContent = "Buscar";
  }
}

climaBoton.addEventListener("click", () => void buscar());
climaBuscar.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void buscar();
});
climaResultados.addEventListener("change", () => {
  const l = encontrados[Number(climaResultados.value)];
  if (l) elegirCiudad(l);
});
climaQuitar.addEventListener("click", () => elegirCiudad(null));
pintarCiudad();

const climaEscena = $<HTMLSelectElement>(document, "#clima-escena");
climaEscena.innerHTML = ESCENAS_PRUEBA.map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join("");
$(document, "#clima-probar").addEventListener("click", () => {
  emit(EVENTO_PROBAR_ESCENA, climaEscena.value).catch(console.error);
});
$(document, "#clima-parar").addEventListener("click", () => {
  emit(EVENTO_PROBAR_ESCENA, PARAR_PRUEBA).catch(console.error);
});

// ---------- Jev ----------

const jevClave = $<HTMLInputElement>(document, "#jev-clave");
const jevEstado = $(document, "#jev-estado");
const jevProbar = $<HTMLButtonElement>(document, "#jev-probar");
jevClave.value = grupos.jev.clave;
jevEstado.textContent = grupos.jev.clave ? "Sin probar" : "Sin clave";
jevClave.addEventListener("change", () => {
  grupos.jev.clave = jevClave.value.trim();
  jevEstado.textContent = grupos.jev.clave ? "Sin probar" : "Sin clave";
  void guardarGrupo("jev");
});

/** Prueba la clave con una pregunta en español: así se ve también si entiende el idioma. */
jevProbar.addEventListener("click", async () => {
  if (!grupos.jev.clave) {
    jevEstado.textContent = "Pega primero la clave";
    return;
  }
  jevProbar.disabled = true;
  jevEstado.textContent = "Probando…";
  try {
    const { modelo, respuestas } = await preguntarJev(
      grupos.jev.clave,
      { mensaje: "¡Mañana hace sol y calor! Perfecto para ir a la playa." },
      {
        bueno: { type: "noul", instructions: "El mensaje dice que mañana hará buen tiempo" },
        lluvia: { type: "noul", instructions: "El mensaje dice que mañana va a llover" },
      },
    );
    const entiende = respuestas.bueno.noul > 0.7 && respuestas.lluvia.noul < 0.3;
    jevEstado.textContent = `Conectado (${modelo})${entiende ? " · entiende español" : " · duda con el español"}`;
  } catch (e) {
    console.error("jev:", e);
    jevEstado.textContent = e instanceof Error ? e.message : "No se pudo conectar";
  } finally {
    jevProbar.disabled = false;
  }
});

// Probar el filtro: Jev clasifica notificaciones inventadas, se ve aquí qué decide con cada una
// y se le pasan al compañero (como si llegaran de Windows) para ver los globos
const jevEjemplos = $(document, "#jev-ejemplos");
const jevEjemplosProbar = $<HTMLButtonElement>(document, "#jev-ejemplos-probar");
const NOMBRE_IMPORTANCIA = { urgente: "Urgente", normal: "Normal", ruido: "Ruido" } as const;
/** Pausa entre las notificaciones que se pasan al compañero. */
const ENTRE_EJEMPLOS_MS = 1500;

jevEjemplosProbar.addEventListener("click", async () => {
  if (!grupos.jev.clave) {
    jevEstado.textContent = "Pega primero la clave";
    return;
  }
  jevEjemplosProbar.disabled = true;
  jevEjemplos.hidden = false;
  jevEjemplos.innerHTML = `<li class="resumen">Preguntando a Jev…</li>`;
  const resultados = await Promise.all(
    NOTIFICACIONES_EJEMPLO.map((n) =>
      importanciaNotificacion(grupos.jev.clave, n).then(
        (r) => ({ n, ...r, error: "" }),
        (e: unknown) => ({ n, importancia: null, confianza: 0, error: e instanceof Error ? e.message : "Error" }),
      ),
    ),
  );
  const aciertos = resultados.filter((r) => r.importancia === r.n.esperado).length;
  jevEjemplos.innerHTML =
    resultados
      .map((r) => {
        const decision = r.importancia
          ? `<b class="${r.importancia === r.n.esperado ? "bien" : "mal"}">${NOMBRE_IMPORTANCIA[r.importancia]} · ${Math.round(r.confianza * 100)} %</b>`
          : `<b class="mal">${escapar(r.error)}</b>`;
        return `<li><div>${escapar(r.n.titulo)}<small>${escapar(r.n.app)} · ${escapar(r.n.texto)}</small></div>${decision}</li>`;
      })
      .join("") +
    `<li class="resumen">${aciertos} de ${resultados.length} como se esperaba (en naranja, las que no). Con menos del 55 % de confianza, el compañero las trata como normales.</li>`;
  jevEjemplosProbar.disabled = false;
  if (!grupos.jev.activo || !grupos.jev.notificaciones) {
    jevEstado.textContent = "Activa «Usar Jev» y el filtro para ver los globos";
    return;
  }
  // Al compañero, una tras otra (con ids negativos: no existen en Windows)
  NOTIFICACIONES_EJEMPLO.forEach((n, i) => {
    window.setTimeout(() => {
      void emit("notification-new", { id: -(i + 1), app: n.app, icono: null, titulo: n.titulo, texto: n.texto });
    }, i * ENTRE_EJEMPLOS_MS);
  });
});

// ---------- Notificaciones de Windows ----------

$(document, "#ajustes-banners").addEventListener("click", () => {
  invoke("abrir_ajustes_banners").catch(console.error);
});

// ---------- Inicio con Windows ----------
// Rust decide cómo: tarea de inicio del paquete (Microsoft Store) o clave Run (sin paquete)

const autoarranque = $<HTMLInputElement>(document, "#autoarranque");
autoarranque.checked = await invoke<boolean>("autoarranque_activo").catch(() => false);
autoarranque.addEventListener("change", async () => {
  try {
    // Windows puede no permitirlo (p. ej. si se desactivó desde el Administrador de tareas)
    autoarranque.checked = await invoke<boolean>("autoarranque_fijar", { activo: autoarranque.checked });
  } catch (e) {
    console.error("autoarranque:", e);
    autoarranque.checked = !autoarranque.checked;
  }
});
