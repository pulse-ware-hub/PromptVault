import { useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";
import { sortTags, suggestTags } from "../tagSuggestions";
import type { Tool } from "../types";
import { t } from "../i18n";

interface Props {
  tags: string[];
  tool: Tool;
  /** Tags déjà utilisés dans la bibliothèque. */
  library: { tag: string; count: number }[];
  disabled: boolean;
  onChange: (tags: string[]) => void;
}

/** Tags triés alphabétiquement, avec complétion (tags existants + modèles d'IA). */
export function TagInput({ tags, tool, library, disabled, onChange }: Props) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const sorted = useMemo(() => sortTags(tags), [tags]);
  const suggestions = useMemo(() => suggestTags(text, tool, library, sorted), [text, tool, library, sorted]);
  const open = focused && !disabled && suggestions.length > 0;

  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "").trim();
    if (tag) onChange(sortTags([...sorted, tag]));
    setText("");
    setActive(-1);
  };

  return (
    <div className="tags">
      {sorted.map((tag) => (
        <span key={tag} className="tag removable">
          #{tag}
          {!disabled && (
            <button aria-label={t("tag.remove", { tag })} onClick={() => onChange(sorted.filter((x) => x !== tag))}>
              <X size={10} weight="bold" aria-hidden />
            </button>
          )}
        </span>
      ))}
      {!disabled && (
        <div className="tag-wrap">
          <input
            className="tag-input"
            placeholder={t("tag.placeholder")}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(-1);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (text.trim()) add(text);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && open) {
                e.preventDefault();
                setActive((a) => (a + 1) % suggestions.length);
              } else if (e.key === "ArrowUp" && open) {
                e.preventDefault();
                setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
              } else if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                add(active >= 0 && suggestions[active] ? suggestions[active] : text);
              } else if (e.key === "Tab" && text.trim() && suggestions.length) {
                // Tab complète avec la suggestion surlignée, ou la première ; Entrée garde le texte tapé tel quel.
                e.preventDefault();
                add(suggestions[active >= 0 ? active : 0]);
              } else if (e.key === "Escape") {
                setFocused(false);
              } else if (e.key === "Backspace" && !text && sorted.length) {
                onChange(sorted.slice(0, -1));
              }
            }}
          />
          {open && (
            <div className="tag-menu" role="listbox">
              {suggestions.map((s, i) => (
                <div
                  key={s}
                  role="option"
                  aria-selected={i === active}
                  className={"tag-option" + (i === active ? " active" : "")}
                  // mousedown (pas click) : le champ ne doit pas perdre le focus avant la sélection
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(s);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
