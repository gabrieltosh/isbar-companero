//! Notificaciones del sistema mediante UserNotificationListener.
//!
//! Requiere identidad de paquete (Fase 4A) y el permiso del usuario. Un hilo propio
//! pide el permiso, avisa al frontend con `notification-access` y emite
//! `notification-new` por cada notificación nueva.
//!
//! `NotificationChanged` no siempre funciona en apps de escritorio: si no se puede
//! suscribir, se consulta la lista cada segundo y se comparan los IDs.
//!
//! La vista de notificaciones de la isla las lista y las descarta con
//! `listar_notificaciones`, `eliminar_notificacion` y `eliminar_notificaciones`.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::process::Command;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;
use windows::core::Result as WinResult;
use windows::Foundation::{Size, TypedEventHandler};
use windows::UI::Notifications::Management::{
    UserNotificationListener as Escucha, UserNotificationListenerAccessStatus as Acceso,
};
use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};

use crate::media::{iniciar_winrt, leer_imagen};

/// Sin eventos de Windows se consulta cada segundo; con eventos, solo como respaldo.
const SONDEO: Duration = Duration::from_secs(1);
const SONDEO_CON_EVENTOS: Duration = Duration::from_secs(5);
/// Mientras no haya permiso, se vuelve a mirar por si el usuario lo activa.
const ESPERA_PERMISO: Duration = Duration::from_secs(10);

#[derive(Serialize, Clone)]
pub struct Notificacion {
    /// Id de Windows: sirve para descartarla
    id: u32,
    /// Cuándo llegó (epoch ms)
    fecha: i64,
    app: String,
    icono: Option<String>,
    titulo: String,
    texto: String,
}

#[derive(Serialize, Clone)]
struct EstadoPermiso {
    /// "permitido", "denegado", "sin-decidir" o "error"
    estado: &'static str,
}

fn nombre_estado(acceso: Acceso) -> &'static str {
    match acceso {
        Acceso::Allowed => "permitido",
        Acceso::Denied => "denegado",
        _ => "sin-decidir",
    }
}

pub fn iniciar(app: AppHandle) {
    thread::spawn(move || {
        if let Err(e) = bucle(&app) {
            eprintln!("notificaciones: {e}");
            let _ = app.emit("notification-access", EstadoPermiso { estado: "error" });
        }
    });
}

fn bucle(app: &AppHandle) -> WinResult<()> {
    iniciar_winrt();
    let escucha = Escucha::Current()?;

    // RequestAccessAsync muestra el diálogo la primera vez; si falla, se usa el estado actual
    let mut acceso = escucha
        .RequestAccessAsync()
        .and_then(|op| op.join())
        .or_else(|_| escucha.GetAccessStatus())?;
    let _ = app.emit("notification-access", EstadoPermiso { estado: nombre_estado(acceso) });

    while acceso != Acceso::Allowed {
        thread::sleep(ESPERA_PERMISO);
        let nuevo = escucha.GetAccessStatus()?;
        if nuevo != acceso {
            acceso = nuevo;
            let _ = app.emit("notification-access", EstadoPermiso { estado: nombre_estado(acceso) });
        }
    }

    let (tx, rx) = mpsc::channel::<()>();
    let con_eventos = escucha
        .NotificationChanged(&TypedEventHandler::new(move |_, _| {
            let _ = tx.send(());
            Ok(())
        }))
        .is_ok();
    let espera = if con_eventos { SONDEO_CON_EVENTOS } else { SONDEO };

    // Las que ya estaban al arrancar no se muestran
    let mut vistas: HashSet<u32> = match consultar(&escucha) {
        Ok(lista) => lista.iter().filter_map(|n| n.Id().ok()).collect(),
        Err(_) => HashSet::new(),
    };
    fijar_pendientes(app, vistas.len());

    loop {
        match rx.recv_timeout(espera) {
            Ok(()) | Err(RecvTimeoutError::Timeout) => {}
            // Sin suscripción el emisor ya no existe: se espera a mano
            Err(RecvTimeoutError::Disconnected) => thread::sleep(espera),
        }
        let lista = match consultar(&escucha) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("notificaciones: no se pudo leer la lista: {e}");
                continue;
            }
        };

        let mut actuales = HashSet::with_capacity(lista.len());
        for n in &lista {
            let Ok(id) = n.Id() else { continue };
            actuales.insert(id);
            if vistas.contains(&id) {
                continue;
            }
            match leer(n) {
                Ok(info) => {
                    let _ = app.emit("notification-new", info);
                }
                Err(e) => eprintln!("notificaciones: no se pudo leer una notificación: {e}"),
            }
        }
        fijar_pendientes(app, actuales.len());
        vistas = actuales;
    }
}

/// Notificaciones que siguen en el Centro de actividades (sin descartar).
static PENDIENTES: AtomicU32 = AtomicU32::new(0);

/// Guarda el número de pendientes y avisa al frontend solo si cambia.
fn fijar_pendientes(app: &AppHandle, total: usize) {
    let total = u32::try_from(total).unwrap_or(u32::MAX);
    if PENDIENTES.swap(total, Ordering::SeqCst) != total {
        let _ = app.emit("notification-count", total);
    }
}

/// Para que el frontend sepa el número al arrancar (el evento puede llegar antes).
#[tauri::command]
pub fn contar_notificaciones() -> u32 {
    PENDIENTES.load(Ordering::SeqCst)
}

/// Abre el Centro de actividades de Windows, donde se leen y descartan.
#[tauri::command]
pub fn abrir_centro_notificaciones(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("ms-actioncenter:", None::<&str>)
        .map_err(|e| e.to_string())
}

fn consultar(escucha: &Escucha) -> WinResult<Vec<UserNotification>> {
    let vista = escucha.GetNotificationsAsync(NotificationKinds::Toast)?.join()?;
    (0..vista.Size()?).map(|i| vista.GetAt(i)).collect()
}

/// Logo de cada app (como data URL), leído una sola vez y compartido entre hilos.
fn iconos() -> &'static Mutex<HashMap<String, Option<String>>> {
    static ICONOS: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    ICONOS.get_or_init(Mutex::default)
}

/// Diferencia entre el origen de DateTime de WinRT (1601, en unidades de 100 ns) y el de Unix.
const TICKS_HASTA_1970: i64 = 116_444_736_000_000_000;

fn leer(n: &UserNotification) -> WinResult<Notificacion> {
    let id = n.Id()?;
    let fecha = n.CreationTime().map(|t| (t.UniversalTime - TICKS_HASTA_1970) / 10_000).unwrap_or(0);
    let pantalla = n.AppInfo()?.DisplayInfo()?;
    let app = pantalla.DisplayName()?.to_string();

    let guardado = iconos().lock().ok().and_then(|c| c.get(&app).cloned());
    let icono = match guardado {
        Some(icono) => icono,
        None => {
            let icono = pantalla
                .GetLogo(Size { Width: 64.0, Height: 64.0 })
                .and_then(|logo| leer_imagen(logo.OpenReadAsync()?))
                .unwrap_or(None);
            if let Ok(mut cache) = iconos().lock() {
                cache.insert(app.clone(), icono.clone());
            }
            icono
        }
    };

    // Plantilla ToastGeneric: el primer texto es el título y el resto el cuerpo
    let binding = n
        .Notification()?
        .Visual()?
        .GetBinding(&KnownNotificationBindings::ToastGeneric()?)?;
    let textos = binding.GetTextElements()?;
    let mut lineas = (0..textos.Size()?).filter_map(|i| textos.GetAt(i).and_then(|t| t.Text()).ok());
    let titulo = lineas.next().map(|t| t.to_string()).unwrap_or_default();
    let texto = lineas.map(|t| t.to_string()).collect::<Vec<_>>().join("\n");

    Ok(Notificacion { id, fecha, app, icono, titulo, texto })
}

/// Ejecuta una consulta WinRT en un hilo aparte (las llamadas bloquean) y la convierte en texto de error.
async fn en_hilo<T: Send + 'static>(f: impl FnOnce(&Escucha) -> WinResult<T> + Send + 'static) -> Result<T, String> {
    spawn_blocking(move || {
        iniciar_winrt();
        let escucha = Escucha::Current()?;
        f(&escucha)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Notificaciones pendientes, de la más reciente a la más antigua.
#[tauri::command]
pub async fn listar_notificaciones() -> Result<Vec<Notificacion>, String> {
    en_hilo(|escucha| {
        let mut lista: Vec<Notificacion> = consultar(escucha)?
            .iter()
            .filter_map(|n| leer(n).map_err(|e| eprintln!("notificaciones: {e}")).ok())
            .collect();
        lista.sort_by_key(|n| std::cmp::Reverse(n.fecha));
        Ok(lista)
    })
    .await
}

/// Descarta una notificación (también desaparece del Centro de actividades).
#[tauri::command]
pub async fn eliminar_notificacion(app: AppHandle, id: u32) -> Result<(), String> {
    let quedan = en_hilo(move |escucha| {
        escucha.RemoveNotification(id)?;
        Ok(consultar(escucha)?.len())
    })
    .await?;
    fijar_pendientes(&app, quedan);
    Ok(())
}

/// Abre la app que envió la notificación y la descarta, como al pulsarla en Windows.
/// Windows no deja que otra app active el contenido concreto (el chat, el correo): solo la app.
#[tauri::command]
pub async fn abrir_notificacion(app: AppHandle, id: u32) -> Result<(), String> {
    let (aumid, quedan) = en_hilo(move |escucha| {
        let aumid = escucha.GetNotification(id)?.AppInfo()?.AppUserModelId()?.to_string();
        escucha.RemoveNotification(id)?;
        Ok((aumid, consultar(escucha)?.len()))
    })
    .await?;
    fijar_pendientes(&app, quedan);
    // shell:AppsFolder abre cualquier app por su AUMID (de la Store o de escritorio)
    Command::new("explorer.exe")
        .arg(format!("shell:AppsFolder\\{aumid}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Descarta todas las notificaciones.
#[tauri::command]
pub async fn eliminar_notificaciones(app: AppHandle) -> Result<(), String> {
    en_hilo(|escucha| escucha.ClearNotifications()).await?;
    fijar_pendientes(&app, 0);
    Ok(())
}

/// Abre Configuración > Sistema > Notificaciones, donde se activa "No molestar" (o el
/// Asistente de concentración en Windows 10) o se quitan los banners de cada app, para que
/// las notificaciones solo se vean en los globos del compañero.
#[tauri::command]
pub fn abrir_ajustes_banners(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("ms-settings:notifications", None::<&str>)
        .map_err(|e| e.to_string())
}

/// Abre Configuración > Privacidad > Notificaciones para conceder el permiso.
#[tauri::command]
pub fn abrir_ajustes_notificaciones(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("ms-settings:privacy-notifications", None::<&str>)
        .map_err(|e| e.to_string())
}
