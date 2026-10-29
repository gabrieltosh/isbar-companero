//! Ventana de los globos de pensamiento: se coloca junto al compañero, hacia el lado con sitio.
//!
//! La página del globo (globo.html) mide lo que va a mostrar y pide aquí que se coloque y se
//! muestre; la respuesta dice a qué lado del compañero quedó, para dibujar las nubecitas.
//! La ventana tiene justo el tamaño del globo, así que recibe el ratón entera (para sus botones).

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::companero;
use crate::window::{aplicar_visibilidad, Estado};

pub const ETIQUETA: &str = "globo";

/// Separación entre el compañero y el globo, en píxeles lógicos.
const SEPARACION: f64 = 4.0;
/// Margen con los bordes del área de trabajo.
const MARGEN_PANTALLA: f64 = 8.0;

/// Crea la ventana (oculta, fuera de la pantalla). Se muestra con `mostrar_globo`.
pub fn crear(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(ventana) = app.get_webview_window(ETIQUETA) {
        return Ok(ventana);
    }
    WebviewWindowBuilder::new(app, ETIQUETA, WebviewUrl::App("globo.html".into()))
        .title("isbar")
        .inner_size(280.0, 120.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .position(-20000.0, -20000.0)
        .additional_browser_args(crate::tray::ARGS_NAVEGADOR)
        .build()
}

fn ventanas(app: &AppHandle) -> Result<(WebviewWindow, WebviewWindow), String> {
    let globo = app.get_webview_window(ETIQUETA).ok_or("No existe la ventana del globo")?;
    let comp = app.get_webview_window(companero::ETIQUETA).ok_or("No existe la ventana del compañero")?;
    Ok((globo, comp))
}

/// Coloca el globo (de `ancho` × `alto` píxeles lógicos) junto al compañero y lo muestra.
/// Devuelve "der" o "izq": el lado del compañero en el que quedó.
#[tauri::command]
pub fn mostrar_globo(app: AppHandle, ancho: f64, alto: f64) -> Result<String, String> {
    let (globo, comp) = ventanas(&app)?;
    let pos = comp.outer_position().map_err(|e| e.to_string())?;
    let monitor = companero::monitor_de(&comp, pos.x, pos.y).ok_or("No se encontró el monitor")?;
    let dpi = monitor.scale_factor();
    let px = |v: f64| (v * dpi).round() as i32;
    let area = monitor.work_area();
    let (izq, arriba) = (area.position.x, area.position.y);
    let (der, abajo) = (izq + area.size.width as i32, arriba + area.size.height as i32);

    // Caja del compañero (en físicos)
    let (_, lado, margen) = companero::medidas();
    let (cx, cy, cl) = (pos.x + px(margen), pos.y + px(margen), px(lado));
    let (w, h) = (px(ancho), px(alto));

    // A la derecha si cabe; si no, a la izquierda
    let (x, lado_globo) = if cx + cl + px(SEPARACION) + w <= der - px(MARGEN_PANTALLA) {
        (cx + cl + px(SEPARACION), "der")
    } else {
        (cx - px(SEPARACION) - w, "izq")
    };
    // La parte de abajo del globo, a la altura de la mitad del compañero (flota por encima)
    let y = (cy + cl / 2 - h).clamp(arriba + px(MARGEN_PANTALLA), (abajo - px(MARGEN_PANTALLA) - h).max(arriba));
    let x = x.clamp(izq + px(MARGEN_PANTALLA), (der - px(MARGEN_PANTALLA) - w).max(izq));

    globo
        .set_size(PhysicalSize::new(w.max(1) as u32, h.max(1) as u32))
        .map_err(|e| e.to_string())?;
    globo.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    app.state::<Estado>().globo.store(true, Ordering::SeqCst);
    aplicar_visibilidad(&app);
    Ok(lado_globo.to_string())
}

/// Oculta el globo (al terminar, al arrastrar el compañero…).
#[tauri::command]
pub fn ocultar_globo(app: AppHandle) {
    app.state::<Estado>().globo.store(false, Ordering::SeqCst);
    aplicar_visibilidad(&app);
}
