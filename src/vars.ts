/** Variables de prompt : `{{nom}}` (espaces et accents autorisés). */
const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractVariables(content: string): string[] {
  const seen = new Set<string>();
  for (const m of content.matchAll(VAR_RE)) seen.add(m[1].trim());
  return [...seen];
}

/** Remplace les variables renseignées ; les vides restent visibles (`{{nom}}`). */
export function renderPrompt(content: string, values: Record<string, string>): string {
  return content.replace(VAR_RE, (whole, name: string) => {
    const v = values[name.trim()];
    return v ? v : whole;
  });
}
