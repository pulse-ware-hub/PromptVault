import { ListBullets, SidebarSimple } from "@phosphor-icons/react";
import { t } from "../i18n";

interface Props {
  kind: "sidebar" | "list";
  /** Le volet est-il déployé ? (icône pleine quand il est replié, comme un bouton « actif »). */
  open: boolean;
  onToggle: () => void;
}

/**
 * Bouton rond de repli d'un volet (⌥⌘S barre latérale / ⌥⌘L liste), à la manière de Notes : il vit dans la
 * bande haute de son volet, à côté des pastilles de la fenêtre ; replié, il migre dans la bande du premier
 * volet encore visible (cf. `App.tsx`).
 */
export function PaneToggle({ kind, open, onToggle }: Props) {
  const Icon = kind === "sidebar" ? SidebarSimple : ListBullets;
  const label =
    kind === "sidebar"
      ? open
        ? t("pane.hideSidebar")
        : t("pane.showSidebar")
      : open
        ? t("pane.hideList")
        : t("pane.showList");
  return (
    <button className={"pane-btn" + (open ? "" : " off")} title={label} aria-label={label} onClick={onToggle}>
      <Icon size={18} weight="regular" aria-hidden />
    </button>
  );
}
