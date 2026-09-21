import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { X } from "@phosphor-icons/react";
import { t } from "../i18n";
import icon from "../assets/icon.png";
import pulsewareLogo from "../assets/pulseware-logo.png";

const REPO_URL = "https://github.com/pulse-ware-hub/PromptVault";

/** Fenêtre « À propos » : icône, nom, auteur, société, puis numéro de version. */
export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal about" role="dialog" aria-label={t("about.title")} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn about-close" onClick={onClose} aria-label={t("set.close")}>
          <X size={16} weight="bold" aria-hidden />
        </button>
        <img className="about-icon" src={icon} alt="" width={96} height={96} />
        <div className="about-name">PromptVault</div>
        <div className="about-author">Emmanuel ROMAIN</div>
        <div className="about-company">Pulse-Ware</div>
        {version && <div className="about-version">{t("about.version", { version })}</div>}
        <img className="about-logo" src={pulsewareLogo} alt="Pulse-Ware" width={72} height={72} />
        <div className="about-meta">
          {t("about.license")} ·{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            {t("about.repo")}
          </a>
        </div>
      </div>
    </div>
  );
}
