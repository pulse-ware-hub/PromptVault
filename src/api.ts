import { invoke } from "@tauri-apps/api/core";
import type { Counts, Folder, Prompt, PromptChanges, PromptSummary, Selection, Tool, Version } from "./types";

export interface AiSettings {
  provider: "claude" | "gemini";
  claudeModel: string;
  geminiModel: string;
  hasClaudeKey: boolean;
  hasGeminiKey: boolean;
}
export interface AiResult {
  text: string;
  provider: string;
  model: string;
}
export type AiAction = "improve" | "shorten" | "detail" | "structure" | "fix" | "translate_fr" | "translate_en";

export type ExportScope = { kind: "all" } | { kind: "folder"; id: string } | { kind: "prompt"; id: string };

export const api = {
  listFolders: () => invoke<Folder[]>("list_folders"),
  createFolder: (name: string, parentId: string | null) =>
    invoke<Folder>("create_folder", { name, parentId }),
  renameFolder: (id: string, name: string) => invoke<Folder>("rename_folder", { id, name }),
  moveFolder: (id: string, parentId: string | null) =>
    invoke<Folder>("move_folder", { id, parentId }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),

  listPrompts: (sel: Selection, query: string) =>
    invoke<PromptSummary[]>("list_prompts", {
      filter: {
        kind: sel.kind,
        id: "id" in sel ? sel.id : null,
        query: query.trim() || null,
      },
    }),
  getPrompt: (id: string) => invoke<Prompt>("get_prompt", { id }),
  createPrompt: (folderId: string | null, tool: Tool | null) =>
    invoke<Prompt>("create_prompt", { folderId, tool }),
  updatePrompt: (id: string, patch: PromptChanges) =>
    invoke<Prompt>("update_prompt", { id, patch }),
  trashPrompt: (id: string) => invoke<void>("trash_prompt", { id }),
  restorePrompt: (id: string) => invoke<Prompt>("restore_prompt", { id }),
  deletePromptForever: (id: string) => invoke<void>("delete_prompt_forever", { id }),
  emptyTrash: () => invoke<number>("empty_trash"),
  duplicatePrompt: (id: string) => invoke<Prompt>("duplicate_prompt", { id }),
  markUsed: (id: string) => invoke<void>("mark_used", { id }),

  listVersions: (promptId: string) => invoke<Version[]>("list_versions", { promptId }),
  restoreVersion: (versionId: number) => invoke<Prompt>("restore_version", { versionId }),

  counts: () => invoke<Counts>("counts"),
  aiSettings: () => invoke<AiSettings>("ai_settings"),
  aiSaveSettings: (provider: string, claudeModel: string, geminiModel: string) =>
    invoke<void>("ai_save_settings", { provider, claudeModel, geminiModel }),
  aiSetKey: (provider: string, key: string) => invoke<void>("ai_set_key", { provider, key }),
  aiDeleteKey: (provider: string) => invoke<void>("ai_delete_key", { provider }),
  aiTest: () => invoke<AiResult>("ai_test"),
  aiTransform: (
    text: string,
    action: AiAction,
    tool: string,
    meta: Record<string, unknown>,
    instruction: string | null,
  ) => invoke<AiResult>("ai_transform", { text, action, tool, meta, instruction }),
  paletteChoose: (id: string, text: string, paste: boolean) =>
    invoke<string>("palette_choose", { id, text, paste }),
  paletteHide: () => invoke<void>("palette_hide"),
  listTags: () => invoke<{ tag: string; count: number }[]>("list_tags"),
  exportMarkdown: (path: string, scope: ExportScope) =>
    invoke<number>("export_markdown", { path, scope: { kind: scope.kind, id: "id" in scope ? scope.id : null } }),
  exportCsv: (path: string, scope: ExportScope) =>
    invoke<number>("export_csv", { path, scope: { kind: scope.kind, id: "id" in scope ? scope.id : null } }),
  exportToFile: (path: string) => invoke<void>("export_to_file", { path }),
  importFromFile: (path: string) =>
    invoke<{ folders: number; prompts: number }>("import_from_file", { path }),
};
