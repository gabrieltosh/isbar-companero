//! Estado de la ventana del compañero: visibilidad y click-through.
//!
//! La ventana es algo más grande que el compañero (para las animaciones, los globos y el panel),
//! así que un hilo comprueba la posición del cursor y solo deja que la ventana reciba el ratón
//! cuando está encima de alguno de sus rectángulos (el compañero, un globo, el panel).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::companero::ETIQUETA;

/// Rectángulo en píxeles lógicos (CSS), relativo a la ventana.
#[derive(Clone, Copy, Default, Deserialize)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn contiene(&self, px: f64, py: f64) -> bool {
        px >= self.x && px <= self.x + self.w && py >= self.y && py <= self.y + self.h
    }
}

pub struct Estado {
    /// El usuario lo ha dejado visible desde la bandeja
    pub visible_usuario: AtomicBool,
    /// Hay una aplicación a pantalla completa en su monitor
    pub pantalla_completa: AtomicBool,
    /// La ventana ya está colocada y se puede mostrar
    pub listo: AtomicBool,
    /// Zonas que reciben el ratón
    pub rects: Mutex<Vec<Rect>>,
}

impl Default for Estado {
    fn default() -> Self {
        Self {
            visible_usuario: AtomicBool::new(true),
            pantalla_completa: AtomicBool::new(false),
            listo: AtomicBool::new(false),
            rects: Mutex::new(Vec::new()),
        }
    }
}

/// Muestra u oculta el compañero según la bandeja y la pantalla completa.
pub fn aplicar_visibilidad(app: &AppHandle) {
    let estado = app.state::<Estado>();
    let visible = estado.visible_usuario.load(Ordering::SeqCst)
        && !estado.pantalla_completa.load(Ordering::SeqCst)
        && estado.listo.load(Ordering::SeqCst);
    if let Some(ventana) = app.get_webview_window(ETIQUETA) {
        fijar_visible(&ventana, visible);
    }
}

/// Se muestra y oculta directamente con Windows (sin quitar el foco). Para Tauri la ventana
/// sigue "visible": si no, al cambiar el click-through Tauri la volvería a ocultar.
fn fijar_visible(ventana: &WebviewWindow, visible: bool) {
    #[cfg(target_os = "windows")]
    crate::fullscreen::fijar_visible(ventana, visible);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = if visible { ventana.show() } else { ventana.hide() };
    }
}

/// Posición del cursor en píxeles lógicos relativa a la ventana.
fn cursor_en(app: &AppHandle, ventana: &WebviewWindow) -> Option<(f64, f64)> {
    let (Ok(cursor), Ok(pos), Ok(escala)) = (app.cursor_position(), ventana.outer_position(), ventana.scale_factor())
    else {
        return None;
    };
    Some(((cursor.x - f64::from(pos.x)) / escala, (cursor.y - f64::from(pos.y)) / escala))
}

/// Hilo que cada ~30 ms decide si la ventana deja pasar los clics.
/// Avisa con `companero-hover` cuando el cursor entra o sale, y le dice dónde está el cursor
/// (`companero-cursor`) para que lo siga con la mirada.
pub fn iniciar_click_through(app: AppHandle) {
    thread::spawn(move || {
        let mut dentro_antes: Option<bool> = None;
        let mut cursor_antes = (f64::NAN, f64::NAN);
        loop {
            thread::sleep(Duration::from_millis(30));
            let estado = app.state::<Estado>();
            // Oculto (bandeja o pantalla completa): no se toca, para que no vuelva a aparecer
            if !estado.visible_usuario.load(Ordering::SeqCst) || estado.pantalla_completa.load(Ordering::SeqCst) {
                continue;
            }
            let Some(ventana) = app.get_webview_window(ETIQUETA) else {
                continue;
            };
            let Some((x, y)) = cursor_en(&app, &ventana) else {
                continue;
            };
            let dentro = estado
                .rects
                .lock()
                .map(|rects| rects.iter().any(|r| r.contiene(x, y)))
                .unwrap_or(false);
            if dentro_antes != Some(dentro) {
                match ventana.set_ignore_cursor_events(!dentro) {
                    Ok(()) => {
                        let _ = ventana.emit("companero-hover", dentro);
                        dentro_antes = Some(dentro);
                    }
                    Err(e) => eprintln!("click-through: {e}"),
                }
            }
            if (x - cursor_antes.0).abs() > 2.0 || (y - cursor_antes.1).abs() > 2.0 {
                let _ = ventana.emit("companero-cursor", (x, y));
                cursor_antes = (x, y);
            }
        }
    });
}
