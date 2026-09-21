import { locale, t } from "./i18n";

export function relativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const loc = locale();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return t("date.yesterday");
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return d.toLocaleDateString(loc, { weekday: "long" });
  return d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" });
}
