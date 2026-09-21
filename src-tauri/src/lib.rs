mod ai;
mod commands;
mod models;
mod palette;
mod store;

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::menu::{Menu, MenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

use commands::Db;

/// Menu par défaut de Tauri, dont l'entrée « About » est remplacée par un élément personnalisé.
fn install_menu(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    let about = MenuItem::with_id(handle, "about", "About PromptVault", true, None::<&str>)?;
    let app_menu = SubmenuBuilder::new(handle, "PromptVault")
        .item(&about)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let menu = Menu::new(handle)?;
    menu.append(&app_menu)?;
    // Fichier, Édition, Présentation, Fenêtre… : ceux de Tauri, inchangés (le 1er est l'ancien menu de l'app).
    for item in Menu::default(handle)?.items()?.into_iter().skip(1) {
        menu.append(&item)?;
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        palette::toggle(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = Connection::open(dir.join("promptvault.db"))?;
            store::init(&conn)?;
            // Corbeille : purge automatique au démarrage (30 jours).
            store::purge_old_trash(&conn)?;
            app.manage(Db(Mutex::new(conn)));
            palette::init(app)?;
            install_menu(app)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // « About PromptVault » du menu de l'application → notre fenêtre « À propos » (icône, auteur, version).
            if event.id() == "about" {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("open-about", ());
            }
        })
        .on_window_event(|window, event| match (window.label(), event) {
            // Fermer la fenêtre principale la masque : la palette ⌥⌘P reste disponible
            // (⌘Q quitte, un clic sur l'icône du Dock la rouvre).
            ("main", WindowEvent::CloseRequested { api, .. }) => {
                api.prevent_close();
                let _ = window.hide();
            }
            // La palette se ferme dès qu'elle perd le focus.
            (palette::LABEL, WindowEvent::Focused(false)) => {
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::set_folder_icon,
            commands::move_folder,
            commands::delete_folder,
            commands::list_prompts,
            commands::get_prompt,
            commands::create_prompt,
            commands::update_prompt,
            commands::trash_prompt,
            commands::restore_prompt,
            commands::delete_prompt_forever,
            commands::empty_trash,
            commands::duplicate_prompt,
            commands::mark_used,
            commands::list_versions,
            commands::restore_version,
            commands::counts,
            commands::export_to_file,
            commands::import_from_file,
            commands::list_tags,
            commands::export_markdown,
            commands::export_csv,
            ai::ai_settings,
            ai::ai_save_settings,
            ai::ai_set_key,
            ai::ai_delete_key,
            ai::ai_test,
            ai::ai_transform,
            palette::palette_choose,
            palette::palette_hide,
        ])
        .build(tauri::generate_context!())
        .expect("erreur au lancement de PromptVault");

    app.run(|handle, event| {
        // Clic sur l'icône du Dock alors que la fenêtre principale est masquée.
        if let RunEvent::Reopen { .. } = event {
            if let Some(win) = handle.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    });
}
