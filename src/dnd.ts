/**
 * Glisser-déposer interne (prompt → dossier / outil / corbeille, dossier → dossier).
 * Pendant un `dragover`, WebKit ne donne pas accès aux données : on garde donc la charge en mémoire.
 */
export type DragPayload = { type: "prompt" | "folder"; id: string };

let current: DragPayload | null = null;

export const dragPayload = () => current;

export function startDrag(e: React.DragEvent, payload: DragPayload, label: string) {
  current = payload;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", label);
}

export const endDrag = () => {
  current = null;
};
