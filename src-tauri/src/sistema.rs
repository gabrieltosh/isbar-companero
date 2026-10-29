//! Estado del sistema para el panel y el compañero: batería, volumen, conexión y uso del PC.
//!
//! Un hilo propio lo lee cada poco (el volumen cada 250 ms, para notar enseguida si se cambia
//! con el teclado; lo demás más despacio) y emite `sistema-estado` solo cuando algo cambia.
//! El panel pide el estado al abrirse con `estado_sistema` y puede cambiar el volumen.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Devices::Power::Battery;
use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Foundation::FILETIME;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::IMMDevice;
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::GetSystemTimes;

use crate::audio::{cadena_com, id_de, por_defecto};

/// Cada cuánto se mira el volumen (y se da una vuelta al bucle).
const PASO: Duration = Duration::from_millis(250);
const CADA_BATERIA: Duration = Duration::from_secs(5);
const CADA_CONEXION: Duration = Duration::from_secs(3);
const CADA_USO: Duration = Duration::from_secs(2);
/// Cada cuánto se mira si ha cambiado el dispositivo de salida.
const CADA_DISPOSITIVO: Duration = Duration::from_secs(1);

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Bateria {
    /// 0 a 100
    porcentaje: u8,
    /// Enchufado a la corriente
    enchufado: bool,
    cargando: bool,
    /// Ahorro de batería de Windows activado
    ahorro: bool,
    /// Lo que le queda descargándose, si Windows lo sabe
    minutos_restantes: Option<u32>,
    /// Lo que le falta para cargarse del todo, si está cargando
    minutos_para_llenar: Option<u32>,
    /// Consumo (descargando) o potencia de carga, en vatios
    vatios: Option<f32>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Volumen {
    /// 0 a 100
    nivel: u8,
    silencio: bool,
    /// Nombre del dispositivo de salida ("Altavoces (Realtek…)", "Auriculares…")
    dispositivo: String,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Conexion {
    /// Conectado a alguna red
    conectado: bool,
    /// Con salida a internet
    internet: bool,
    wifi: bool,
    /// Nombre de la red (el de la wifi o "Ethernet")
    nombre: Option<String>,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Uso {
    /// Procesador, 0 a 100
    cpu: u8,
    /// Memoria en uso, 0 a 100, y en GB
    memoria: u8,
    memoria_usada: f32,
    memoria_total: f32,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EstadoSistema {
    /// Sin batería (PC de sobremesa), null
    bateria: Option<Bateria>,
    volumen: Option<Volumen>,
    conexion: Option<Conexion>,
    uso: Option<Uso>,
}

static ULTIMO: Mutex<Option<EstadoSistema>> = Mutex::new(None);

/// Estado actual (el panel lo pide al abrirse).
#[tauri::command]
pub fn estado_sistema() -> Option<EstadoSistema> {
    ULTIMO.lock().ok().and_then(|e| e.clone())
}

/// Volumen del dispositivo de salida por defecto (0 a 100).
#[tauri::command]
pub async fn fijar_volumen(nivel: u8) -> Result<(), String> {
    con_volumen(move |v| {
        // SAFETY: interfaz COM válida de este hilo.
        unsafe { v.SetMasterVolumeLevelScalar(f32::from(nivel.min(100)) / 100.0, std::ptr::null()) }
    })
    .await
}

/// Silencia o quita el silencio.
#[tauri::command]
pub async fn alternar_silencio() -> Result<(), String> {
    con_volumen(|v| {
        // SAFETY: interfaz COM válida de este hilo.
        unsafe { v.SetMute(!v.GetMute()?.as_bool(), std::ptr::null()) }
    })
    .await
}

/// Ejecuta algo con el control de volumen en un hilo aparte (las llamadas COM bloquean).
async fn con_volumen(
    accion: impl FnOnce(&IAudioEndpointVolume) -> windows::core::Result<()> + Send + 'static,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // SAFETY: inicia COM para este hilo; si ya lo estaba, el error se ignora.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let dispositivo = por_defecto()?;
        // SAFETY: llamada COM en un hilo con COM iniciado.
        let volumen: IAudioEndpointVolume = unsafe { dispositivo.Activate(CLSCTX_ALL, None)? };
        accion(&volumen)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

/// Batería con GetSystemPowerStatus; el consumo, con el informe de batería de WinRT.
fn leer_bateria() -> Option<Bateria> {
    let mut s = SYSTEM_POWER_STATUS::default();
    // SAFETY: rellena una estructura nuestra.
    unsafe { GetSystemPowerStatus(&mut s).ok()? };
    // 128: no hay batería; 255: no se sabe
    if s.BatteryFlag & 128 != 0 || s.BatteryFlag == 255 || s.BatteryLifePercent > 100 {
        return None;
    }
    let enchufado = s.ACLineStatus == 1;
    let informe = Battery::AggregateBattery().and_then(|b| b.GetReport()).ok();
    let valor = |r: windows::core::Result<windows::Foundation::IReference<i32>>| r.and_then(|v| v.Value()).ok();
    let tasa = informe.as_ref().and_then(|i| valor(i.ChargeRateInMilliwatts()));
    let queda = informe.as_ref().and_then(|i| valor(i.RemainingCapacityInMilliwattHours()));
    let llena = informe.as_ref().and_then(|i| valor(i.FullChargeCapacityInMilliwattHours()));
    let cargando = s.BatteryFlag & 8 != 0 || tasa.is_some_and(|t| t > 0);
    let minutos_para_llenar = match (tasa, queda, llena) {
        (Some(t), Some(q), Some(l)) if cargando && t > 0 && l > q => Some(((l - q) as f32 / t as f32 * 60.0).round() as u32),
        _ => None,
    };
    Some(Bateria {
        porcentaje: s.BatteryLifePercent,
        enchufado,
        cargando,
        ahorro: s.SystemStatusFlag == 1,
        minutos_restantes: (!enchufado && s.BatteryLifeTime != u32::MAX).then_some(s.BatteryLifeTime / 60),
        minutos_para_llenar,
        // Redondeado a décimas: así no se emite por cambios mínimos
        vatios: tasa.filter(|t| *t != 0).map(|t| (t.unsigned_abs() as f32 / 100.0).round() / 10.0),
    })
}

/// Nombre del dispositivo de salida.
fn nombre_de(dispositivo: &IMMDevice) -> Option<String> {
    // SAFETY: llamadas COM en un hilo con COM iniciado; la cadena se copia y se libera, y la
    // PROPVARIANT se libera sola al soltarla.
    unsafe {
        let propiedades = dispositivo.OpenPropertyStore(STGM_READ).ok()?;
        let valor = propiedades.GetValue(&PKEY_Device_FriendlyName).ok()?;
        Some(cadena_com(PropVariantToStringAlloc(&valor).ok()?))
    }
}

/// Control de volumen del dispositivo de salida por defecto, con su id y su nombre.
struct Salida {
    id: String,
    nombre: String,
    volumen: IAudioEndpointVolume,
}

impl Salida {
    fn abrir() -> Option<Self> {
        let dispositivo = por_defecto().ok()?;
        // SAFETY: llamada COM en un hilo con COM iniciado.
        let volumen = unsafe { dispositivo.Activate(CLSCTX_ALL, None).ok()? };
        Some(Self { id: id_de(&dispositivo).ok()?, nombre: nombre_de(&dispositivo).unwrap_or_default(), volumen })
    }

    fn leer(&self) -> Option<Volumen> {
        // SAFETY: interfaz COM válida de este hilo.
        unsafe {
            Some(Volumen {
                nivel: (self.volumen.GetMasterVolumeLevelScalar().ok()? * 100.0).round() as u8,
                silencio: self.volumen.GetMute().ok()?.as_bool(),
                dispositivo: self.nombre.clone(),
            })
        }
    }
}

fn leer_conexion() -> Conexion {
    let Ok(perfil) = NetworkInformation::GetInternetConnectionProfile() else {
        return Conexion { conectado: false, internet: false, wifi: false, nombre: None };
    };
    let nivel = perfil.GetNetworkConnectivityLevel().unwrap_or(NetworkConnectivityLevel::None);
    Conexion {
        conectado: nivel != NetworkConnectivityLevel::None,
        internet: nivel == NetworkConnectivityLevel::InternetAccess,
        wifi: perfil.IsWlanConnectionProfile().unwrap_or(false),
        nombre: perfil.ProfileName().ok().map(|n| n.to_string()).filter(|n| !n.is_empty()),
    }
}

/// Tiempos del procesador (reposo y total) para calcular el uso entre dos lecturas.
fn tiempos_cpu() -> Option<(u64, u64)> {
    let (mut reposo, mut nucleo, mut usuario) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    // SAFETY: rellena estructuras nuestras.
    unsafe { GetSystemTimes(Some(&mut reposo), Some(&mut nucleo), Some(&mut usuario)).ok()? };
    let n = |f: FILETIME| (u64::from(f.dwHighDateTime) << 32) | u64::from(f.dwLowDateTime);
    // El tiempo de núcleo ya incluye el de reposo
    Some((n(reposo), n(nucleo) + n(usuario)))
}

fn leer_uso(antes: &mut Option<(u64, u64)>) -> Option<Uso> {
    let ahora = tiempos_cpu()?;
    let cpu = match *antes {
        Some((reposo, total)) if ahora.1 > total => {
            let ocupado = 1.0 - (ahora.0 - reposo) as f32 / (ahora.1 - total) as f32;
            (ocupado.clamp(0.0, 1.0) * 100.0).round() as u8
        }
        _ => 0,
    };
    *antes = Some(ahora);
    let mut m = MEMORYSTATUSEX { dwLength: size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    // SAFETY: rellena una estructura nuestra con su tamaño puesto.
    unsafe { GlobalMemoryStatusEx(&mut m).ok()? };
    let gb = |b: u64| (b as f32 / 1_073_741_824.0 * 10.0).round() / 10.0;
    Some(Uso {
        cpu,
        memoria: m.dwMemoryLoad as u8,
        memoria_usada: gb(m.ullTotalPhys - m.ullAvailPhys),
        memoria_total: gb(m.ullTotalPhys),
    })
}

pub fn iniciar(app: AppHandle) {
    thread::spawn(move || {
        crate::media::iniciar_winrt();
        // SAFETY: inicia COM para este hilo; si ya lo estaba (RoInitialize), el error se ignora.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let mut estado = EstadoSistema { bateria: None, volumen: None, conexion: None, uso: None };
        let mut salida: Option<Salida> = None;
        let mut cpu_antes = None;
        let hace_mucho = Instant::now() - Duration::from_secs(60);
        let (mut bateria_en, mut conexion_en, mut uso_en, mut dispositivo_en) = (hace_mucho, hace_mucho, hace_mucho, hace_mucho);
        loop {
            let mut nuevo = estado.clone();
            if dispositivo_en.elapsed() >= CADA_DISPOSITIVO {
                dispositivo_en = Instant::now();
                let actual = por_defecto().and_then(|d| id_de(&d)).ok();
                if salida.as_ref().map(|s| &s.id) != actual.as_ref() {
                    salida = Salida::abrir();
                }
            }
            nuevo.volumen = salida.as_ref().and_then(Salida::leer);
            if bateria_en.elapsed() >= CADA_BATERIA {
                bateria_en = Instant::now();
                nuevo.bateria = leer_bateria();
            }
            if conexion_en.elapsed() >= CADA_CONEXION {
                conexion_en = Instant::now();
                nuevo.conexion = Some(leer_conexion());
            }
            if uso_en.elapsed() >= CADA_USO {
                uso_en = Instant::now();
                nuevo.uso = leer_uso(&mut cpu_antes);
            }
            if nuevo != estado {
                estado = nuevo;
                if let Ok(mut ultimo) = ULTIMO.lock() {
                    *ultimo = Some(estado.clone());
                }
                let _ = app.emit("sistema-estado", &estado);
            }
            thread::sleep(PASO);
        }
    });
}

#[cfg(test)]
mod pruebas {
    use super::*;

    /// Lee el sistema de verdad y lo muestra. Se lanza a mano:
    /// `cargo test --lib sistema -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn leer_el_sistema() {
        crate::media::iniciar_winrt();
        println!("batería: {:?}", leer_bateria());
        println!("volumen: {:?}", Salida::abrir().and_then(|s| s.leer()));
        println!("conexión: {:?}", leer_conexion());
        let mut antes = None;
        leer_uso(&mut antes);
        thread::sleep(Duration::from_secs(1));
        println!("uso: {:?}", leer_uso(&mut antes));
    }
}
