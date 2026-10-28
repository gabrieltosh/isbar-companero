mod autoarranque;
mod claude_uso;
mod companero;
mod tray;
mod window;

#[cfg(target_os = "windows")]
mod fullscreen;
#[cfg(target_os = "windows")]
mod media;
#[cfg(target_os = "windows")]
mod notifications;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(window::EstadoIsla::default());

    #[cfg(target_os = "windows")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        window::set_island_rect,
        window::aplicar_ajustes_ventana,
        window::listar_monitores,
        window::aplicar_estilo,
        companero::iniciar_companero,
        companero::set_companero_rects,
        companero::arrastrar_companero,
        companero::salir_del_borde,
        tray::abrir_configuracion_cmd,
        claude_uso::leer_uso_claude,
        autoarranque::autoarranque_activo,
        autoarranque::autoarranque_fijar,
        media::media_play_pause,
        media::media_next,
        media::media_previous,
        notifications::abrir_ajustes_notificaciones,
        notifications::contar_notificaciones,
        notifications::abrir_centro_notificaciones,
        notifications::listar_notificaciones,
        notifications::eliminar_notificacion,
        notifications::eliminar_notificaciones,
        notifications::abrir_notificacion,
    ]);
    #[cfg(not(target_os = "windows"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        window::set_island_rect,
        window::aplicar_ajustes_ventana,
        window::listar_monitores,
        window::aplicar_estilo,
        companero::iniciar_companero,
        companero::set_companero_rects,
        companero::arrastrar_companero,
        companero::salir_del_borde,
        tray::abrir_configuracion_cmd,
        claude_uso::leer_uso_claude,
        autoarranque::autoarranque_activo,
        autoarranque::autoarranque_fijar,
    ]);

    builder
        .setup(|app| {
            if let Some(ventana) = app.get_webview_window("main") {
                window::colocar(&ventana, &window::AjustesVentana::default())?;
                ventana.set_ignore_cursor_events(true)?;
            }
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
        .expect("error al iniciar la isla");
}
