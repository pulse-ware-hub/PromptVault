import { useEffect, useState } from "react";
import { Copy, GearSix, Sparkle, X } from "@phosphor-icons/react";
import { api, type AiAction, type AiSettings } from "../api";
import { t, tError, type Key } from "../i18n";

const ACTIONS: AiAction[] = ["improve", "shorten", "detail", "structure", "fix", "translate_fr", "translate_en"];

interface Props {
  content: string;
  tool: string;
  meta: Record<string, unknown>;
  onApply: (text: string) => void | Promise<void>;
  onCopy: (text: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

/** Panneau « Améliorer avec l'IA » : action, consigne libre, comparaison original / proposition. */
export function AiPanel({ content, tool, meta, onApply, onCopy, onOpenSettings, onClose }: Props) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [action, setAction] = useState<AiAction>("improve");
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [used, setUsed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; noKey: boolean } | null>(null);

  const refresh = () => api.aiSettings().then(setSettings).catch((e) => setError({ text: tError(e), noKey: false }));
  useEffect(() => {
    void refresh();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Retour des réglages : la clé a pu être ajoutée.
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const provider = settings?.provider ?? "claude";
  const providerName = t(provider === "claude" ? "set.claude" : "set.gemini");
  const model = provider === "claude" ? settings?.claudeModel : settings?.geminiModel;
  const hasKey = provider === "claude" ? settings?.hasClaudeKey : settings?.hasGeminiKey;

  const generate = async () => {
    setError(null);
    if (!content.trim()) {
      setError({ text: t("ai.emptyPrompt"), noKey: false });
      return;
    }
    setBusy(true);
    try {
      const r = await api.aiTransform(content, action, tool, meta, instruction.trim() || null);
      setResult(r.text);
      setUsed(t("ai.using", { provider: r.provider, model: r.model }));
    } catch (e) {
      setError({ text: tError(e), noKey: String(e).startsWith("E_AI_NO_KEY") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer ai-drawer" onClick={onClose}>
      <div className="drawer-card ai-card" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <Sparkle size={16} weight="fill" className="ai-spark" aria-hidden />
          <strong>{t("ai.title")}</strong>
          <span className="tag">{t("ai.using", { provider: providerName, model: model ?? "…" })}</span>
          <span className="spacer" />
          <button className="icon-btn big" onClick={onOpenSettings} title={t("set.title")}>
            <GearSix size={16} aria-hidden />
          </button>
          <button className="icon-btn big" onClick={onClose} aria-label={t("ed.close")}>
            <X size={16} weight="bold" aria-hidden />
          </button>
        </div>

        <div className="ai-body">
          <div className="ai-actions" role="group">
            {ACTIONS.map((a) => (
              <button key={a} className={"chip" + (a === action ? " on" : "")} onClick={() => setAction(a)}>
                {t(`ai.action.${a}` as Key)}
              </button>
            ))}
          </div>

          <label className="ai-field">
            <span>{t("ai.instruction")}</span>
            <input
              value={instruction}
              placeholder={t("ai.instructionPh")}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && hasKey && void generate()}
            />
          </label>

          {settings && !hasKey && (
            <div className="ai-notice">
              {t("ai.noKey", { provider: providerName })}{" "}
              <button className="btn" onClick={onOpenSettings}>
                {t("ai.configure")}
              </button>
            </div>
          )}

          <div className="ai-run">
            <button className="btn primary" disabled={busy || !hasKey} onClick={() => void generate()}>
              <Sparkle size={14} weight="fill" aria-hidden /> {busy ? t("ai.generating") : result ? t("ai.retry") : t("ai.generate")}
            </button>
            <span className="muted ai-privacy">{t("ai.privacy", { provider: providerName })}</span>
          </div>

          {error && (
            <div className="ai-error">
              {error.text}{" "}
              {error.noKey && (
                <button className="btn" onClick={onOpenSettings}>
                  {t("ai.configure")}
                </button>
              )}
            </div>
          )}

          {result !== null && (
            <div className="ai-compare">
              <div>
                <div className="ai-col-title">{t("ai.original")}</div>
                <pre className="ai-text">{content}</pre>
              </div>
              <div>
                <div className="ai-col-title">
                  {t("ai.proposal")} {used && <span className="muted">· {used}</span>}
                </div>
                <textarea className="ai-text ai-edit" value={result} onChange={(e) => setResult(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {result !== null && (
          <div className="ai-foot">
            <button className="btn" onClick={() => onCopy(result)}>
              <Copy size={14} aria-hidden /> {t("ai.copyResult")}
            </button>
            <span className="spacer" />
            <button
              className="btn primary"
              disabled={!result.trim()}
              onClick={() => {
                onApply(result);
                onClose();
              }}
            >
              {t("ai.apply")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
