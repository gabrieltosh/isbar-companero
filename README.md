<p align="center">
  <img src="app-icon.svg" width="110" alt="Logo de isbar" />
</p>

<h1 align="center">isbar Compañero</h1>

<p align="center">
  <b>Un asistente con cara que vive en tu pantalla.</b><br />
  Se mueve, reacciona, te avisa con globos de pensamiento y le puedes pedir cosas.
  Nace de <a href="https://github.com/gabrieltosh/isbar">isbar</a> y reutiliza su base.
</p>

> En desarrollo. El plan está en [PLAN-COMPANERO.md](PLAN-COMPANERO.md).

<p align="center">
  <a href="https://gabrieltosh.github.io/isbar/">Web</a> ·
  <a href="https://gabrieltosh.github.io/isbar/privacidad">Privacidad</a> ·
  <a href="LICENSE">Licencia MIT</a>
</p>

<p align="center">
  <img src="tienda/capturas/1-musica.png" alt="isbar mostrando la canción que suena con sus controles" />
</p>

<table>
  <tr>
    <td><img src="tienda/capturas/2-pomodoro.png" alt="Vista Pomodoro" /></td>
    <td><img src="tienda/capturas/3-pausas.png" alt="Vista de pausas activas" /></td>
  </tr>
  <tr>
    <td><img src="tienda/capturas/4-agua.png" alt="Vista del recordatorio de agua" /></td>
    <td><img src="tienda/capturas/5-calendario.png" alt="Vista de calendario" /></td>
  </tr>
</table>

## Qué hace

- **Música**: lo que suena en el sistema (Spotify, navegador…), con carátula y controles.
- **Notificaciones**: muestra las notificaciones de Windows y avisa de cuántas hay pendientes.
- **Pomodoro**: temporizador de enfoque y descansos que sigue contando con la barra contraída.
- **Agua**: litros bebidos hoy, meta diaria y recordatorio.
- **Pausas activas**: recordatorios para estirar la postura y descansar la vista, con ejercicios guiados paso a paso.
- **Tareas**, **Bandeja** de archivos y **Calendario**.
- **Uso de Claude**: límites de 5 horas y semanal de Claude Code (a través de su barra de estado).
- Se oculta con aplicaciones a pantalla completa, icono en la bandeja del sistema, inicio con Windows
  y configuración de vistas, tamaño, posición y monitor.

## Desarrollo

Requisitos: Windows 10 (2004) o posterior, [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/) y el
[Windows SDK](https://developer.microsoft.com/windows/downloads/windows-sdk/) (para los paquetes MSIX).

```
npm install
npm run tauri dev
```

Hecho con [Tauri 2](https://tauri.app/) (Rust + WebView2) y TypeScript sin frameworks.

### Notificaciones del sistema en desarrollo

Leer las notificaciones de Windows requiere identidad de paquete. En desarrollo se registra un paquete
externo firmado con un certificado de prueba (la primera vez, en PowerShell como administrador):

```
npm run paquete:registrar
npm run paquete:comprobar
```

### Paquete para Microsoft Store

```
npm run paquete:store
```

Genera `src-tauri/target/store/isbar_<versión>_x64.msix` (la Store lo firma al publicarlo). Con
`-Probar` crea además una copia firmada para instalarla en tu PC antes de subirla.

### Uso de Claude Code

```
npm run claude:instalar   # añade la barra de estado de isbar a Claude Code (conserva la que hubiera)
npm run claude:quitar     # la quita y deja la anterior
```

## Licencia

[MIT](LICENSE)
