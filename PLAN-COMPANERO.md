# Plan: el Compañero de isbar

Un asistente con cara que vive en la pantalla: se mueve, reacciona, habla con globos de pensamiento
y despliega un panel para ver avisos, música, recordatorios y pedirle cosas.

Es un **proyecto propio** (`isbar-companero`, identificador `com.isbar.companero`), separado de la
isla (`isbar`). Reutiliza su base: notificaciones, música, Pomodoro, agua, pausas, ajustes y
sonidos.

## Principio

**El compañero reacciona a todo lo que pasa o puede saber**: lo que hace el usuario, los cambios
de configuración y el estado del PC (música, avisos, internet, batería, volumen, uso…). Cada
función nueva llega con su reacción (cara, gesto, globo o algo que lleva encima), no solo con una
tarjeta en el panel. Sin ser pesado: los cambios breves se ignoran y cada aviso sale una vez.

## Estado actual

**Hechas: fases 0 a 4**, el reconocimiento de la música (mejoras 1 a 9) y de la **fase 6** el
estado del sistema y el tiempo, con sus reacciones. Ver «Añadido fuera del plan».

**Siguiente**, en este orden:
1. ~~**Clima**~~ ✅ (Open-Meteo, ciudad en Configuración): saludo de buenos días con el tiempo del
   día y paraguas si va a llover. Probado en Windows con la API real: funciona.
2. ~~**Animaciones del tiempo**~~ ✅ (`tiempo.ts`): cada tiempo tiene su escena (ver fase 6).
   Probadas en una página de prueba; falta verlas en Windows con el tiempo real.
3. **No molestar**: interruptor que silencia los globos un rato (30 min, 1 h, hasta mañana).
4. **Panel nuevo**: barra de 7 iconos (la activa muestra su nombre): Inicio (solo resumen, no se
   gestiona nada desde ahí), Avisos, Música, Pomodoro, Pausas, Tareas y Sistema.
5. **Fase 5 (asistente)**: Tareas/recordatorios y Chat.
6. **Modo inteligente con Jev** (opcional, cuando haya acceso): ver «Hacerlo más inteligente».

| Fase | Estado |
|---|---|
| 0. Preparación | Hecha |
| 1. Ventana y movimiento | Hecha |
| 2. Cara y vida propia | Hecha |
| 3. Globos, notificaciones y música | Hecha |
| 4. Panel (Inicio, Avisos, Música) | Hecha; se reorganiza (ver «Siguiente») |
| 5. Asistente | Pendiente |
| 6. Estado del sistema y del día | En curso: sistema y tiempo hechos; sistema, tiempo y sus animaciones hechos; no molestar y lo del día pendientes |
| 7. Pulido y publicación | Pendiente |

## Diseño acordado

- **Cuerpo**: pantalla oscura (cuadrado redondeado), sólida por defecto; en Configuración se puede
  bajar su opacidad (hasta el 50 %) para que sea de cristal.
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
- **Música**: baila al pulso de la canción con catorce pasos. Tranquilos: mecerse, flotar (solo
  hasta 105 ppm), asentir lento, balanceo, vuelta. Medios: cabeceo, metrónomo, rebote, paso
  lateral. Intensos: saltitos, sacudida, pogo (desde 110 ppm), contratiempo (hasta 125 ppm),
  remolino. Cada dos compases (o al empezar una parte nueva) sortea entre los que encajan con lo
  animada que está la música (intensidad y tempo), con más probabilidad para los que mejor
  encajan y sin repetir los tres últimos. En una pausa espera; al volver la música, celebra.
  Canta con el volumen; notas al ritmo; globo con la canción al cambiar de pista. Sin volumen,
  no baila.
- **Estado sobre la cabeza**: progreso del Pomodoro en el borde; sin internet, una antena (busca
  señal, se queda caída y se ilumina al volver); poca batería y volumen, un icono pequeño (tiene
  prioridad sobre el paraguas). El tiempo se vive con escenas alrededor (ver fase 6).
- **Sonidos opcionales**: blips cortos y suaves, desactivados por defecto.
- **Menú con clic derecho**: opciones como pensamientos sueltos que salen del compañero.
  «Esconderme» lo lleva al lado más cercano de la pantalla, asomando media cara (si ya está
  escondido, «Salir de aquí»); «Adiós por ahora» se despide con la mano y se oculta hasta que se
  vuelve a mostrar desde el icono de la bandeja (y entonces saluda). Los globos tienen una ✕.

## Preparar un equipo para desarrollar

- Node.js, Rust (`rustup`, edición 2024: 1.85 o más) y Visual Studio Build Tools con
  «Desarrollo para el escritorio con C++». WebView2 ya viene con Windows 11.
- `npm install` y `npm run tauri dev` (la primera compilación tarda ~1–2 min).
- **Control inteligente de aplicaciones** (Windows 11) bloquea los programas que Rust genera al
  compilar (`os error 4551`): hay que desactivarlo en Seguridad de Windows → Control de
  aplicaciones y del explorador.

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
| `src/companero/ritmo.ts` | Pulso sin saltos entre mensajes, energía, intensidad y notitas |
| `src/companero/baile.ts` | Pasos de baile, elección por intensidad y tempo, mezcla entre pasos |
| `src/companero/entorno.ts` | Clasifica la ventana de debajo y recuerda sitios visitados |
| `src/companero/respuestas.ts` | Gestos de sí, no y no sé al interactuar |
| `src/companero/sistema.ts` | Reacciones al estado del PC: antena sin internet, batería, uso, volumen |
| `src/companero/clima.ts` | El tiempo cada 30 min: buenos días con el tiempo, aviso de lluvia y paraguas |
| `src/estado/clima.ts` | Open-Meteo: previsión y buscador de ciudades (desde el frontend, sin clave) |
| `src/estado/*` | Pomodoro, agua, pausas y música (solo los arranca el compañero); tipos del sistema |
| `src/panel/`, `src/globo/`, `config.html` | Panel, globo y configuración |

### Rust
| Archivo | Para qué |
|---|---|
| `companero.rs` | Ventana, arrastre, bordes, inactividad (`GetLastInputInfo`), tamaño |
| `window.rs` | Visibilidad, click-through, cursor cerca |
| `globo.rs`, `panel.rs`, `tray.rs` | Globo, panel y menú de la bandeja |
| `media.rs` | Música del sistema (SMTC), controles y saltar a una posición |
| `audio.rs` | Escucha la app de música (o toda la salida) con WASAPI loopback, solo mientras suena |
| `ritmo.rs` | Bandas, golpes, tempo, pulso, compás y partes de la canción (sin código de Windows; con pruebas) |
| `sistema.rs` | Batería (con consumo), volumen (y cambiarlo), conexión y uso del PC; avisa al cambiar |
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
- Panel hacia el lado con espacio: Inicio, Avisos (abrir, descartar, borrar todo), Música y
  Sistema.
- Se reorganizará: barra de iconos; Inicio como resumen; Pomodoro, Pausas y Tareas en sus pestañas.

**Fase 5. Asistente**
- Pestañas Recordatorios y Chat en el panel.
- Cuadro para escribirle y respuestas «hablando».
- Recordatorios («en N min», «a las HH:MM», «mañana…») persistentes, que sobreviven a reinicios.
- Órdenes: pomodoro, agua, tiempo, batería, pausas.

**Fase 6. Estado del sistema y del día** (en curso)
- ✅ Pestaña Sistema: batería (nivel, carga, tiempo restante, consumo en vatios, ahorro), volumen
  (control, silencio, dispositivo), conexión (wifi o cable, sin internet) y uso de procesador y
  memoria. En un PC de sobremesa no sale la batería.
- ✅ Reacciones: sin internet busca señal con una antena y se queda con ella caída (reintenta
  cada minuto); al volver, la antena se ilumina y celebra. Batería al 20 % y al 10 %, al
  enchufarlo y al cargarse del todo. PC a tope (procesador 90 % durante 20 s) o sin memoria: suda.
  Volumen: icono un momento y sorpresa si lo subes mucho. Cambio de altavoces a cascos: lo dice.
- ✅ Tiempo (Open-Meteo, sin clave ni dependencias nuevas). En Configuración se busca la ciudad
  (solo se envía el nombre buscado y su posición). Lo mira cada 30 min (a los 5 si falla, y en
  cuanto vuelve internet). Buenos días una vez al día (5–12 h, al usar el PC) con el tiempo de hoy,
  la temperatura y un consejo (paraguas, calor, frío). Si va a llover en las próximas 3 horas
  (≥ 60 %) o ya llueve, lo avisa una vez y lleva un paraguas sobre la cabeza. Al elegir ciudad,
  cuenta el tiempo de allí. El panel enseña la temperatura junto a la fecha.
  Se pide desde el frontend: Rust no tiene cliente HTTP y añadirlo sería una dependencia nueva.
- **Animaciones del tiempo** ✅. Minimalistas y con solo dos colores, como la cara: el LED y el
  negro del cristal. El tiempo se mira cada 15 min (Open-Meteo renueva el de ahora
  cada 15). La escena completa sale por ratos: 1,5 min al cambiar el tiempo o al despertarse y
  45 s cada 12 min; el resto, un detalle discreto (paraguas cerrado, bufanda, gafas,
  nieve en la cabeza). En Configuración → Tiempo, «Probar escena» enseña cualquiera 20 s.
  El paraguas fijo encima se queda corto: cada tiempo
  cambia el cuerpo, la cara y lo que pasa alrededor, con transiciones suaves (nada aparece de golpe)
  y respetando el modo tranquilo (menos partículas y movimiento). Todo en SVG dentro del margen de
  la ventana (24 px por lado), sin dependencias nuevas. Un módulo nuevo `src/companero/tiempo.ts`
  dibuja las escenas; `clima.ts` sigue pidiendo el tiempo y avisando.
  - **Lluvia / llovizna**: el paraguas se abre con rebote (se pasa un poco y vuelve) y lo sujeta
    a un lado con el mango bajando hasta el cuerpo; las gotas caen en diagonal, chocan con la
    tela y salpican (sin charco ni línea de suelo). Más
    gotas cuanto más llueve (llovizna, lluvia, fuerte). Cuando para, cierra el paraguas, lo sacude
    (gotitas que salen volando) y sonríe.
  - **Va a llover** (aún no llueve): mira al cielo de vez en cuando y una nube pasa por
    encima; el paraguas sale cerrado y lo abre al empezar la lluvia.
  - **Tormenta**: como la lluvia, más el borde del cristal que se enciende con el relámpago, un rayo que cruza
    detrás y un susto (sorpresa y tiritón) con cada trueno, cada 8–20 s.
  - **Nieve**: copos que bajan meciéndose y se van posando hasta formar una capa fina sobre
    la cabeza; de vez en cuando se la sacude. Tirita un poco.
  - **Sol con calor** (≥ 28 °C): gafas de sol LED sobre los ojos, gota de sudor que resbala y un
    brillo que recorre el cristal.
  - **Frío** (≤ 5 °C): tirita en ráfagas cortas, vaho al respirar (nubecita que sale de la boca y
    se deshace) y bufanda lisa (la punta con dos rayas).
  - **Niebla**: líneas onduladas (≋) que flotan sobre la cabeza y delante del cuerpo y se mecen
    despacio; entrecierra los ojos como si no viera.
  - **Nublado**: una nubecita que pasa por detrás, y a veces se para un rato encima.
  - **Despejado de noche**: alguna estrellita que titila a su alrededor.
  - **Buenos días**: el saludo lleva la escena del tiempo de hoy durante unos segundos (sale el sol
    por detrás, o la nube con lluvia), aunque ahora mismo haga otro tiempo.
  - Las escenas se apagan mientras duerme (solo se queda la capa de nieve), y los
    iconos de batería y volumen tienen prioridad sobre lo que lleva encima.
- Saludo de buenas noches.
- No molestar.
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
- Siete pasos de baile más (catorce en total), elección ponderada y según el tempo; canta a ratos.
- Opacidad del cuerpo en Configuración (sólido por defecto).

## Mejorar el reconocimiento de la música

### Cómo funcionaba antes (medidor de pico)
- `audio.rs` leía **solo el medidor de pico** del dispositivo de salida (~30 veces por segundo). Es
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

### Cómo funciona ahora
- `audio.rs` escucha **solo la app de música** con el loopback por proceso: toma la app de SMTC
  (`media::app_actual`), busca su proceso entre las sesiones de audio del dispositivo (por paquete,
  nombre del ejecutable o identificador de sesión; prefiere la que está sonando) y la escucha con
  sus procesos hijos. Si no la encuentra o Windows no lo admite, escucha toda la salida con
  **WASAPI loopback**. Todo en memoria, sin guardar nada. Cada 3 s mira si ha cambiado el
  dispositivo o la app; al reabrir conserva el tempo y el pulso.
- `ritmo.rs` mide cada 10 ms tres bandas con filtros sencillos (sin FFT ni dependencias nuevas):
  graves < 150 Hz, medios 300–2500 Hz y agudos > 5 kHz. El **flujo** (cuánto crece cada banda,
  en logaritmo) marca los golpes; los graves pesan más.
- **Tempo** por autocorrelación del flujo de los últimos 8 s, prefiriendo 90–140 ppm y
  descartando un tempo si su mitad también encaja. Un tempo nuevo se acepta si se repite ~1 s.
- **Pulso** que avanza solo y cada 250 ms se acerca a la fase que mejor encaja con los golpes
  (más deprisa cuanto más claro es el ritmo), adelantado 34 ms por el retraso de la medida.
- **Compás**: el pulso de cada cuatro con más graves es el primero; el baile cambia de paso al
  empezar un compás y marca más el primer tiempo.
- **Partes de la canción**: si el reparto de graves, medios y agudos de los últimos 2 s cambia
  claramente respecto a los 2 s anteriores, es una parte nueva (como mucho una cada 8 s) y el baile
  cambia de paso al empezar el compás siguiente. Si se van los graves más de 1 s con música
  sonando, es una **pausa**: se queda esperando, casi quieto y mirando a los lados. Cuando vuelven
  los graves (tras al menos 2 s de pausa), **celebra** un compás con saltos grandes y notitas.
- El panel (pestaña Música) muestra pulsos por minuto, lo claro que está el ritmo, los golpes y
  las partes (o «en pausa»).
- Pruebas (`cargo test --lib ritmo`) con pistas sintéticas de 80 a 170 ppm: tempo con menos de
  un 2 % de error, pulso con menos de 0,04 pulsos de desfase, compás correcto, cambio de tempo,
  estribillo como parte nueva, pausa y vuelta a su hora, sin avisos en una pista uniforme y
  silencio sin golpes.

### Qué falta afinar con música real
- `ADELANTO_MS` (`ritmo.ts`) si el salto no cae justo en el golpe (con Bluetooth irá adelantado).
- Umbrales de partes (`UMBRAL_CAMBIO`) y pausas (`CAIDA_PAUSA`) en `ritmo.rs`.
- Apps cuyo proceso no se reconoce (se nota porque baila también con otros sonidos). Para ver
  qué sesiones de audio hay y comparar lo que suena en total con lo de una app:
  `APP_PRUEBA=Spotify.exe cargo test --lib audio -- --ignored --nocapture` (en `src-tauri/`).

### Mejoras propuestas (en orden recomendado)
Todas hechas (la FFT del punto 2 se cambió por filtros, sin dependencia nueva; el punto 8
funciona desde Windows 10 2004).


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

## Hacerlo más inteligente: Jev (TypeSafe)

[Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) es un «System One model»:
recibe un estado (texto o datos) y devuelve **una opción de una lista definida de antemano, con su
probabilidad**. No escribe texto. Lo que dice el artículo: 70–500 ms por consulta, ~0,04 $ por
millón de tokens de entrada (la salida no se cobra), hasta 255 opciones por decisión. Está **en la
nube** y en **acceso anticipado** (lista de espera); el artículo no dice si entiende español.
Documentación: https://docs.typesafe.ai/introduction

### Para qué sirve aquí
Hoy las reacciones salen de reglas fijas. Jev decidiría lo que con reglas queda torpe:

1. **Qué hacer ahora** (primer experimento). Cada cierto tiempo o al pasar algo, se le manda un
   resumen del momento (hora, app en primer plano, si escribes, música, Pomodoro, batería,
   últimas interacciones) y devuelve qué expresión poner, si es buen momento para interrumpir y
   qué tipo de comentario hacer. Si su probabilidad es baja, no se hace nada.
2. **Carácter del baile** (segundo experimento). Una consulta por canción y otra por cada parte
   nueva, con título, artista y los números del análisis (tempo, intensidad, bandas; nunca el
   audio): ánimo (alegre, triste, épica, relajada, romántica, enérgica, oscura…), estilo de baile
   (cabeceo de rock, balanceo, saltos de electrónica, mecerse de balada…), género y cuándo hacer
   algo especial. Sus probabilidades guiarían el sorteo de pasos (`baile.ts`) y la cara (triste
   con una canción triste, en vez de sonreír siempre). El pulso y los golpes **siguen siendo
   locales** (`ritmo.rs`): Jev es demasiado lento para seguir el ritmo.
3. **Filtrar notificaciones**: urgente, normal o ruido; mostrar ya, esperar a que acabe el
   Pomodoro o callar (un «No molestar» inteligente).
4. **Saber qué estás haciendo** (programando, en una reunión, viendo un vídeo, jugando) para
   ajustar cuánto habla y se mueve (hoy, reglas en `entorno.ts`).
5. **Asistente**: clasificar lo que le escribes (recordatorio, Pomodoro, agua, clima, charla). Las
   horas y el texto del recordatorio los saca un analizador propio; para charlar haría falta un
   modelo que escriba.

### Reglas
- **Opcional y apagado por defecto**, con la clave propia del usuario y aviso claro de lo que sale
  del PC (títulos de ventanas, apps, canción y artista; quizá texto de notificaciones).
- **Sin internet o sin acceso, todo sigue igual** con las reglas actuales: Jev es una capa encima.
- Nunca para la animación en tiempo real; solo para decisiones (una consulta cada poco).
- Llamarlo desde Rust (posible dependencia nueva para HTTP, a explicar antes) o desde el frontend.
- Comparar sus decisiones con las reglas antes de darle el control.

### Pasos
1. Pedir acceso en typesafe.ai y conseguir una clave (lo hace el usuario).
2. Leer la documentación de la API: formato de las consultas, límites y si admite español.
3. Conexión con Jev y ajuste en Configuración (clave y aviso de privacidad).
4. Experimento «qué hacer ahora».
5. Experimento «carácter del baile».

## Para más adelante
- IA opcional para conversar (clave de API propia del usuario; se avisa de que el texto sale del PC).
- Lanzador de apps, Centro de control y reemplazo del menú Inicio y la barra de tareas.
- Versión para Linux (el código de Windows ya está aislado en sus módulos).
