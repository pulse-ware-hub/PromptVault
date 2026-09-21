//! Commandes Tauri : fines enveloppes autour de `store` (verrou sur la connexion).

use std::sync::Mutex;

use rusqlite::Connection;
use tauri::State;

use crate::models::*;
use crate::store;

pub struct Db(pub Mutex<Connection>);

type Result<T> = std::result::Result<T, String>;

fn with<T>(db: &State<Db>, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    let conn = db.0.lock().map_err(|_| "E_DB_LOCKED".to_string())?;
    f(&conn)
}

#[tauri::command]
pub fn list_folders(db: State<Db>) -> Result<Vec<Folder>> {
    with(&db, store::list_folders)
}

#[tauri::command]
pub fn create_folder(db: State<Db>, name: String, parent_id: Option<String>) -> Result<Folder> {
    with(&db, |c| store::create_folder(c, &name, parent_id.as_deref()))
}

#[tauri::command]
pub fn rename_folder(db: State<Db>, id: String, name: String) -> Result<Folder> {
    with(&db, |c| store::rename_folder(c, &id, &name))
}

#[tauri::command]
pub fn set_folder_icon(db: State<Db>, id: String, icon: String) -> Result<Folder> {
    with(&db, |c| store::set_folder_icon(c, &id, &icon))
}

#[tauri::command]
pub fn move_folder(db: State<Db>, id: String, parent_id: Option<String>) -> Result<Folder> {
    with(&db, |c| store::move_folder(c, &id, parent_id.as_deref()))
}

#[tauri::command]
pub fn delete_folder(db: State<Db>, id: String) -> Result<()> {
    with(&db, |c| store::delete_folder(c, &id))
}

#[tauri::command]
pub fn list_prompts(db: State<Db>, filter: PromptFilter) -> Result<Vec<PromptSummary>> {
    with(&db, |c| store::list_prompts(c, &filter))
}

#[tauri::command]
pub fn get_prompt(db: State<Db>, id: String) -> Result<Prompt> {
    with(&db, |c| store::get_prompt(c, &id))
}

#[tauri::command]
pub fn create_prompt(
    db: State<Db>,
    folder_id: Option<String>,
    tool: Option<String>,
) -> Result<Prompt> {
    with(&db, |c| store::create_prompt(c, folder_id.as_deref(), tool.as_deref()))
}

#[tauri::command]
pub fn update_prompt(db: State<Db>, id: String, patch: PromptPatch) -> Result<Prompt> {
    with(&db, |c| store::update_prompt(c, &id, &patch))
}

#[tauri::command]
pub fn trash_prompt(db: State<Db>, id: String) -> Result<()> {
    with(&db, |c| store::trash_prompt(c, &id))
}

#[tauri::command]
pub fn restore_prompt(db: State<Db>, id: String) -> Result<Prompt> {
    with(&db, |c| store::restore_prompt(c, &id))
}

#[tauri::command]
pub fn delete_prompt_forever(db: State<Db>, id: String) -> Result<()> {
    with(&db, |c| store::delete_prompt_forever(c, &id))
}

#[tauri::command]
pub fn empty_trash(db: State<Db>) -> Result<usize> {
    with(&db, store::empty_trash)
}

#[tauri::command]
pub fn duplicate_prompt(db: State<Db>, id: String) -> Result<Prompt> {
    with(&db, |c| store::duplicate_prompt(c, &id))
}

#[tauri::command]
pub fn mark_used(db: State<Db>, id: String) -> Result<()> {
    with(&db, |c| store::mark_used(c, &id))
}

#[tauri::command]
pub fn list_versions(db: State<Db>, prompt_id: String) -> Result<Vec<Version>> {
    with(&db, |c| store::list_versions(c, &prompt_id))
}

#[tauri::command]
pub fn restore_version(db: State<Db>, version_id: i64) -> Result<Prompt> {
    with(&db, |c| store::restore_version(c, version_id))
}

#[tauri::command]
pub fn counts(db: State<Db>) -> Result<Counts> {
    with(&db, store::counts)
}

/// Exporte toute la bibliothèque dans un fichier JSON.
#[tauri::command]
pub fn export_to_file(db: State<Db>, path: String) -> Result<()> {
    let backup = with(&db, store::export_backup)?;
    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("E_WRITE_FAILED:{e}"))
}

/// Importe (fusionne) un fichier JSON exporté par PromptVault.
#[tauri::command]
pub fn import_from_file(db: State<Db>, path: String) -> Result<ImportReport> {
    let json =
        std::fs::read_to_string(&path).map_err(|e| format!("E_READ_FAILED:{e}"))?;
    let backup: Backup =
        serde_json::from_str(&json).map_err(|e| format!("E_BACKUP_INVALID:{e}"))?;
    with(&db, |c| store::import_backup(c, &backup))
}

#[tauri::command]
pub fn list_tags(db: State<Db>) -> Result<Vec<TagCount>> {
    with(&db, store::all_tags)
}

/// Export Markdown : un prompt → fichier `.md` ; dossier / tout → arborescence dans le dossier choisi.
#[tauri::command]
pub fn export_markdown(db: State<Db>, path: String, scope: ExportScope) -> Result<usize> {
    with(&db, |c| {
        if scope.kind == "prompt" {
            let items = store::prompts_in_scope(c, &scope)?;
            let (p, folder) = items.first().ok_or("E_PROMPT_NOT_FOUND")?;
            std::fs::write(&path, store::prompt_to_markdown(p, folder))
                .map_err(|e| format!("E_WRITE_FAILED:{e}"))?;
            Ok(1)
        } else {
            store::export_markdown_tree(c, std::path::Path::new(&path), &scope)
        }
    })
}

#[tauri::command]
pub fn export_csv(db: State<Db>, path: String, scope: ExportScope) -> Result<usize> {
    with(&db, |c| {
        let (csv, n) = store::export_csv_string(c, &scope)?;
        std::fs::write(&path, csv).map_err(|e| format!("E_WRITE_FAILED:{e}"))?;
        Ok(n)
    })
}
