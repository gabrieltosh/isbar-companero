//! Oculta el compañero cuando hay una aplicación a pantalla completa
//! (juegos, vídeos) en el mismo monitor, y la vuelve a mostrar al salir.

use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetForegroundWindow, GetWindowRect, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE,
};

use crate::companero::ETIQUETA;
use crate::window::{aplicar_visibilidad, Estado};

const INTERVALO: Duration = Duration::from_millis(500);
/// El escritorio y la barra de tareas ocupan todo el monitor pero no cuentan.
const CLASES_ESCRITORIO: [&str; 3] = ["Progman", "WorkerW", "Shell_TrayWnd"];

pub fn iniciar(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(INTERVALO);
        let Some(ventana) = app.get_webview_window(ETIQUETA) else {
            continue;
        };
        let Ok(isla) = ventana.hwnd() else {
            continue;
        };
        let completa = hay_pantalla_completa(isla);
        let estado = app.state::<Estado>();
        if estado.pantalla_completa.swap(completa, Ordering::SeqCst) != completa {
            aplicar_visibilidad(&app);
        }
    });
}

fn hay_pantalla_completa(isla: HWND) -> bool {
    // SAFETY: solo se consultan datos de ventanas y monitores; los búferes son locales.
    unsafe {
        let primera = GetForegroundWindow();
        if primera.is_invalid() || primera == isla {
            return false;
        }

        let mut clase = [0u16; 64];
        let largo = GetClassNameW(primera, &mut clase).max(0) as usize;
        let clase = String::from_utf16_lossy(&clase[..largo]);
        if CLASES_ESCRITORIO.contains(&clase.as_str()) {
            return false;
        }

        let monitor = MonitorFromWindow(primera, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromWindow(isla, MONITOR_DEFAULTTONEAREST) {
            return false;
        }
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let mut r = RECT::default();
        if GetWindowRect(primera, &mut r).is_err() {
            return false;
        }
        let m = info.rcMonitor;
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}

/// Muestra u oculta sin quitarle el foco a la ventana activa.
pub fn fijar_visible(ventana: &WebviewWindow, visible: bool) {
    if let Ok(hwnd) = ventana.hwnd() {
        // SAFETY: el HWND pertenece a nuestra propia ventana y sigue vivo.
        unsafe {
            let _ = ShowWindow(hwnd, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
        }
    }
}
