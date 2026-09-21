import { useEffect, useState } from "react";
import { CheckCircle, Key, Trash, X } from "@phosphor-icons/react";
import { api, type AiSettings } from "../api";
import { t, tError } from "../i18n";

interface Props {
  onClose: () => void;
  notify: (msg: string) => void;
  onOpenAbout: () => void;
}

type Provider = "claude" | "gemini";

const DEFAULT_MODELS: Record<Provider, string> = { claude: "claude-sonnet-5", gemini: "gemini-2.5-flash" };
const MODEL_SUGGESTIONS: Record<Provider, string[]> = {
  claude: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
};

/** Réglages de l'IA : fournisseur, modèle, clé API (Trousseau macOS), test de connexion. */
export function SettingsDialog({ onClose, notify, onOpenAbout }: Props) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<Provider>("claude");
  const [models, setModels] = useState<Record<Provider, string>>(DEFAULT_MODELS);
  const [keyInput, setKeyInput] = useState<Record<Provider, string>>({ claude: "", gemini: "" });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const s = await api.aiSettings();
      setSettings(s);
      setProvider(s.provider);
      setModels({ claude: s.claudeModel, gemini: s.geminiModel });
    } catch (e) {
      setStatus({ ok: false, text: tError(e) });
    }
  };
  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasKey = (p: Provider) => (p === "claude" ? settings?.hasClaudeKey : settings?.hasGeminiKey) ?? false;

  const persist = async () => {
    await api.aiSaveSettings(provider, models.claude, models.gemini);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
    } catch (e) {
      setStatus({ ok: false, text: tError(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveKey = (p: Provider) =>
    run(async () => {
      await api.aiSetKey(p, keyInput[p]);
      setKeyInput((k) => ({ ...k, [p]: "" }));
      await load();
      notify(t("set.keySaved"));
    });

  const deleteKey = (p: Provider) =>
    run(async () => {
      await api.aiDeleteKey(p);
      await load();
      notify(t("set.keyDeleted"));
    });

  const test = () =>
    run(async () => {
      await persist(); // teste le fournisseur et le modèle affichés
      const r = await api.aiTest();
      setStatus({ ok: true, text: t("set.testOk", { provider: r.provider, model: r.model }) });
    });

  const save = () =>
    run(async () => {
      await persist();
      await load();
      notify(t("set.saved"));
      onClose();
    });

  const section = (p: Provider) => (
    <div className={"set-provider" + (provider === p ? " active" : "")} key={p}>
      <label className="set-radio">
        <input type="radio" name="provider" checked={provider === p} onChange={() => setProvider(p)} />
        <strong>{t(p === "claude" ? "set.claude" : "set.gemini")}</strong>
        <span className={"set-key-status" + (hasKey(p) ? " ok" : "")}>
          {hasKey(p) ? <CheckCircle size={14} weight="fill" aria-hidden /> : <Key size={14} aria-hidden />}
          {hasKey(p) ? t("set.keyStored") : t("set.keyNone")}
        </span>
      </label>
      <div className="set-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t("set.keyPh")}
          value={keyInput[p]}
          onChange={(e) => setKeyInput((k) => ({ ...k, [p]: e.target.value }))}
        />
        <button className="btn" disabled={busy || !keyInput[p].trim()} onClick={() => void saveKey(p)}>
          {t("set.saveKey")}
        </button>
        {hasKey(p) && (
          <button className="btn danger" disabled={busy} onClick={() => void deleteKey(p)} title={t("set.deleteKey")}>
            <Trash size={14} aria-hidden />
          </button>
        )}
      </div>
      <div className="set-row">
        <label className="set-model">
          <span>{t("set.model")}</span>
          <input
            list={`models-${p}`}
            value={models[p]}
            placeholder={DEFAULT_MODELS[p]}
            onChange={(e) => setModels((m) => ({ ...m, [p]: e.target.value }))}
          />
          <datalist id={`models-${p}`}>
            {MODEL_SUGGESTIONS[p].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="muted set-hint">{t("set.modelHint")}</div>
      <div className="muted set-hint">{t(p === "claude" ? "set.getKeyClaude" : "set.getKeyGemini")}</div>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={t("set.title")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>
            {t("set.title")} — {t("set.ai")}
          </strong>
          <span className="spacer" />
          <button className="icon-btn big" onClick={onClose} aria-label={t("set.close")}>
            <X size={16} weight="bold" aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <div className="muted set-hint">{t("set.provider")}</div>
          {section("claude")}
          {section("gemini")}
          <div className="muted set-privacy">{t("set.privacy")}</div>
          {status && <div className={"set-status" + (status.ok ? " ok" : " bad")}>{status.text}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn" disabled={busy} onClick={() => void test()}>
            {busy ? t("set.testing") : t("set.test")}
          </button>
          <button className="link-btn" onClick={onOpenAbout}>
            {t("set.about")}
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            {t("set.close")}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {t("set.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
