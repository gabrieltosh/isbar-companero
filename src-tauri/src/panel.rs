//! Panel del compañero: se abre con un clic junto a él (hacia el lado con sitio) y se cierra
//! al volver a pulsarlo, con Esc o al hacer clic fuera (cuando pierde el foco).
//!
//! A diferencia del globo, el panel toma el foco para poder usar el teclado. Avisa al
//! compañero con `panel-visible` para que los globos esperen mientras está abierto.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

use crate::companero;
use crate::window::Estado;

pub const ETIQUETA: &str = "panel";

/// Tamaño del panel en píxeles lógicos.
const ANCHO: f64 = 320.0;
const ALTO: f64 = 440.0;
/// Separación con el compañero y con los bordes del área de trabajo.
const SEPARACION: f64 = 6.0;
const MARGEN_PANTALLA: f64 = 8.0;
/// Si se cerró por perder el foco hace menos de esto, un clic en el compañero no lo reabre
/// (ese mismo clic es el que le quitó el foco).
const IGNORAR_TRAS_CERRAR_MS: u64 = 350;

static ABIERTO: AtomicBool = AtomicBool::new(false);
static CERRADO_EN: AtomicU64 = AtomicU64::new(0);

fn ahora_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Crea la ventana (oculta). Se cierra sola al perder el foco.
pub fn crear(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(ventana) = app.get_webview_window(ETIQUETA) {
        return Ok(ventana);
    }
    let ventana = WebviewWindowBuilder::new(app, ETIQUETA, WebviewUrl::App("panel.html".into()))
        .title("isbar")
        .inner_size(ANCHO, ALTO)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .visible(false)
        .additional_browser_args(crate::tray::ARGS_NAVEGADOR)
        .build()?;
    let app_cierre = app.clone();
    ventana.on_window_event(move |evento| {
        if let WindowEvent::Focused(false) = evento
            && ABIERTO.load(Ordering::SeqCst)
        {
            cerrar(&app_cierre);
        }
    });
    Ok(ventana)
}

fn cerrar(app: &AppHandle) {
    if !ABIERTO.swap(false, Ordering::SeqCst) {
        return;
    }
    CERRADO_EN.store(ahora_ms(), Ordering::SeqCst);
    if let Some(ventana) = app.get_webview_window(ETIQUETA) {
        let _ = ventana.hide();
    }
    let _ = app.emit("panel-visible", false);
}

/// Coloca el panel junto al compañero: a la derecha si cabe (si no, a la izquierda), alineado
/// por abajo con él si está en la mitad de abajo de la pantalla, o por arriba si está en la de arriba.
fn colocar(panel: &WebviewWindow, comp: &WebviewWindow) -> Result<(), String> {
    let pos = comp.outer_position().map_err(|e| e.to_string())?;
    let monitor = companero::monitor_de(comp, pos.x, pos.y).ok_or("No se encontró el monitor")?;
    let dpi = monitor.scale_factor();
    let px = |v: f64| (v * dpi).round() as i32;
    let area = monitor.work_area();
    let (izq, arriba) = (area.position.x, area.position.y);
    let (der, abajo) = (izq + area.size.width as i32, arriba + area.size.height as i32);

    let (_, lado, margen) = companero::medidas();
    let (cx, cy, cl) = (pos.x + px(margen), pos.y + px(margen), px(lado));
    let (w, h) = (px(ANCHO), px(ALTO));

    let x = if cx + cl + px(SEPARACION) + w <= der - px(MARGEN_PANTALLA) {
        cx + cl + px(SEPARACION)
    } else {
        cx - px(SEPARACION) - w
    };
    let mitad = arriba + (abajo - arriba) / 2;
    let y = if cy + cl / 2 > mitad { cy + cl - h } else { cy };
    let x = x.clamp(izq + px(MARGEN_PANTALLA), (der - px(MARGEN_PANTALLA) - w).max(izq));
    let y = y.clamp(arriba + px(MARGEN_PANTALLA), (abajo - px(MARGEN_PANTALLA) - h).max(arriba));

    panel.set_size(LogicalSize::new(ANCHO, ALTO)).map_err(|e| e.to_string())?;
    panel.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())
}

/// Abre el panel si está cerrado y lo cierra si está abierto (clic en el compañero).
/// Es async porque mostrar y enfocar una ventana desde un comando síncrono puede bloquear en Windows.
#[tauri::command]
pub async fn alternar_panel(app: AppHandle) -> Result<bool, String> {
    if ABIERTO.load(Ordering::SeqCst) {
        cerrar(&app);
        return Ok(false);
    }
    if ahora_ms().saturating_sub(CERRADO_EN.load(Ordering::SeqCst)) < IGNORAR_TRAS_CERRAR_MS {
        return Ok(false);
    }
    let panel = app.get_webview_window(ETIQUETA).ok_or("No existe la ventana del panel")?;
    let comp = app
        .get_webview_window(companero::ETIQUETA)
        .ok_or("No existe la ventana del compañero")?;
    colocar(&panel, &comp)?;
    // El globo se aparta mientras el panel está abierto
    crate::globo::ocultar_globo(app.clone());
    let _ = app.emit("globo-cerrar", ());
    ABIERTO.store(true, Ordering::SeqCst);
    panel.show().map_err(|e| e.to_string())?;
    panel.set_focus().map_err(|e| e.to_string())?;
    let _ = app.emit("panel-visible", true);
    Ok(true)
}

/// Cierra el panel (Esc, o desde el propio panel tras una acción).
#[tauri::command]
pub fn cerrar_panel(app: AppHandle) {
    cerrar(&app);
}

/// Se oculta junto con el compañero (bandeja o pantalla completa).
pub fn al_ocultar_companero(app: &AppHandle) {
    if !app.state::<Estado>().visible_usuario.load(Ordering::SeqCst)
        || app.state::<Estado>().pantalla_completa.load(Ordering::SeqCst)
    {
        cerrar(app);
    }
}
