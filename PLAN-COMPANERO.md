# Plan: el Compañero de isbar

Un asistente con cara que vive en la pantalla: se mueve, reacciona, habla con globos de pensamiento
y despliega un panel para ver avisos, música, recordatorios y pedirle cosas.

Es un **proyecto propio** (`isbar-companero`, identificador `com.isbar.companero`), separado de la
isla (`isbar`). Reutiliza su base: notificaciones, música, Pomodoro, agua, pausas, ajustes y
sonidos.

## Estado actual

**Hechas: fases 0 a 4**, más muchas mejoras pedidas por el camino (ver «Añadido fuera del plan»).
**Siguiente: fase 5 (asistente).** Pendiente aparte: mejorar el reconocimiento de la música
(sección propia más abajo).

| Fase | Estado |
|---|---|
| 0. Preparación | Hecha |
| 1. Ventana y movimiento | Hecha |
| 2. Cara y vida propia | Hecha |
| 3. Globos, notificaciones y música | Hecha |
| 4. Panel (Inicio, Avisos, Música) | Hecha; Recordatorios y Chat pasan a la fase 5 |
| 5. Asistente | Pendiente |
| 6. Estado del sistema y del día | Pendiente |
| 7. Pulido y publicación | Pendiente |

## Diseño acordado

- **Cuerpo**: pantalla de cristal oscuro (cuadrado redondeado), translúcida.
- **Cara LED**: dos ojos y una boca con trazos gruesos y brillo suave. Color por defecto blanco,
  con opción azul, naranja y lima. Sin carcasa, sin parecido a personajes ni logos conocidos.
  Los extras que salen de la cara (notas, manos, estrellas, nubecitas) llevan un borde oscuro fino
  para verse sobre fondos claros.
- **Cara paramétrica con morph**: ojos y boca son formas de dos curvas que se interpolan
  (380 ms) al cambiar de expresión; los extras se funden.
- **Emociones**: normal, feliz, risa, guiño, sorpresa, enojado, triste, pensativo, cansado
  (con bostezo), mareado, preocupado, hablando, silba, dormido, celebra, saludo, música, aviso,
  curioso, lupa, otea (visera), asoma, frustrado, impresionado, juega (pelota), asiente, niega,
  no sé.
- **Vida propia**: respira; parpadea; mira al ratón (lo sigue hasta ~700 px) o alrededor; mira
  hacia abajo cuando escribes; ocurrencias cada 25–60 s mientras usas el PC; rutinas cuando está
  solo (mirar, silbar, estirarse, estirarse a los lados, jugar con una pelota, bailar solo); se
  cansa a los 3 min, se duerme a los 6 (la mitad de noche); bosteza en sesiones largas.
- **Reacciones al ratón**: sonríe con el ratón encima; clic abre el panel con un guiño; doble clic
  con reacción variada (risa, celebra, guiño, susto, impresionado); muchos clics, enfado o
  frustración; se marea si agitas o haces círculos con el ratón cerca.
- **Moverlo**: mantener pulsado y arrastrar con física de péndulo (se inclina, se estira, se
  balancea al soltarlo); sacudirlo lo marea; junto a un borde se esconde y se asoma; recuerda la
  posición.
- **Al soltarlo**: curiosea su nuevo sitio de cuatro formas distintas (interrogante, lupa, visera,
  asomarse) y reacciona según la ventana que queda debajo (vídeo, juego, código, oficina, correo,
  chat, música, navegador, carpetas, escritorio). Recuerda los sitios donde ha estado y a veces
  los reconoce sin curiosear.
- **Gestos de cabeza** al interactuar: sí (asiente), no (niega), no sé (se encoge de hombros).
- **Globos de pensamiento**: avisos con acciones (Abrir, Más tarde, Descartar, Hecho…), hacia el
  lado con espacio, con nubecitas hacia el compañero.
- **Panel** (clic): Inicio, Avisos, Música (con barra de tiempo arrastrable); Recordatorios y Chat
  en la fase 5.
- **Música**: baila al pulso de la canción con siete pasos (balanceo, cabeceo, saltitos, paso
  lateral, vuelta, sacudida, mecerse) elegidos según intensidad y tempo; canta con el volumen;
  notas al ritmo; globo con la canción al cambiar de pista. Sin volumen, no baila.
- **Iconos de estado** sobre la cabeza: progreso del Pomodoro en el borde (hecho); sin internet y
  batería baja (fase 6).
- **Sonidos opcionales**: blips cortos y suaves, desactivados por defecto.

## Arquitectura (como está hoy)

### Ventanas
- `companero` (112×112 a tamaño 1: margen 24, lado 64): transparente, siempre encima, sin barra de
  tareas. Se muestra y oculta con `ShowWindow` sin activarla (para Tauri sigue «visible»).
- `globo`: ventana aparte que Rust coloca al lado con espacio.
- `panel` (320×440): coge el foco; se cierra al perderlo, con Esc o con clic en el compañero.
- **Click-through** por sondeo de rectángulos (`window.rs`); fuera de ellos los clics pasan.
- Una sola copia de la app (`tauri-plugin-single-instance`): abrirla otra vez hace que salude.

### Frontend
| Archivo | Para qué |
|---|---|
| `src/companero/main.ts` | Bucle de animación, mirada, física del paseo, clics, arrastre, curioseo |
| `src/companero/cara.ts` | Rasgos de cada expresión, morph, dibujo de la cara y extras (SVG) |
| `src/companero/vida.ts` | Decide la cara: gesto > arrastre/ratón > petición de la app > estado |
| `src/companero/avisos.ts` | Notificaciones, música, Pomodoro, agua y pausas como globos |
| `src/companero/globos.ts` | Cola de globos |
| `src/companero/puente.ts` | Estado para el panel y órdenes del panel |
| `src/companero/ritmo.ts` | Golpes, tempo y pulso de la música a partir del nivel de sonido |
| `src/companero/baile.ts` | Pasos de baile, elección por intensidad y tempo, mezcla entre pasos |
| `src/companero/entorno.ts` | Clasifica la ventana de debajo y recuerda sitios visitados |
| `src/companero/respuestas.ts` | Gestos de sí, no y no sé al interactuar |
| `src/estado/*` | Pomodoro, agua, pausas y música (solo los arranca el compañero) |
| `src/panel/`, `src/globo/`, `config.html` | Panel, globo y configuración |

### Rust
| Archivo | Para qué |
|---|---|
| `companero.rs` | Ventana, arrastre, bordes, inactividad (`GetLastInputInfo`), tamaño |
| `window.rs` | Visibilidad, click-through, cursor cerca |
| `globo.rs`, `panel.rs`, `tray.rs` | Globo, panel y menú de la bandeja |
| `media.rs` | Música del sistema (SMTC), controles y saltar a una posición |
| `audio.rs` | Medidor de pico del dispositivo de salida (solo mientras suena música) |
| `debajo.rs` | Programa y título de la ventana que queda debajo al soltarlo |
| `notifications.rs` | Notificaciones del sistema (UserNotificationListener) |
| `fullscreen.rs` | Ocultarse con una app a pantalla completa |

## Fases

Cada fase termina con algo que funciona y se puede probar.

**Fase 0. Preparación** ✅
- Lógica de Pomodoro, agua, pausas y música en módulos compartidos.

**Fase 1. Ventana y movimiento** ✅
- Ventana con click-through de varios rectángulos; arrastrar, rebote, imán a bordes, asomarse,
  posición guardada, multimonitor; ocultarse en pantalla completa.

**Fase 2. Cara y vida propia** ✅
- Motor de la cara con morph, emociones, vida propia y reacciones al ratón.
- Ajustes: color, tamaño y modo tranquilo.

**Fase 3. Globos, notificaciones y música** ✅
- Globos con cola y acciones; notificaciones del sistema como globos (con el paquete de
  desarrollo `IsbarCompaneroDev` para tener identidad; Asistente de concentración en «Solo
  alarmas» para que no salgan dos avisos).
- Música con globo y controles; Pomodoro, agua y pausas con globos y gestos.

**Fase 4. Panel** ✅
- Panel hacia el lado con espacio: Inicio, Avisos (abrir, descartar, borrar todo), Música.

**Fase 5. Asistente**
- Pestañas Recordatorios y Chat en el panel.
- Cuadro para escribirle y respuestas «hablando».
- Recordatorios («en N min», «a las HH:MM», «mañana…») persistentes, que sobreviven a reinicios.
- Órdenes: pomodoro, agua, tiempo, batería, pausas.

**Fase 6. Estado del sistema y del día**
- Batería y conexión con iconos y avisos.
- Tiempo del día (Open-Meteo, sin clave) y saludo de buenos días y buenas noches.
- Noche: sugerir descanso. Ritmo de trabajo: avisar tras mucho tiempo sin pausa. Rachas.

**Fase 7. Pulido y publicación**
- Sonidos opcionales, rendimiento (pausar la animación cuando está oculto), accesibilidad.
- Probar en Windows 10 y 11, varios monitores y escalas.
- Publicar como **isbar 0.2** en la Microsoft Store.

## Añadido fuera del plan (hecho)

- Morph paramétrico de la cara en vez de fundido.
- Seguir al cursor de lejos, marearse con círculos del ratón, física de péndulo al arrastrar.
- Borde oscuro fino en todos los extras y en los globos (fondos claros).
- Panel: botones que no pierden clics; barra de tiempo de la música arrastrable.
- Baile al ritmo real de la música (`audio.rs` + `ritmo.ts` + `baile.ts`), sin bailar si no hay
  volumen, igual con cualquier volumen o dispositivo (USB, Bluetooth).
- Curioseo variado al soltarlo, reacción según la ventana de debajo, recuerdo de sitios.
- Rutinas nuevas (pelota, bailar solo, estirarse a los lados) y doble clic variado.
- Gestos de sí, no y no sé al interactuar (borrar avisos, música, Pomodoro, pausas).
- Menos fotogramas dormido o cansado; la cara solo se redibuja si cambia.

## Mejorar el reconocimiento de la música

### Cómo funciona hoy
- `audio.rs` lee **solo el medidor de pico** del dispositivo de salida (~30 veces por segundo). Es
  un único número de 0 a 1: no distingue graves de agudos ni qué app suena.
- `ritmo.ts` aplica una **ganancia automática** (respecto a lo más fuerte de hace unos segundos),
  busca **subidas bruscas** del nivel frente a lo que sonaba justo antes con un umbral que se
  adapta a cada canción, estima el **tempo** con la media del tiempo entre golpes y lleva un
  **pulso continuo** que se corrige con cada golpe.
- Funciona bien con música rítmica (detecta 5–8 de cada 8 pulsos), pero tiene límites:
  - Con 30 lecturas por segundo, el momento del golpe tiene un error de hasta ~33 ms.
  - El pico mezcla todo: la voz, un platillo o un sonido del sistema cuentan como «golpe».
  - El tempo puede engancharse a la mitad o al doble del real.
  - No sabe dónde empieza el compás ni cuándo llega el estribillo o una pausa.
  - Cualquier sonido del PC (una videollamada, un juego, un aviso) se mezcla con la música.

### Mejoras propuestas (en orden recomendado)

1. **Capturar el audio de salida con WASAPI en modo loopback** (en vez del medidor de pico).
   Se recibe la onda que suena (sin grabarla ni guardarla: se analiza en memoria y se descarta),
   con muchas más muestras por segundo. Base para todo lo demás. Sin dependencias nuevas
   (`windows`, `Win32_Media_Audio`).
2. **Separar por bandas con FFT**: graves (bombo, 40–150 Hz), medios (caja, voz) y agudos
   (hi-hat). Los golpes se buscan en los graves, mucho más fiables. Necesita una dependencia
   nueva para la FFT (p. ej. `rustfft`, a explicar antes de añadirla). Rust mandaría al frontend
   unas pocas cifras por lectura (energía por banda), no el audio.
3. **Flujo espectral** (cuánto crece la energía en cada banda) para detectar ataques aunque la
   música esté muy comprimida. Sustituye a la «subida del pico» actual.
4. **Tempo por autocorrelación o histograma de intervalos** sobre los últimos 6–8 s, eligiendo
   entre mitad y doble con preferencia por 90–140 pulsos por minuto. Evita el enganche a la
   mitad o al doble y se estabiliza antes.
5. **Fase como un bucle de enganche (PLL)**: corregir la fase del pulso poco a poco y adelantar el
   movimiento unos ms para compensar la latencia (lectura + dibujo), así el salto cae justo en el
   golpe.
6. **Compás y primer tiempo**: detectar el «uno» (más graves cada 4 pulsos) para cambiar de paso
   al empezar un compás y marcar más el primer tiempo.
7. **Secciones de la canción**: detectar estribillo, «drop» o pausa por cambios de energía y
   brillo (agudos). Al entrar el estribillo, paso nuevo; en el drop, celebra; en una pausa se
   queda quieto esperando y luego arranca.
8. **Escuchar solo la app de música** con el loopback por proceso (Windows 10 2004+,
   `AUDIOCLIENT_PROCESS_LOOPBACK`) usando el proceso de la app que informa SMTC. Así no baila con
   avisos, videollamadas ni juegos. Si el sistema no lo admite, se vuelve al loopback general.
9. **Herramientas para afinar**: ver en la pestaña Música del panel los pulsos por minuto, golpes
   y nivel detectados; y probar con pistas de metrónomo de tempo conocido (80, 120, 150) para medir
   aciertos antes y después de cada cambio.

Notas: el análisis seguirá activo solo mientras suena música; una FFT de 1024 muestras cada
~20 ms gasta muy poco. Nada del audio se guarda ni sale del equipo.

## Para más adelante
- IA opcional para conversar (clave de API propia del usuario; se avisa de que el texto sale del PC).
- Lanzador de apps, Centro de control y reemplazo del menú Inicio y la barra de tareas.
- Versión para Linux (el código de Windows ya está aislado en sus módulos).
