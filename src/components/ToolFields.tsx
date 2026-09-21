import { useId, useState } from "react";
import { CaretDown, CaretRight, SlidersHorizontal } from "@phosphor-icons/react";
import { TOOL_FIELDS, type FieldDef } from "../toolFields";
import { toolInfo, type Tool } from "../types";
import { t, tOr, type Key } from "../i18n";

interface Props {
  tool: Tool;
  meta: Record<string, unknown>;
  disabled: boolean;
  onChange: (meta: Record<string, unknown>) => void;
}

const OPEN_KEY = "pv.toolFieldsOpen";

/** Paramètres propres au type d'outil (format d'image, durée de vidéo, langage de code…) dans `meta`. */
export function ToolFields({ tool, meta, disabled, onChange }: Props) {
  const uid = useId();
  const fields = TOOL_FIELDS[tool];
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== "0");
  if (!fields) return null;

  const filled = fields.filter((f) => meta[f.key] !== undefined && meta[f.key] !== "" && meta[f.key] !== false).length;

  const set = (key: string, value: unknown) => {
    const next = { ...meta };
    if (value === "" || value === undefined || value === false) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  const control = (f: FieldDef) => {
    const v = meta[f.key];
    const id = `${uid}-${f.key}`;
    const placeholder = tOr(`fp.${tool}.${f.key}`, "") || undefined;
    switch (f.kind) {
      case "select":
        return (
          <select id={id} value={(v as string) ?? ""} disabled={disabled} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">—</option>
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {tOr(`o.${o}`, o)}
              </option>
            ))}
          </select>
        );
      case "number":
        return (
          <span className="with-suffix">
            <input
              id={id}
              type="number"
              min={0}
              value={(v as number | string) ?? ""}
              disabled={disabled}
              onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))}
            />
            {f.suffix && <span className="suffix">{f.suffix}</span>}
          </span>
        );
      case "toggle":
        return (
          <input id={id} type="checkbox" checked={v === true} disabled={disabled} onChange={(e) => set(f.key, e.target.checked)} />
        );
      case "area":
        return (
          <textarea id={id} rows={2} value={(v as string) ?? ""} placeholder={placeholder} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />
        );
      default:
        return (
          <>
            <input
              id={id}
              list={f.suggestions ? `${id}-list` : undefined}
              value={(v as string) ?? ""}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(e) => set(f.key, e.target.value)}
            />
            {f.suggestions && (
              <datalist id={`${id}-list`}>
                {f.suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </>
        );
    }
  };

  return (
    <div className="tool-fields">
      <button
        className="tool-fields-head"
        onClick={() => {
          localStorage.setItem(OPEN_KEY, open ? "0" : "1");
          setOpen(!open);
        }}
      >
        {open ? <CaretDown size={11} weight="bold" aria-hidden /> : <CaretRight size={11} weight="bold" aria-hidden />}
        <SlidersHorizontal size={14} aria-hidden />
        <span>{t("tf.title", { tool: toolInfo(tool).label })}</span>
        {filled > 0 && <span className="tag">{filled}</span>}
      </button>
      {open && (
        <div className="tool-fields-grid">
          {fields.map((f) => (
            <label key={f.key} className={"field" + (f.wide ? " wide" : "") + (f.kind === "toggle" ? " inline" : "")}>
              <span>{t(`f.${tool}.${f.key}` as Key)}</span>
              {control(f)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
