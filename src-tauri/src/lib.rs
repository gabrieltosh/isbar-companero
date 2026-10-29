mod autoarranque;
mod claude_uso;
mod companero;
mod globo;
mod panel;
mod tray;
mod window;

#[cfg(target_os = "windows")]
mod fullscreen;
#[cfg(target_os = "windows")]
mod media;
#[cfg(target_os = "windows")]
mod notifications;

use tauri::{Emitter, Manager};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Tiene que ser el primer plugin. Si la app ya está abierta (por ejemplo, arrancó con
        // Windows y se abre a mano), no aparece un segundo compañero: el que ya está se muestra y saluda
        .plugin(tauri_plugin_single_instance::init(|app, _args, _carpeta| {
            app.state::<window::Estado>().visible_usuario.store(true, std::sync::atomic::Ordering::SeqCst);
            window::aplicar_visibilidad(app);
            let _ = app.emit("otra-copia", ());
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(window::Estado::default());

    #[cfg(target_os = "windows")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        companero::iniciar_companero,
        companero::set_companero_rects,
        companero::arrastrar_companero,
        companero::salir_del_borde,
        companero::fijar_tamano_companero,
        globo::mostrar_globo,
        globo::ocultar_globo,
        panel::alternar_panel,
        panel::cerrar_panel,
        tray::abrir_configuracion_cmd,
        claude_uso::leer_uso_claude,
        autoarranque::autoarranque_activo,
        autoarranque::autoarranque_fijar,
        media::media_play_pause,
        media::media_next,
        media::media_previous,
        notifications::abrir_ajustes_notificaciones,
        notifications::abrir_ajustes_banners,
        notifications::contar_notificaciones,
        notifications::abrir_centro_notificaciones,
        notifications::listar_notificaciones,
        notifications::eliminar_notificacion,
        notifications::eliminar_notificaciones,
        notifications::abrir_notificacion,
    ]);
    #[cfg(not(target_os = "windows"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        companero::iniciar_companero,
        companero::set_companero_rects,
        companero::arrastrar_companero,
        companero::salir_del_borde,
        companero::fijar_tamano_companero,
        globo::mostrar_globo,
        globo::ocultar_globo,
        panel::alternar_panel,
        panel::cerrar_panel,
        tray::abrir_configuracion_cmd,
        claude_uso::leer_uso_claude,
        autoarranque::autoarranque_activo,
        autoarranque::autoarranque_fijar,
    ]);

    builder
        .setup(|app| {
            // La única ventana es la del compañero; su página la coloca y la muestra
            companero::crear(app.handle())?;
            globo::crear(app.handle())?;
            panel::crear(app.handle())?;
            tray::crear(app.handle())?;
            window::iniciar_click_through(app.handle().clone());
            claude_uso::iniciar(app.handle().clone());
            #[cfg(target_os = "windows")]
            {
                fullscreen::iniciar(app.handle().clone());
                media::iniciar(app.handle().clone());
                notifications::iniciar(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar el compañero");
}
