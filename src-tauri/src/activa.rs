//! La ventana activa (la que tiene el foco): programa y título. Un hilo la mira cada segundo y,
//! cuando cambia, avisa al compañero (`ventana-activa`) para que sepa qué estás haciendo
//! (reunión, programando, viendo un vídeo…) y se comporte en consecuencia. Lo de esta app no
//! cuenta. Solo se lee en el momento; no se guarda aquí.

use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

use crate::companero::ETIQUETA;
use crate::debajo::{programa, Debajo};

const INTERVALO: Duration = Duration::from_secs(1);

/// La ventana activa ahora (si no es de esta app).
fn ventana_activa() -> Option<Debajo> {
    // SAFETY: solo se consultan datos de la ventana con el foco; el búfer es local.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return None;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == std::process::id() {
            return None;
        }
        let mut texto = [0u16; 256];
        let largo = GetWindowTextW(hwnd, &mut texto).max(0) as usize;
        Some(Debajo { programa: programa(pid).unwrap_or_default(), titulo: String::from_utf16_lossy(&texto[..largo]) })
    }
}

pub fn iniciar(app: AppHandle) {
    thread::spawn(move || {
        let mut antes: Option<(String, String)> = None;
        loop {
            thread::sleep(INTERVALO);
            let Some(v) = ventana_activa() else {
                continue;
            };
            let clave = (v.programa.clone(), v.titulo.clone());
            if antes.as_ref() == Some(&clave) {
                continue;
            }
            antes = Some(clave);
            if let Some(ventana) = app.get_webview_window(ETIQUETA) {
                let _ = ventana.emit("ventana-activa", v);
            }
        }
    });
}
