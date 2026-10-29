//! Sonido de la música, para que el compañero baile con ella.
//!
//! Se escucha con WASAPI en modo loopback (lo mismo que suena). Si se sabe qué app pone la
//! música (la de SMTC, ver media.rs) y Windows lo admite (Windows 10 2004 o posterior), se
//! escucha **solo esa app**: así no baila con avisos, videollamadas ni juegos. Si no, se
//! escucha la mezcla de todo el dispositivo de salida.
//! No se graba ni se guarda: cada trozo se analiza en memoria (ritmo.rs) y se descarta, y al
//! compañero solo le llegan unas cifras (nivel, bandas, golpe, tempo, pulso y secciones).
//! El loopback mide antes del volumen general: si está silenciado o al 0 % se analiza silencio
//! (sin volumen, el compañero no baila). Con cualquier otro volumen se analiza tal cual, porque
//! unos cascos al 5 % pueden sonar fuerte; el compañero ajusta la escala solo.
//! El compañero lo pide con `escuchar_audio(true)` mientras suena música; entonces se emite
//! `audio-ritmo` unas 30 veces por segundo.

use std::ffi::c_void;
use std::mem::ManuallyDrop;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, ActivateAudioInterfaceAsync, AudioSessionStateActive, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient,
    IAudioClient, IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX,
    WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, BLOB, CLSCTX_ALL, COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::CreateEventW;
use windows::Win32::System::Variant::VT_BLOB;
use windows::core::{implement, Interface, GUID, HRESULT};

use crate::ritmo::Analizador;

/// Cada cuánto se recogen las muestras nuevas.
const LEER: Duration = Duration::from_millis(8);
/// Cada cuánto se manda el estado al compañero.
const EMITIR: Duration = Duration::from_millis(33);
/// Sin escuchar, cada cuánto se mira si hay que empezar.
const ESPERA: Duration = Duration::from_millis(250);
/// Cada cuánto se mira si ha cambiado el dispositivo (de altavoces a cascos…) o la app de música.
const REVISAR_ORIGEN: Duration = Duration::from_secs(3);
/// Cada cuánto se mira si está silenciado o con el volumen a cero.
const REVISAR_VOLUMEN: Duration = Duration::from_millis(250);
/// Sin muestras nuevas en este tiempo (no suena nada), se analiza silencio.
const SIN_MUESTRAS: Duration = Duration::from_millis(60);
/// Lo que se espera a que Windows prepare la escucha de una app.
const ESPERA_ACTIVAR: Duration = Duration::from_secs(2);
/// Búfer que pide el loopback (en unidades de 100 ns): 200 ms.
const BUFER: i64 = 2_000_000;
/// Formato en que se pide el sonido de una app (Windows lo convierte): 48 kHz, estéreo, 16 bits.
const FRECUENCIA_APP: u32 = 48_000;
const CANALES_APP: u16 = 2;

const FORMATO_PCM: u16 = 1;
const FORMATO_FLOAT: u16 = 3;
const FORMATO_EXTENSIBLE: u16 = 0xFFFE;
const SUBTIPO_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const SUBTIPO_FLOAT: GUID = GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
/// AUDCLNT_E_UNSUPPORTED_FORMAT
const FORMATO_NO_ADMITIDO: HRESULT = HRESULT(0x8889_0008u32 as i32);

static ESCUCHANDO: AtomicBool = AtomicBool::new(false);

/// El compañero pide empezar o dejar de escuchar (solo mientras suena música).
#[tauri::command]
pub fn escuchar_audio(activo: bool) {
    ESCUCHANDO.store(activo, Ordering::SeqCst);
}

#[derive(Clone, Copy)]
enum Muestra {
    Float,
    Entero16,
}

/// Qué se escucha: el dispositivo de salida y, si se encontró, el proceso de la app de música.
#[derive(Clone, PartialEq, Debug)]
struct Origen {
    dispositivo: String,
    proceso: Option<u32>,
}

/// Una escucha abierta (de todo el dispositivo o de una app).
struct Captura {
    cliente: IAudioClient,
    captura: IAudioCaptureClient,
    volumen: IAudioEndpointVolume,
    /// Evento que pide la escucha de una app (no se espera en él, se lee cada poco)
    evento: Option<HANDLE>,
    canales: usize,
    muestra: Muestra,
    frecuencia: u32,
}

pub(crate) fn por_defecto() -> windows::core::Result<IMMDevice> {
    // SAFETY: llamadas COM en un hilo con COM iniciado.
    unsafe {
        let enumerador: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        enumerador.GetDefaultAudioEndpoint(eRender, eMultimedia)
    }
}

/// Copia una cadena reservada por COM y la libera.
///
/// SAFETY: `texto` debe venir de COM (CoTaskMemAlloc) y no usarse después.
pub(crate) unsafe fn cadena_com(texto: windows::core::PWSTR) -> String {
    // SAFETY: lo garantiza quien llama.
    unsafe {
        let copia = texto.to_string().unwrap_or_default();
        CoTaskMemFree(Some(texto.0 as *const c_void));
        copia
    }
}

/// Identificador del dispositivo, para saber si ha cambiado.
pub(crate) fn id_de(dispositivo: &IMMDevice) -> windows::core::Result<String> {
    // SAFETY: interfaz COM válida; la cadena se copia y se libera.
    unsafe { Ok(cadena_com(dispositivo.GetId()?)) }
}

/// Proceso que pone el sonido de la app de música (`app`: su AppUserModelId), buscándolo
/// entre las sesiones de audio del dispositivo. Prefiere una sesión que esté sonando.
fn proceso_de_la_app(dispositivo: &IMMDevice, app: &str) -> Option<u32> {
    let app = app.to_lowercase();
    // Firefox se identifica con un código en vez de su nombre
    let app = if app == "308046b0af4a39cb" { "firefox".to_string() } else { app };
    // "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" → paquete y app; "Spotify.exe" → spotify
    let paquete = app.split('!').next().unwrap_or(&app).to_string();
    let nombre = app.rsplit('!').next().unwrap_or(&app).trim_end_matches(".exe").to_string();
    let mut mejor: Option<(u32, bool)> = None;
    // SAFETY: llamadas COM en un hilo con COM iniciado; las cadenas se copian y se liberan.
    unsafe {
        let gestor: IAudioSessionManager2 = dispositivo.Activate(CLSCTX_ALL, None).ok()?;
        let sesiones = gestor.GetSessionEnumerator().ok()?;
        for i in 0..sesiones.GetCount().ok()? {
            let Ok(sesion) = sesiones.GetSession(i).and_then(|s| s.cast::<IAudioSessionControl2>()) else {
                continue;
            };
            // El proceso 0 son los sonidos del sistema
            let pid = sesion.GetProcessId().unwrap_or(0);
            if pid == 0 {
                continue;
            }
            let id = sesion.GetSessionInstanceIdentifier().map(|t| cadena_com(t).to_lowercase()).unwrap_or_default();
            let programa = crate::debajo::programa(pid).unwrap_or_default();
            let programa = programa.trim_end_matches(".exe");
            let coincide = id.contains(&paquete)
                || (programa.len() >= 3 && (app.contains(programa) || programa.contains(nombre.as_str())));
            if !coincide {
                continue;
            }
            let sonando = sesion.GetState().is_ok_and(|e| e == AudioSessionStateActive);
            if mejor.is_none_or(|(_, ya_sonando)| sonando && !ya_sonando) {
                mejor = Some((pid, sonando));
            }
        }
    }
    mejor.map(|(pid, _)| pid)
}

/// Origen que toca ahora: el dispositivo por defecto y el proceso de la app de música.
fn origen_actual() -> Option<(IMMDevice, Origen)> {
    let dispositivo = por_defecto().ok()?;
    let id = id_de(&dispositivo).ok()?;
    let proceso = crate::media::app_actual().and_then(|app| proceso_de_la_app(&dispositivo, &app));
    Some((dispositivo, Origen { dispositivo: id, proceso }))
}

/// Tipo de muestra del formato de mezcla (normalmente float de 32 bits).
///
/// SAFETY: `formato` debe apuntar a un WAVEFORMATEX válido (o WAVEFORMATEXTENSIBLE si lo dice).
unsafe fn tipo_de(formato: *const WAVEFORMATEX) -> Option<Muestra> {
    // SAFETY: lo garantiza quien llama; las estructuras están empaquetadas, se leen sin alinear.
    let f = unsafe { std::ptr::read_unaligned(formato) };
    let subtipo = if f.wFormatTag == FORMATO_EXTENSIBLE {
        // SAFETY: con la etiqueta EXTENSIBLE la estructura completa es WAVEFORMATEXTENSIBLE.
        let e = unsafe { std::ptr::read_unaligned(formato.cast::<WAVEFORMATEXTENSIBLE>()) };
        e.SubFormat
    } else if f.wFormatTag == FORMATO_FLOAT {
        SUBTIPO_FLOAT
    } else if f.wFormatTag == FORMATO_PCM {
        SUBTIPO_PCM
    } else {
        return None;
    };
    match (subtipo, f.wBitsPerSample) {
        (s, 32) if s == SUBTIPO_FLOAT => Some(Muestra::Float),
        (s, 16) if s == SUBTIPO_PCM => Some(Muestra::Entero16),
        _ => None,
    }
}

/// Avisa cuando Windows termina de preparar la escucha de una app. Windows exige que sea
/// ágil (IAgileObject): `implement` ya lo añade solo.
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Preparado(mpsc::Sender<()>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Preparado_Impl {
    fn ActivateCompleted(&self, _operacion: windows::core::Ref<IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

impl Captura {
    /// Todo lo que suena por el dispositivo.
    fn general(dispositivo: &IMMDevice) -> windows::core::Result<Self> {
        // SAFETY: llamadas COM en un hilo con COM iniciado; el formato de mezcla se libera
        // con CoTaskMemFree después de usarlo, pase lo que pase.
        unsafe {
            let cliente: IAudioClient = dispositivo.Activate(CLSCTX_ALL, None)?;
            let mezcla = cliente.GetMixFormat()?;
            let f = std::ptr::read_unaligned(mezcla);
            let muestra = tipo_de(mezcla);
            let iniciado = match muestra {
                Some(_) => cliente.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, BUFER, 0, mezcla, None),
                None => Ok(()),
            };
            CoTaskMemFree(Some(mezcla as *const c_void));
            let Some(muestra) = muestra else {
                return Err(windows::core::Error::new(FORMATO_NO_ADMITIDO, "formato de audio no admitido"));
            };
            iniciado?;
            Self::empezar(dispositivo, cliente, None, usize::from(f.nChannels.max(1)), muestra, f.nSamplesPerSec)
        }
    }

    /// Solo el sonido de un proceso (y los que cuelgan de él).
    fn de_proceso(dispositivo: &IMMDevice, pid: u32) -> windows::core::Result<Self> {
        let mut parametros = AUDIOCLIENT_ACTIVATION_PARAMS {
            ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
            Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
                ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                    TargetProcessId: pid,
                    ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
                },
            },
        };
        // ManuallyDrop: al soltarla, PROPVARIANT llamaría a PropVariantClear, que liberaría el
        // bloque como si fuera de COM (son los parámetros de aquí, en la pila)
        let variante = ManuallyDrop::new(PROPVARIANT {
            Anonymous: PROPVARIANT_0 {
                Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                    vt: VT_BLOB,
                    wReserved1: 0,
                    wReserved2: 0,
                    wReserved3: 0,
                    Anonymous: PROPVARIANT_0_0_0 {
                        blob: BLOB {
                            cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                            pBlobData: (&raw mut parametros).cast::<u8>(),
                        },
                    },
                }),
            },
        });
        let (tx, rx) = mpsc::channel();
        let preparado: IActivateAudioInterfaceCompletionHandler = Preparado(tx).into();
        let bloque = CANALES_APP * 2;
        let formato = WAVEFORMATEX {
            wFormatTag: FORMATO_PCM,
            nChannels: CANALES_APP,
            nSamplesPerSec: FRECUENCIA_APP,
            nAvgBytesPerSec: FRECUENCIA_APP * u32::from(bloque),
            nBlockAlign: bloque,
            wBitsPerSample: 16,
            cbSize: 0,
        };
        // SAFETY: los parámetros (y la variante que apunta a ellos) viven hasta que Windows
        // avisa de que ha terminado, porque se espera aquí mismo; las llamadas COM son de este hilo.
        unsafe {
            let operacion = ActivateAudioInterfaceAsync(
                VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                &IAudioClient::IID,
                Some(&raw const *variante),
                &preparado,
            )?;
            if rx.recv_timeout(ESPERA_ACTIVAR).is_err() {
                return Err(windows::core::Error::new(HRESULT(0x8000_0004u32 as i32), "Windows no preparó la escucha de la app"));
            }
            let mut resultado = HRESULT(0);
            let mut interfaz = None;
            operacion.GetActivateResult(&mut resultado, &mut interfaz)?;
            resultado.ok()?;
            let cliente: IAudioClient = interfaz.ok_or_else(windows::core::Error::empty)?.cast()?;
            let banderas = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
            cliente.Initialize(AUDCLNT_SHAREMODE_SHARED, banderas, BUFER, 0, &formato, None)?;
            let evento = CreateEventW(None, false, false, None)?;
            if let Err(e) = cliente.SetEventHandle(evento) {
                let _ = CloseHandle(evento);
                return Err(e);
            }
            Self::empezar(dispositivo, cliente, Some(evento), usize::from(CANALES_APP), Muestra::Entero16, FRECUENCIA_APP)
        }
    }

    fn empezar(
        dispositivo: &IMMDevice,
        cliente: IAudioClient,
        evento: Option<HANDLE>,
        canales: usize,
        muestra: Muestra,
        frecuencia: u32,
    ) -> windows::core::Result<Self> {
        // SAFETY: llamadas COM en un hilo con COM iniciado, con el cliente ya inicializado.
        unsafe {
            let resultado = (|| {
                let volumen: IAudioEndpointVolume = dispositivo.Activate(CLSCTX_ALL, None)?;
                let captura: IAudioCaptureClient = cliente.GetService()?;
                cliente.Start()?;
                Ok((volumen, captura))
            })();
            match resultado {
                Ok((volumen, captura)) => Ok(Self { cliente, captura, volumen, evento, canales, muestra, frecuencia }),
                Err(e) => {
                    if let Some(evento) = evento {
                        let _ = CloseHandle(evento);
                    }
                    Err(e)
                }
            }
        }
    }

    /// Silenciado o con el volumen a cero.
    fn sin_volumen(&self) -> windows::core::Result<bool> {
        // SAFETY: interfaz COM válida de este hilo.
        unsafe { Ok(self.volumen.GetMute()?.as_bool() || self.volumen.GetMasterVolumeLevelScalar()? <= 0.0) }
    }

    /// Añade a `mono` las muestras nuevas (mezclando los canales). Devuelve si había alguna.
    fn leer(&self, mono: &mut Vec<f32>) -> windows::core::Result<bool> {
        let mut hubo = false;
        // SAFETY: GetBuffer da `marcos * canales` muestras del formato acordado, válidas hasta
        // ReleaseBuffer, que se llama siempre antes de pedir el siguiente paquete.
        unsafe {
            while self.captura.GetNextPacketSize()? > 0 {
                let mut datos: *mut u8 = std::ptr::null_mut();
                let mut marcos = 0u32;
                let mut banderas = 0u32;
                self.captura.GetBuffer(&mut datos, &mut marcos, &mut banderas, None, None)?;
                let n = marcos as usize;
                if banderas & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || datos.is_null() {
                    mono.extend(std::iter::repeat_n(0.0, n));
                } else {
                    let total = n * self.canales;
                    let escala = 1.0 / self.canales as f32;
                    match self.muestra {
                        Muestra::Float => {
                            let s = std::slice::from_raw_parts(datos.cast::<f32>(), total);
                            mono.extend(s.chunks_exact(self.canales).map(|m| m.iter().sum::<f32>() * escala));
                        }
                        Muestra::Entero16 => {
                            let s = std::slice::from_raw_parts(datos.cast::<i16>(), total);
                            let e = escala / 32768.0;
                            mono.extend(s.chunks_exact(self.canales).map(|m| m.iter().map(|&v| f32::from(v)).sum::<f32>() * e));
                        }
                    }
                }
                self.captura.ReleaseBuffer(marcos)?;
                hubo |= n > 0;
            }
        }
        Ok(hubo)
    }
}

impl Drop for Captura {
    fn drop(&mut self) {
        // SAFETY: interfaz COM válida; parar un cliente ya parado no hace nada. El evento es
        // nuestro y nadie más lo usa.
        unsafe {
            let _ = self.cliente.Stop();
            if let Some(evento) = self.evento {
                let _ = CloseHandle(evento);
            }
        }
    }
}

/// Lo que se está escuchando ahora: la captura y su análisis.
struct Escucha {
    captura: Captura,
    /// Lo que se pidió al abrirla (aunque la escucha de la app fallara y se escuche todo)
    pedido: Origen,
    analizador: Analizador,
    sin_volumen: bool,
    volumen_revisado: Instant,
    /// Hasta cuándo se ha analizado (para rellenar con silencio si no llega nada)
    analizado: Instant,
}

impl Escucha {
    /// Abre la escucha pedida. Si viene de otra escucha con la misma frecuencia (`anterior`:
    /// frecuencia y análisis), sigue con su análisis: no pierde el tempo ni el pulso al cambiar
    /// de cascos a altavoces.
    fn abrir(dispositivo: &IMMDevice, pedido: Origen, anterior: Option<(u32, Analizador)>) -> Option<Self> {
        let de_la_app = pedido.proceso.and_then(|pid| {
            Captura::de_proceso(dispositivo, pid)
                .map_err(|e| eprintln!("audio: no se pudo escuchar solo la app de música ({e}); se escucha todo"))
                .ok()
        });
        let captura = match de_la_app {
            Some(c) => c,
            None => Captura::general(dispositivo).map_err(|e| eprintln!("audio: sin loopback: {e}")).ok()?,
        };
        let analizador = match anterior {
            Some((frecuencia, analizador)) if frecuencia == captura.frecuencia => analizador,
            _ => Analizador::nuevo(captura.frecuencia),
        };
        Some(Self {
            captura,
            pedido,
            analizador,
            sin_volumen: false,
            volumen_revisado: Instant::now() - REVISAR_VOLUMEN,
            analizado: Instant::now(),
        })
    }

    /// Recoge y analiza lo nuevo. Error si el dispositivo ha dejado de funcionar.
    fn paso(&mut self, mono: &mut Vec<f32>) -> windows::core::Result<()> {
        if self.volumen_revisado.elapsed() >= REVISAR_VOLUMEN {
            self.sin_volumen = self.captura.sin_volumen()?;
            self.volumen_revisado = Instant::now();
        }
        mono.clear();
        let hubo = self.captura.leer(mono)?;
        let ahora = Instant::now();
        if hubo {
            self.analizado = ahora;
        } else {
            // Si no suena nada, Windows no manda muestras: se analiza silencio para que el
            // pulso siga avanzando y el compañero sepa que no hay música
            let pasado = ahora - self.analizado;
            if pasado < SIN_MUESTRAS {
                return Ok(());
            }
            let n = (pasado.as_secs_f32().min(0.5) * self.captura.frecuencia as f32) as usize;
            mono.resize(n, 0.0);
            self.analizado = ahora;
        }
        if self.sin_volumen {
            mono.fill(0.0);
        }
        self.analizador.procesar(mono);
        Ok(())
    }
}

pub fn iniciar(app: AppHandle) {
    thread::spawn(move || {
        // SAFETY: inicia COM para este hilo; si ya lo estaba, el error se ignora.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let mut escucha: Option<Escucha> = None;
        let mut mono: Vec<f32> = Vec::new();
        let mut revisado = Instant::now();
        let mut emitido = Instant::now();
        loop {
            if !ESCUCHANDO.load(Ordering::SeqCst) {
                escucha = None;
                thread::sleep(ESPERA);
                continue;
            }
            // Al empezar, y si cambia el dispositivo de salida o la app de música, se abre de nuevo
            if escucha.is_none() || revisado.elapsed() >= REVISAR_ORIGEN {
                revisado = Instant::now();
                if let Some((dispositivo, pedido)) = origen_actual()
                    && escucha.as_ref().is_none_or(|e| e.pedido != pedido)
                {
                    // Se suelta la captura anterior antes de abrir la nueva (su análisis se guarda)
                    let anterior = escucha.take().map(|e| (e.captura.frecuencia, e.analizador));
                    escucha = Escucha::abrir(&dispositivo, pedido, anterior);
                }
            }
            let Some(e) = escucha.as_mut() else {
                thread::sleep(ESPERA);
                continue;
            };
            if let Err(error) = e.paso(&mut mono) {
                eprintln!("audio: {error}");
                escucha = None;
                continue;
            }
            if emitido.elapsed() >= EMITIR {
                emitido = Instant::now();
                let _ = app.emit("audio-ritmo", e.analizador.estado());
            }
            thread::sleep(LEER);
        }
    });
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;

    fn pico(muestras: &[f32]) -> f32 {
        muestras.iter().fold(0.0f32, |a, m| a.max(m.abs()))
    }

    /// Diagnóstico contra el sistema de verdad: lista las sesiones de audio y escucha a la vez
    /// toda la salida y solo una app durante 3 s (si la app suena, su pico no es cero; si suena
    /// otra cosa, solo sube el general). Se lanza a mano, con la app que se quiera probar:
    /// `APP_PRUEBA=Spotify.exe cargo test --lib audio -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn escuchar_el_sistema() {
        // SAFETY: inicia COM para este hilo de prueba.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let dispositivo = por_defecto().expect("dispositivo");
        // SAFETY: llamadas COM de prueba en este hilo.
        unsafe {
            let gestor: IAudioSessionManager2 = dispositivo.Activate(CLSCTX_ALL, None).expect("gestor");
            let sesiones = gestor.GetSessionEnumerator().expect("sesiones");
            for i in 0..sesiones.GetCount().expect("cuenta") {
                let control = sesiones.GetSession(i).expect("sesión");
                let pid = control.cast::<IAudioSessionControl2>().and_then(|s| s.GetProcessId()).unwrap_or(0);
                let nivel = control.cast::<IAudioMeterInformation>().and_then(|m| m.GetPeakValue()).unwrap_or(-1.0);
                let sonando = control.GetState().is_ok_and(|e| e == AudioSessionStateActive);
                println!("sesión: proceso {pid} {:?}, sonando {sonando}, pico {nivel:.3}", crate::debajo::programa(pid));
            }
        }
        let app = std::env::var("APP_PRUEBA").unwrap_or_else(|_| "Spotify.exe".into());
        let pid = proceso_de_la_app(&dispositivo, &app);
        println!("{app}: proceso {pid:?}");
        let general = Captura::general(&dispositivo).expect("loopback general");
        // Sin la app, se escucha este mismo proceso (en silencio) para probar que abre bien
        let solo_app = Captura::de_proceso(&dispositivo, pid.unwrap_or(std::process::id())).expect("loopback de la app");
        let (mut todo, mut de_la_app) = (Vec::new(), Vec::new());
        for _ in 0..300 {
            thread::sleep(Duration::from_millis(10));
            general.leer(&mut todo).expect("leer general");
            solo_app.leer(&mut de_la_app).expect("leer la app");
        }
        println!("general: {} muestras a {} Hz, pico {:.3}", todo.len(), general.frecuencia, pico(&todo));
        println!("solo la app: {} muestras, pico {:.3}", de_la_app.len(), pico(&de_la_app));
    }
}
