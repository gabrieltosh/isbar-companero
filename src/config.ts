// Ventana de configuración: cada cambio se guarda al momento y se avisa a la isla.
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  AGUA_POR_DEFECTO,
  COLORES_COMPANERO,
  COMPANERO_POR_DEFECTO,
  EVENTO_AJUSTES,
  NOMBRES_VISTAS,
  PAUSAS_POR_DEFECTO,
  POMODORO_POR_DEFECTO,
  SONIDO_POR_DEFECTO,
  TAMANOS_COMPANERO,
  leerAjustes,
  type Ajustes,
  type Estilo,
  type ConfigAgua,
  type ConfigCompanero,
  type ConfigPausas,
  type ConfigPomodoro,
  type ConfigSonido,
} from "./ajustes";
import { campanita } from "./sonido";
import { guardar, leer } from "./store";
import { $, escapar } from "./util";

interface InfoMonitor {
  nombre: string;
  etiqueta: string;
}

// Cada grupo de campos se guarda bajo su clave del store
const grupos: {
  ajustes: Ajustes;
  pomodoro: ConfigPomodoro;
  agua: ConfigAgua;
  pausas: ConfigPausas;
  sonido: ConfigSonido;
  companero: ConfigCompanero;
} = {
  ajustes: await leerAjustes(),
  pomodoro: await leer("pomodoroConfig", POMODORO_POR_DEFECTO),
  agua: await leer("aguaConfig", AGUA_POR_DEFECTO),
  pausas: { ...PAUSAS_POR_DEFECTO, ...(await leer<Partial<ConfigPausas>>("pausasConfig", {})) },
  sonido: { ...SONIDO_POR_DEFECTO, ...(await leer<Partial<ConfigSonido>>("sonidoConfig", {})) },
  companero: { ...COMPANERO_POR_DEFECTO, ...(await leer<Partial<ConfigCompanero>>("companeroConfig", {})) },
};
const CLAVES: Record<keyof typeof grupos, string> = {
  ajustes: "ajustes",
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

// ---------- Vistas ----------

const listaVistas = $(document, "#vistas");

function pintarVistas(): void {
  const { vistas, ocultas } = grupos.ajustes;
  listaVistas.innerHTML = vistas
    .map(
      (id, i) => `<li data-id="${id}">
        <label><input type="checkbox" ${ocultas.includes(id) ? "" : "checked"} /> ${escapar(NOMBRES_VISTAS[id] ?? id)}</label>
        <button data-mover="-1" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
        <button data-mover="1" ${i === vistas.length - 1 ? "disabled" : ""} aria-label="Bajar">↓</button>
      </li>`,
    )
    .join("");
}

listaVistas.addEventListener("change", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
  if (!id) return;
  const { vistas, ocultas } = grupos.ajustes;
  const ocultar = !ocultas.includes(id);
  // Siempre tiene que quedar al menos una vista activa
  if (ocultar && ocultas.length >= vistas.length - 1) {
    pintarVistas();
    return;
  }
  grupos.ajustes.ocultas = ocultar ? [...ocultas, id] : ocultas.filter((o) => o !== id);
  void guardarGrupo("ajustes");
});

listaVistas.addEventListener("click", (e) => {
  const boton = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-mover]");
  const id = boton?.closest<HTMLElement>("[data-id]")?.dataset.id;
  if (!boton || !id) return;
  const vistas = [...grupos.ajustes.vistas];
  const desde = vistas.indexOf(id);
  const hasta = desde + Number(boton.dataset.mover);
  if (hasta < 0 || hasta >= vistas.length) return;
  [vistas[desde], vistas[hasta]] = [vistas[hasta], vistas[desde]];
  grupos.ajustes.vistas = vistas;
  pintarVistas();
  void guardarGrupo("ajustes");
});

pintarVistas();

// ---------- Campos numéricos, rangos e interruptores ----------

function pintarValores(): void {
  $(document, "#v-escala").textContent = `${Math.round(grupos.ajustes.escala * 100)} %`;
  $(document, "#v-desplazamiento").textContent = `${grupos.ajustes.desplazamiento} px`;
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

// ---------- Estilo ----------

const selectorEstilo = $<HTMLSelectElement>(document, "#estilo");
selectorEstilo.value = grupos.ajustes.estilo;
selectorEstilo.addEventListener("change", () => {
  grupos.ajustes.estilo = selectorEstilo.value as Estilo;
  void guardarGrupo("ajustes");
});

// ---------- Monitor ----------

const selectorMonitor = $<HTMLSelectElement>(document, "#monitor");
const monitores = await invoke<InfoMonitor[]>("listar_monitores").catch(() => []);
selectorMonitor.innerHTML =
  `<option value="">Principal</option>` +
  monitores.map((m) => `<option value="${escapar(m.nombre)}">${escapar(m.etiqueta)}</option>`).join("");
selectorMonitor.value = grupos.ajustes.monitor ?? "";
selectorMonitor.addEventListener("change", () => {
  grupos.ajustes.monitor = selectorMonitor.value || null;
  void guardarGrupo("ajustes");
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
