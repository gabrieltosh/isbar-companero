//! Ritmo de la música a partir del sonido que sale por los altavoces (lo alimenta audio.rs).
//! No depende del sistema: recibe muestras y calcula golpes, tempo, pulso y compás.
//!
//! - Cada 10 ms se mide la energía de tres bandas (graves, medios y agudos) con filtros
//!   sencillos, y cuánto ha crecido cada una (flujo): ahí empiezan los golpes. Los graves
//!   (bombo) pesan más que los agudos (platillos).
//! - Tempo: autocorrelación del flujo de los últimos 8 s. Se prefieren 90–140 pulsos por minuto
//!   y se descarta un tempo si su mitad también encaja (sería el doble del real).
//! - Pulso: avanza solo y cada 250 ms se corrige poco a poco hacia la fase que mejor encaja con
//!   los golpes recientes (bucle de enganche); así no salta aunque falte algún golpe.
//! - Compás: el primer tiempo es el pulso de cada cuatro con más graves.
//! - Secciones: un cambio claro en el reparto de graves, medios y agudos es una parte nueva
//!   (estribillo…); si desaparecen los graves es una pausa, y cuando vuelven, la entrada fuerte.

use std::collections::VecDeque;
use std::f64::consts::{FRAC_1_SQRT_2, TAU};

use serde::Serialize;

/// Cada cuánto se mide (s): 100 medidas por segundo.
const SALTO: f32 = 0.01;
/// Medidas que se guardan para el tempo y la fase (8 s).
const HISTORIA: usize = 800;
/// Medidas necesarias para estimar el tempo (3 s).
const MINIMO_TEMPO: usize = 300;
/// Cada cuántas medidas se revisan el tempo y la fase (250 ms).
const REVISAR_CADA: u64 = 25;
/// Tempo aceptado y el preferido (pulsos por minuto).
const PPM_MIN: f32 = 60.0;
const PPM_MAX: f32 = 180.0;
const PPM_PREFERIDO: f32 = 120.0;
/// Cuánto se aleja la preferencia del tempo preferido (en octavas).
const ANCHO_PREFERENCIA: f32 = 0.9;
/// Energía mínima (cuadrado de la amplitud, unos -60 dB): por debajo es silencio.
const PISO: f64 = 1e-6;
/// Peso de cada banda (graves, medios, agudos) en el flujo.
const PESOS: [f32; 3] = [1.0, 0.6, 0.25];
/// Rango (en logaritmo de energía, ~20 dB) con el que se manda cada banda de 0 a 1.
const RANGO_BANDA: f32 = 4.6;
/// Un golpe: el flujo supera lo normal en tantas desviaciones, y como mínimo esto.
const DESVIACIONES_GOLPE: f32 = 1.5;
const MINIMO_GOLPE: f32 = 0.5;
/// Ventana (medidas) alrededor de cada pulso para medir sus graves.
const VENTANA_ACENTO: usize = 3;
/// Lo que tarda un golpe en notarse en el flujo (medidas): el pulso se adelanta esto.
const RETRASO: f32 = 3.4;
/// Media corta de la energía (unos 0,5 s) y cuánto baja por medida la referencia de la canción.
const SUAVE_SECCION: f32 = 0.02;
const BAJA_REFERENCIA: f32 = 0.0005;
/// Por encima de esto (logaritmo de energía) hay música; por debajo, casi silencio.
const HAY_MUSICA: f32 = -11.0;
/// Pausa: los graves caen tanto (unos 10 dB) durante tanto tiempo (medidas).
const CAIDA_PAUSA: f32 = 2.3;
const DURACION_PAUSA: u64 = 100;
/// Los graves vuelven: cerca de la referencia y bastante por encima de lo más bajo de la pausa.
const VUELTA_REFERENCIA: f32 = 1.0;
const VUELTA_SUBIDA: f32 = 1.5;
/// La vuelta solo cuenta si la pausa ha durado esto (medidas).
const PAUSA_MINIMA: u64 = 200;
/// Huellas de las bandas (una por revisión) para comparar los últimos 2 s con los 2 s de antes.
const HUELLAS: usize = 16;
/// Diferencia entre las dos mitades (suma de las tres bandas, en logaritmo) para una parte nueva.
const UMBRAL_CAMBIO: f32 = 1.2;
/// Como mínimo, tanto tiempo (medidas) entre partes nuevas.
const ENTRE_CAMBIOS: u64 = 800;

/// Momentos de la canción que se avisan una vez.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Seccion {
    /// Empieza una parte distinta (estribillo, estrofa…)
    Cambio,
    /// Se van los graves: la canción se queda en suspenso
    Pausa,
    /// Vuelven los graves después de una pausa (la entrada fuerte, el «drop»)
    Vuelta,
}

/// Lo que se manda al compañero unas 30 veces por segundo.
#[derive(Serialize, Clone, Debug)]
pub struct Estado {
    /// Pico del sonido desde el último estado (0 a 1)
    pub nivel: f32,
    /// Energía de cada banda respecto a lo más fuerte de hace poco (0 a 1)
    pub graves: f32,
    pub medios: f32,
    pub agudos: f32,
    /// Hubo un golpe desde el último estado
    pub golpe: bool,
    /// Milisegundos entre pulsos
    pub intervalo: f32,
    /// Pulsos contados: la parte entera cuenta pulsos (múltiplos de 4 = primer tiempo del
    /// compás) y la decimal va de un pulso al siguiente
    pub pulso: f64,
    /// Qué claro está el ritmo (0 a 1)
    pub confianza: f32,
    /// La canción está en una pausa (sin graves)
    pub pausa: bool,
    /// Momento de la canción desde el último estado, si lo hubo
    pub seccion: Option<Seccion>,
}

/// Filtro de segundo orden (paso bajo o paso alto, Butterworth).
#[derive(Clone, Copy)]
struct Filtro {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Filtro {
    fn nuevo(fs: f64, corte: f64, paso_alto: bool) -> Self {
        let (s, c) = (TAU * corte / fs).sin_cos();
        let alfa = s * FRAC_1_SQRT_2;
        let a0 = 1.0 + alfa;
        let (b0, b1) = if paso_alto { ((1.0 + c) / 2.0, -(1.0 + c)) } else { ((1.0 - c) / 2.0, 1.0 - c) };
        Self { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: -2.0 * c / a0, a2: (1.0 - alfa) / a0, z1: 0.0, z2: 0.0 }
    }

    fn filtrar(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    /// En silencio el estado se queda en números diminutos que hacen lentas las cuentas.
    fn limpiar(&mut self) {
        if self.z1.abs() < 1e-25 && self.z2.abs() < 1e-25 {
            self.z1 = 0.0;
            self.z2 = 0.0;
        }
    }
}

pub struct Analizador {
    muestras_salto: usize,
    /// Graves (bombo, bajo: < 150 Hz), medios (caja, voz: 300–2500 Hz) y agudos (> 5 kHz)
    bandas: [Vec<Filtro>; 3],
    suma: [f64; 3],
    contadas: usize,
    /// Energía (logaritmo) de cada banda en las dos medidas anteriores
    antes: [[f32; 2]; 3],
    /// Lo más fuerte de cada banda hace poco, y cómo está ahora (0 a 1)
    techo: [f32; 3],
    bandas_ahora: [f32; 3],
    /// Flujo de cada medida y energía de los graves (los últimos 8 s)
    flujo: VecDeque<f32>,
    graves: VecDeque<f32>,
    medidas: u64,
    /// Medidas entre pulsos
    periodo: f32,
    con_tempo: bool,
    /// Tempo distinto que se repite: si se confirma, se cambia a él
    candidato: Option<(f32, u32)>,
    reanclar: bool,
    confianza: f32,
    /// Pulsos contados desde el principio
    fase: f64,
    /// Graves de cada pulso del compás, y cuál de los cuatro es el primero
    acentos: [f32; 4],
    primero: usize,
    media: f32,
    varianza: f32,
    previo: f32,
    antes_previo: f32,
    ultimo_golpe: u64,
    golpe: bool,
    pico: f32,
    /// Energía media reciente (total, y de cada banda) y la referencia de los graves en esta
    /// canción (en logaritmo). Se promedia la energía y no su logaritmo: así cuentan los golpes
    corta_total: f32,
    corta: [f32; 3],
    referencia_graves: f32,
    pausa: bool,
    pausa_desde: u64,
    bajo_desde: Option<u64>,
    minimo_pausa: f32,
    huellas: VecDeque<[f32; 3]>,
    ultimo_cambio: u64,
    seccion: Option<Seccion>,
}

impl Analizador {
    pub fn nuevo(fs: u32) -> Self {
        let fs_f = f64::from(fs);
        let filtro = |corte, alto| Filtro::nuevo(fs_f, corte, alto);
        let silencio = PISO.ln() as f32;
        Self {
            muestras_salto: ((fs as f32 * SALTO).round() as usize).max(1),
            bandas: [
                vec![filtro(150.0, false), filtro(150.0, false)],
                vec![filtro(300.0, true), filtro(2500.0, false)],
                vec![filtro(5000.0, true)],
            ],
            suma: [0.0; 3],
            contadas: 0,
            antes: [[silencio; 2]; 3],
            techo: [silencio; 3],
            bandas_ahora: [0.0; 3],
            flujo: VecDeque::with_capacity(HISTORIA + 1),
            graves: VecDeque::with_capacity(HISTORIA + 1),
            medidas: 0,
            periodo: 60.0 / (PPM_PREFERIDO * SALTO),
            con_tempo: false,
            candidato: None,
            reanclar: false,
            confianza: 0.0,
            fase: 0.0,
            acentos: [0.0; 4],
            primero: 0,
            media: 0.0,
            varianza: 0.0,
            previo: 0.0,
            antes_previo: 0.0,
            ultimo_golpe: 0,
            golpe: false,
            pico: 0.0,
            corta_total: 0.0,
            corta: [0.0; 3],
            referencia_graves: silencio,
            pausa: false,
            pausa_desde: 0,
            bajo_desde: None,
            minimo_pausa: 0.0,
            huellas: VecDeque::with_capacity(HUELLAS + 1),
            ultimo_cambio: 0,
            seccion: None,
        }
    }

    /// Añade muestras (mono, de -1 a 1).
    pub fn procesar(&mut self, muestras: &[f32]) {
        for &m in muestras {
            self.pico = self.pico.max(m.abs());
            let x = f64::from(m);
            for (b, filtros) in self.bandas.iter_mut().enumerate() {
                let y = filtros.iter_mut().fold(x, |v, f| f.filtrar(v));
                self.suma[b] += y * y;
            }
            self.contadas += 1;
            if self.contadas == self.muestras_salto {
                self.medir();
            }
        }
    }

    /// Estado para el compañero; empieza a contar de nuevo el pico y el golpe.
    pub fn estado(&mut self) -> Estado {
        let estado = Estado {
            nivel: self.pico.min(1.0),
            graves: self.bandas_ahora[0],
            medios: self.bandas_ahora[1],
            agudos: self.bandas_ahora[2],
            golpe: self.golpe,
            intervalo: self.periodo * SALTO * 1000.0,
            pulso: self.fase - self.primero as f64,
            confianza: self.confianza,
            pausa: self.pausa,
            seccion: self.seccion.take(),
        };
        self.pico = 0.0;
        self.golpe = false;
        estado
    }

    /// Una medida (cada 10 ms).
    fn medir(&mut self) {
        let n = self.contadas as f64;
        let mut flujo = 0.0;
        let mut total = 0.0;
        for (b, peso) in PESOS.iter().enumerate() {
            let energia = self.suma[b] / n;
            total += energia;
            let l = (energia + PISO).ln() as f32;
            self.corta[b] += (energia as f32 - self.corta[b]) * SUAVE_SECCION;
            // Subida respecto a hace dos medidas (los golpes tardan unos ms en crecer)
            flujo += (l - self.antes[b][0]).max(0.0) * peso;
            self.antes[b] = [self.antes[b][1], l];
            self.techo[b] = l.max(self.techo[b] - 0.002);
            self.bandas_ahora[b] = ((l - self.techo[b]) / RANGO_BANDA + 1.0).clamp(0.0, 1.0);
            if b == 0 {
                guardar(&mut self.graves, energia as f32);
            }
            self.suma[b] = 0.0;
            self.bandas[b].iter_mut().for_each(Filtro::limpiar);
        }
        self.contadas = 0;
        guardar(&mut self.flujo, flujo);
        self.medidas += 1;
        self.buscar_golpe(flujo);
        self.avanzar_pulso();
        self.seguir_pausa(total as f32);
        if self.medidas.is_multiple_of(REVISAR_CADA) {
            self.buscar_cambio();
            if self.flujo.len() >= MINIMO_TEMPO {
                self.revisar_tempo();
                self.revisar_fase();
            }
        }
    }

    /// Pausa cuando se van los graves (con música sonando); vuelta cuando regresan.
    fn seguir_pausa(&mut self, total: f32) {
        self.corta_total += (total - self.corta_total) * SUAVE_SECCION;
        let total = log(self.corta_total);
        let graves = log(self.corta[0]);
        // La referencia sube enseguida y baja muy despacio
        self.referencia_graves = graves.max(self.referencia_graves - BAJA_REFERENCIA);
        let hay_musica = total > HAY_MUSICA;
        if !self.pausa {
            if hay_musica && graves < self.referencia_graves - CAIDA_PAUSA {
                let desde = *self.bajo_desde.get_or_insert(self.medidas);
                if self.medidas - desde >= DURACION_PAUSA {
                    self.pausa = true;
                    self.pausa_desde = desde;
                    self.minimo_pausa = graves;
                    self.seccion = Some(Seccion::Pausa);
                }
            } else {
                self.bajo_desde = None;
            }
            return;
        }
        self.minimo_pausa = self.minimo_pausa.min(graves);
        if !hay_musica {
            // Se acabó la canción: no hay vuelta
            self.pausa = false;
            self.bajo_desde = None;
        } else if graves > self.referencia_graves - VUELTA_REFERENCIA && graves > self.minimo_pausa + VUELTA_SUBIDA {
            self.pausa = false;
            self.bajo_desde = None;
            if self.medidas - self.pausa_desde >= PAUSA_MINIMA {
                self.seccion = Some(Seccion::Vuelta);
                self.ultimo_cambio = self.medidas;
                self.huellas.clear();
            }
        }
    }

    /// Parte nueva: las bandas de los últimos 2 s se parecen poco a las de los 2 s anteriores.
    fn buscar_cambio(&mut self) {
        if log(self.corta_total) <= HAY_MUSICA {
            self.huellas.clear();
            return;
        }
        if self.huellas.len() == HUELLAS {
            self.huellas.pop_front();
        }
        self.huellas.push_back(self.corta.map(log));
        // Si los graves están cayendo, se espera a ver si es una pausa
        let esperar = self.pausa || self.bajo_desde.is_some();
        if self.huellas.len() < HUELLAS || esperar || self.medidas - self.ultimo_cambio < ENTRE_CAMBIOS {
            return;
        }
        let mitad = HUELLAS / 2;
        let media = |desde: usize, b: usize| self.huellas.range(desde..desde + mitad).map(|h| h[b]).sum::<f32>() / mitad as f32;
        let diferencia: f32 = (0..3).map(|b| (media(mitad, b) - media(0, b)).abs()).sum();
        if diferencia > UMBRAL_CAMBIO {
            self.seccion = Some(Seccion::Cambio);
            self.ultimo_cambio = self.medidas;
            self.huellas.clear();
        }
    }

    /// Golpe: un máximo del flujo claramente por encima de lo normal en esta canción.
    fn buscar_golpe(&mut self, flujo: f32) {
        let umbral = (self.media + self.varianza.sqrt() * DESVIACIONES_GOLPE).max(MINIMO_GOLPE);
        let cresta = self.previo > umbral && self.previo >= self.antes_previo && self.previo > flujo;
        let separacion = (self.periodo * 0.4).max(10.0) as u64;
        if cresta && self.medidas - self.ultimo_golpe >= separacion {
            self.golpe = true;
            self.ultimo_golpe = self.medidas;
        }
        self.media += (flujo - self.media) * 0.01;
        self.varianza += ((flujo - self.media).powi(2) - self.varianza) * 0.01;
        self.antes_previo = self.previo;
        self.previo = flujo;
    }

    /// El pulso avanza; un cuarto de pulso después de cada uno se apuntan sus graves (compás).
    fn avanzar_pulso(&mut self) {
        let antes = self.fase;
        self.fase += 1.0 / f64::from(self.periodo);
        let marca = |f: f64| (f - 0.25).floor();
        if marca(self.fase) <= marca(antes) || self.graves.is_empty() {
            return;
        }
        let atras = (self.periodo * 0.25).round() as usize;
        let centro = self.graves.len().saturating_sub(1 + atras);
        let desde = centro.saturating_sub(VENTANA_ACENTO);
        let hasta = (centro + VENTANA_ACENTO).min(self.graves.len() - 1);
        let valor = self.graves.range(desde..=hasta).fold(0.0f32, |a, &b| a.max(b));
        let i = (marca(self.fase) as i64).rem_euclid(4) as usize;
        self.acentos[i] += (valor - self.acentos[i]) * 0.2;
        // Cambia de primer tiempo solo si otro destaca con claridad
        let mejor = (0..4).max_by(|&a, &b| self.acentos[a].total_cmp(&self.acentos[b])).unwrap_or(0);
        if mejor != self.primero && self.acentos[mejor] > self.acentos[self.primero] * 1.3 {
            self.primero = mejor;
        }
    }

    /// Tempo por autocorrelación del flujo.
    fn revisar_tempo(&mut self) {
        let n = self.flujo.len();
        let media = self.flujo.iter().sum::<f32>() / n as f32;
        let x: Vec<f32> = self.flujo.iter().map(|v| v - media).collect();
        let lag_min = (60.0 / (PPM_MAX * SALTO)).floor() as usize;
        let lag_max = (60.0 / (PPM_MIN * SALTO)).ceil() as usize;
        let max_r = (lag_max * 4).min(n / 2);
        let r: Vec<f32> = (0..=max_r)
            .map(|l| (l..n).map(|t| x[t] * x[t - l]).sum::<f32>() / (n - l) as f32)
            .collect();
        if r[0] <= 1e-6 {
            self.confianza = 0.0;
            return;
        }
        // Cada tempo puntúa por cuánto se parece la música a sí misma un pulso, dos, tres y
        // cuatro después; si a medio pulso también se parece, es que el tempo real es el doble
        let mut puntos = vec![f32::MIN; lag_max + 2];
        let mut parecido = vec![0.0f32; lag_max + 2];
        for l in lag_min..=lag_max.min(max_r) {
            let (mut suma, mut pesos) = (0.0, 0.0);
            for k in 1..=4 {
                if l * k > max_r {
                    break;
                }
                suma += r[l * k] / k as f32;
                pesos += 1.0 / k as f32;
            }
            let media_lag = suma / pesos;
            let mitad = r[l / 2].max(0.0) * 0.5;
            let ppm = 60.0 / (l as f32 * SALTO);
            let preferencia = (-0.5 * ((ppm / PPM_PREFERIDO).log2() / ANCHO_PREFERENCIA).powi(2)).exp();
            puntos[l] = (media_lag - mitad) * preferencia;
            parecido[l] = media_lag / r[0];
        }
        let Some(mejor) = (lag_min..=lag_max).max_by(|&a, &b| puntos[a].total_cmp(&puntos[b])) else {
            return;
        };
        self.confianza = (parecido[mejor] * 2.0).clamp(0.0, 1.0);
        if self.confianza < 0.1 {
            return;
        }
        // Afinar entre medidas con una parábola por los vecinos
        let mut nuevo = mejor as f32;
        if mejor > lag_min && mejor < lag_max {
            let (a, b, c) = (puntos[mejor - 1], puntos[mejor], puntos[mejor + 1]);
            let d = a - 2.0 * b + c;
            if d < 0.0 {
                nuevo += (0.5 * (a - c) / d).clamp(-0.5, 0.5);
            }
        }
        if !self.con_tempo {
            self.periodo = nuevo;
            self.con_tempo = true;
            self.reanclar = true;
        } else if (nuevo / self.periodo - 1.0).abs() < 0.06 {
            self.periodo += (nuevo - self.periodo) * 0.25;
            self.candidato = None;
        } else {
            // Otro tempo: se cambia solo si se repite durante casi un segundo
            self.candidato = match self.candidato {
                Some((c, veces)) if (nuevo / c - 1.0).abs() < 0.06 => {
                    if veces + 1 >= 3 {
                        self.periodo = nuevo;
                        self.reanclar = true;
                        None
                    } else {
                        Some((nuevo, veces + 1))
                    }
                }
                _ => Some((nuevo, 1)),
            };
        }
    }

    /// Acerca el pulso a la fase que mejor encaja con los golpes de los últimos segundos.
    fn revisar_fase(&mut self) {
        if !self.con_tempo {
            return;
        }
        let p = self.periodo;
        let x = self.flujo.make_contiguous();
        let ultimo = x.len() - 1;
        let pasos = p.ceil() as usize;
        // Para cada desfase posible (medidas desde el último pulso), cuánto flujo cae en los pulsos
        let puntos: Vec<f32> = (0..pasos)
            .map(|desfase| {
                let (mut suma, mut peso) = (0.0, 1.0);
                for k in 0..8 {
                    let t = ultimo as f32 - desfase as f32 - k as f32 * p;
                    if t < 1.0 {
                        break;
                    }
                    let i = t.round() as usize;
                    suma += peso * (x[i] + 0.5 * (x[i - 1] + x.get(i + 1).copied().unwrap_or(0.0)));
                    peso *= 0.8;
                }
                suma
            })
            .collect();
        let Some(mejor) = (0..pasos).max_by(|&a, &b| puntos[a].total_cmp(&puntos[b])) else {
            return;
        };
        let (a, b, c) = (puntos[(mejor + pasos - 1) % pasos], puntos[mejor], puntos[(mejor + 1) % pasos]);
        let d = a - 2.0 * b + c;
        let afinado = if d < 0.0 { mejor as f32 + (0.5 * (a - c) / d).clamp(-0.5, 0.5) } else { mejor as f32 };
        // Parte del pulso que ya ha pasado desde el último golpe, y lo que dice el pulso actual
        let objetivo = f64::from((afinado + RETRASO) / p);
        let mut error = (self.fase - self.fase.floor()) - objetivo;
        error -= error.round();
        let ganancia = if self.reanclar { 1.0 } else { 0.3 * (0.3 + 0.7 * f64::from(self.confianza)) };
        self.fase -= error * ganancia;
        self.reanclar = false;
    }
}

/// Logaritmo de una energía, con el piso del silencio.
fn log(energia: f32) -> f32 {
    (energia + PISO as f32).ln()
}

fn guardar(cola: &mut VecDeque<f32>, valor: f32) {
    if cola.len() == HISTORIA {
        cola.pop_front();
    }
    cola.push_back(valor);
}

#[cfg(test)]
mod pruebas {
    use super::*;

    const FS: u32 = 48_000;

    /// Qué suena en una parte de una pista sintética.
    #[derive(Clone, Copy)]
    struct Parte {
        segundos: f32,
        bombo: bool,
        caja: f32,
        platillo: f32,
    }

    const COMPLETA: Parte = Parte { segundos: 0.0, bombo: true, caja: 0.3, platillo: 0.1 };

    fn parte(segundos: f32, base: Parte) -> Parte {
        Parte { segundos, ..base }
    }

    /// Pista sintética: bombo en cada pulso (más fuerte en el primer tiempo, que es el pulso
    /// `primero` de cada cuatro), caja en el segundo y el cuarto, platillo a contratiempo y un
    /// acorde de fondo. Las partes van seguidas sin perder el compás.
    fn pista_partes(ppm: f32, primero: usize, partes: &[Parte]) -> Vec<f32> {
        let periodo = 60.0 / ppm;
        let mut semilla: u32 = 12345;
        let mut ruido = move || {
            semilla = semilla.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (semilla >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0
        };
        let mut previo = 0.0;
        let mut salida = Vec::new();
        let mut inicio = 0.0;
        for p in partes {
            let fin = inicio + p.segundos;
            while (salida.len() as f32) < fin * FS as f32 {
                let t = salida.len() as f32 / FS as f32;
                let pulso = (t / periodo).floor();
                let desde = t - pulso * periodo;
                let indice = pulso as usize % 4;
                let r = ruido();
                let mut s = 0.05 * (TAU as f32 * 220.0 * t).sin();
                if p.bombo {
                    let fuerza = if indice == primero { 0.8 } else { 0.4 };
                    s += fuerza * (-desde * 25.0).exp() * (TAU as f32 * 55.0 * desde).sin();
                }
                if indice % 2 == (primero + 1) % 2 {
                    s += p.caja * (-desde * 30.0).exp() * r;
                }
                let medio = t - (pulso + 0.5) * periodo;
                if medio >= 0.0 {
                    // Platillo: ruido con solo los agudos
                    s += p.platillo * (-medio * 80.0).exp() * (r - previo);
                }
                previo = r;
                salida.push(s);
            }
            inicio = fin;
        }
        salida
    }

    fn pista(ppm: f32, segundos: f32, primero: usize) -> Vec<f32> {
        pista_partes(ppm, primero, &[parte(segundos, COMPLETA)])
    }

    /// Analiza una pista en trozos de 10 ms, como llegaría del sistema. Devuelve el último
    /// estado y los momentos de la canción con el segundo en que se avisaron.
    fn analizar_todo(muestras: &[f32]) -> (Estado, Vec<(Seccion, f32)>) {
        let mut a = Analizador::nuevo(FS);
        let mut ultimo = a.estado();
        let mut secciones = Vec::new();
        for (i, trozo) in muestras.chunks(480).enumerate() {
            a.procesar(trozo);
            if i % 3 == 0 {
                ultimo = a.estado();
                if let Some(s) = ultimo.seccion {
                    secciones.push((s, i as f32 * 0.01));
                }
            }
        }
        (ultimo, secciones)
    }

    fn analizar(muestras: &[f32]) -> Estado {
        analizar_todo(muestras).0
    }

    #[test]
    fn tempo_correcto() {
        for ppm in [80.0, 100.0, 120.0, 128.0, 150.0, 170.0] {
            let e = analizar(&pista(ppm, 12.0, 0));
            let esperado = 60_000.0 / ppm;
            let error = (e.intervalo / esperado - 1.0).abs();
            assert!(error < 0.02, "{ppm} ppm: intervalo {} ms, esperado {esperado} ms", e.intervalo);
            assert!(e.confianza > 0.3, "{ppm} ppm: confianza {}", e.confianza);
        }
    }

    #[test]
    fn pulso_en_fase_y_compas() {
        for (ppm, primero) in [(120.0, 0), (96.0, 2), (140.0, 1)] {
            let muestras = pista(ppm, 12.0, primero);
            let e = analizar(&muestras);
            // Pulsos que de verdad han pasado, contando desde el primer tiempo del compás
            let tiempo = muestras.len() as f64 / f64::from(FS);
            let esperado = tiempo * f64::from(ppm) / 60.0 - primero as f64;
            let desfase = e.pulso - esperado;
            let fraccion = desfase - desfase.round();
            assert!(fraccion.abs() < 0.04, "{ppm} ppm: desfase de {fraccion} pulsos");
            let compas = desfase.round().rem_euclid(4.0);
            assert!(compas == 0.0, "{ppm} ppm: primer tiempo desplazado {compas} pulsos");
        }
    }

    #[test]
    fn cambio_de_tempo() {
        let mut muestras = pista(100.0, 10.0, 0);
        muestras.extend(pista(132.0, 8.0, 0));
        let e = analizar(&muestras);
        let esperado = 60_000.0 / 132.0;
        assert!((e.intervalo / esperado - 1.0).abs() < 0.02, "intervalo {} ms, esperado {esperado} ms", e.intervalo);
    }

    #[test]
    fn misma_parte_sin_avisos() {
        let (_, secciones) = analizar_todo(&pista(120.0, 25.0, 0));
        assert!(secciones.is_empty(), "avisos sin motivo: {secciones:?}");
    }

    #[test]
    fn estribillo_es_parte_nueva() {
        let estrofa = Parte { segundos: 10.0, bombo: true, caja: 0.0, platillo: 0.0 };
        let muestras = pista_partes(120.0, 0, &[estrofa, parte(8.0, Parte { caja: 0.4, platillo: 0.3, ..COMPLETA })]);
        let (_, secciones) = analizar_todo(&muestras);
        let cambios: Vec<f32> = secciones.iter().filter(|(s, _)| *s == Seccion::Cambio).map(|(_, t)| *t).collect();
        assert!(cambios.len() == 1 && (10.0..13.0).contains(&cambios[0]), "cambios: {secciones:?}");
    }

    #[test]
    fn pausa_y_vuelta() {
        let sin_bombo = Parte { bombo: false, ..COMPLETA };
        let muestras = pista_partes(120.0, 0, &[parte(10.0, COMPLETA), parte(4.0, sin_bombo), parte(5.0, COMPLETA)]);
        let (e, secciones) = analizar_todo(&muestras);
        let cuando = |buscada| secciones.iter().find(|(s, _)| *s == buscada).map(|(_, t)| *t);
        let pausa = cuando(Seccion::Pausa).unwrap_or(-1.0);
        let vuelta = cuando(Seccion::Vuelta).unwrap_or(-1.0);
        assert!((10.0..11.8).contains(&pausa), "pausa en {pausa} s: {secciones:?}");
        assert!((14.0..14.8).contains(&vuelta), "vuelta en {vuelta} s: {secciones:?}");
        assert_eq!(secciones.len(), 2, "avisos de más: {secciones:?}");
        assert!(!e.pausa);
        // El tempo sigue bien después
        assert!((e.intervalo / 500.0 - 1.0).abs() < 0.02, "intervalo {} ms", e.intervalo);
    }

    #[test]
    fn silencio_sin_golpes() {
        let mut a = Analizador::nuevo(FS);
        let ceros = vec![0.0; 480];
        for _ in 0..500 {
            a.procesar(&ceros);
            let e = a.estado();
            assert!(!e.golpe && !e.pausa && e.seccion.is_none());
            assert_eq!(e.confianza, 0.0);
        }
    }
}
