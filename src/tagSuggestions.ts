import type { Tool } from "./types";

/** Modèles / outils d'IA proposés à la complétion des tags, avec les types d'outil qui leur correspondent. */
export const MODEL_TAGS: { name: string; tools: Tool[] }[] = [
  // Texte
  { name: "ChatGPT", tools: ["text"] },
  { name: "GPT", tools: ["text", "code"] },
  { name: "Claude", tools: ["text", "code"] },
  { name: "Gemini", tools: ["text", "code", "image"] },
  { name: "Grok", tools: ["text"] },
  { name: "Kimi", tools: ["text", "code"] },
  { name: "Perplexity", tools: ["text"] },
  { name: "Perplexity Deep Research", tools: ["text"] },
  { name: "Mistral", tools: ["text", "code"] },
  { name: "DeepSeek", tools: ["text", "code"] },
  { name: "Qwen", tools: ["text", "code"] },
  { name: "Llama", tools: ["text", "code"] },
  { name: "Copilot", tools: ["text", "code"] },
  // Espaces de travail Claude
  { name: "Claude Cowork", tools: ["text"] },
  { name: "Claude Design", tools: ["text", "image"] },
  { name: "Claude Projects", tools: ["text"] },
  { name: "Claude Science", tools: ["text"] },
  { name: "ChatGPT Work Codex", tools: ["text", "code"] },
  // Code
  { name: "Claude Code", tools: ["code"] },
  { name: "Codex", tools: ["code"] },
  { name: "Codex GPT", tools: ["code"] },
  { name: "Muse Code", tools: ["code"] },
  { name: "OpenCode", tools: ["code"] },
  { name: "Cursor", tools: ["code"] },
  { name: "GitHub Copilot", tools: ["code"] },
  { name: "Windsurf", tools: ["code"] },
  { name: "Gemini CLI", tools: ["code"] },
  { name: "Aider", tools: ["code"] },
  { name: "Cline", tools: ["code"] },
  // Images
  { name: "Midjourney", tools: ["image"] },
  { name: "DALL·E", tools: ["image"] },
  { name: "GPT Image", tools: ["image"] },
  { name: "Stable Diffusion", tools: ["image"] },
  { name: "Flux", tools: ["image"] },
  { name: "Ideogram", tools: ["image"] },
  { name: "Leonardo", tools: ["image"] },
  { name: "Firefly", tools: ["image"] },
  { name: "Imagen", tools: ["image"] },
  // Vidéo
  { name: "Sora", tools: ["video"] },
  { name: "Veo", tools: ["video"] },
  { name: "Runway", tools: ["video"] },
  { name: "Kling", tools: ["video"] },
  { name: "Pika", tools: ["video"] },
  { name: "Luma", tools: ["video"] },
  { name: "Hailuo", tools: ["video"] },
  // Voix
  { name: "ElevenLabs", tools: ["voice"] },
  { name: "OpenAI TTS", tools: ["voice"] },
  { name: "Cartesia", tools: ["voice"] },
  // Musique
  { name: "Suno", tools: ["music"] },
  { name: "Udio", tools: ["music"] },
  { name: "Lyria", tools: ["music"] },
  { name: "Stable Audio", tools: ["music"] },
];

/** Modèles pour un type d'outil (menus de « Modèle » dans les paramètres). */
export const modelsFor = (tool: Tool): string[] =>
  MODEL_TAGS.filter((m) => m.tools.includes(tool)).map((m) => m.name);

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const MAX = 8;

/** Tri alphabétique des tags (accents et casse ignorés). */
export const sortTags = (tags: string[]): string[] =>
  [...new Set(tags)].sort((a, b) => norm(a).localeCompare(norm(b)));

/**
 * Suggestions pour la saisie d'un tag, par ordre alphabétique. Avec une saisie : d'abord ceux qui
 * commencent par le texte, puis ceux dont un mot commence ainsi (« code » → Claude Code), puis les
 * autres correspondances. Sans saisie : les modèles de l'outil courant. Tags déjà posés exclus ;
 * tags de la bibliothèque et modèles confondus.
 */
export function suggestTags(
  input: string,
  tool: Tool,
  library: { tag: string; count: number }[],
  current: string[],
): string[] {
  const q = norm(input.replace(/^#/, ""));
  const taken = new Set(current.map(norm));
  const seen = new Set<string>();
  const pool: string[] = [];
  const add = (name: string) => {
    const k = norm(name);
    if (!seen.has(k) && !taken.has(k)) {
      seen.add(k);
      pool.push(name);
    }
  };
  if (!q) {
    MODEL_TAGS.filter((m) => m.tools.includes(tool)).forEach((m) => add(m.name));
    return pool.sort((a, b) => norm(a).localeCompare(norm(b))).slice(0, MAX);
  }
  library.forEach((t) => add(t.tag));
  MODEL_TAGS.forEach((m) => add(m.name));
  const rank = (name: string): number | null => {
    const n = norm(name);
    if (n.startsWith(q)) return 0;
    if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : null;
  };
  return pool
    .map((name) => ({ name, r: rank(name) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r! - b.r! || norm(a.name).localeCompare(norm(b.name)))
    .slice(0, MAX)
    .map((x) => x.name);
}
