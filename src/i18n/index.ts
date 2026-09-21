import { useSyncExternalStore } from "react";
import { en } from "./en";
import { fr, type Key } from "./fr";

export type Lang = "fr" | "en";
export type { Key };

const DICTS: Record<Lang, Record<string, string>> = { fr, en };
const STORAGE_KEY = "pv.lang";

const isLang = (v: unknown): v is Lang => v === "fr" || v === "en";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* stockage indisponible */
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current: Lang = detect();
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((f) => f());

if (typeof document !== "undefined") document.documentElement.lang = current;

/** Langue changée depuis l'autre fenêtre (la palette partage le stockage de la fenêtre principale). */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && isLang(e.newValue) && e.newValue !== current) {
      current = e.newValue;
      document.documentElement.lang = current;
      notify();
    }
  });
}

export const getLang = (): Lang => current;

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignoré */
  }
  document.documentElement.lang = lang;
  notify();
}

/** Hook : fait re-rendre le composant quand la langue change. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    getLang,
  );
}

/** Traduit une clé ; `{nom}` est remplacé par `vars.nom`. Repli : français, puis la clé elle-même. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? DICTS.fr[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
  return s;
}

/** Pluriel : utilise `<base>.one` quand n vaut 1 (ou 0 en français), sinon `<base>.other`. */
export function tn(base: string, n: number, vars?: Record<string, string | number>): string {
  const one = n === 1 || (current === "fr" && n === 0);
  return t(`${base}.${one ? "one" : "other"}` as Key, { n, ...vars });
}

/** Traduit une clé si elle existe, sinon renvoie `fallback` (libellés d'options libres). */
export function tOr(key: string, fallback: string): string {
  return key in fr ? t(key as Key) : fallback;
}

/** Traduit une erreur du cœur Rust (`E_CODE` ou `E_CODE:argument`) ; message inconnu → tel quel. */
export function tError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = /^(E_[A-Z_]+)(?::([\s\S]*))?$/.exec(raw.trim());
  if (m) {
    const key = `err.${m[1]}`;
    if (key in fr) return t(key as Key, { arg: m[2] ?? "" });
  }
  return raw;
}

export const locale = () => (current === "fr" ? "fr-FR" : "en-US");
