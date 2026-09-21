import { Fragment, forwardRef, useState } from "react";
import type { Folder, PromptSummary, Selection } from "../types";
import { DEFAULT_FOLDER_ID, toolInfo } from "../types";
import { PushPin, Plus, Star } from "@phosphor-icons/react";
import { ToolIcon } from "./Icons";
import { endDrag, startDrag } from "../dnd";
import { t, tn } from "../i18n";
import { relativeDate } from "../format";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface Props {
  title: string;
  selection: Selection;
  items: PromptSummary[];
  selectedId: string | null;
  folders: Folder[];
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onToggleFavorite: (p: PromptSummary) => void;
  onTogglePin: (p: PromptSummary) => void;
  onExportPrompt: (id: string) => void;
  onMove: (id: string, folderId: string) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onEmptyTrash: () => void;
  /** Boutons de la bande haute (à côté des pastilles si la barre latérale est repliée). */
  bar?: React.ReactNode;
}

export const PromptList = forwardRef<HTMLInputElement, Props>(function PromptList(p, searchRef) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const inTrash = p.selection.kind === "trash";
  // Séparateurs « Épinglés » / « Autres » : seulement si la liste en contient et qu'elle est triée ainsi
  // (pas dans la corbeille ni dans « Récents », qui restent chronologiques).
  const showGroups = !inTrash && p.selection.kind !== "recent" && p.items.some((it) => it.pinned);

  const folderName = (id: string) =>
    id === DEFAULT_FOLDER_ID ? t("folder.default") : (p.folders.find((f) => f.id === id)?.name ?? "");

  const openMenu = (e: React.MouseEvent, it: PromptSummary) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = inTrash
      ? [
          { label: t("ctx.restore"), onClick: () => p.onRestore(it.id) },
          { label: t("ctx.deleteForever"), danger: true, onClick: () => p.onDeleteForever(it.id) },
        ]
      : [
          { label: it.pinned ? t("ctx.unpin") : t("ctx.pin"), onClick: () => p.onTogglePin(it) },
          { label: it.favorite ? t("ctx.unfavorite") : t("ctx.favorite"), onClick: () => p.onToggleFavorite(it) },
          { label: t("ctx.duplicate"), onClick: () => p.onDuplicate(it.id) },
          { label: t("ctx.exportMd"), onClick: () => p.onExportPrompt(it.id) },
          { label: "", onClick: () => {}, separator: true },
          ...p.folders
            .filter((f) => f.id !== it.folderId)
            .slice(0, 12)
            .map((f) => ({ label: t("ctx.moveTo", { name: f.id === DEFAULT_FOLDER_ID ? t("folder.default") : f.name }), onClick: () => p.onMove(it.id, f.id) })),
          { label: "", onClick: () => {}, separator: true },
          { label: t("ctx.trash"), danger: true, onClick: () => p.onTrash(it.id) },
        ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <section className="list-pane">
      <div className="drag-region" data-tauri-drag-region />
      <div className="pane-bar">{p.bar}</div>
      <header className="list-header">
        <div className="list-title">
          <h2>{p.title}</h2>
          <span className="muted">{tn("list.count", p.items.length)}</span>
        </div>
        {inTrash ? (
          <button className="btn" disabled={!p.items.length} onClick={p.onEmptyTrash}>
            {t("list.emptyTrash")}
          </button>
        ) : (
          <button className="btn primary" onClick={p.onNew} title={t("list.newTitle")}>
            <Plus size={13} weight="bold" aria-hidden /> {t("list.new")}
          </button>
        )}
      </header>
      <div className="search">
        <input
          ref={searchRef}
          type="search"
          placeholder={t("list.search")}
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
        />
      </div>
      <div className="scroll">
        {p.items.length === 0 && (
          <div className="empty">
            {p.query ? t("list.noResults") : inTrash ? t("list.trashEmpty") : t("list.none")}
          </div>
        )}
        {p.items.map((it, i) => (
          <Fragment key={it.id}>
            {showGroups && i === 0 && it.pinned && <div className="group-title"><PushPin size={11} weight="fill" aria-hidden /> {t("list.pinned")}</div>}
            {showGroups && !it.pinned && (i === 0 || p.items[i - 1].pinned) && (
              <div className="group-title">{i === 0 ? t("list.first") : t("list.others")}</div>
            )}
          <div
            className={"item" + (it.id === p.selectedId ? " active" : "")}
            draggable={!inTrash}
            onDragStart={(e) => startDrag(e, { type: "prompt", id: it.id }, it.title || "Prompt")}
            onDragEnd={endDrag}
            onClick={() => p.onSelect(it.id)}
            onContextMenu={(e) => openMenu(e, it)}
          >
            <div className="item-top">
              <span className="item-title">{it.title || t("list.untitled")}</span>
              {it.pinned && !inTrash && (
                <span className="pin" title={t("list.pinnedTip")}>
                  <PushPin size={12} weight="fill" aria-hidden />
                </span>
              )}
              {it.favorite && (
                <span className="star" title={t("list.favoriteTip")}>
                  <Star size={12} weight="fill" aria-hidden />
                </span>
              )}
            </div>
            <div className="item-meta">
              <span className="date">{relativeDate(it.updatedAt)}</span>
              <span className="preview">{it.preview || t("list.noContent")}</span>
            </div>
            <div className="item-foot">
              <span title={toolInfo(it.tool).label} className="tool-badge">
                <ToolIcon tool={it.tool} size={14} />
              </span>
              <span className="muted">{folderName(it.folderId)}</span>
              {[...it.tags].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" })).slice(0, 3).map((t) => (
                <span key={t} className="tag">
                  #{t}
                </span>
              ))}
            </div>
          </div>
          </Fragment>
        ))}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </section>
  );
});
