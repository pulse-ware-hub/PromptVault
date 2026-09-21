import { useEffect, useMemo, useRef, useState } from "react";
import type { Counts, Folder, Selection } from "../types";
import { DEFAULT_FOLDER_ID, tools } from "../types";
import { getLang, setLang, t } from "../i18n";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { FolderGlyph, SmartIcons, ToolIcon } from "./Icons";
import type { ExportScope } from "../api";
import { dragPayload, endDrag, startDrag, type DragPayload } from "../dnd";
import { CaretRight, FloppyDisk, GearSix, Plus } from "@phosphor-icons/react";

interface Props {
  folders: Folder[];
  counts: Counts;
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Crée un dossier (sous `parentId`) et retourne son id pour passer en renommage. */
  onCreateFolder: (parentId: string | null) => Promise<string | null>;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (folder: Folder) => void;
  /** `json` = sauvegarde complète ; `md` / `csv` selon le périmètre. */
  onExport: (format: "json" | "md" | "csv", scope: ExportScope) => void;
  onImport: () => void;
  onDropPrompt: (
    promptId: string,
    target: { kind: "folder" | "tool" | "favorites" | "trash"; id?: string },
  ) => void;
  onMoveFolder: (id: string, parentId: string | null) => void;
  onOpenSettings: () => void;
  /** Boutons de la bande haute (à côté des pastilles de la fenêtre). */
  bar?: React.ReactNode;
  /** Déclenché par ⌘⇧N : le parent incrémente pour demander un nouveau dossier. */
  newFolderSignal: number;
}

/** Le dossier système « Mes prompts » s'affiche dans la langue courante. */
const folderName = (f: Folder) => (f.id === DEFAULT_FOLDER_ID ? t("folder.default") : f.name);

const sameSel = (a: Selection, b: Selection) =>
  a.kind === b.kind && ("id" in a ? a.id : "") === ("id" in b ? b.id : "");

export function Sidebar(props: Props) {
  const { folders, counts, selection, onSelect } = props;
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("pv.expanded") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);

  /** Zone de dépôt : `accepts` filtre ce qui peut y être lâché, `onDrop` agit. */
  const dropZone = (key: string, accepts: (p: DragPayload) => boolean, onDrop: (p: DragPayload) => void) => ({
    onDragOver: (e: React.DragEvent) => {
      const p = dragPayload();
      if (p && accepts(p)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropKey(key);
      }
    },
    onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const p = dragPayload();
      setDropKey(null);
      endDrag();
      if (p && accepts(p)) onDrop(p);
    },
  });
  const promptOnly = (p: DragPayload) => p.type === "prompt";

  useEffect(() => {
    localStorage.setItem("pv.expanded", JSON.stringify([...expanded]));
  }, [expanded]);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const key = f.parentId;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return map;
  }, [folders]);

  // Entrée et perte de focus valident tous deux ; `renamingId` évite le double envoi.
  const commitRename = (folder: Folder, raw: string) => {
    if (renamingId !== folder.id) return;
    setRenamingId(null);
    const v = raw.trim();
    if (v && v !== folder.name) props.onRenameFolder(folder.id, v);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const createFolder = async (parentId: string | null) => {
    const id = await props.onCreateFolder(parentId);
    if (id) {
      if (parentId) setExpanded((p) => new Set(p).add(parentId));
      setRenamingId(id);
    }
  };

  // ⌘⇧N
  const lastSignal = useRef(props.newFolderSignal);
  useEffect(() => {
    if (props.newFolderSignal !== lastSignal.current) {
      lastSignal.current = props.newFolderSignal;
      void createFolder(selection.kind === "folder" ? selection.id : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.newFolderSignal]);

  const openMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: t("side.newSubfolder"), onClick: () => void createFolder(folder.id) },
      {
        label: t("side.rename"),
        disabled: folder.isSystem,
        onClick: () => setRenamingId(folder.id),
      },
      { label: "", onClick: () => {}, separator: true },
      { label: t("side.exportMd"), onClick: () => props.onExport("md", { kind: "folder", id: folder.id }) },
      { label: t("side.exportCsv"), onClick: () => props.onExport("csv", { kind: "folder", id: folder.id }) },
      { label: "", onClick: () => {}, separator: true },
      {
        label: t("side.deleteFolder"),
        danger: true,
        disabled: folder.isSystem,
        onClick: () => props.onDeleteFolder(folder),
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const renderFolder = (folder: Folder, depth: number): React.ReactNode => {
    const kids = childrenOf.get(folder.id) ?? [];
    const isOpen = expanded.has(folder.id);
    const active = sameSel(selection, { kind: "folder", id: folder.id });
    return (
      <div key={folder.id}>
        <div
          className={"row" + (active ? " active" : "") + (dropKey === "folder:" + folder.id ? " drop-target" : "")}
          style={{ paddingLeft: 10 + depth * 16 }}
          draggable={!folder.isSystem && renamingId !== folder.id}
          onDragStart={(e) => startDrag(e, { type: "folder", id: folder.id }, folder.name)}
          onDragEnd={endDrag}
          {...dropZone(
            "folder:" + folder.id,
            (p) => p.type === "prompt" || p.id !== folder.id,
            (p) =>
              p.type === "prompt"
                ? props.onDropPrompt(p.id, { kind: "folder", id: folder.id })
                : props.onMoveFolder(p.id, folder.id),
          )}
          onClick={() => onSelect({ kind: "folder", id: folder.id })}
          onContextMenu={(e) => openMenu(e, folder)}
          onDoubleClick={() => !folder.isSystem && setRenamingId(folder.id)}
        >
          <span
            className={"chevron" + (kids.length ? "" : " hidden") + (isOpen ? " open" : "")}
            onClick={(e) => {
              e.stopPropagation();
              toggle(folder.id);
            }}
          >
            <CaretRight size={11} weight="bold" aria-hidden />
          </span>
          <FolderGlyph system={folder.id === DEFAULT_FOLDER_ID} open={isOpen && kids.length > 0} />
          {renamingId === folder.id ? (
            <input
              className="rename"
              autoFocus
              defaultValue={folderName(folder)}
              onFocus={(e) => e.currentTarget.select()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => commitRename(folder, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(folder, e.currentTarget.value);
                if (e.key === "Escape") commitRename(folder, folder.name);
              }}
            />
          ) : (
            <span className="label">{folderName(folder)}</span>
          )}
          <span className="count">{counts.byFolder[folder.id] ?? ""}</span>
        </div>
        {isOpen && kids.map((k) => renderFolder(k, depth + 1))}
      </div>
    );
  };

  const smart = (
    sel: Selection,
    icon: React.ReactNode,
    label: string,
    count?: number,
    drop?: ReturnType<typeof dropZone>,
    dropId?: string,
  ): React.ReactNode => (
    <div
      className={"row" + (sameSel(selection, sel) ? " active" : "") + (dropKey === dropId ? " drop-target" : "")}
      onClick={() => onSelect(sel)}
      {...drop}
    >
      <span className="glyph">{icon}</span>
      <span className="label">{label}</span>
      <span className="count">{count || ""}</span>
    </div>
  );

  const roots = childrenOf.get(null) ?? [];

  return (
    <aside className="sidebar">
      <div className="drag-region" data-tauri-drag-region />
      <div className="pane-bar">{props.bar}</div>
      <div className="scroll">
        {smart({ kind: "all" }, SmartIcons.all, t("side.all"), counts.all)}
        {smart(
          { kind: "favorites" },
          SmartIcons.favorites,
          t("side.favorites"),
          counts.favorites,
          dropZone("favorites", promptOnly, (p) => props.onDropPrompt(p.id, { kind: "favorites" })),
          "favorites",
        )}
        {smart({ kind: "recent" }, SmartIcons.recent, t("side.recent"))}

        <div
          className={"section-title" + (dropKey === "root" ? " drop-target" : "")}
          title={t("side.dropRoot")}
          {...dropZone("root", (p) => p.type === "folder", (p) => props.onMoveFolder(p.id, null))}
        >
          <span>{t("side.folders")}</span>
          <button className="icon-btn" title={t("side.newFolder")} onClick={() => void createFolder(null)}>
            <Plus size={14} weight="bold" aria-hidden />
          </button>
        </div>
        {roots.map((f) => renderFolder(f, 0))}

        <div className="section-title">
          <span>{t("side.tools")}</span>
        </div>
        {tools().map((tool) => (
          <div
            key={tool.id}
            className={
              "row" +
              (sameSel(selection, { kind: "tool", id: tool.id }) ? " active" : "") +
              (dropKey === "tool:" + tool.id ? " drop-target" : "")
            }
            onClick={() => onSelect({ kind: "tool", id: tool.id })}
            title={tool.label}
            {...dropZone("tool:" + tool.id, promptOnly, (p) => props.onDropPrompt(p.id, { kind: "tool", id: tool.id }))}
          >
            <span className="glyph"><ToolIcon tool={tool.id} size={17} /></span>
            <span className="label">{tool.short}</span>
            <span className="count">{counts.byTool[tool.id] ?? ""}</span>
          </div>
        ))}

        <div className="section-title" />
        {smart(
          { kind: "trash" },
          SmartIcons.trash,
          t("side.trash"),
          counts.trash,
          dropZone("trash", promptOnly, (p) => props.onDropPrompt(p.id, { kind: "trash" })),
          "trash",
        )}
      </div>
      <div className="sidebar-footer">
        <span className="lang-switch" role="group" aria-label={t("side.language")}>
          {(["fr", "en"] as const).map((l) => (
            <button
              key={l}
              className={getLang() === l ? "on" : ""}
              onClick={() => setLang(l)}
              title={l === "fr" ? "Français" : "English"}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </span>
        <button className="link-btn" title={t("side.settings")} onClick={props.onOpenSettings}>
          <GearSix size={15} weight="duotone" aria-hidden />
        </button>
        <button
          className="link-btn"
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({
              x: r.left,
              y: r.top - 130,
              items: [
                { label: t("side.exportJson"), onClick: () => props.onExport("json", { kind: "all" }) },
                { label: t("side.exportAllMd"), onClick: () => props.onExport("md", { kind: "all" }) },
                { label: t("side.exportAllCsv"), onClick: () => props.onExport("csv", { kind: "all" }) },
                { label: "", onClick: () => {}, separator: true },
                { label: t("side.import"), onClick: props.onImport },
              ],
            });
          }}
        >
          <FloppyDisk size={14} weight="duotone" aria-hidden /> {t("side.backup")}
        </button>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </aside>
  );
}
