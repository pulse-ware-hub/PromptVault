import { useCallback, useEffect, useRef, useState } from "react";
import { open, save, confirm, message } from "@tauri-apps/plugin-dialog";
import { api, type ExportScope } from "./api";
import { Editor } from "./components/Editor";
import { PromptList } from "./components/PromptList";
import { Sidebar } from "./components/Sidebar";
import type { Counts, Folder, Prompt, PromptSummary, Selection, PromptChanges } from "./types";
import { DEFAULT_FOLDER_ID, toolInfo } from "./types";
import { HeroIcon } from "./components/Icons";
import { listen } from "@tauri-apps/api/event";
import { t, tError, useLang } from "./i18n";
import { PaneToggle } from "./components/PaneToggles";
import { AboutDialog } from "./components/AboutDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { Plus } from "@phosphor-icons/react";

const EMPTY_COUNTS: Counts = { all: 0, favorites: 0, trash: 0, byFolder: {}, byTool: {} };

function selectionTitle(sel: Selection, folders: Folder[]): string {
  switch (sel.kind) {
    case "all":
      return t("side.all");
    case "favorites":
      return t("side.favorites");
    case "recent":
      return t("side.recent");
    case "trash":
      return t("side.trash");
    case "folder":
      return sel.id === DEFAULT_FOLDER_ID
        ? t("folder.default")
        : (folders.find((f) => f.id === sel.id)?.name ?? t("folder.fallback"));
    case "tool":
      return toolInfo(sel.id).label;
  }
}

export default function App() {
  useLang(); // re-rend toute l'interface quand la langue change
  const [folders, setFolders] = useState<Folder[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [selection, setSelection] = useState<Selection>({ kind: "folder", id: DEFAULT_FOLDER_ID });
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PromptSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [revision, setRevision] = useState(0); // force le rechargement de l'éditeur
  const [toast, setToast] = useState<string | null>(null);
  const [newFolderSignal, setNewFolderSignal] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("pv.sidebar") !== "0");
  const [listOpen, setListOpen] = useState(() => localStorage.getItem("pv.list") !== "0");
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((o) => {
      localStorage.setItem("pv.sidebar", o ? "0" : "1");
      return !o;
    });
  }, []);
  const toggleList = useCallback(() => {
    setListOpen((o) => {
      localStorage.setItem("pv.list", o ? "0" : "1");
      return !o;
    });
  }, []);

  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | null>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const fail = useCallback(
    (e: unknown) => void message(tError(e), { title: "PromptVault", kind: "error" }),
    [],
  );

  // ── Chargement ───────────────────────────────────────────────────────────────
  const refreshSide = useCallback(async () => {
    const [f, c] = await Promise.all([api.listFolders(), api.counts()]);
    setFolders(f);
    setCounts(c);
  }, []);

  const selRef = useRef(selection);
  const queryRef = useRef(query);
  selRef.current = selection;
  queryRef.current = query;

  const refreshList = useCallback(async () => {
    const list = await api.listPrompts(selRef.current, queryRef.current);
    setItems(list);
    // Le prompt ouvert a pu quitter la liste (corbeille, restauration, déplacement…) :
    // on passe au premier restant plutôt que de garder un éditeur périmé.
    setSelectedId((cur) => (cur && list.some((i) => i.id === cur) ? cur : (list[0]?.id ?? null)));
    return list;
  }, []);

  useEffect(() => {
    void refreshSide().catch(fail);
  }, [refreshSide, fail]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.listPrompts(selection, query);
        if (cancelled) return;
        setItems(list);
        setSelectedId((cur) => (cur && list.some((i) => i.id === cur) ? cur : (list[0]?.id ?? null)));
      } catch (e) {
        fail(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, query, fail]);

  useEffect(() => {
    if (!selectedId) {
      setPrompt(null);
      return;
    }
    let cancelled = false;
    api
      .getPrompt(selectedId)
      .then((p) => !cancelled && setPrompt(p))
      .catch(() => !cancelled && setPrompt(null));
    return () => {
      cancelled = true;
    };
  }, [selectedId, revision]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshSide(), refreshList()]);
  }, [refreshSide, refreshList]);

  // ── Actions prompts ──────────────────────────────────────────────────────────
  const newPrompt = useCallback(async () => {
    try {
      const sel = selRef.current;
      const p = await api.createPrompt(
        sel.kind === "folder" ? sel.id : null,
        sel.kind === "tool" ? sel.id : null,
      );
      setQuery("");
      // Hors dossier/outil correspondant, le prompt (créé dans « Mes prompts ») n'apparaîtrait pas.
      if (sel.kind === "trash" || sel.kind === "favorites" || sel.kind === "recent") {
        setSelection({ kind: "folder", id: p.folderId });
      }
      await refreshAll();
      setSelectedId(p.id);
      setTimeout(() => titleRef.current?.focus(), 60);
    } catch (e) {
      fail(e);
    }
  }, [refreshAll, fail]);

  // Stable (utilisé dans les effets de l'éditeur) : ne dépend d'aucun état.
  const savePrompt = useCallback(
    async (id: string, patch: PromptChanges) => {
      try {
        const updated = await api.updatePrompt(id, patch);
        setPrompt((cur) => (cur && cur.id === id ? { ...cur, ...updatedFields(updated, patch) } : cur));
        await refreshAll();
      } catch (e) {
        fail(e);
      }
    },
    [refreshAll, fail],
  );

  const toggleFavorite = useCallback(
    (p: { id: string; favorite: boolean }) => void savePrompt(p.id, { favorite: !p.favorite }),
    [savePrompt],
  );

  const togglePin = useCallback(
    (p: { id: string; pinned: boolean }) => {
      void savePrompt(p.id, { pinned: !p.pinned });
      notify(p.pinned ? t("app.unpinned") : t("app.pinned"));
    },
    [savePrompt, notify],
  );

  const trash = useCallback(
    async (id: string) => {
      await api.trashPrompt(id).catch(fail);
      await refreshAll();
      notify(t("app.trashed"));
    },
    [refreshAll, fail, notify],
  );

  const restore = useCallback(
    async (id: string) => {
      await api.restorePrompt(id).catch(fail);
      await refreshAll();
      notify(t("app.restored"));
    },
    [refreshAll, fail, notify],
  );

  const deleteForever = useCallback(
    async (id: string) => {
      if (!(await confirm(t("app.deleteForeverText"), {
        title: t("app.deleteForeverTitle"), kind: "warning", okLabel: t("app.delete"), cancelLabel: t("app.cancel"),
      }))) return;
      await api.deletePromptForever(id).catch(fail);
      await refreshAll();
    },
    [refreshAll, fail],
  );

  const duplicate = useCallback(
    async (id: string) => {
      const copy = await api.duplicatePrompt(id).catch(fail);
      if (!copy) return;
      await refreshAll();
      setSelectedId(copy.id);
      notify(t("app.duplicated"));
    },
    [refreshAll, fail, notify],
  );

  const emptyTrash = useCallback(async () => {
    if (!(await confirm(t("app.emptyTrashText"), {
      title: t("app.emptyTrashTitle"), kind: "warning", okLabel: t("app.empty"), cancelLabel: t("app.cancel"),
    }))) return;
    await api.emptyTrash().catch(fail);
    await refreshAll();
  }, [refreshAll, fail]);

  // ── Actions dossiers ─────────────────────────────────────────────────────────
  const createFolder = useCallback(
    async (parentId: string | null): Promise<string | null> => {
      try {
        const f = await api.createFolder(t("app.newFolderName"), parentId);
        await refreshSide();
        setSelection({ kind: "folder", id: f.id });
        return f.id;
      } catch (e) {
        fail(e);
        return null;
      }
    },
    [refreshSide, fail],
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      await api.renameFolder(id, name).catch(fail);
      await refreshSide();
    },
    [refreshSide, fail],
  );

  const deleteFolder = useCallback(
    async (folder: Folder) => {
      const n = counts.byFolder[folder.id] ?? 0;
      const ok = await confirm(
        t("app.deleteFolderText", { name: folder.name }) + (n ? t("app.deleteFolderCount", { n }) : ""),
        { title: t("app.deleteFolderTitle"), kind: "warning", okLabel: t("app.delete"), cancelLabel: t("app.cancel") },
      );
      if (!ok) return;
      await api.deleteFolder(folder.id).catch(fail);
      setSelection({ kind: "folder", id: DEFAULT_FOLDER_ID });
      await refreshAll();
    },
    [counts, refreshAll, fail],
  );

  // ── Sauvegarde / import ──────────────────────────────────────────────────────
  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportData = useCallback(
    async (format: "json" | "md" | "csv", scope: ExportScope, suggestedName?: string) => {
      try {
        if (format === "json") {
          const path = await save({
            title: t("app.dlgExportLibrary"),
            defaultPath: `promptvault-${stamp()}.json`,
            filters: [{ name: "JSON", extensions: ["json"] }],
          });
          if (!path) return;
          await api.exportToFile(path);
          notify(t("app.exportedLibrary"));
        } else if (format === "csv") {
          const path = await save({
            title: t("app.dlgExportCsv"),
            defaultPath: `promptvault-${stamp()}.csv`,
            filters: [{ name: "CSV", extensions: ["csv"] }],
          });
          if (!path) return;
          const n = await api.exportCsv(path, scope);
          notify(t("app.exportedCsv", { n }));
        } else if (scope.kind === "prompt") {
          const path = await save({
            title: t("app.dlgExportMd"),
            defaultPath: `${(suggestedName || "prompt").replace(/[\\/:*?"<>|]/g, " ").trim() || "prompt"}.md`,
            filters: [{ name: "Markdown", extensions: ["md"] }],
          });
          if (!path) return;
          await api.exportMarkdown(path, scope);
          notify(t("app.exportedMdPrompt"));
        } else {
          const dir = await open({ title: t("app.dlgPickDir"), directory: true, multiple: false });
          if (!dir || Array.isArray(dir)) return;
          const n = await api.exportMarkdown(dir, scope);
          notify(t("app.exportedMdTree", { n }));
        }
      } catch (e) {
        fail(e);
      }
    },
    [notify, fail],
  );

  const exportPrompt = useCallback(
    (id: string) => {
      const name = items.find((i) => i.id === id)?.title || prompt?.title || "prompt";
      void exportData("md", { kind: "prompt", id }, name);
    },
    [items, prompt, exportData],
  );

  // ── Glisser-déposer ──────────────────────────────────────────────────────────
  const dropPrompt = useCallback(
    async (
      id: string,
      target: { kind: "folder" | "tool" | "favorites" | "trash"; id?: string },
    ) => {
      if (target.kind === "trash") {
        await trash(id);
      } else if (target.kind === "folder" && target.id) {
        await savePrompt(id, { folderId: target.id });
        notify(
          t("app.movedTo", {
            name:
              target.id === DEFAULT_FOLDER_ID
                ? t("folder.default")
                : (folders.find((f) => f.id === target.id)?.name ?? t("folder.fallback")),
          }),
        );
      } else if (target.kind === "tool" && target.id) {
        await savePrompt(id, { tool: target.id as Prompt["tool"] });
        notify(t("app.toolSet", { tool: toolInfo(target.id as Prompt["tool"]).label }));
      } else if (target.kind === "favorites") {
        await savePrompt(id, { favorite: true });
        notify(t("app.favAdded"));
      }
    },
    [trash, savePrompt, notify, folders],
  );

  const moveFolder = useCallback(
    async (id: string, parentId: string | null) => {
      try {
        await api.moveFolder(id, parentId);
        await refreshSide();
        notify(t("app.folderMoved"));
      } catch (e) {
        fail(e);
      }
    },
    [refreshSide, notify, fail],
  );

  const importAll = useCallback(async () => {
    const path = await open({
      title: t("app.dlgImport"),
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path || Array.isArray(path)) return;
    try {
      const r = await api.importFromFile(path);
      await refreshAll();
      notify(t("app.imported", { n: r.prompts, m: r.folders }));
    } catch (e) {
      fail(e);
    }
  }, [refreshAll, notify, fail]);

  // ── Résultat de la palette globale (⌥⌘P) : rappel dans la fenêtre principale
  useEffect(() => {
    let off: (() => void) | undefined;
    listen<string>("palette-result", (e) => {
      notify(
        e.payload === "pasted"
          ? t("app.pasted")
          : e.payload === "paste-failed"
            ? t("app.pasteFallback")
            : t("app.copiedOnly"),
      );
      void refreshAll(); // le compteur d'utilisation a changé
    })
      .then((un) => (off = un))
      .catch(() => {});
    return () => off?.();
  }, [notify, refreshAll]);

  // ── Menu natif « About PromptVault » → notre fenêtre « À propos »
  useEffect(() => {
    let off: (() => void) | undefined;
    listen("open-about", () => setAboutOpen(true))
      .then((un) => (off = un))
      .catch(() => {});
    return () => off?.();
  }, []);

  // ── Raccourcis clavier ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      // ⌥⌘S / ⌥⌘L : e.key vaut un caractère spécial avec ⌥ sur Mac → on lit la touche physique.
      if (e.altKey && e.code === "KeyS") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (e.altKey && e.code === "KeyL") {
        e.preventDefault();
        toggleList();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "n" && e.shiftKey) {
        e.preventDefault();
        setNewFolderSignal((n) => n + 1);
      } else if (k === "n") {
        e.preventDefault();
        void newPrompt();
      } else if (k === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newPrompt, toggleSidebar, toggleList]);

  // Boutons de repli à la manière de Notes : chacun vit dans la bande haute de son volet ; s'il est replié,
  // il migre dans la bande du premier volet visible (qui laisse alors la place aux pastilles de la fenêtre).
  const sidebarBtn = <PaneToggle kind="sidebar" open={sidebarOpen} onToggle={toggleSidebar} />;
  const listBtn = <PaneToggle kind="list" open={listOpen} onToggle={toggleList} />;
  const sidebarBar = sidebarBtn;
  const listBar = (
    <>
      {!sidebarOpen && sidebarBtn}
      {listBtn}
    </>
  );
  const editorBar = (
    <>
      {!sidebarOpen && !listOpen && sidebarBtn}
      {!listOpen && listBtn}
    </>
  );

  const title = selectionTitle(selection, folders);

  return (
    <div className={"app" + (sidebarOpen ? "" : " no-sidebar") + (listOpen ? "" : " no-list")}>
      <Sidebar
        folders={folders}
        counts={counts}
        selection={selection}
        onSelect={(s) => {
          setSelection(s);
          setQuery("");
        }}
        onCreateFolder={createFolder}
        onRenameFolder={renameFolder}
        onDeleteFolder={deleteFolder}
        onExport={exportData}
        onImport={importAll}
        onDropPrompt={dropPrompt}
        onMoveFolder={moveFolder}
        onOpenSettings={() => setSettingsOpen(true)}
        newFolderSignal={newFolderSignal}
        bar={sidebarBar}
      />
      <PromptList
        ref={searchRef}
        title={title}
        selection={selection}
        items={items}
        selectedId={selectedId}
        folders={folders}
        query={query}
        onQuery={setQuery}
        onSelect={setSelectedId}
        onNew={newPrompt}
        onDuplicate={duplicate}
        onToggleFavorite={toggleFavorite}
        onTogglePin={togglePin}
        onExportPrompt={exportPrompt}
        onMove={(id, folderId) => void savePrompt(id, { folderId })}
        onTrash={trash}
        onRestore={restore}
        onDeleteForever={deleteForever}
        onEmptyTrash={emptyTrash}
        bar={listBar}
      />
      {prompt ? (
        <Editor
          key={`${prompt.id}:${revision}`}
          ref={titleRef}
          prompt={prompt}
          folders={folders}
          onSave={savePrompt}
          onToggleFavorite={toggleFavorite}
          onTogglePin={togglePin}
          onExportPrompt={exportPrompt}
          onOpenSettings={() => setSettingsOpen(true)}
          bar={editorBar}
          onTrash={trash}
          onRestore={restore}
          onDeleteForever={deleteForever}
          onDuplicate={duplicate}
          onCopied={(id) => void api.markUsed(id)}
          onVersionRestored={() => {
            setRevision((r) => r + 1);
            void refreshAll();
          }}
          notify={notify}
        />
      ) : (
        <section className="editor-pane empty-editor">
          <div className="drag-region" data-tauri-drag-region />
          <div className="pane-bar">{editorBar}</div>
          <div className="empty-hero">
            <div className="hero-icon">
              <HeroIcon />
            </div>
            <p>{t("app.pickHint")}</p>
            <button className="btn primary" onClick={newPrompt}>
              <Plus size={13} weight="bold" aria-hidden /> {t("app.newPrompt")}
            </button>
          </div>
        </section>
      )}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          notify={notify}
          onOpenAbout={() => setAboutOpen(true)}
        />
      )}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** Champs à reporter dans l'état local après une sauvegarde (le texte tapé reste géré par l'éditeur). */
function updatedFields(updated: Prompt, patch: PromptChanges): Partial<Prompt> {
  const out: Partial<Prompt> = { updatedAt: updated.updatedAt };
  if ("favorite" in patch) out.favorite = updated.favorite;
  if ("pinned" in patch) out.pinned = updated.pinned;
  if ("tool" in patch) out.tool = updated.tool;
  if ("folderId" in patch) out.folderId = updated.folderId;
  return out;
}
