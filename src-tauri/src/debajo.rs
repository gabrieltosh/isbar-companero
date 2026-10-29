//! Qué ventana queda debajo del compañero al soltarlo, para que reaccione a lo que "ve"
//! (un vídeo, una hoja de cálculo, el escritorio…). Solo se lee el nombre del programa y el
//! título de la ventana en ese momento; no se guarda ni sale del equipo.

use serde::Serialize;
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

/// La ventana de debajo: programa (p. ej. "excel.exe", en minúsculas) y título.
#[derive(Serialize, Clone)]
pub struct Debajo {
    pub programa: String,
    pub titulo: String,
}

struct Busqueda {
    x: i32,
    y: i32,
    propio: u32,
    encontrada: Option<HWND>,
}

/// Una ventana normal que se ve (ni minimizada, ni oculta por Windows, ni una barra de herramientas).
fn se_ve(hwnd: HWND) -> bool {
    // SAFETY: solo se consultan propiedades de una ventana que da EnumWindows.
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return false;
        }
        if GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
            return false;
        }
        let mut oculta: u32 = 0;
        let ok = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&mut oculta as *mut u32).cast(),
            size_of::<u32>() as u32,
        );
        ok.is_err() || oculta == 0
    }
}

unsafe extern "system" fn revisar(hwnd: HWND, datos: LPARAM) -> BOOL {
    // SAFETY: `datos` apunta a la Busqueda de `ventana_debajo`, viva durante EnumWindows.
    let busqueda = unsafe { &mut *(datos.0 as *mut Busqueda) };
    let mut pid = 0;
    // SAFETY: consultas sobre una ventana válida que da EnumWindows.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == busqueda.propio || !se_ve(hwnd) {
        return true.into();
    }
    let mut r = RECT::default();
    // SAFETY: igual que arriba.
    if unsafe { GetWindowRect(hwnd, &mut r) }.is_err() {
        return true.into();
    }
    if busqueda.x >= r.left && busqueda.x < r.right && busqueda.y >= r.top && busqueda.y < r.bottom {
        busqueda.encontrada = Some(hwnd);
        return false.into();
    }
    true.into()
}

/// Nombre del ejecutable de un proceso, en minúsculas (p. ej. "spotify.exe").
pub(crate) fn programa(pid: u32) -> Option<String> {
    // SAFETY: se abre el proceso solo para leer su ruta y se cierra al terminar.
    unsafe {
        let proceso = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 520];
        let mut largo = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(proceso, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut largo);
        let _ = CloseHandle(proceso);
        ok.ok()?;
        let ruta = String::from_utf16_lossy(&buf[..largo as usize]);
        ruta.rsplit(['\\', '/']).next().map(|n| n.to_lowercase())
    }
}

/// La ventana más arriba (que no sea de esta app) que contiene el punto de pantalla (px físicos).
pub fn ventana_debajo(x: i32, y: i32) -> Option<Debajo> {
    let mut busqueda = Busqueda { x, y, propio: std::process::id(), encontrada: None };
    // SAFETY: la callback solo usa `busqueda` mientras dura la llamada. EnumWindows da error
    // cuando la callback para antes de tiempo (al encontrarla): no es un fallo.
    let _ = unsafe { EnumWindows(Some(revisar), LPARAM(&mut busqueda as *mut Busqueda as isize)) };
    let hwnd = busqueda.encontrada?;
    let mut pid = 0;
    let mut texto = [0u16; 256];
    // SAFETY: consultas sobre una ventana válida.
    let largo = unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        GetWindowTextW(hwnd, &mut texto)
    };
    let titulo = String::from_utf16_lossy(&texto[..largo.max(0) as usize]);
    Some(Debajo { programa: programa(pid).unwrap_or_default(), titulo })
}
