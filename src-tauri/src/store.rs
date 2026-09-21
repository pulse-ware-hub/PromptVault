//! Accès SQLite : schéma, migrations, dossiers, prompts, versions, recherche, corbeille.
//!
//! Les erreurs renvoyées au frontend sont des **codes** (`E_FOLDER_NOT_FOUND`, éventuellement
//! `E_TOOL_UNKNOWN:image`) que l'interface traduit selon la langue choisie.
//!
//! Toutes les fonctions prennent un `&Connection` : les commandes Tauri les appellent
//! sous verrou, et les tests les exécutent sur une base en mémoire.

use std::collections::HashMap;

use chrono::{Duration, Utc};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};

use crate::models::*;

type Result<T> = std::result::Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Une nouvelle version dans cet intervalle écrase la précédente (évite une version par frappe).
const VERSION_COALESCE_SECONDS: i64 = 300;
const MAX_VERSIONS_PER_PROMPT: i64 = 100;
pub const TRASH_RETENTION_DAYS: i64 = 30;

// ── Schéma ────────────────────────────────────────────────────────────────────

const SCHEMA_V1: &str = "
CREATE TABLE folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT 'folder',
    parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0,
    is_system  INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE prompts (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL DEFAULT '',
    content      TEXT NOT NULL DEFAULT '',
    folder_id    TEXT NOT NULL REFERENCES folders(id),
    tool         TEXT NOT NULL DEFAULT 'none',
    tags         TEXT NOT NULL DEFAULT '[]',
    favorite     INTEGER NOT NULL DEFAULT 0,
    trashed_at   TEXT,
    meta         TEXT NOT NULL DEFAULT '{}',
    use_count    INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX idx_prompts_folder ON prompts(folder_id);
CREATE INDEX idx_prompts_updated ON prompts(updated_at);

CREATE TABLE prompt_versions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_id TEXT NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    content   TEXT NOT NULL,
    saved_at  TEXT NOT NULL
);
CREATE INDEX idx_versions_prompt ON prompt_versions(prompt_id);

CREATE VIRTUAL TABLE prompts_fts USING fts5(
    title, content, tags,
    content='prompts', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER prompts_ai AFTER INSERT ON prompts BEGIN
    INSERT INTO prompts_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;
CREATE TRIGGER prompts_ad AFTER DELETE ON prompts BEGIN
    INSERT INTO prompts_fts(prompts_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;
CREATE TRIGGER prompts_au AFTER UPDATE ON prompts BEGIN
    INSERT INTO prompts_fts(prompts_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
    INSERT INTO prompts_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;
";

/// v2 : prompts épinglés.
const SCHEMA_V2: &str = "ALTER TABLE prompts ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;";

/// v3 : réglages clé/valeur (fournisseur d'IA, modèles…). Les clés API n'y sont JAMAIS stockées (Trousseau macOS).
const SCHEMA_V3: &str = "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);";

/// Ouvre la connexion (pragmas) et applique les migrations manquantes.
pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .map_err(err)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(err)?;
    if version < 1 {
        let tx = conn.unchecked_transaction().map_err(err)?;
        tx.execute_batch(SCHEMA_V1).map_err(err)?;
        tx.execute(
            "INSERT INTO folders (id, name, icon, parent_id, position, is_system, created_at)
             VALUES (?1, ?2, 'tray', NULL, 0, 1, ?3)",
            params![DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME, now()],
        )
        .map_err(err)?;
        tx.execute_batch("PRAGMA user_version = 1;").map_err(err)?;
        tx.commit().map_err(err)?;
    }
    if version < 2 {
        let tx = conn.unchecked_transaction().map_err(err)?;
        tx.execute_batch(SCHEMA_V2).map_err(err)?;
        tx.execute_batch("PRAGMA user_version = 2;").map_err(err)?;
        tx.commit().map_err(err)?;
    }
    if version < 3 {
        let tx = conn.unchecked_transaction().map_err(err)?;
        tx.execute_batch(SCHEMA_V3).map_err(err)?;
        tx.execute_batch("PRAGMA user_version = 3;").map_err(err)?;
        tx.commit().map_err(err)?;
    }
    Ok(())
}

// ── Dossiers ──────────────────────────────────────────────────────────────────

fn row_to_folder(r: &Row) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: r.get("id")?,
        name: r.get("name")?,
        icon: r.get("icon")?,
        parent_id: r.get("parent_id")?,
        position: r.get("position")?,
        is_system: r.get::<_, i64>("is_system")? != 0,
        created_at: r.get("created_at")?,
    })
}

pub fn list_folders(conn: &Connection) -> Result<Vec<Folder>> {
    let mut stmt = conn
        .prepare("SELECT * FROM folders ORDER BY is_system DESC, position, name COLLATE NOCASE")
        .map_err(err)?;
    let rows = stmt.query_map([], row_to_folder).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

fn get_folder(conn: &Connection, id: &str) -> Result<Folder> {
    conn.query_row("SELECT * FROM folders WHERE id = ?1", [id], row_to_folder)
        .optional()
        .map_err(err)?
        .ok_or_else(|| format!("E_FOLDER_NOT_FOUND:{id}"))
}

pub fn create_folder(conn: &Connection, name: &str, parent_id: Option<&str>) -> Result<Folder> {
    let name = name.trim();
    if name.is_empty() {
        return Err("E_FOLDER_NAME_EMPTY".into());
    }
    if let Some(p) = parent_id {
        get_folder(conn, p)?;
    }
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM folders WHERE parent_id IS ?1",
            [parent_id],
            |r| r.get(0),
        )
        .map_err(err)?;
    let id = new_id();
    conn.execute(
        "INSERT INTO folders (id, name, icon, parent_id, position, is_system, created_at)
         VALUES (?1, ?2, 'folder', ?3, ?4, 0, ?5)",
        params![id, name, parent_id, position, now()],
    )
    .map_err(err)?;
    get_folder(conn, &id)
}

pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> Result<Folder> {
    let name = name.trim();
    if name.is_empty() {
        return Err("E_FOLDER_NAME_EMPTY".into());
    }
    if get_folder(conn, id)?.is_system {
        return Err("E_SYSTEM_FOLDER_RENAME".into());
    }
    conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id])
        .map_err(err)?;
    get_folder(conn, id)
}

pub fn set_folder_icon(conn: &Connection, id: &str, icon: &str) -> Result<Folder> {
    conn.execute("UPDATE folders SET icon = ?1 WHERE id = ?2", params![icon, id])
        .map_err(err)?;
    get_folder(conn, id)
}

/// Identifiants d'un dossier et de tous ses descendants.
fn subtree_ids(conn: &Connection, id: &str) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE sub(id) AS (
                 SELECT ?1
                 UNION ALL
                 SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
             ) SELECT id FROM sub",
        )
        .map_err(err)?;
    let rows = stmt.query_map([id], |r| r.get::<_, String>(0)).map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

pub fn move_folder(conn: &Connection, id: &str, new_parent: Option<&str>) -> Result<Folder> {
    if get_folder(conn, id)?.is_system {
        return Err("E_SYSTEM_FOLDER_MOVE".into());
    }
    if let Some(p) = new_parent {
        get_folder(conn, p)?;
        if subtree_ids(conn, id)?.iter().any(|s| s == p) {
            return Err("E_FOLDER_CYCLE".into());
        }
    }
    conn.execute(
        "UPDATE folders SET parent_id = ?1 WHERE id = ?2",
        params![new_parent, id],
    )
    .map_err(err)?;
    get_folder(conn, id)
}

/// Supprime un dossier et ses sous-dossiers ; leurs prompts vont à la corbeille
/// (rattachés à « Mes prompts », donc restaurables).
pub fn delete_folder(conn: &Connection, id: &str) -> Result<()> {
    if get_folder(conn, id)?.is_system {
        return Err("E_SYSTEM_FOLDER_DELETE".into());
    }
    let ids = subtree_ids(conn, id)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    let ts = now();
    for fid in &ids {
        tx.execute(
            "UPDATE prompts SET folder_id = ?1, trashed_at = COALESCE(trashed_at, ?2), updated_at = ?2
             WHERE folder_id = ?3",
            params![DEFAULT_FOLDER_ID, ts, fid],
        )
        .map_err(err)?;
    }
    tx.execute("DELETE FROM folders WHERE id = ?1", [id]).map_err(err)?;
    tx.commit().map_err(err)
}

// ── Prompts ───────────────────────────────────────────────────────────────────

fn parse_tags(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn row_to_prompt(r: &Row) -> rusqlite::Result<Prompt> {
    Ok(Prompt {
        id: r.get("id")?,
        title: r.get("title")?,
        content: r.get("content")?,
        folder_id: r.get("folder_id")?,
        tool: r.get("tool")?,
        tags: parse_tags(&r.get::<_, String>("tags")?),
        favorite: r.get::<_, i64>("favorite")? != 0,
        pinned: r.get::<_, i64>("pinned")? != 0,
        trashed_at: r.get("trashed_at")?,
        meta: serde_json::from_str(&r.get::<_, String>("meta")?).unwrap_or(serde_json::json!({})),
        use_count: r.get("use_count")?,
        last_used_at: r.get("last_used_at")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

pub fn get_prompt(conn: &Connection, id: &str) -> Result<Prompt> {
    conn.query_row("SELECT * FROM prompts WHERE id = ?1", [id], row_to_prompt)
        .optional()
        .map_err(err)?
        .ok_or_else(|| format!("E_PROMPT_NOT_FOUND:{id}"))
}

fn check_tool(tool: &str) -> Result<()> {
    if TOOLS.contains(&tool) {
        Ok(())
    } else {
        Err(format!("E_TOOL_UNKNOWN:{tool}"))
    }
}

/// Requête FTS5 sûre : chaque mot devient un préfixe entre guillemets (`"mot"*`).
fn fts_query(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{w}\"*"))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

pub fn list_prompts(conn: &Connection, filter: &PromptFilter) -> Result<Vec<PromptSummary>> {
    let mut conditions: Vec<String> = Vec::new();
    let mut args: Vec<String> = Vec::new();
    let mut limit = "";

    match filter.kind.as_str() {
        "all" => conditions.push("p.trashed_at IS NULL".into()),
        "favorites" => conditions.push("p.trashed_at IS NULL AND p.favorite = 1".into()),
        "recent" => {
            conditions.push("p.trashed_at IS NULL".into());
            limit = " LIMIT 50";
        }
        "trash" => conditions.push("p.trashed_at IS NOT NULL".into()),
        "folder" => {
            conditions.push("p.trashed_at IS NULL AND p.folder_id = ?".into());
            args.push(filter.id.clone().ok_or("E_MISSING_ARG")?);
        }
        "tool" => {
            let tool = filter.id.clone().ok_or("E_MISSING_ARG")?;
            check_tool(&tool)?;
            conditions.push("p.trashed_at IS NULL AND p.tool = ?".into());
            args.push(tool);
        }
        other => return Err(format!("E_UNKNOWN_SELECTION:{other}")),
    }

    if let Some(q) = filter.query.as_deref().and_then(fts_query) {
        conditions.push("p.rowid IN (SELECT rowid FROM prompts_fts WHERE prompts_fts MATCH ?)".into());
        args.push(q);
    }

    let sql = format!(
        "SELECT p.id, p.title, substr(replace(p.content, char(10), ' '), 1, 160) AS preview,
                p.folder_id, p.tool, p.tags, p.favorite, p.trashed_at, p.updated_at, p.pinned
         FROM prompts p WHERE {} ORDER BY p.updated_at DESC, p.rowid DESC{}",
        conditions.join(" AND "),
        limit
    );
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt
        .query_map(params_from_iter(args.iter()), |r| {
            Ok(PromptSummary {
                id: r.get(0)?,
                title: r.get(1)?,
                preview: r.get(2)?,
                folder_id: r.get(3)?,
                tool: r.get(4)?,
                tags: parse_tags(&r.get::<_, String>(5)?),
                favorite: r.get::<_, i64>(6)? != 0,
                trashed_at: r.get(7)?,
                updated_at: r.get(8)?,
                pinned: r.get::<_, i64>(9)? != 0,
            })
        })
        .map_err(err)?;
    let mut items: Vec<PromptSummary> = rows.collect::<rusqlite::Result<_>>().map_err(err)?;
    // Les épinglés passent en tête (corbeille et « Récents », purement chronologiques, exceptés).
    if !matches!(filter.kind.as_str(), "trash" | "recent") {
        pin_to_top(&mut items);
    }
    Ok(items)
}

/// Tags propres : sans vides ni doublons (casse ignorée), triés alphabétiquement (accents ignorés).
fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().trim_start_matches('#').trim().to_string())
        .filter(|t| !t.is_empty() && seen.insert(sort_key(t)))
        .collect();
    out.sort_by_cached_key(|t| sort_key(t));
    out
}

/// Clé de tri « naturelle » : minuscules, sans accents (« Émile » se range avec les « E »).
fn sort_key(s: &str) -> String {
    use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};
    s.trim().nfd().filter(|c| !is_combining_mark(*c)).collect::<String>().to_lowercase()
}

/// Épinglés d'abord, triés par titre puis par début du contenu (un titre vide se range
/// d'après le contenu) ; les autres gardent l'ordre reçu (du plus récent au plus ancien).
fn pin_to_top(items: &mut Vec<PromptSummary>) {
    let (mut pinned, rest): (Vec<_>, Vec<_>) = items.drain(..).partition(|p| p.pinned);
    pinned.sort_by_cached_key(|p| {
        let content = sort_key(&p.preview);
        let title = sort_key(&p.title);
        (if title.is_empty() { content.clone() } else { title }, content)
    });
    items.extend(pinned);
    items.extend(rest);
}

/// Nouveau prompt : par défaut dans « Mes prompts ».
pub fn create_prompt(
    conn: &Connection,
    folder_id: Option<&str>,
    tool: Option<&str>,
) -> Result<Prompt> {
    let folder = folder_id.unwrap_or(DEFAULT_FOLDER_ID);
    get_folder(conn, folder)?;
    let tool = tool.unwrap_or("none");
    check_tool(tool)?;
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO prompts (id, folder_id, tool, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, folder, tool, ts],
    )
    .map_err(err)?;
    get_prompt(conn, &id)
}

pub fn update_prompt(conn: &Connection, id: &str, patch: &PromptPatch) -> Result<Prompt> {
    let cur = get_prompt(conn, id)?;
    let title = patch.title.clone().unwrap_or_else(|| cur.title.clone());
    let content = patch.content.clone().unwrap_or_else(|| cur.content.clone());
    let folder_id = patch.folder_id.clone().unwrap_or_else(|| cur.folder_id.clone());
    let tool = patch.tool.clone().unwrap_or_else(|| cur.tool.clone());
    let tags = normalize_tags(patch.tags.clone().unwrap_or_else(|| cur.tags.clone()));
    let favorite = patch.favorite.unwrap_or(cur.favorite);
    let pinned = patch.pinned.unwrap_or(cur.pinned);
    let meta = patch.meta.clone().unwrap_or_else(|| cur.meta.clone());
    // Épingler / désépingler ne compte pas comme une modification (date inchangée).
    let pin_only = patch.pinned.is_some()
        && patch.title.is_none()
        && patch.content.is_none()
        && patch.folder_id.is_none()
        && patch.tool.is_none()
        && patch.tags.is_none()
        && patch.favorite.is_none()
        && patch.meta.is_none();
    let updated_at = if pin_only { cur.updated_at.clone() } else { now() };

    check_tool(&tool)?;
    if folder_id != cur.folder_id {
        get_folder(conn, &folder_id)?;
    }
    let text_changed = title != cur.title || content != cur.content;

    conn.execute(
        "UPDATE prompts SET title = ?1, content = ?2, folder_id = ?3, tool = ?4, tags = ?5,
                favorite = ?6, meta = ?7, updated_at = ?8, pinned = ?10 WHERE id = ?9",
        params![
            title,
            content,
            folder_id,
            tool,
            serde_json::to_string(&tags).map_err(err)?,
            favorite as i64,
            serde_json::to_string(&meta).map_err(err)?,
            updated_at,
            id,
            pinned as i64
        ],
    )
    .map_err(err)?;
    if text_changed {
        if patch.new_version == Some(true) {
            // L'ancien texte doit rester consultable : on l'enregistre d'abord s'il n'a aucune version.
            let has_versions: i64 = conn
                .query_row("SELECT COUNT(*) FROM prompt_versions WHERE prompt_id = ?1", [id], |r| r.get(0))
                .map_err(err)?;
            if has_versions == 0 {
                insert_version(conn, id, &cur.title, &cur.content)?;
            }
            insert_version(conn, id, &title, &content)?;
        } else {
            snapshot_version(conn, id, &title, &content)?;
        }
    }
    get_prompt(conn, id)
}

/// Enregistre une version ; une version très récente est mise à jour plutôt que dupliquée.
fn snapshot_version(conn: &Connection, prompt_id: &str, title: &str, content: &str) -> Result<()> {
    let last: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, saved_at FROM prompt_versions WHERE prompt_id = ?1 ORDER BY id DESC LIMIT 1",
            [prompt_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    let ts = now();
    let recent = last.as_ref().is_some_and(|(_, saved)| {
        chrono::DateTime::parse_from_rfc3339(saved)
            .map(|d| (Utc::now() - d.with_timezone(&Utc)).num_seconds() < VERSION_COALESCE_SECONDS)
            .unwrap_or(false)
    });
    match last {
        Some((vid, _)) if recent => {
            conn.execute(
                "UPDATE prompt_versions SET title = ?1, content = ?2, saved_at = ?3 WHERE id = ?4",
                params![title, content, ts, vid],
            )
            .map_err(err)?;
        }
        _ => insert_version(conn, prompt_id, title, content)?,
    }
    Ok(())
}

/// Ajoute une version (sans fusion) et borne l'historique à `MAX_VERSIONS_PER_PROMPT`.
fn insert_version(conn: &Connection, prompt_id: &str, title: &str, content: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO prompt_versions (prompt_id, title, content, saved_at) VALUES (?1, ?2, ?3, ?4)",
        params![prompt_id, title, content, now()],
    )
    .map_err(err)?;
    conn.execute(
        "DELETE FROM prompt_versions WHERE prompt_id = ?1 AND id NOT IN (
             SELECT id FROM prompt_versions WHERE prompt_id = ?1 ORDER BY id DESC LIMIT ?2)",
        params![prompt_id, MAX_VERSIONS_PER_PROMPT],
    )
    .map_err(err)?;
    Ok(())
}

pub fn list_versions(conn: &Connection, prompt_id: &str) -> Result<Vec<Version>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, prompt_id, title, content, saved_at FROM prompt_versions
             WHERE prompt_id = ?1 ORDER BY id DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([prompt_id], |r| {
            Ok(Version {
                id: r.get(0)?,
                prompt_id: r.get(1)?,
                title: r.get(2)?,
                content: r.get(3)?,
                saved_at: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

pub fn restore_version(conn: &Connection, version_id: i64) -> Result<Prompt> {
    let (prompt_id, title, content): (String, String, String) = conn
        .query_row(
            "SELECT prompt_id, title, content FROM prompt_versions WHERE id = ?1",
            [version_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(err)?
        .ok_or("E_VERSION_NOT_FOUND")?;
    update_prompt(
        conn,
        &prompt_id,
        &PromptPatch {
            title: Some(title),
            content: Some(content),
            ..Default::default()
        },
    )
}

pub fn trash_prompt(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE prompts SET trashed_at = ?1, updated_at = ?1 WHERE id = ?2 AND trashed_at IS NULL",
        params![now(), id],
    )
    .map_err(err)?;
    Ok(())
}

/// Restaure depuis la corbeille (dans son dossier, ou « Mes prompts » s'il n'existe plus).
pub fn restore_prompt(conn: &Connection, id: &str) -> Result<Prompt> {
    conn.execute(
        "UPDATE prompts SET trashed_at = NULL, updated_at = ?1 WHERE id = ?2",
        params![now(), id],
    )
    .map_err(err)?;
    get_prompt(conn, id)
}

pub fn delete_prompt_forever(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM prompts WHERE id = ?1", [id]).map_err(err)?;
    Ok(())
}

pub fn empty_trash(conn: &Connection) -> Result<usize> {
    conn.execute("DELETE FROM prompts WHERE trashed_at IS NOT NULL", [])
        .map_err(err)
}

/// Purge les prompts en corbeille depuis plus de `TRASH_RETENTION_DAYS` jours.
pub fn purge_old_trash(conn: &Connection) -> Result<usize> {
    let cutoff = (Utc::now() - Duration::days(TRASH_RETENTION_DAYS))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    conn.execute(
        "DELETE FROM prompts WHERE trashed_at IS NOT NULL AND trashed_at < ?1",
        [cutoff],
    )
    .map_err(err)
}

pub fn duplicate_prompt(conn: &Connection, id: &str) -> Result<Prompt> {
    let src = get_prompt(conn, id)?;
    let new = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO prompts (id, title, content, folder_id, tool, tags, favorite, meta, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?8)",
        params![
            new,
            format!("{} (copie)", src.title),
            src.content,
            src.folder_id,
            src.tool,
            serde_json::to_string(&src.tags).map_err(err)?,
            serde_json::to_string(&src.meta).map_err(err)?,
            ts
        ],
    )
    .map_err(err)?;
    get_prompt(conn, &new)
}

/// Compte une utilisation (copie du prompt) — sans modifier `updated_at`.
pub fn mark_used(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE prompts SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2",
        params![now(), id],
    )
    .map_err(err)?;
    Ok(())
}

pub fn counts(conn: &Connection) -> Result<Counts> {
    let mut c = Counts::default();
    c.all = conn
        .query_row("SELECT COUNT(*) FROM prompts WHERE trashed_at IS NULL", [], |r| r.get(0))
        .map_err(err)?;
    c.favorites = conn
        .query_row(
            "SELECT COUNT(*) FROM prompts WHERE trashed_at IS NULL AND favorite = 1",
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    c.trash = conn
        .query_row("SELECT COUNT(*) FROM prompts WHERE trashed_at IS NOT NULL", [], |r| r.get(0))
        .map_err(err)?;
    let group = |sql: &str| -> Result<HashMap<String, i64>> {
        let mut stmt = conn.prepare(sql).map_err(err)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(err)?;
        rows.collect::<rusqlite::Result<_>>().map_err(err)
    };
    c.by_folder = group(
        "SELECT folder_id, COUNT(*) FROM prompts WHERE trashed_at IS NULL GROUP BY folder_id",
    )?;
    c.by_tool =
        group("SELECT tool, COUNT(*) FROM prompts WHERE trashed_at IS NULL GROUP BY tool")?;
    Ok(c)
}

// ── Sauvegarde / import ───────────────────────────────────────────────────────

pub fn export_backup(conn: &Connection) -> Result<Backup> {
    let mut stmt = conn.prepare("SELECT * FROM prompts ORDER BY created_at").map_err(err)?;
    let prompts = stmt
        .query_map([], row_to_prompt)
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(Backup {
        version: 1,
        exported_at: now(),
        folders: list_folders(conn)?,
        prompts,
    })
}

/// Fusionne une sauvegarde : les éléments dont l'id existe déjà sont ignorés.
pub fn import_backup(conn: &Connection, backup: &Backup) -> Result<ImportReport> {
    if backup.version != 1 {
        return Err(format!("E_BACKUP_VERSION:{}", backup.version));
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    let mut report = ImportReport { folders: 0, prompts: 0 };

    // Dossiers en deux passes (parents éventuellement postérieurs aux enfants).
    for f in backup.folders.iter().filter(|f| !f.is_system) {
        report.folders += tx
            .execute(
                "INSERT OR IGNORE INTO folders (id, name, icon, parent_id, position, is_system, created_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, 0, ?5)",
                params![f.id, f.name, f.icon, f.position, f.created_at],
            )
            .map_err(err)?;
    }
    for f in backup.folders.iter().filter(|f| !f.is_system) {
        if let Some(p) = &f.parent_id {
            tx.execute(
                "UPDATE folders SET parent_id = ?1 WHERE id = ?2 AND parent_id IS NULL
                 AND EXISTS (SELECT 1 FROM folders WHERE id = ?1)",
                params![p, f.id],
            )
            .map_err(err)?;
        }
    }
    for p in &backup.prompts {
        check_tool(&p.tool)?;
        report.prompts += tx
            .execute(
                "INSERT OR IGNORE INTO prompts (id, title, content, folder_id, tool, tags, favorite,
                        trashed_at, meta, use_count, last_used_at, created_at, updated_at, pinned)
                 VALUES (?1, ?2, ?3,
                         COALESCE((SELECT id FROM folders WHERE id = ?4), ?5),
                         ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    p.id,
                    p.title,
                    p.content,
                    p.folder_id,
                    DEFAULT_FOLDER_ID,
                    p.tool,
                    serde_json::to_string(&p.tags).map_err(err)?,
                    p.favorite as i64,
                    p.trashed_at,
                    serde_json::to_string(&p.meta).map_err(err)?,
                    p.use_count,
                    p.last_used_at,
                    p.created_at,
                    p.updated_at,
                    p.pinned as i64
                ],
            )
            .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(report)
}

// ── Réglages ──────────────────────────────────────────────────────────────────

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .map_err(err)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(err)?;
    Ok(())
}

// ── Tags ──────────────────────────────────────────────────────────────────────

/// Tags utilisés (hors corbeille) avec leur fréquence, par ordre alphabétique — alimente la complétion.
pub fn all_tags(conn: &Connection) -> Result<Vec<TagCount>> {
    let mut stmt = conn
        .prepare(
            "SELECT j.value, COUNT(*) AS n FROM prompts p, json_each(p.tags) j
             WHERE p.trashed_at IS NULL GROUP BY j.value ORDER BY j.value COLLATE NOCASE",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok(TagCount { tag: r.get(0)?, count: r.get(1)? }))
        .map_err(err)?;
    rows.collect::<rusqlite::Result<_>>().map_err(err)
}

// ── Exports (Markdown / CSV) ──────────────────────────────────────────────────

/// Prompts concernés (hors corbeille, sauf un prompt demandé explicitement) avec le chemin
/// de leur dossier (`Marketing/Emails`).
pub fn prompts_in_scope(
    conn: &Connection,
    scope: &ExportScope,
) -> Result<Vec<(Prompt, String)>> {
    let folders = list_folders(conn)?;
    let path_of = |id: &str| -> String {
        let mut parts = Vec::new();
        let mut cur = folders.iter().find(|f| f.id == id);
        while let Some(f) = cur {
            parts.push(f.name.clone());
            cur = f.parent_id.as_ref().and_then(|p| folders.iter().find(|x| &x.id == p));
        }
        parts.reverse();
        parts.join("/")
    };
    let prompts: Vec<Prompt> = match scope.kind.as_str() {
        "prompt" => vec![get_prompt(conn, scope.id.as_deref().ok_or("E_MISSING_ARG")?)?],
        "folder" => {
            let ids = subtree_ids(conn, scope.id.as_deref().ok_or("E_MISSING_ARG")?)?;
            export_backup(conn)?
                .prompts
                .into_iter()
                .filter(|p| p.trashed_at.is_none() && ids.contains(&p.folder_id))
                .collect()
        }
        "all" => export_backup(conn)?.prompts.into_iter().filter(|p| p.trashed_at.is_none()).collect(),
        other => return Err(format!("E_UNKNOWN_SCOPE:{other}")),
    };
    Ok(prompts
        .into_iter()
        .map(|p| {
            let path = path_of(&p.folder_id);
            (p, path)
        })
        .collect())
}

/// Un prompt en Markdown : en-tête YAML (chaînes JSON, valides en YAML) puis le contenu.
pub fn prompt_to_markdown(p: &Prompt, folder_path: &str) -> String {
    let q = |s: &str| serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into());
    let mut out = String::from("---\n");
    out += &format!("title: {}\n", q(&p.title));
    out += &format!("tool: {}\n", p.tool);
    out += &format!("folder: {}\n", q(folder_path));
    out += &format!("tags: {}\n", serde_json::to_string(&p.tags).unwrap_or_else(|_| "[]".into()));
    out += &format!("favorite: {}\npinned: {}\n", p.favorite, p.pinned);
    out += &format!("created: {}\nupdated: {}\n", q(&p.created_at), q(&p.updated_at));
    if p.meta.as_object().is_some_and(|m| !m.is_empty()) {
        out += &format!("meta: {}\n", serde_json::to_string(&p.meta).unwrap_or_else(|_| "{}".into()));
    }
    out += "---\n\n";
    out += &p.content;
    if !p.content.ends_with('\n') {
        out.push('\n');
    }
    out
}

/// Nom de fichier sûr : sans séparateurs ni caractères réservés, 80 caractères max.
pub fn safe_name(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let cleaned = cleaned.trim_matches('.').trim().to_string();
    cleaned.chars().take(80).collect::<String>().trim().to_string()
}

/// Écrit `dir/<dossier>/<titre>.md` pour chaque prompt (arborescence = dossiers) ; retourne le nombre de fichiers.
pub fn export_markdown_tree(
    conn: &Connection,
    dir: &std::path::Path,
    scope: &ExportScope,
) -> Result<usize> {
    let mut count = 0;
    for (p, folder) in prompts_in_scope(conn, scope)? {
        let mut target = dir.to_path_buf();
        for part in folder.split('/').map(safe_name).filter(|s| !s.is_empty()) {
            target.push(part);
        }
        std::fs::create_dir_all(&target).map_err(|e| format!("E_MKDIR_FAILED:{e}"))?;
        let base = {
            let t = safe_name(&p.title);
            if t.is_empty() {
                let c = safe_name(&p.content);
                if c.is_empty() { "Sans titre".to_string() } else { c.chars().take(40).collect() }
            } else {
                t
            }
        };
        // Doublons de titre : « Titre.md », « Titre (2).md »…
        let mut file = target.join(format!("{base}.md"));
        let mut n = 2;
        while file.exists() {
            file = target.join(format!("{base} ({n}).md"));
            n += 1;
        }
        std::fs::write(&file, prompt_to_markdown(&p, &folder))
            .map_err(|e| format!("E_WRITE_FAILED:{e}"))?;
        count += 1;
    }
    Ok(count)
}

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// CSV (RFC 4180, BOM UTF-8 pour qu'Excel lise les accents).
pub fn export_csv_string(conn: &Connection, scope: &ExportScope) -> Result<(String, usize)> {
    let rows = prompts_in_scope(conn, scope)?;
    let mut out = String::from("\u{feff}id,title,folder,tool,tags,favorite,pinned,created_at,updated_at,content,meta\r\n");
    for (p, folder) in &rows {
        let meta = if p.meta.as_object().is_some_and(|m| m.is_empty()) {
            String::new()
        } else {
            serde_json::to_string(&p.meta).unwrap_or_default()
        };
        let cols = [
            p.id.clone(),
            p.title.clone(),
            folder.clone(),
            p.tool.clone(),
            p.tags.join("; "),
            p.favorite.to_string(),
            p.pinned.to_string(),
            p.created_at.clone(),
            p.updated_at.clone(),
            p.content.clone(),
            meta,
        ];
        out += &cols.iter().map(|c| csv_field(c)).collect::<Vec<_>>().join(",");
        out += "\r\n";
    }
    Ok((out, rows.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn
    }

    fn set(conn: &Connection, id: &str, title: &str, content: &str) -> Prompt {
        update_prompt(
            conn,
            id,
            &PromptPatch {
                title: Some(title.into()),
                content: Some(content.into()),
                ..Default::default()
            },
        )
        .unwrap()
    }

    fn filter(kind: &str, id: Option<&str>, query: Option<&str>) -> PromptFilter {
        PromptFilter {
            kind: kind.into(),
            id: id.map(Into::into),
            query: query.map(Into::into),
        }
    }

    #[test]
    fn default_folder_exists_and_is_protected() {
        let conn = db();
        let folders = list_folders(&conn).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].id, DEFAULT_FOLDER_ID);
        assert!(folders[0].is_system);
        assert!(delete_folder(&conn, DEFAULT_FOLDER_ID).is_err());
        assert!(rename_folder(&conn, DEFAULT_FOLDER_ID, "x").is_err());
        assert!(move_folder(&conn, DEFAULT_FOLDER_ID, None).is_err());
        init(&conn).unwrap(); // idempotent : pas de second dossier par défaut
        assert_eq!(list_folders(&conn).unwrap().len(), 1);
    }

    #[test]
    fn new_prompt_lands_in_my_prompts() {
        let conn = db();
        let p = create_prompt(&conn, None, None).unwrap();
        assert_eq!(p.folder_id, DEFAULT_FOLDER_ID);
        assert_eq!(p.tool, "none");
        let items = list_prompts(&conn, &filter("folder", Some(DEFAULT_FOLDER_ID), None)).unwrap();
        assert_eq!(items.len(), 1);
    }

    #[test]
    fn nested_folders_and_cycle_protection() {
        let conn = db();
        let a = create_folder(&conn, "A", None).unwrap();
        let b = create_folder(&conn, "B", Some(&a.id)).unwrap();
        assert_eq!(b.parent_id.as_deref(), Some(a.id.as_str()));
        assert!(move_folder(&conn, &a.id, Some(&b.id)).is_err()); // A dans son descendant B
        assert!(move_folder(&conn, &a.id, Some(&a.id)).is_err());
        assert!(create_folder(&conn, "  ", None).is_err());
        let moved = move_folder(&conn, &b.id, None).unwrap();
        assert_eq!(moved.parent_id, None);
    }

    #[test]
    fn delete_folder_sends_prompts_to_trash_and_they_can_be_restored() {
        let conn = db();
        let a = create_folder(&conn, "A", None).unwrap();
        let sub = create_folder(&conn, "Sub", Some(&a.id)).unwrap();
        let p1 = create_prompt(&conn, Some(&a.id), Some("image")).unwrap();
        let p2 = create_prompt(&conn, Some(&sub.id), None).unwrap();
        delete_folder(&conn, &a.id).unwrap();
        assert_eq!(list_folders(&conn).unwrap().len(), 1);
        let trash = list_prompts(&conn, &filter("trash", None, None)).unwrap();
        assert_eq!(trash.len(), 2);
        let restored = restore_prompt(&conn, &p1.id).unwrap();
        assert_eq!(restored.folder_id, DEFAULT_FOLDER_ID);
        assert!(restored.trashed_at.is_none());
        assert!(get_prompt(&conn, &p2.id).unwrap().trashed_at.is_some());
    }

    #[test]
    fn tools_are_validated_and_filterable() {
        let conn = db();
        assert!(create_prompt(&conn, None, Some("hologramme")).is_err());
        let p = create_prompt(&conn, None, Some("music")).unwrap();
        create_prompt(&conn, None, Some("code")).unwrap();
        let music = list_prompts(&conn, &filter("tool", Some("music"), None)).unwrap();
        assert_eq!(music.len(), 1);
        assert_eq!(music[0].id, p.id);
        assert!(list_prompts(&conn, &filter("tool", Some("nope"), None)).is_err());
    }

    #[test]
    fn full_text_search_is_prefix_accent_insensitive_and_tracks_updates() {
        let conn = db();
        let p = create_prompt(&conn, None, None).unwrap();
        set(&conn, &p.id, "Affiche de festival", "Une illustration très colorée");
        let q = |s: &str| list_prompts(&conn, &filter("all", None, Some(s))).unwrap().len();
        assert_eq!(q("illus"), 1); // préfixe
        assert_eq!(q("tres coloree"), 1); // sans accents
        assert_eq!(q("festival affiche"), 1); // plusieurs mots
        assert_eq!(q("absent"), 0);
        assert_eq!(q("\"; DROP TABLE"), 0); // requête hostile inoffensive
        set(&conn, &p.id, "Autre", "contenu neuf");
        assert_eq!(q("illustration"), 0); // index à jour après modification
        assert_eq!(q("neuf"), 1);
        trash_prompt(&conn, &p.id).unwrap();
        assert_eq!(q("neuf"), 0); // la corbeille n'apparaît pas dans « Tous »
        delete_prompt_forever(&conn, &p.id).unwrap();
        assert_eq!(
            list_prompts(&conn, &filter("trash", None, Some("neuf"))).unwrap().len(),
            0
        );
    }

    #[test]
    fn pinned_come_first_sorted_by_title_then_content_start() {
        let conn = db();
        let mk = |title: &str, content: &str| {
            let p = create_prompt(&conn, None, None).unwrap();
            set(&conn, &p.id, title, content);
            std::thread::sleep(std::time::Duration::from_millis(3)); // dates distinctes
            p
        };
        let zebre = mk("Zèbre", "rayures");
        let alpha = mk("alpha", "début");
        let emile = mk("Émile", "prénom");
        let no_title_b = mk("", "Bravo — contenu sans titre");
        let no_title_a = mk("  ", "alerte — contenu sans titre");
        let recent_unpinned = mk("Plus récent", "non épinglé");
        let old_unpinned = mk("Plus ancien", "non épinglé");
        for p in [&zebre, &alpha, &emile, &no_title_b, &no_title_a] {
            update_prompt(&conn, &p.id, &PromptPatch { pinned: Some(true), ..Default::default() })
                .unwrap();
        }
        let titles: Vec<String> = list_prompts(&conn, &filter("all", None, None))
            .unwrap()
            .into_iter()
            .map(|p| if p.title.trim().is_empty() { p.preview } else { p.title })
            .collect();
        // Épinglés d'abord (titre vide → début du contenu ; accents ignorés : « Émile » avec les « e »),
        // puis les autres du plus récemment modifié au plus ancien.
        assert_eq!(
            titles,
            [
                "alerte — contenu sans titre",
                "alpha",
                "Bravo — contenu sans titre",
                "Émile",
                "Zèbre",
                "Plus ancien",
                "Plus récent",
            ]
        );
        let _ = (&recent_unpinned, &old_unpinned);
    }

    #[test]
    fn pinning_keeps_the_modification_date_and_works_in_every_list() {
        let conn = db();
        let a = create_prompt(&conn, None, Some("text")).unwrap();
        set(&conn, &a.id, "Beta", "x");
        std::thread::sleep(std::time::Duration::from_millis(3));
        let b = create_prompt(&conn, None, Some("text")).unwrap();
        set(&conn, &b.id, "Alpha", "y");
        let before = get_prompt(&conn, &a.id).unwrap().updated_at;
        std::thread::sleep(std::time::Duration::from_millis(3));
        update_prompt(&conn, &a.id, &PromptPatch { pinned: Some(true), ..Default::default() })
            .unwrap();
        let after = get_prompt(&conn, &a.id).unwrap();
        assert!(after.pinned);
        assert_eq!(after.updated_at, before); // épingler ≠ modifier
        // en tête dans « Tous », dans un dossier, dans un outil…
        for f in [
            filter("all", None, None),
            filter("folder", Some(DEFAULT_FOLDER_ID), None),
            filter("tool", Some("text"), None),
        ] {
            assert_eq!(list_prompts(&conn, &f).unwrap()[0].id, a.id);
        }
        // …mais « Récents » reste chronologique (Alpha a été modifié en dernier).
        assert_eq!(list_prompts(&conn, &filter("recent", None, None)).unwrap()[0].id, b.id);
        // La recherche respecte aussi l'épinglage.
        assert_eq!(list_prompts(&conn, &filter("all", None, Some("beta"))).unwrap()[0].id, a.id);
        // Désépingler.
        update_prompt(&conn, &a.id, &PromptPatch { pinned: Some(false), ..Default::default() })
            .unwrap();
        assert_eq!(list_prompts(&conn, &filter("all", None, None)).unwrap()[0].id, b.id);
    }

    #[test]
    fn migrating_a_v1_database_adds_pinned_without_losing_data() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute(
            "INSERT INTO folders (id, name, icon, parent_id, position, is_system, created_at)
             VALUES ('my-prompts', 'Mes prompts', 'tray', NULL, 0, 1, 'x')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO prompts (id, title, content, folder_id, created_at, updated_at)
             VALUES ('old', 'Ancien', 'contenu', 'my-prompts', 'x', 'x')",
            [],
        )
        .unwrap();
        conn.execute_batch("PRAGMA user_version = 1;").unwrap();

        init(&conn).unwrap();

        let p = get_prompt(&conn, "old").unwrap();
        assert_eq!((p.title.as_str(), p.pinned), ("Ancien", false));
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 3);
        init(&conn).unwrap(); // idempotent
    }

    #[test]
    fn old_backups_without_pinned_still_import() {
        let json = r#"{"version":1,"exportedAt":"x","folders":[],"prompts":[{
            "id":"p1","title":"T","content":"C","folderId":"my-prompts","tool":"text","tags":[],
            "favorite":false,"trashedAt":null,"meta":{},"useCount":0,"lastUsedAt":null,
            "createdAt":"x","updatedAt":"x"}]}"#;
        let backup: Backup = serde_json::from_str(json).unwrap();
        let conn = db();
        import_backup(&conn, &backup).unwrap();
        assert!(!get_prompt(&conn, "p1").unwrap().pinned);
    }

    #[test]
    fn favorites_recents_and_counts() {
        let conn = db();
        let p = create_prompt(&conn, None, Some("text")).unwrap();
        create_prompt(&conn, None, None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5)); // horodatage à la milliseconde
        update_prompt(
            &conn,
            &p.id,
            &PromptPatch { favorite: Some(true), tags: Some(vec!["seo".into()]), ..Default::default() },
        )
        .unwrap();
        assert_eq!(list_prompts(&conn, &filter("favorites", None, None)).unwrap().len(), 1);
        assert_eq!(list_prompts(&conn, &filter("recent", None, None)).unwrap()[0].id, p.id);
        let c = counts(&conn).unwrap();
        assert_eq!((c.all, c.favorites, c.trash), (2, 1, 0));
        assert_eq!(c.by_folder[DEFAULT_FOLDER_ID], 2);
        assert_eq!(c.by_tool["text"], 1);
        assert_eq!(get_prompt(&conn, &p.id).unwrap().tags, vec!["seo".to_string()]);
    }

    #[test]
    fn versions_coalesce_then_restore() {
        let conn = db();
        let p = create_prompt(&conn, None, None).unwrap();
        set(&conn, &p.id, "T", "v1");
        set(&conn, &p.id, "T", "v2"); // < 5 min : même version mise à jour
        assert_eq!(list_versions(&conn, &p.id).unwrap().len(), 1);
        // On vieillit la version pour forcer une nouvelle entrée.
        conn.execute(
            "UPDATE prompt_versions SET saved_at = '2000-01-01T00:00:00.000Z'",
            [],
        )
        .unwrap();
        set(&conn, &p.id, "T", "v3");
        let versions = list_versions(&conn, &p.id).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].content, "v3");
        assert_eq!(versions[1].content, "v2");
        let restored = restore_version(&conn, versions[1].id).unwrap();
        assert_eq!(restored.content, "v2");
        // Un changement de tags seul ne crée pas de version.
        let n = list_versions(&conn, &p.id).unwrap().len();
        update_prompt(
            &conn,
            &p.id,
            &PromptPatch { tags: Some(vec!["x".into()]), ..Default::default() },
        )
        .unwrap();
        assert_eq!(list_versions(&conn, &p.id).unwrap().len(), n);
    }

    #[test]
    fn trash_purge_and_empty() {
        let conn = db();
        let old = create_prompt(&conn, None, None).unwrap();
        let recent = create_prompt(&conn, None, None).unwrap();
        trash_prompt(&conn, &old.id).unwrap();
        trash_prompt(&conn, &recent.id).unwrap();
        conn.execute(
            "UPDATE prompts SET trashed_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1",
            [&old.id],
        )
        .unwrap();
        assert_eq!(purge_old_trash(&conn).unwrap(), 1);
        assert!(get_prompt(&conn, &old.id).is_err());
        assert!(get_prompt(&conn, &recent.id).is_ok());
        assert_eq!(empty_trash(&conn).unwrap(), 1);
    }

    #[test]
    fn duplicate_and_usage_tracking() {
        let conn = db();
        let p = create_prompt(&conn, None, Some("image")).unwrap();
        set(&conn, &p.id, "Logo", "un logo {{marque}}");
        let copy = duplicate_prompt(&conn, &p.id).unwrap();
        assert_eq!(copy.title, "Logo (copie)");
        assert_eq!(copy.content, "un logo {{marque}}");
        mark_used(&conn, &p.id).unwrap();
        mark_used(&conn, &p.id).unwrap();
        let used = get_prompt(&conn, &p.id).unwrap();
        assert_eq!(used.use_count, 2);
        assert!(used.last_used_at.is_some());
    }

    #[test]
    fn backup_roundtrip_merges_without_duplicates() {
        let src = db();
        let f = create_folder(&src, "Marketing", None).unwrap();
        let sub = create_folder(&src, "Emails", Some(&f.id)).unwrap();
        let p = create_prompt(&src, Some(&sub.id), Some("text")).unwrap();
        set(&src, &p.id, "Relance", "Bonjour {{prenom}}");
        let backup = export_backup(&src).unwrap();
        let json = serde_json::to_string(&backup).unwrap();

        let dst = db();
        let parsed: Backup = serde_json::from_str(&json).unwrap();
        let report = import_backup(&dst, &parsed).unwrap();
        assert_eq!(report, ImportReport { folders: 2, prompts: 1 });
        let folders = list_folders(&dst).unwrap();
        let emails = folders.iter().find(|x| x.name == "Emails").unwrap();
        assert_eq!(emails.parent_id.as_deref(), Some(f.id.as_str()));
        assert_eq!(get_prompt(&dst, &p.id).unwrap().content, "Bonjour {{prenom}}");
        // Réimport : rien de nouveau.
        let again = import_backup(&dst, &parsed).unwrap();
        assert_eq!(again, ImportReport { folders: 0, prompts: 0 });
        // Un dossier inconnu rapatrie le prompt dans « Mes prompts ».
        let mut orphan = parsed;
        orphan.prompts[0].id = "orphan".into();
        orphan.prompts[0].folder_id = "disparu".into();
        import_backup(&dst, &orphan).unwrap();
        assert_eq!(get_prompt(&dst, "orphan").unwrap().folder_id, DEFAULT_FOLDER_ID);
    }

    #[test]
    fn all_tags_are_counted_and_exclude_the_trash() {
        let conn = db();
        let mk = |tags: &[&str]| {
            let p = create_prompt(&conn, None, None).unwrap();
            update_prompt(
                &conn,
                &p.id,
                &PromptPatch { tags: Some(tags.iter().map(|t| t.to_string()).collect()), ..Default::default() },
            )
            .unwrap();
            p
        };
        mk(&["claude", "seo"]);
        mk(&["claude"]);
        let gone = mk(&["fantôme"]);
        trash_prompt(&conn, &gone.id).unwrap();
        let tags = all_tags(&conn).unwrap();
        assert_eq!(tags, vec![
            TagCount { tag: "claude".into(), count: 2 },
            TagCount { tag: "seo".into(), count: 1 },
        ]);
    }

    #[test]
    fn tags_are_deduplicated_and_sorted_alphabetically_ignoring_accents() {
        let conn = db();
        let p = create_prompt(&conn, None, None).unwrap();
        let updated = update_prompt(
            &conn,
            &p.id,
            &PromptPatch {
                tags: Some(
                    ["zèbre", "Alpha", "école", "#beta", "alpha", " ", "Émile"]
                        .iter()
                        .map(|s| s.to_string())
                        .collect(),
                ),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(updated.tags, vec!["Alpha", "beta", "école", "Émile", "zèbre"]);
    }

    #[test]
    fn markdown_export_mirrors_folders_and_dedupes_names() {
        let conn = db();
        let f = create_folder(&conn, "Marketing", None).unwrap();
        let sub = create_folder(&conn, "Emails: relance", Some(&f.id)).unwrap();
        let a = create_prompt(&conn, Some(&sub.id), Some("text")).unwrap();
        set(&conn, &a.id, "Relance / J+3", "Bonjour {{prenom}}");
        let b = create_prompt(&conn, Some(&sub.id), None).unwrap();
        set(&conn, &b.id, "Relance / J+3", "second");
        let c = create_prompt(&conn, None, None).unwrap();
        set(&conn, &c.id, "", "contenu sans titre");
        update_prompt(&conn, &a.id, &PromptPatch {
            tags: Some(vec!["claude".into()]),
            meta: Some(serde_json::json!({"ton": "amical"})),
            ..Default::default()
        }).unwrap();

        let dir = std::env::temp_dir().join(format!("pv-export-{}", uuid::Uuid::new_v4()));
        let n = export_markdown_tree(&conn, &dir, &ExportScope { kind: "all".into(), id: None }).unwrap();
        assert_eq!(n, 3);
        let deep = dir.join("Marketing").join("Emails relance");
        let first = std::fs::read_to_string(deep.join("Relance J+3.md")).unwrap();
        assert!(first.starts_with("---\ntitle: \"Relance / J+3\"\ntool: text\n"));
        assert!(first.contains("folder: \"Marketing/Emails: relance\""));
        assert!(first.contains("tags: [\"claude\"]"));
        assert!(first.contains("meta: {\"ton\":\"amical\"}"));
        assert!(first.ends_with("Bonjour {{prenom}}\n"));
        assert!(deep.join("Relance J+3 (2).md").exists()); // doublon de titre
        assert!(dir.join("Mes prompts").join("contenu sans titre.md").exists()); // titre vide → contenu
        // Périmètre « dossier » : seulement le sous-arbre.
        let dir2 = dir.join("only-marketing");
        let n2 = export_markdown_tree(&conn, &dir2, &ExportScope { kind: "folder".into(), id: Some(f.id.clone()) }).unwrap();
        assert_eq!(n2, 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn csv_export_escapes_quotes_commas_and_newlines() {
        let conn = db();
        let p = create_prompt(&conn, None, Some("code")).unwrap();
        set(&conn, &p.id, "Titre, avec \"virgule\"", "ligne 1\nligne 2");
        let (csv, n) = export_csv_string(&conn, &ExportScope { kind: "all".into(), id: None }).unwrap();
        assert_eq!(n, 1);
        assert!(csv.starts_with('\u{feff}'));
        assert!(csv.contains("\"Titre, avec \"\"virgule\"\"\""));
        assert!(csv.contains("\"ligne 1\nligne 2\""));
        assert_eq!(safe_name("a/b:c*d?.md"), "a b c d .md");
        // Prompt inconnu / périmètre invalide → erreurs claires.
        assert!(export_csv_string(&conn, &ExportScope { kind: "prompt".into(), id: Some("nope".into()) }).is_err());
        assert!(export_csv_string(&conn, &ExportScope { kind: "x".into(), id: None }).is_err());
    }

    #[test]
    fn settings_are_upserted() {
        let conn = db();
        assert_eq!(get_setting(&conn, "ai.provider").unwrap(), None);
        set_setting(&conn, "ai.provider", "claude").unwrap();
        set_setting(&conn, "ai.provider", "gemini").unwrap();
        assert_eq!(get_setting(&conn, "ai.provider").unwrap().as_deref(), Some("gemini"));
    }

    #[test]
    fn a_forced_new_version_keeps_the_previous_text_even_within_the_coalescing_window() {
        let conn = db();
        let p = create_prompt(&conn, None, None).unwrap();
        set(&conn, &p.id, "T", "texte d'origine");
        // Remplacement (ex. par l'IA) dans la minute : sans `new_version`, l'origine serait écrasée.
        update_prompt(
            &conn,
            &p.id,
            &PromptPatch { content: Some("texte amélioré".into()), new_version: Some(true), ..Default::default() },
        )
        .unwrap();
        let v = list_versions(&conn, &p.id).unwrap();
        assert_eq!(v.iter().map(|x| x.content.as_str()).collect::<Vec<_>>(), ["texte amélioré", "texte d'origine"]);

        // Prompt sans aucune version (ex. importé) : l'ancien texte est enregistré avant le nouveau.
        let conn2 = db();
        conn2
            .execute(
                "INSERT INTO prompts (id, title, content, folder_id, created_at, updated_at)
                 VALUES ('imp', 'Importé', 'ancien', 'my-prompts', 'x', 'x')",
                [],
            )
            .unwrap();
        update_prompt(
            &conn2,
            "imp",
            &PromptPatch { content: Some("nouveau".into()), new_version: Some(true), ..Default::default() },
        )
        .unwrap();
        let v2 = list_versions(&conn2, "imp").unwrap();
        assert_eq!(v2.iter().map(|x| x.content.as_str()).collect::<Vec<_>>(), ["nouveau", "ancien"]);
    }
}

