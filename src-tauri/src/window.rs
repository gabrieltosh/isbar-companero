//! Ventana-isla: posición, tamaño, monitor, visibilidad y click-through.
//!
//! La ventana es más grande que la píldora (para dejar sitio a las animaciones),
//! así que un hilo comprueba la posición del cursor y solo deja que la ventana
//! reciba el ratón cuando está encima del rectángulo de la píldora.
//! Lo mismo para la ventana del compañero (companero.rs), con varios rectángulos.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Tamaño de la ventana con escala 1, en píxeles lógicos (igual que en tauri.conf.json).
const ANCHO_BASE: f64 = 560.0;
const ALTO_BASE: f64 = 290.0;

/// Rectángulo en píxeles lógicos (CSS), relativo a la ventana.
#[derive(Clone, Copy, Default, Deserialize)]
pub struct RectIsla {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl RectIsla {
    fn contiene(&self, px: f64, py: f64) -> bool {
        px >= self.x && px <= self.x + self.w && py >= self.y && py <= self.y + self.h
    }
}

/// Ajustes de la ventana que llegan desde la configuración.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AjustesVentana {
    /// Tamaño de la isla (1 = 100 %)
    escala: f64,
    /// Separación del borde superior, en píxeles lógicos
    desplazamiento: f64,
    /// Nombre del monitor, o None para el principal
    monitor: Option<String>,
}

impl Default for AjustesVentana {
    fn default() -> Self {
        Self { escala: 1.0, desplazamiento: 0.0, monitor: None }
    }
}

pub struct EstadoIsla {
    rect: Mutex<RectIsla>,
    ajustes: Mutex<AjustesVentana>,
    /// El usuario la ha dejado visible desde la bandeja
    pub visible_usuario: AtomicBool,
    /// Hay una aplicación a pantalla completa en el monitor de la isla (o del compañero)
    pub pantalla_completa: AtomicBool,
    /// Estilo elegido: compañero en lugar de isla
    pub companero: AtomicBool,
    /// La ventana del compañero ya está colocada y se puede mostrar
    pub companero_listo: AtomicBool,
    /// Zonas del compañero que reciben el ratón (el compañero, un globo, el panel)
    pub rects_companero: Mutex<Vec<RectIsla>>,
}

impl Default for EstadoIsla {
    fn default() -> Self {
        Self {
            rect: Mutex::new(RectIsla::default()),
            ajustes: Mutex::new(AjustesVentana::default()),
            visible_usuario: AtomicBool::new(true),
            pantalla_completa: AtomicBool::new(false),
            companero: AtomicBool::new(false),
            companero_listo: AtomicBool::new(false),
            rects_companero: Mutex::new(Vec::new()),
        }
    }
}

/// El frontend informa del tamaño de la píldora cada vez que cambia de estado.
#[tauri::command]
pub fn set_island_rect(estado: tauri::State<'_, EstadoIsla>, x: f64, y: f64, w: f64, h: f64) {
    if let Ok(mut rect) = estado.rect.lock() {
        *rect = RectIsla { x, y, w, h };
    }
}

/// Aplica tamaño, desplazamiento y monitor elegidos en la configuración.
#[tauri::command]
pub fn aplicar_ajustes_ventana(
    app: AppHandle,
    estado: tauri::State<'_, EstadoIsla>,
    ajustes: AjustesVentana,
) -> Result<(), String> {
    if let Ok(mut actuales) = estado.ajustes.lock() {
        *actuales = ajustes.clone();
    }
    let ventana = app.get_webview_window("main").ok_or("No existe la ventana de la isla")?;
    colocar(&ventana, &ajustes).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct InfoMonitor {
    nombre: String,
    etiqueta: String,
}

#[tauri::command]
pub fn listar_monitores(app: AppHandle) -> Result<Vec<InfoMonitor>, String> {
    let ventana = app.get_webview_window("main").ok_or("No existe la ventana de la isla")?;
    let monitores = ventana.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitores
        .iter()
        .enumerate()
        .filter_map(|(i, m)| {
            let nombre = m.name()?.clone();
            let tam = m.size();
            Some(InfoMonitor {
                etiqueta: format!("Monitor {} ({}×{})", i + 1, tam.width, tam.height),
                nombre,
            })
        })
        .collect())
}

/// Coloca la ventana arriba y centrada en el monitor elegido (o el principal).
/// Se trabaja en píxeles físicos con el escalado DPI de ese monitor.
pub fn colocar(ventana: &WebviewWindow, ajustes: &AjustesVentana) -> tauri::Result<()> {
    let monitores = ventana.available_monitors()?;
    let elegido = ajustes
        .monitor
        .as_deref()
        .and_then(|nombre| monitores.iter().find(|m| m.name().map(String::as_str) == Some(nombre)))
        .cloned();
    let monitor = match elegido {
        Some(m) => m,
        None => match ventana.primary_monitor()?.or_else(|| monitores.into_iter().next()) {
            Some(m) => m,
            None => return Ok(()),
        },
    };

    let dpi = monitor.scale_factor();
    let ancho = (ANCHO_BASE * ajustes.escala * dpi).round() as i32;
    let alto = (ALTO_BASE * ajustes.escala * dpi).round() as i32;
    let origen = monitor.position();
    let x = origen.x + (monitor.size().width as i32 - ancho) / 2;
    let y = origen.y + (ajustes.desplazamiento * dpi).round() as i32;

    // Primero se mueve (por si cambia de monitor y de DPI) y luego se ajusta el tamaño
    ventana.set_position(PhysicalPosition::new(x, y))?;
    ventana.set_size(PhysicalSize::new(ancho.max(1) as u32, alto.max(1) as u32))?;
    ventana.set_position(PhysicalPosition::new(x, y))
}

/// Ventana del estilo elegido (la isla o el compañero).
pub fn ventana_activa(app: &AppHandle) -> Option<WebviewWindow> {
    let etiqueta = if app.state::<EstadoIsla>().companero.load(Ordering::SeqCst) {
        crate::companero::ETIQUETA
    } else {
        "main"
    };
    app.get_webview_window(etiqueta)
}

/// Muestra la ventana del estilo elegido (según la bandeja y la pantalla completa) y oculta la otra.
pub fn aplicar_visibilidad(app: &AppHandle) {
    let estado = app.state::<EstadoIsla>();
    let visible = estado.visible_usuario.load(Ordering::SeqCst) && !estado.pantalla_completa.load(Ordering::SeqCst);
    let companero = estado.companero.load(Ordering::SeqCst);
    let listo = estado.companero_listo.load(Ordering::SeqCst);
    if let Some(isla) = app.get_webview_window("main") {
        fijar_visible(&isla, visible && !companero);
    }
    if let Some(ventana) = app.get_webview_window(crate::companero::ETIQUETA) {
        fijar_visible(&ventana, visible && companero && listo);
    }
}

/// Se muestra y oculta directamente con Windows (sin quitar el foco). Para Tauri las ventanas
/// siguen "visibles": si no, al cambiar el click-through Tauri las volvería a ocultar.
fn fijar_visible(ventana: &WebviewWindow, visible: bool) {
    #[cfg(target_os = "windows")]
    crate::fullscreen::fijar_visible(ventana, visible);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = if visible { ventana.show() } else { ventana.hide() };
    }
}

/// Cambia entre la isla y el compañero (lo llama la isla al leer los ajustes).
/// Es async porque crear una ventana desde un comando síncrono bloquea el hilo principal en Windows.
#[tauri::command]
pub async fn aplicar_estilo(app: AppHandle, estilo: String) -> Result<(), String> {
    let companero = estilo == "companero";
    app.state::<EstadoIsla>().companero.store(companero, Ordering::SeqCst);
    if companero && let Err(e) = crate::companero::crear(&app) {
        eprintln!("compañero: no se pudo crear la ventana: {e}");
        return Err(e.to_string());
    }
    aplicar_visibilidad(&app);
    Ok(())
}

/// Posición del cursor en píxeles lógicos relativa a una ventana.
fn cursor_en(app: &AppHandle, ventana: &WebviewWindow) -> Option<(f64, f64)> {
    let (Ok(cursor), Ok(pos), Ok(escala)) = (app.cursor_position(), ventana.outer_position(), ventana.scale_factor())
    else {
        return None;
    };
    Some(((cursor.x - f64::from(pos.x)) / escala, (cursor.y - f64::from(pos.y)) / escala))
}

/// Deja pasar los clics fuera de los rectángulos y avisa con `evento` al entrar o salir.
fn actualizar_click_through(ventana: &WebviewWindow, dentro: bool, antes: &mut Option<bool>, evento: &str) {
    if *antes == Some(dentro) {
        return;
    }
    if let Err(e) = ventana.set_ignore_cursor_events(!dentro) {
        eprintln!("click-through: {e}");
        return;
    }
    let _ = ventana.emit(evento, dentro);
    *antes = Some(dentro);
}

/// Hilo que cada ~30 ms decide si cada ventana deja pasar los clics.
/// Avisa con `isla-hover` / `companero-hover` cuando el cursor entra o sale, y al compañero
/// le dice dónde está el cursor (`companero-cursor`) para que lo siga con la mirada.
pub fn iniciar_click_through(app: AppHandle) {
    thread::spawn(move || {
        let mut dentro_isla: Option<bool> = None;
        let mut dentro_companero: Option<bool> = None;
        let mut cursor_antes = (f64::NAN, f64::NAN);
        loop {
            thread::sleep(Duration::from_millis(30));
            let estado = app.state::<EstadoIsla>();
            let companero = estado.companero.load(Ordering::SeqCst);
            // Oculta (bandeja o pantalla completa): no se toca, para que no vuelva a aparecer
            if !estado.visible_usuario.load(Ordering::SeqCst) || estado.pantalla_completa.load(Ordering::SeqCst) {
                continue;
            }

            // Solo se toca la ventana del estilo activo: la otra está oculta y debe seguir así
            if !companero
                && let Some(ventana) = app.get_webview_window("main")
                && let Some((x, y)) = cursor_en(&app, &ventana)
            {
                let rect = estado.rect.lock().map(|r| *r).unwrap_or_default();
                actualizar_click_through(&ventana, rect.contiene(x, y), &mut dentro_isla, "isla-hover");
            }

            if !companero {
                continue;
            }
            let Some(ventana) = app.get_webview_window(crate::companero::ETIQUETA) else {
                continue;
            };
            let Some((x, y)) = cursor_en(&app, &ventana) else {
                continue;
            };
            let dentro = estado
                .rects_companero
                .lock()
                .map(|rects| rects.iter().any(|r| r.contiene(x, y)))
                .unwrap_or(false);
            actualizar_click_through(&ventana, dentro, &mut dentro_companero, "companero-hover");
            if (x - cursor_antes.0).abs() > 2.0 || (y - cursor_antes.1).abs() > 2.0 {
                let _ = ventana.emit("companero-cursor", (x, y));
                cursor_antes = (x, y);
            }
        }
    });
}
