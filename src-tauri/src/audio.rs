//! Nivel del sonido que sale por los altavoces, para que el compañero baile con la música.
//!
//! Solo se lee el medidor de pico de Windows (lo mismo que dibuja la barra verde de
//! Configuración > Sonido): un número de 0 a 1. No se graba ni se analiza el audio.
//! El medidor mide antes del volumen general, así que se multiplica por ese volumen (y es 0
//! en silencio): sin volumen, el compañero no baila.
//! El compañero lo pide con `escuchar_audio(true)` mientras suena música; entonces se emite
//! `audio-nivel` unas 30 veces por segundo.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

/// Cada cuánto se lee el nivel mientras se escucha.
const PASO: Duration = Duration::from_millis(33);
/// Sin escuchar, cada cuánto se mira si hay que empezar.
const ESPERA: Duration = Duration::from_millis(250);
/// Cada cuánto se vuelve a buscar el dispositivo (por si cambias de altavoces a cascos).
const RENOVAR_DISPOSITIVO: Duration = Duration::from_secs(3);

static ESCUCHANDO: AtomicBool = AtomicBool::new(false);

/// El compañero pide empezar o dejar de leer el nivel (solo mientras suena música).
#[tauri::command]
pub fn escuchar_audio(activo: bool) {
    ESCUCHANDO.store(activo, Ordering::SeqCst);
}

/// Medidor y volumen del dispositivo de salida por defecto (altavoces, cascos USB o Bluetooth…).
struct Salida {
    medidor: IAudioMeterInformation,
    volumen: IAudioEndpointVolume,
}

impl Salida {
    fn buscar() -> windows::core::Result<Self> {
        // SAFETY: llamadas COM en un hilo con COM iniciado; las interfaces se liberan solas al soltarlas.
        unsafe {
            let enumerador: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let dispositivo = enumerador.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            Ok(Self {
                medidor: dispositivo.Activate(CLSCTX_ALL, None)?,
                volumen: dispositivo.Activate(CLSCTX_ALL, None)?,
            })
        }
    }

    /// Nivel que se oye: el pico por el volumen general (0 si está en silencio).
    fn nivel(&self) -> windows::core::Result<f32> {
        // SAFETY: interfaces COM válidas de este hilo.
        unsafe {
            if self.volumen.GetMute()?.as_bool() {
                return Ok(0.0);
            }
            Ok(self.medidor.GetPeakValue()? * self.volumen.GetMasterVolumeLevelScalar()?)
        }
    }
}

pub fn iniciar(app: AppHandle) {
    thread::spawn(move || {
        // SAFETY: inicia COM para este hilo; si ya lo estaba, el error se ignora.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let mut actual: Option<Salida> = None;
        let mut renovado = Instant::now();
        loop {
            if !ESCUCHANDO.load(Ordering::SeqCst) {
                actual = None;
                thread::sleep(ESPERA);
                continue;
            }
            if actual.is_none() || renovado.elapsed() > RENOVAR_DISPOSITIVO {
                actual = Salida::buscar().map_err(|e| eprintln!("audio: sin medidor: {e}")).ok();
                renovado = Instant::now();
            }
            let nivel = actual.as_ref().and_then(|s| s.nivel().ok());
            match nivel {
                Some(nivel) => {
                    let _ = app.emit("audio-nivel", nivel);
                }
                None => actual = None,
            }
            thread::sleep(PASO);
        }
    });
}
