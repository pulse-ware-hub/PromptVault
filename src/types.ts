import { t } from "./i18n";

export type Tool = "none" | "text" | "image" | "video" | "voice" | "music" | "code";

export interface Folder {
  id: string;
  name: string;
  icon: string;
  parentId: string | null;
  position: number;
  isSystem: boolean;
  createdAt: string;
}

export interface Prompt {
  id: string;
  title: string;
  content: string;
  folderId: string;
  tool: Tool;
  tags: string[];
  favorite: boolean;
  pinned: boolean;
  trashedAt: string | null;
  meta: Record<string, unknown>;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Modifications envoyées au cœur : champs du prompt + `newVersion` (forcer une nouvelle entrée d'historique). */
export type PromptChanges = Partial<Omit<Prompt, "id">> & { newVersion?: boolean };

export interface PromptSummary {
  id: string;
  title: string;
  preview: string;
  folderId: string;
  tool: Tool;
  tags: string[];
  favorite: boolean;
  pinned: boolean;
  trashedAt: string | null;
  updatedAt: string;
}

export interface Version {
  id: number;
  promptId: string;
  title: string;
  content: string;
  savedAt: string;
}

export interface Counts {
  all: number;
  favorites: number;
  trash: number;
  byFolder: Record<string, number>;
  byTool: Record<string, number>;
}

/** Sélection de la barre latérale. */
export type Selection =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "recent" }
  | { kind: "trash" }
  | { kind: "folder"; id: string }
  | { kind: "tool"; id: Tool };

export const DEFAULT_FOLDER_ID = "my-prompts";

export const TOOL_IDS: Exclude<Tool, "none">[] = ["text", "image", "video", "voice", "music", "code"];

/** Outils avec leurs libellés dans la langue courante (appeler à chaque rendu). */
export const tools = () =>
  TOOL_IDS.map((id) => ({ id, label: t(`tool.${id}`), short: t(`tool.${id}.short`) }));

export const toolInfo = (id: Tool) =>
  id === "none"
    ? { id, short: t("tool.none.short"), label: t("tool.none") }
    : { id, short: t(`tool.${id}.short`), label: t(`tool.${id}`) };
