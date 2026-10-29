// Puente con el panel: el compañero tiene el estado (Pomodoro, agua, pausas, música) y se lo
// manda al panel mientras está abierto; el panel le devuelve órdenes.
import { emit, listen } from "@tauri-apps/api/event";
import { beber, configAgua, mlHoy } from "../estado/agua";
import { cancionAnterior, cancionSiguiente, infoMusica, posicionMusica, reproducirPausar } from "../estado/musica";
import {
  NOMBRE_PAUSA,
  TIPOS_PAUSA,
  cuandoPausa,
  empezarPausa,
  estadoPausas,
  pausaActiva,
  proximaPausa,
} from "../estado/pausas";
import {
  alternarPomodoro,
  cambiarModo,
  duracion,
  estadoPomodoro,
  reiniciarPomodoro,
  restante,
} from "../estado/pomodoro";
import { EVENTO_ESTADO, EVENTO_ORDEN, EVENTO_PEDIR, EVENTO_VISIBLE, type EstadoPanel, type OrdenPanel } from "../panel/tipos";
import { pausarGlobos } from "./globos";
import { gesto } from "./vida";

/** Mientras el panel está abierto, cada cuánto se le manda el estado (relojes, música…). */
const REFRESCO_MS = 500;

let abierto = false;

function foto(): EstadoPanel {
  const p = estadoPomodoro();
  const proximo = TIPOS_PAUSA.filter(pausaActiva).sort((a, b) => proximaPausa(a) - proximaPausa(b))[0];
  const info = infoMusica();
  return {
    pomodoro: { modo: p.modo, corriendo: p.corriendo, restante: restante(), duracion: duracion(p.modo), ciclos: p.ciclos },
    agua: { ml: mlHoy(), meta: configAgua().meta, sorbo: configAgua().sorbo },
    pausas: {
      modo: estadoPausas().modo,
      proxima: proximo
        ? { tipo: proximo, nombre: NOMBRE_PAUSA[proximo], cuando: cuandoPausa(proximaPausa(proximo)) }
        : null,
    },
    musica: info ? { ...info, posicion: posicionMusica() } : null,
  };
}

function enviar(): void {
  void emit(EVENTO_ESTADO, foto());
}

function ejecutar(orden: OrdenPanel): void {
  switch (orden.tipo) {
    case "pomodoro-alternar":
      if (!estadoPomodoro().corriendo) gesto("guino", 1100);
      alternarPomodoro();
      break;
    case "pomodoro-reiniciar":
      reiniciarPomodoro();
      break;
    case "pomodoro-modo":
      cambiarModo(orden.modo);
      break;
    case "agua-beber":
      beber();
      gesto(mlHoy() >= configAgua().meta ? "celebra" : "feliz", 1600);
      break;
    case "pausa-empezar":
      empezarPausa(orden.pausa);
      break;
    case "musica":
      if (orden.accion === "anterior") cancionAnterior();
      if (orden.accion === "play") reproducirPausar();
      if (orden.accion === "siguiente") cancionSiguiente();
      break;
  }
  enviar();
}

/** ¿Está el panel abierto? */
export function panelAbierto(): boolean {
  return abierto;
}

export function iniciarPuente(): void {
  listen<boolean>(EVENTO_VISIBLE, ({ payload }) => {
    abierto = payload;
    // Los globos esperan mientras el panel está abierto
    pausarGlobos(payload);
    if (payload) enviar();
  }).catch(console.error);
  listen(EVENTO_PEDIR, () => enviar()).catch(console.error);
  listen<OrdenPanel>(EVENTO_ORDEN, ({ payload }) => ejecutar(payload)).catch(console.error);
  window.setInterval(() => {
    if (abierto) enviar();
  }, REFRESCO_MS);
}
