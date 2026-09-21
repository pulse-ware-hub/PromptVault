import type { Tool } from "./types";
import { modelsFor } from "./tagSuggestions";

/**
 * Description d'un paramètre d'outil. Le libellé et l'exemple sont traduits par clé
 * (`f.<outil>.<champ>` / `fp.<outil>.<champ>`) ; les valeurs de liste sont des identifiants stables
 * (`formal`, `fr`…) traduits à l'affichage (`o.<valeur>`), les valeurs techniques (16:9, Rust…) restent telles quelles.
 */
export interface FieldDef {
  key: string;
  kind: "text" | "select" | "number" | "toggle" | "area";
  options?: string[];
  suffix?: string;
  /** Suggestions libres (liste de complétion) pour un champ texte. */
  suggestions?: string[];
  wide?: boolean;
}

const LANGS = ["fr", "en", "es", "de", "it", "pt", "other"];

/** Paramètres propres à chaque type d'outil, stockés dans `prompt.meta`. */
export const TOOL_FIELDS: Partial<Record<Tool, FieldDef[]>> = {
  text: [
    { key: "model", kind: "text", suggestions: modelsFor("text") },
    { key: "language", kind: "select", options: LANGS },
    { key: "tone", kind: "select", options: ["neutral", "formal", "friendly", "persuasive", "teaching", "humorous", "technical"] },
    { key: "length", kind: "text" },
  ],
  image: [
    { key: "model", kind: "text", suggestions: modelsFor("image") },
    { key: "ratio", kind: "select", options: ["1:1", "4:3", "3:2", "16:9", "9:16", "21:9"] },
    { key: "style", kind: "select", options: ["photo", "illustration", "3d", "anime", "watercolor", "cinema", "minimal", "other"] },
    { key: "resolution", kind: "text" },
    { key: "seed", kind: "text" },
    { key: "negative", kind: "area", wide: true },
  ],
  video: [
    { key: "model", kind: "text", suggestions: modelsFor("video") },
    { key: "duration", kind: "number", suffix: "s" },
    { key: "ratio", kind: "select", options: ["16:9", "9:16", "1:1", "4:3", "21:9"] },
    { key: "resolution", kind: "select", options: ["720p", "1080p", "4K"] },
    { key: "fps", kind: "select", options: ["24", "25", "30", "60"] },
    { key: "camera", kind: "text" },
  ],
  voice: [
    { key: "model", kind: "text", suggestions: modelsFor("voice") },
    { key: "voice", kind: "text" },
    { key: "language", kind: "select", options: LANGS },
    { key: "speed", kind: "text" },
    { key: "emotion", kind: "text" },
  ],
  music: [
    { key: "model", kind: "text", suggestions: modelsFor("music") },
    { key: "genre", kind: "text" },
    { key: "duration", kind: "number", suffix: "s" },
    { key: "tempo", kind: "number", suffix: "BPM" },
    { key: "mood", kind: "text" },
    { key: "instrumental", kind: "toggle" },
  ],
  code: [
    { key: "language", kind: "select", options: ["TypeScript", "JavaScript", "Python", "Rust", "Go", "Swift", "Kotlin", "Java", "C#", "C++", "PHP", "Ruby", "SQL", "Bash", "HTML/CSS", "other"] },
    { key: "framework", kind: "text" },
    { key: "model", kind: "text", suggestions: modelsFor("code") },
    { key: "tests", kind: "toggle" },
  ],
};
