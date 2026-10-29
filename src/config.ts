// Ventana de configuración: cada cambio se guarda al momento y se avisa al compañero.
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  AGUA_POR_DEFECTO,
  CLIMA_POR_DEFECTO,
  GLOBOS_POR_DEFECTO,
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
  type ConfigPausas,
  type ConfigPomodoro,
  type ConfigSonido,
} from "./ajustes";
import { buscarCiudad, type Lugar } from "./estado/clima";
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
} = {
  pomodoro: await leer("pomodoroConfig", POMODORO_POR_DEFECTO),
  agua: await leer("aguaConfig", AGUA_POR_DEFECTO),
  pausas: { ...PAUSAS_POR_DEFECTO, ...(await leer<Partial<ConfigPausas>>("pausasConfig", {})) },
  sonido: { ...SONIDO_POR_DEFECTO, ...(await leer<Partial<ConfigSonido>>("sonidoConfig", {})) },
  companero: { ...COMPANERO_POR_DEFECTO, ...(await leer<Partial<ConfigCompanero>>("companeroConfig", {})) },
  clima: { ...CLIMA_POR_DEFECTO, ...(await leer<Partial<ConfigClima>>("climaConfig", {})) },
  globos: { ...GLOBOS_POR_DEFECTO, ...(await leer<Partial<ConfigGlobos>>("globosConfig", {})) },
};
const CLAVES: Record<keyof typeof grupos, string> = {
  pomodoro: "pomodoroConfig",
  agua: "aguaConfig",
  pausas: "pausasConfig",
  sonido: "sonidoConfig",
  companero: "companeroConfig",
  clima: "climaConfig",
  globos: "globosConfig",
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
