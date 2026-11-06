// Persistencia local con tauri-plugin-store, en la carpeta de datos de la app. Casi todo va en
// isla.json; lo que ocupa más (lo aprendido de las canciones) va en su propio archivo.
import { load, type Store } from "@tauri-apps/plugin-store";

const almacenes = new Map<string, Promise<Store>>();

function abrir(archivo: string): Promise<Store> {
  let almacen = almacenes.get(archivo);
  if (!almacen) {
    almacen = load(archivo, { autoSave: 300, defaults: {} });
    almacenes.set(archivo, almacen);
  }
  return almacen;
}

export async function leer<T>(clave: string, porDefecto: T, archivo = "isla.json"): Promise<T> {
  try {
    const valor = await (await abrir(archivo)).get<T>(clave);
    return valor ?? porDefecto;
  } catch (e) {
    console.error("store:", e);
    return porDefecto;
  }
}

export async function guardar(clave: string, valor: unknown, archivo = "isla.json"): Promise<void> {
  try {
    await (await abrir(archivo)).set(clave, valor);
  } catch (e) {
    console.error("store:", e);
  }
}
