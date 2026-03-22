mod commands;
mod server;

use tauri::menu::MenuBuilder;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

const TRAY_MENU_SHOW: &str = "tray_show_main";
const TRAY_MENU_QUIT: &str = "tray_quit_app";
const MAIN_WINDOW_LABEL: &str = "main";

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    webot_service_rs::init_tracing();

    let desktop_state = server::bootstrap().expect("failed to bootstrap desktop runtime");

    tauri::Builder::default()
        .manage(desktop_state)
        .setup(|app| {
            let menu = MenuBuilder::new(app)
                .text(TRAY_MENU_SHOW, "打开 WeBot")
                .text(TRAY_MENU_QUIT, "退出 WeBot")
                .build()?;

            let mut tray_builder = TrayIconBuilder::with_id(MAIN_WINDOW_LABEL)
                .menu(&menu)
                .tooltip("WeBot")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    TRAY_MENU_SHOW => show_main_window(app),
                    TRAY_MENU_QUIT => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(&tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            let _ = tray_builder.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_port,
            commands::get_api_base_url,
            commands::get_openfang_base_url,
            commands::get_status,
            commands::get_app_metadata,
            commands::download_and_install_update,
            commands::pick_skill_folder,
            commands::pick_avatar_file,
            commands::launch_mpv,
            commands::read_markdown_file,
            commands::save_markdown_as,
            commands::read_binary_file_base64,
            commands::save_binary_file_as,
            commands::open_file_with_system,
            commands::load_skill_component_source,
            commands::load_skill_prompt_context,
            commands::list_available_skill_components,
            commands::load_skill_component_manifest,
            commands::load_global_agent_rules,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri app")
        .run(|app, event| match event {
            tauri::RunEvent::WindowEvent { label, event, .. } => {
                if label == MAIN_WINDOW_LABEL {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_main_window(app);
                    }
                }
            }
            tauri::RunEvent::ExitRequested { .. } => {
                let state = app.state::<server::DesktopState>();
                server::shutdown(&state);
            }
            _ => {}
        });
}
