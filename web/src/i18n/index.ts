import { useSyncExternalStore } from 'react';
import { en } from './en';
import { fr } from './fr';

export type Lang = 'en' | 'fr';
export type Key = keyof typeof en;
type Dicts = Record<string, Partial<Record<string, string>>>;

const DICTS: Dicts = { en, fr };

export function translate(lang: string, key: string, vars?: Record<string, string | number>, dicts: Dicts = DICTS): string {
  const raw = dicts[lang]?.[key] ?? dicts.en?.[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
}

let current: Lang = 'en';
const listeners = new Set<() => void>();

export function getLanguage(): Lang { return current; }

export function setLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  listeners.forEach((l) => l());
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  return translate(current, key, vars);
}

/** Subscribe a component to language changes; returns the current language. */
export function useLanguage(): Lang {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getLanguage,
  );
}

export function detectLanguage(): Lang {
  return typeof navigator !== 'undefined' && /^fr/i.test(navigator.language ?? '') ? 'fr' : 'en';
}
