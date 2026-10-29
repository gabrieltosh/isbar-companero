//! Compañero: ventana flotante con cara que el usuario mueve por la pantalla.
//!
//! La ventana es un poco más grande que el compañero (margen para las animaciones).
//! Para moverlo, el frontend avisa al mantenerlo pulsado y un hilo mueve la ventana
//! con el cursor hasta que se suelta el botón. Al soltarlo cerca del borde izquierdo
//! o derecho del monitor se esconde a medias ("se asoma").
//! La posición la guarda el frontend (evento `companero-soltado`) y la devuelve al arrancar.
//! Además avisa cada pocos segundos de cuánto tiempo lleva el usuario sin tocar el PC
//! (`companero-inactivo`), para que el compañero se canse y se duerma.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::window::{aplicar_visibilidad, Estado, Rect};

pub const ETIQUETA: &str = "companero";

/// Lado de la ventana y del compañero con tamaño 1, en píxeles lógicos.
const LADO_VENTANA: f64 = 112.0;
const LADO: f64 = 64.0;
/// Tamaño elegido en la configuración (1 = mediano).
static ESCALA: Mutex<f64> = Mutex::new(1.0);
/// Cada cuánto se avisa del tiempo sin usar el PC.
const AVISO_INACTIVIDAD: Duration = Duration::from_secs(2);
static INACTIVIDAD_INICIADA: AtomicBool = AtomicBool::new(false);

/// Lado de la ventana, lado del compañero y margen entre ambos, con el tamaño elegido.
pub(crate) fn medidas() -> (f64, f64, f64) {
    let e = ESCALA.lock().map(|e| *e).unwrap_or(1.0);
    let (ventana, lado) = (LADO_VENTANA * e, LADO * e);
    (ventana, lado, (ventana - lado) / 2.0)
}
/// Separación mínima con los bordes del área de trabajo.
const SEPARACION: f64 = 16.0;
/// A menos de esta distancia de un lado, al soltarlo se esconde a medias.
const IMAN: f64 = 28.0;
/// Cada cuánto se sigue al cursor mientras se arrastra.
const PASO_ARRASTRE: Duration = Duration::from_millis(8);

/// Posición física de la ventana (la que guarda el frontend).
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct PosCompanero {
    x: i32,
    y: i32,
}

/// Se avisa al soltarlo: dónde quedó y si está escondido en un borde (-1 izquierda, 1 derecha).
#[derive(Clone, Serialize)]
struct Soltado {
    x: i32,
    y: i32,
    borde: i8,
}

/// Crea la ventana (al arrancar). Nace fuera de la pantalla y oculta para Windows (pero visible
/// para Tauri, ver window::fijar_visible); se muestra cuando el frontend la coloca.
pub fn crear(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(ventana) = app.get_webview_window(ETIQUETA) {
        return Ok(ventana);
    }
    let ventana = WebviewWindowBuilder::new(app, ETIQUETA, WebviewUrl::App("companero.html".into()))
        .title("isbar")
        .inner_size(medidas().0, medidas().0)
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
        .build()?;
    ventana.set_ignore_cursor_events(true)?;
    aplicar_visibilidad(app);
    iniciar_inactividad(app.clone());
    Ok(ventana)
}

/// Hilo que avisa al compañero de cuánto tiempo lleva el usuario sin tocar el ratón ni el teclado.
fn iniciar_inactividad(app: AppHandle) {
    if INACTIVIDAD_INICIADA.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || loop {
        thread::sleep(AVISO_INACTIVIDAD);
        if let Some(ventana) = app.get_webview_window(ETIQUETA) {
            let _ = ventana.emit("companero-inactivo", ms_inactivo());
        }
    });
}

fn ventana(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(ETIQUETA).ok_or_else(|| "No existe la ventana del compañero".to_string())
}

/// Monitor en el que está el centro del compañero (o el principal, o el primero).
pub(crate) fn monitor_de(ventana: &WebviewWindow, x: i32, y: i32) -> Option<Monitor> {
    let monitores = ventana.available_monitors().ok()?;
    let dentro = monitores.iter().find(|m| {
        let lado = (medidas().0 * m.scale_factor()) as i32;
        let (cx, cy) = (x + lado / 2, y + lado / 2);
        let (p, t) = (m.position(), m.size());
        cx >= p.x && cx < p.x + t.width as i32 && cy >= p.y && cy < p.y + t.height as i32
    });
    dentro
        .cloned()
        .or_else(|| ventana.primary_monitor().ok().flatten())
        .or_else(|| monitores.into_iter().next())
}

/// A dónde debe ir la ventana si se suelta en (x, y): dentro del área de trabajo,
/// o escondida a medias si está pegada a un lado (cuando `permitir_borde`).
fn destino(ventana: &WebviewWindow, x: i32, y: i32, permitir_borde: bool) -> (i32, i32, i8) {
    let Some(monitor) = monitor_de(ventana, x, y) else {
        return (x, y, 0);
    };
    let dpi = monitor.scale_factor();
    let px = |v: f64| (v * dpi).round() as i32;
    let (_, lado, margen) = medidas();
    let area = monitor.work_area();
    let (izq, arriba) = (area.position.x, area.position.y);
    let (der, abajo) = (izq + area.size.width as i32, arriba + area.size.height as i32);

    // Caja del compañero dentro de la ventana
    let (cx, cy) = (x + px(margen), y + px(margen));
    let cy = cy.clamp(arriba + px(SEPARACION), (abajo - px(SEPARACION) - px(lado)).max(arriba));
    let (cx, borde) = if permitir_borde && cx < izq + px(IMAN) {
        (izq - px(lado) / 2, -1)
    } else if permitir_borde && cx + px(lado) > der - px(IMAN) {
        (der - px(lado) / 2, 1)
    } else {
        (cx.clamp(izq + px(SEPARACION), (der - px(SEPARACION) - px(lado)).max(izq)), 0)
    };
    (cx - px(margen), cy - px(margen), borde)
}

/// Esquina inferior derecha del monitor principal.
fn posicion_inicial(ventana: &WebviewWindow) -> (i32, i32) {
    match ventana.primary_monitor().ok().flatten() {
        Some(m) => {
            let area = m.work_area();
            let lado = (medidas().0 * m.scale_factor()) as i32;
            (
                area.position.x + area.size.width as i32 - lado - 40,
                area.position.y + area.size.height as i32 - lado - 40,
            )
        }
        None => (100, 100),
    }
}

/// Mueve la ventana con una curva suave (unos 160 ms).
fn deslizar(ventana: &WebviewWindow, hasta: (i32, i32)) {
    let Ok(desde) = ventana.outer_position() else {
        return;
    };
    const PASOS: i32 = 10;
    for i in 1..=PASOS {
        let t = f64::from(i) / f64::from(PASOS);
        let k = 1.0 - (1.0 - t).powi(3);
        let x = desde.x + (f64::from(hasta.0 - desde.x) * k).round() as i32;
        let y = desde.y + (f64::from(hasta.1 - desde.y) * k).round() as i32;
        let _ = ventana.set_position(PhysicalPosition::new(x, y));
        thread::sleep(Duration::from_millis(16));
    }
}

/// La página del compañero ya cargó: se coloca donde estaba (o en una esquina) y se muestra.
/// Devuelve el borde en el que quedó escondido (-1, 0 o 1).
#[tauri::command]
pub fn iniciar_companero(app: AppHandle, pos: Option<PosCompanero>) -> Result<i8, String> {
    let ventana = ventana(&app)?;
    let (x, y) = pos.map(|p| (p.x, p.y)).unwrap_or_else(|| posicion_inicial(&ventana));
    let (x, y, borde) = destino(&ventana, x, y, true);
    ventana.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    app.state::<Estado>().listo.store(true, Ordering::SeqCst);
    aplicar_visibilidad(&app);
    Ok(borde)
}

/// Zonas de la ventana que reciben el ratón (el resto deja pasar los clics).
#[tauri::command]
pub fn set_companero_rects(estado: tauri::State<'_, Estado>, rects: Vec<Rect>) {
    if let Ok(mut actuales) = estado.rects.lock() {
        *actuales = rects;
    }
}

/// Empieza a arrastrar: la ventana sigue al cursor hasta que se suelta el botón.
/// `dx`, `dy`: dónde se cogió, en píxeles lógicos dentro de la ventana.
#[tauri::command]
pub fn arrastrar_companero(app: AppHandle, dx: f64, dy: f64) -> Result<(), String> {
    let ventana = ventana(&app)?;
    let escala = ventana.scale_factor().map_err(|e| e.to_string())?;
    // El globo se aparta mientras se mueve
    crate::globo::ocultar_globo(app.clone());
    let _ = ventana.emit("globo-cerrar", ());
    thread::spawn(move || {
        let mut vuelta = 0u32;
        while boton_pulsado() {
            if let Ok(cursor) = app.cursor_position() {
                let x = (cursor.x - dx * escala).round() as i32;
                let y = (cursor.y - dy * escala).round() as i32;
                let _ = ventana.set_position(PhysicalPosition::new(x, y));
                // Cada ~16 ms se avisa de dónde va, para que se incline y se estire según la velocidad
                vuelta += 1;
                if vuelta.is_multiple_of(2) {
                    let _ = ventana.emit("companero-moviendo", (f64::from(x) / escala, f64::from(y) / escala));
                }
            }
            thread::sleep(PASO_ARRASTRE);
        }
        soltar(&ventana, true);
    });
    Ok(())
}

/// Cambia el tamaño del compañero (0.8 pequeño, 1 mediano, 1.25 grande) sin moverlo de sitio.
#[tauri::command]
pub fn fijar_tamano_companero(app: AppHandle, escala: f64) -> Result<(), String> {
    let ventana = ventana(&app)?;
    let escala = escala.clamp(0.6, 1.6);
    let antes = medidas().0;
    if let Ok(mut actual) = ESCALA.lock() {
        *actual = escala;
    }
    let (lado_ventana, _, _) = medidas();
    // Se mantiene el centro donde estaba
    let dpi = ventana.scale_factor().map_err(|e| e.to_string())?;
    let pos = ventana.outer_position().map_err(|e| e.to_string())?;
    let corrimiento = ((lado_ventana - antes) * dpi / 2.0).round() as i32;
    ventana
        .set_size(LogicalSize::new(lado_ventana, lado_ventana))
        .map_err(|e| e.to_string())?;
    let (x, y, borde) = destino(&ventana, pos.x - corrimiento, pos.y - corrimiento, true);
    ventana.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    let _ = ventana.emit("companero-soltado", Soltado { x, y, borde });
    Ok(())
}

/// Saca al compañero del borde en el que estaba escondido.
#[tauri::command]
pub fn salir_del_borde(app: AppHandle) -> Result<(), String> {
    let ventana = ventana(&app)?;
    thread::spawn(move || soltar(&ventana, false));
    Ok(())
}

fn soltar(ventana: &WebviewWindow, permitir_borde: bool) {
    let Ok(pos) = ventana.outer_position() else {
        return;
    };
    let (x, y, borde) = destino(ventana, pos.x, pos.y, permitir_borde);
    deslizar(ventana, (x, y));
    let _ = ventana.emit("companero-soltado", Soltado { x, y, borde });
}

/// El botón principal del ratón sigue pulsado (respeta el cambio de botones para zurdos).
#[cfg(target_os = "windows")]
fn boton_pulsado() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};
    // SAFETY: solo se consulta el estado del ratón y la configuración del sistema.
    unsafe {
        let boton = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
        (GetAsyncKeyState(i32::from(boton.0)) as u16) & 0x8000 != 0
    }
}

/// Milisegundos desde la última vez que se tocó el ratón o el teclado.
#[cfg(target_os = "windows")]
fn ms_inactivo() -> u32 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: solo se consulta la hora de la última entrada; la estructura es local.
    unsafe {
        if GetLastInputInfo(&mut info).as_bool() {
            GetTickCount().wrapping_sub(info.dwTime)
        } else {
            0
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn ms_inactivo() -> u32 {
    0
}

/// Fuera de Windows todavía no se puede arrastrar (se suelta al momento).
#[cfg(not(target_os = "windows"))]
fn boton_pulsado() -> bool {
    false
}
