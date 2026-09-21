//! Types échangés avec le frontend (sérialisés en camelCase).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Dossier système par défaut : reçoit les nouveaux prompts, non supprimable.
pub const DEFAULT_FOLDER_ID: &str = "my-prompts";
pub const DEFAULT_FOLDER_NAME: &str = "Mes prompts";

/// Outils concernés par un prompt (`none` = non défini).
pub const TOOLS: [&str; 7] = ["none", "text", "image", "video", "voice", "music", "code"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub parent_id: Option<String>,
    pub position: i64,
    pub is_system: bool,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub id: String,
    pub title: String,
    pub content: String,
    pub folder_id: String,
    pub tool: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    /// Épinglé : affiché en tête de liste (trié par titre), avant les autres.
    #[serde(default)]
    pub pinned: bool,
    pub trashed_at: Option<String>,
    pub meta: serde_json::Value,
    pub use_count: i64,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Ligne de la liste centrale (sans le contenu complet).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PromptSummary {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub folder_id: String,
    pub tool: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub pinned: bool,
    pub trashed_at: Option<String>,
    pub updated_at: String,
}

/// Sélection de la barre latérale + recherche éventuelle.
/// `kind` : `all` | `favorites` | `recent` | `trash` | `folder` (id = dossier) | `tool` (id = outil).
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptFilter {
    pub kind: String,
    pub id: Option<String>,
    pub query: Option<String>,
}

/// Modifications partielles d'un prompt (seuls les champs présents sont appliqués).
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PromptPatch {
    pub title: Option<String>,
    pub content: Option<String>,
    pub folder_id: Option<String>,
    pub tool: Option<String>,
    pub tags: Option<Vec<String>>,
    pub favorite: Option<bool>,
    pub pinned: Option<bool>,
    pub meta: Option<serde_json::Value>,
    /// Force une **nouvelle** version (sans fusion avec la précédente) : remplacement par l'IA, restauration…
    pub new_version: Option<bool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub id: i64,
    pub prompt_id: String,
    pub title: String,
    pub content: String,
    pub saved_at: String,
}

/// Compteurs affichés dans la barre latérale.
#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub all: i64,
    pub favorites: i64,
    pub trash: i64,
    pub by_folder: HashMap<String, i64>,
    pub by_tool: HashMap<String, i64>,
}

/// Sauvegarde complète (export/import JSON).
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub version: u32,
    pub exported_at: String,
    pub folders: Vec<Folder>,
    pub prompts: Vec<Prompt>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub folders: usize,
    pub prompts: usize,
}

/// Périmètre d'un export : tout, un dossier (sous-dossiers compris) ou un seul prompt.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportScope {
    /// `all` | `folder` | `prompt`
    pub kind: String,
    pub id: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct TagCount {
    pub tag: String,
    pub count: i64,
}
