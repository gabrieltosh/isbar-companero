//! Icono en la bandeja del sistema y ventana de configuración.

use std::sync::atomic::Ordering;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::window::{aplicar_visibilidad, Estado};

/// Mismos argumentos en todas las ventanas: todas
/// comparten carpeta de datos de WebView2 y deben arrancar con las mismas opciones.
/// Son los de Tauri por defecto más el permiso para sonar sin un clic previo.
pub(crate) const ARGS_NAVEGADOR: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

pub fn crear(app: &AppHandle) -> tauri::Result<()> {
    let alternar = MenuItem::with_id(app, "alternar", "Mostrar/ocultar", true, None::<&str>)?;
    let config = MenuItem::with_id(app, "config", "Configuración", true, None::<&str>)?;
    let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&alternar, &config, &PredefinedMenuItem::separator(app)?, &salir])?;

    let mut icono = TrayIconBuilder::with_id("isla")
        .tooltip("isbar")
        .menu(&menu)
        // Clic izquierdo: mostrar/ocultar. Clic derecho: menú
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            "alternar" => alternar_visible(app),
            "config" => abrir_configuracion(app),
            "salir" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|bandeja, evento| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = evento
            {
                alternar_visible(bandeja.app_handle());
            }
        });
    if let Some(imagen) = app.default_window_icon() {
        icono = icono.icon(imagen.clone());
    }
    icono.build(app)?;
    Ok(())
}

fn alternar_visible(app: &AppHandle) {
    app.state::<Estado>().visible_usuario.fetch_xor(true, Ordering::SeqCst);
    aplicar_visibilidad(app);
}

/// Abre la configuración desde la página. Es async porque crear una ventana desde un
/// comando síncrono bloquea el hilo principal en Windows.
#[tauri::command]
pub async fn abrir_configuracion_cmd(app: AppHandle) {
    abrir_configuracion(&app);
}

/// Abre la ventana de configuración, o la trae al frente si ya está abierta.
pub fn abrir_configuracion(app: &AppHandle) {
    if let Some(ventana) = app.get_webview_window("config") {
        let _ = ventana.unminimize();
        let _ = ventana.show();
        let _ = ventana.set_focus();
        return;
    }
    let resultado = WebviewWindowBuilder::new(app, "config", WebviewUrl::App("config.html".into()))
        .title("Configuración de isbar Compañero")
        .inner_size(440.0, 660.0)
        .resizable(false)
        .maximizable(false)
        .center()
        .additional_browser_args(ARGS_NAVEGADOR)
        .build();
    if let Err(e) = resultado {
        eprintln!("configuración: no se pudo abrir la ventana: {e}");
    }
}
