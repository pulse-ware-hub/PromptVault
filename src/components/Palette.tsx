import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import { DEFAULT_FOLDER_ID, toolInfo, type Prompt, type PromptSummary } from "../types";
import { t, tError, useLang } from "../i18n";
import { extractVariables, renderPrompt } from "../vars";
import { ToolIcon } from "./Icons";
import { MagnifyingGlass, PushPin } from "@phosphor-icons/react";

const MAX_RESULTS = 40;

/**
 * Palette globale (⌥⌘P) — fenêtre flottante affichée par le cœur Rust. Chercher, choisir, coller
 * dans l'app précédente. Les prompts à variables passent par un petit formulaire.
 */
export function Palette() {
  useLang();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PromptSummary[]>([]);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<Prompt | null>(null); // étape « variables »
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (q: string) => {
    try {
      const list = await api.listPrompts({ kind: "all" }, q);
      setItems(list.slice(0, MAX_RESULTS));
      setActive(0);
      setError(null);
    } catch (e) {
      setError(tError(e));
    }
  }, []);

  // Rechargé à chaque ouverture (les prompts ont pu changer dans la fenêtre principale).
  const reset = useCallback(() => {
    setQuery("");
    setChosen(null);
    setValues({});
    void load("");
    setTimeout(() => searchRef.current?.focus(), 30);
  }, [load]);

  useEffect(() => {
    document.body.classList.add("palette-window");
    reset();
    let off: (() => void) | undefined;
    listen("palette-open", reset)
      .then((un) => (off = un))
      .catch(() => window.addEventListener("focus", reset)); // navigateur (tests) : pas d'évènements Tauri
    return () => off?.();
  }, [reset]);

  useEffect(() => {
    if (!chosen) void load(query);
  }, [query, chosen, load]);

  useEffect(() => {
    listRef.current?.querySelector(".pal-item.active")?.scrollIntoView({ block: "nearest" });
  }, [active, items]);

  const finish = useCallback(
    async (prompt: Prompt, text: string, paste: boolean) => {
      try {
        await api.paletteChoose(prompt.id, text, paste);
      } catch (e) {
        setError(tError(e));
      }
    },
    [],
  );

  const pick = useCallback(
    async (item: PromptSummary, paste: boolean) => {
      try {
        const prompt = await api.getPrompt(item.id);
        if (extractVariables(prompt.content).length > 0) {
          setChosen(prompt);
          setValues({});
          setTimeout(() => document.querySelector<HTMLInputElement>(".pal-vars input")?.focus(), 30);
        } else {
          await finish(prompt, prompt.content, paste);
        }
      } catch (e) {
        setError(tError(e));
      }
    },
    [finish],
  );

  const vars = chosen ? extractVariables(chosen.content) : [];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (chosen) {
        setChosen(null);
        setTimeout(() => searchRef.current?.focus(), 30);
      } else {
        void api.paletteHide();
      }
      return;
    }
    if (chosen) {
      if (e.key === "Enter") {
        e.preventDefault();
        const inputs = [...document.querySelectorAll<HTMLInputElement>(".pal-vars input")];
        const idx = inputs.indexOf(document.activeElement as HTMLInputElement);
        // Entrée : champ suivant ; sur le dernier (ou avec ⌘/⌥) : coller. ⌘⇧… non géré.
        if (!e.metaKey && !e.altKey && idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
        else void finish(chosen, renderPrompt(chosen.content, values), true);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && items[active]) {
      e.preventDefault();
      // ↵ colle ; ⌘↵ / ⌥↵ copie seulement.
      void pick(items[active], !(e.metaKey || e.altKey));
    }
  };

  const folderLabel = (it: PromptSummary) => (it.folderId === DEFAULT_FOLDER_ID ? t("folder.default") : "");

  return (
    <div className="palette" onKeyDown={onKeyDown}>
      <div className="pal-head" data-tauri-drag-region>
        <MagnifyingGlass size={20} weight="bold" aria-hidden />
        <input
          ref={searchRef}
          className="pal-search"
          placeholder={t("pal.search")}
          value={query}
          disabled={chosen !== null}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {chosen ? (
        <div className="pal-vars">
          <div className="pal-vars-title">
            {chosen.title || t("list.untitled")} — {t("pal.fill")}
          </div>
          <div className="pal-vars-grid">
            {vars.map((v) => (
              <label key={v}>
                <span>{v}</span>
                <input
                  value={values[v] ?? ""}
                  placeholder={`{{${v}}}`}
                  onChange={(e) => setValues((p) => ({ ...p, [v]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <pre className="pal-preview">{renderPrompt(chosen.content, values)}</pre>
        </div>
      ) : (
        <div className="pal-list" ref={listRef}>
          {items.length === 0 && <div className="empty">{t("pal.empty")}</div>}
          {items.map((it, i) => (
            <div
              key={it.id}
              className={"pal-item" + (i === active ? " active" : "")}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => void pick(it, true)}
            >
              <span className="pal-icon" title={toolInfo(it.tool).label}>
                <ToolIcon tool={it.tool} size={18} />
              </span>
              <span className="pal-text">
                <span className="pal-title">
                  {it.pinned && <PushPin size={12} weight="fill" className="pal-pin" aria-hidden />}
                  {it.title || t("list.untitled")}
                </span>
                <span className="pal-preview-line">{it.preview}</span>
              </span>
              <span className="pal-folder">{folderLabel(it)}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="pal-error">{error}</div>}
      <div className="pal-foot">
        {chosen ? (
          <>
            <span>{t("pal.hintNext")}</span>
            <span>{t("pal.confirm")}</span>
            <span>{t("pal.hintBack")}</span>
          </>
        ) : (
          <>
            <span>{t("pal.hintNav")}</span>
            <span>{t("pal.hintPaste")}</span>
            <span>{t("pal.hintCopy")}</span>
            <span>{t("pal.hintClose")}</span>
          </>
        )}
      </div>
    </div>
  );
}
