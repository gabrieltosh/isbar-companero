// Ventana de configuración: cada cambio se guarda al momento y se avisa al compañero.
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  AGUA_POR_DEFECTO,
  COLORES_COMPANERO,
  COMPANERO_POR_DEFECTO,
  EVENTO_AJUSTES,
  PAUSAS_POR_DEFECTO,
  POMODORO_POR_DEFECTO,
  SONIDO_POR_DEFECTO,
  TAMANOS_COMPANERO,
  type ConfigAgua,
  type ConfigCompanero,
  type ConfigPausas,
  type ConfigPomodoro,
  type ConfigSonido,
} from "./ajustes";
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
} = {
  pomodoro: await leer("pomodoroConfig", POMODORO_POR_DEFECTO),
  agua: await leer("aguaConfig", AGUA_POR_DEFECTO),
  pausas: { ...PAUSAS_POR_DEFECTO, ...(await leer<Partial<ConfigPausas>>("pausasConfig", {})) },
  sonido: { ...SONIDO_POR_DEFECTO, ...(await leer<Partial<ConfigSonido>>("sonidoConfig", {})) },
  companero: { ...COMPANERO_POR_DEFECTO, ...(await leer<Partial<ConfigCompanero>>("companeroConfig", {})) },
};
const CLAVES: Record<keyof typeof grupos, string> = {
  pomodoro: "pomodoroConfig",
  agua: "aguaConfig",
  pausas: "pausasConfig",
  sonido: "sonidoConfig",
  companero: "companeroConfig",
};

async function guardarGrupo(grupo: keyof typeof grupos): Promise<void> {
  await guardar(CLAVES[grupo], grupos[grupo]);
  await emit(EVENTO_AJUSTES);
}

// ---------- Campos numéricos, rangos e interruptores ----------

function pintarValores(): void {
  $(document, "#v-volumen").textContent = `${Math.round(grupos.sonido.volumen * 100)} %`;
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
