//! Palette globale (⌥⌘P) : fenêtre flottante de recherche, utilisable depuis n'importe quelle app.
//!
//! Choisir un prompt le copie dans le presse-papier puis, si macOS l'autorise (Accessibilité),
//! réactive l'application précédente et y colle (⌘V). Sans autorisation, il reste copié.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::commands::Db;
use crate::store;

pub const SHORTCUT: &str = "Alt+CommandOrControl+P";
pub const LABEL: &str = "palette";

/// Identifiant (bundle id) de l'application active au moment où la palette s'ouvre.
pub struct PrevApp(pub Mutex<Option<String>>);

pub fn init(app: &tauri::App) -> tauri::Result<()> {
    app.manage(PrevApp(Mutex::new(None)));
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#palette".into()))
        .title("PromptVault — Palette")
        .inner_size(680.0, 460.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .skip_taskbar(true)
        .center()
        .build()?;
    if let Err(e) = app.global_shortcut().register(SHORTCUT) {
        eprintln!("Palette : raccourci {SHORTCUT} indisponible ({e})");
    }
    Ok(())
}

/// Ouvre la palette (ou la ferme si elle est déjà visible).
pub fn toggle(app: &AppHandle) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
        return;
    }
    let handle = app.clone();
    // osascript prend ~100 ms : hors du thread du raccourci.
    std::thread::spawn(move || {
        let front = frontmost_bundle_id();
        if let Ok(mut prev) = handle.state::<PrevApp>().0.lock() {
            *prev = front;
        }
        if let Some(win) = handle.get_webview_window(LABEL) {
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
            let _ = win.emit("palette-open", ());
        }
    });
}

/// Un bundle id ne contient que des lettres, chiffres, points et tirets (évite toute injection AppleScript).
fn valid_bundle_id(s: &str) -> bool {
    !s.is_empty() && s.len() < 200 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

fn osascript(script: &str) -> Result<String, String> {
    let out = Command::new("osascript")
        .args(["-e", script])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn frontmost_bundle_id() -> Option<String> {
    osascript(
        "tell application \"System Events\" to get bundle identifier of first application process whose frontmost is true",
    )
    .ok()
    .filter(|id| valid_bundle_id(id))
}

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .env("LC_ALL", "en_US.UTF-8")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("pbcopy: stdin indisponible")?
        .write_all(text.as_bytes())
        .map_err(|e| e.to_string())?;
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

/// Copie `text`, ferme la palette et, si `paste`, colle dans l'application précédente.
/// Retourne `pasted` (collé), `copied` (copie seule demandée) ou `paste-failed` (copié, collage refusé).
#[tauri::command]
pub async fn palette_choose(
    app: AppHandle,
    db: State<'_, Db>,
    id: String,
    text: String,
    paste: bool,
) -> Result<String, String> {
    copy_to_clipboard(&text).map_err(|e| format!("E_CLIPBOARD:{e}"))?;
    if let Ok(conn) = db.0.lock() {
        let _ = store::mark_used(&conn, &id);
    }
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
    let result = if paste { paste_into_previous(&app) } else { "copied".to_string() };
    // Le principal peut afficher un rappel (ex. autorisation Accessibilité manquante).
    let _ = app.emit("palette-result", &result);
    Ok(result)
}

fn paste_into_previous(app: &AppHandle) -> String {
    let prev = app.state::<PrevApp>().0.lock().ok().and_then(|p| p.clone());
    std::thread::sleep(Duration::from_millis(120));
    if let Some(bundle) = prev {
        let _ = osascript(&format!("tell application id \"{bundle}\" to activate"));
        std::thread::sleep(Duration::from_millis(200));
    }
    match osascript("tell application \"System Events\" to keystroke \"v\" using command down") {
        Ok(_) => "pasted".into(),
        Err(_) => "paste-failed".into(),
    }
}

#[tauri::command]
pub fn palette_hide(app: AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_ids_are_validated_against_injection() {
        assert!(valid_bundle_id("com.apple.Safari"));
        assert!(valid_bundle_id("com.pulseware.promptvault"));
        assert!(!valid_bundle_id(""));
        assert!(!valid_bundle_id("x\" to quit\" -- "));
        assert!(!valid_bundle_id("a b"));
        assert!(!valid_bundle_id(&"a".repeat(300)));
    }
}
