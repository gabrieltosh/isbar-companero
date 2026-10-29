//! Multimedia del sistema mediante SMTC (GlobalSystemMediaTransportControls).
//!
//! Un hilo propio se suscribe a los cambios de sesión, canción, estado y línea de
//! tiempo, y emite `media-update` al frontend con `InfoMedia` (o `null` sin sesión).
//! Los eventos de WinRT llegan en hilos arbitrarios: solo mandan una señal por un
//! canal y es el hilo de multimedia el que vuelve a leer todo.

use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::Result as WinResult;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Sesion,
    GlobalSystemMediaTransportControlsSessionManager as Gestor,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as EstadoReproduccion,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows_future::IAsyncOperation;

/// Cada cuánto se relee aunque no llegue ningún evento (algunos navegadores no avisan).
const REFRESCO: Duration = Duration::from_secs(5);
/// Diferencia de posición a partir de la cual se reenvía aunque nada más cambie.
const DERIVA_MAX_MS: f64 = 2000.0;
/// Las carátulas enormes no se envían (el evento viaja como JSON).
const CARATULA_MAX_BYTES: u64 = 2 * 1024 * 1024;
/// Diferencia entre la época de Windows (1601) y la de Unix (1970), en unidades de 100 ns.
const EPOCA_WINDOWS_A_UNIX: i64 = 116_444_736_000_000_000;

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InfoMedia {
    titulo: String,
    artista: String,
    reproduciendo: bool,
    duracion_ms: f64,
    posicion_ms: f64,
    app: String,
    caratula: Option<String>,
}

impl InfoMedia {
    /// Igual salvo la posición, que avanza sola en el frontend.
    fn mismo_contenido(&self, otro: &InfoMedia) -> bool {
        self.titulo == otro.titulo
            && self.artista == otro.artista
            && self.reproduciendo == otro.reproduciendo
            && self.duracion_ms == otro.duracion_ms
            && self.app == otro.app
            && self.caratula == otro.caratula
    }
}

enum Senal {
    /// Cambió la sesión activa: hay que volver a suscribirse.
    Sesion,
    /// Cambió algo de la sesión actual.
    Datos,
}

/// Inicializa WinRT en el hilo actual. Si ya lo estaba, el error se ignora.
pub(crate) fn iniciar_winrt() {
    // SAFETY: RoInitialize solo prepara el apartamento COM del hilo actual.
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
}

pub fn iniciar(app: AppHandle) {
    thread::spawn(move || {
        if let Err(e) = bucle(&app) {
            eprintln!("multimedia: {e}");
        }
    });
}

/// Manejador de evento WinRT que solo avisa al hilo de multimedia.
fn manejador<A: windows::core::RuntimeType + 'static>(tx: &Sender<Senal>) -> TypedEventHandler<Sesion, A> {
    let tx = tx.clone();
    TypedEventHandler::new(move |_, _| {
        let _ = tx.send(Senal::Datos);
        Ok(())
    })
}

struct Suscripcion {
    sesion: Sesion,
    tokens: [i64; 3],
}

impl Suscripcion {
    fn nueva(sesion: Sesion, tx: &Sender<Senal>) -> WinResult<Self> {
        let tokens = [
            sesion.MediaPropertiesChanged(&manejador(tx))?,
            sesion.PlaybackInfoChanged(&manejador(tx))?,
            sesion.TimelinePropertiesChanged(&manejador(tx))?,
        ];
        Ok(Self { sesion, tokens })
    }
}

impl Drop for Suscripcion {
    fn drop(&mut self) {
        let [propiedades, reproduccion, linea] = self.tokens;
        let _ = self.sesion.RemoveMediaPropertiesChanged(propiedades);
        let _ = self.sesion.RemovePlaybackInfoChanged(reproduccion);
        let _ = self.sesion.RemoveTimelinePropertiesChanged(linea);
    }
}

fn bucle(app: &AppHandle) -> WinResult<()> {
    iniciar_winrt();
    let gestor = Gestor::RequestAsync()?.join()?;
    let (tx, rx) = mpsc::channel::<Senal>();

    let tx_sesion = tx.clone();
    gestor.CurrentSessionChanged(&TypedEventHandler::new(move |_, _| {
        let _ = tx_sesion.send(Senal::Sesion);
        Ok(())
    }))?;

    let mut suscripcion: Option<Suscripcion> = None;
    let mut caratula = CacheCaratula::default();
    let mut ultimo: Option<(InfoMedia, Instant)> = None;
    let mut primera = true;
    let _ = tx.send(Senal::Sesion);

    loop {
        // Agrupa las señales que llegan seguidas para leer una sola vez
        let (mut cambio_sesion, mut por_evento) = match rx.recv_timeout(REFRESCO) {
            Ok(Senal::Sesion) => (true, true),
            Ok(Senal::Datos) => (false, true),
            Err(RecvTimeoutError::Timeout) => (false, false),
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        };
        thread::sleep(Duration::from_millis(60));
        while let Ok(s) = rx.try_recv() {
            por_evento = true;
            cambio_sesion |= matches!(s, Senal::Sesion);
        }

        if cambio_sesion {
            suscripcion = None;
            if let Ok(sesion) = gestor.GetCurrentSession() {
                match Suscripcion::nueva(sesion, &tx) {
                    Ok(s) => suscripcion = Some(s),
                    Err(e) => eprintln!("multimedia: no se pudo suscribir: {e}"),
                }
            }
        }

        let info = match &suscripcion {
            Some(s) => leer(&s.sesion, &mut caratula).ok(),
            None => None,
        };

        if primera || por_evento || hay_que_reenviar(&info, &ultimo) {
            primera = false;
            let _ = app.emit("media-update", &info);
            ultimo = info.map(|i| (i, Instant::now()));
        }
    }
}

/// Sin eventos, solo se reenvía si cambió el contenido o la posición se desvió.
fn hay_que_reenviar(info: &Option<InfoMedia>, ultimo: &Option<(InfoMedia, Instant)>) -> bool {
    match (info, ultimo) {
        (None, None) => false,
        (Some(nueva), Some((vieja, cuando))) => {
            if !nueva.mismo_contenido(vieja) {
                return true;
            }
            let avance = if vieja.reproduciendo {
                cuando.elapsed().as_secs_f64() * 1000.0
            } else {
                0.0
            };
            (nueva.posicion_ms - (vieja.posicion_ms + avance)).abs() > DERIVA_MAX_MS
        }
        _ => true,
    }
}

fn leer(sesion: &Sesion, caratula: &mut CacheCaratula) -> WinResult<InfoMedia> {
    let propiedades = sesion.TryGetMediaPropertiesAsync()?.join()?;
    let titulo = propiedades.Title()?.to_string();
    let artista = propiedades.Artist()?.to_string();

    let reproduciendo = sesion
        .GetPlaybackInfo()
        .and_then(|p| p.PlaybackStatus())
        .map(|e| e == EstadoReproduccion::Playing)
        .unwrap_or(false);

    let (duracion_ms, posicion_ms) = linea_de_tiempo(sesion, reproduciendo).unwrap_or((0.0, 0.0));
    let app = nombre_app(&sesion.SourceAppUserModelId()?.to_string());

    let clave = format!("{app}\u{1}{titulo}\u{1}{artista}");
    let caratula = caratula.obtener(&clave, || {
        let referencia = propiedades.Thumbnail()?;
        leer_imagen(referencia.OpenReadAsync()?)
    });

    Ok(InfoMedia {
        titulo,
        artista,
        reproduciendo,
        duracion_ms,
        posicion_ms,
        app,
        caratula,
    })
}

/// Duración y posición en ms. La posición que da Windows es la del momento
/// `LastUpdatedTime`, así que si está sonando se le suma el tiempo transcurrido.
fn linea_de_tiempo(sesion: &Sesion, reproduciendo: bool) -> WinResult<(f64, f64)> {
    let t = sesion.GetTimelineProperties()?;
    let inicio = t.StartTime()?.Duration;
    let fin = t.EndTime()?.Duration;
    let mut posicion = t.Position()?.Duration - inicio;

    if reproduciendo {
        let actualizado = t.LastUpdatedTime()?.UniversalTime;
        let ahora = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as i64 / 100 + EPOCA_WINDOWS_A_UNIX)
            .unwrap_or(actualizado);
        if actualizado > 0 && ahora > actualizado {
            posicion += ahora - actualizado;
        }
    }

    let duracion = (fin - inicio).max(0);
    if duracion > 0 {
        posicion = posicion.clamp(0, duracion);
    }
    // Las unidades de WinRT son de 100 ns
    Ok((duracion as f64 / 10_000.0, posicion.max(0) as f64 / 10_000.0))
}

/// Convierte el AppUserModelId en un nombre legible: "Spotify.exe" → "Spotify",
/// "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" → "Spotify", "MSEdge" → "Edge".
fn nombre_app(id: &str) -> String {
    let base = id.rsplit('!').next().unwrap_or(id);
    let base = base.rsplit(['\\', '/']).next().unwrap_or(base);
    let base = base.strip_suffix(".exe").unwrap_or(base);
    match base.to_ascii_lowercase().as_str() {
        "msedge" => "Edge".into(),
        "chrome" => "Chrome".into(),
        "firefox" | "308046b0af4a39cb" => "Firefox".into(),
        _ => base.to_string(),
    }
}

/// La carátula solo se vuelve a leer cuando cambia la canción.
#[derive(Default)]
struct CacheCaratula {
    clave: String,
    valor: Option<String>,
}

impl CacheCaratula {
    fn obtener(&mut self, clave: &str, cargar: impl FnOnce() -> WinResult<Option<String>>) -> Option<String> {
        // Si aún no había carátula se reintenta: algunas apps la publican un poco después
        if self.clave != clave || self.valor.is_none() {
            self.clave = clave.to_string();
            self.valor = cargar().unwrap_or(None);
        }
        self.valor.clone()
    }
}

/// Lee una imagen de WinRT (carátula, logo de app) como data URL.
pub(crate) fn leer_imagen(
    operacion: IAsyncOperation<windows::Storage::Streams::IRandomAccessStreamWithContentType>,
) -> WinResult<Option<String>> {
    let flujo = operacion.join()?;
    let tam = flujo.Size()?;
    if tam == 0 || tam > CARATULA_MAX_BYTES {
        return Ok(None);
    }
    let lector = DataReader::CreateDataReader(&flujo)?;
    let leidos = lector.LoadAsync(tam as u32)?.join()?;
    let mut bytes = vec![0u8; leidos as usize];
    lector.ReadBytes(&mut bytes)?;

    let tipo = flujo.ContentType().map(|t| t.to_string()).unwrap_or_default();
    let tipo = if tipo.starts_with("image/") { tipo } else { "image/png".into() };
    let datos = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:{tipo};base64,{datos}")))
}

// ---------- Comandos ----------

/// Ejecuta una acción sobre la sesión actual en un hilo bloqueante,
/// para no frenar el hilo principal de Tauri.
/// Devuelve si el reproductor aceptó la orden.
async fn sobre_sesion(
    accion: impl FnOnce(&Sesion) -> WinResult<IAsyncOperation<bool>> + Send + 'static,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> WinResult<bool> {
        iniciar_winrt();
        let sesion = Gestor::RequestAsync()?.join()?.GetCurrentSession()?;
        accion(&sesion)?.join()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("No hay ninguna sesión multimedia activa ({e})"))
}

#[tauri::command]
pub async fn media_play_pause() -> Result<(), String> {
    sobre_sesion(|s| s.TryTogglePlayPauseAsync()).await.map(|_| ())
}

#[tauri::command]
pub async fn media_next() -> Result<(), String> {
    sobre_sesion(|s| s.TrySkipNextAsync()).await.map(|_| ())
}

#[tauri::command]
pub async fn media_previous() -> Result<(), String> {
    sobre_sesion(|s| s.TrySkipPreviousAsync()).await.map(|_| ())
}

/// Salta a una posición de la canción (en ms). Devuelve si el reproductor lo permite
/// (no todos aceptan que se cambie la posición desde fuera).
#[tauri::command]
pub async fn media_seek(posicion_ms: u64) -> Result<bool, String> {
    // WinRT mide el tiempo en unidades de 100 ns
    let ticks = i64::try_from(posicion_ms).unwrap_or(i64::MAX / 10_000).saturating_mul(10_000);
    sobre_sesion(move |s| s.TryChangePlaybackPositionAsync(ticks)).await
}
