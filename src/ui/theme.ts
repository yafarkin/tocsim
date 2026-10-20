import { useLayoutEffect, useState } from 'react';

export type ThemePreference = 'system' | 'dark' | 'light';
export const THEME_STORAGE_KEY = 'toc.theme';
interface ThemeRecord {schemaVersion: 1; preference: ThemePreference}
type StorageReader = () => Pick<Storage, 'getItem'>;
type StorageWriter = () => Pick<Storage, 'setItem'>;

export function readTheme(storage: StorageReader = () => localStorage): ThemePreference {
  try {
    const value: unknown = JSON.parse(storage().getItem(THEME_STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 1
      && 'preference' in value && ['system', 'dark', 'light'].includes(value.preference as string)) {
      return value.preference as ThemePreference;
    }
  } catch { /* Storage is optional, including on file://. */ }
  return 'system';
}
export function saveTheme(preference: ThemePreference, storage: StorageWriter = () => localStorage): void {
  try {
    const record: ThemeRecord = {schemaVersion: 1, preference};
    storage().setItem(THEME_STORAGE_KEY, JSON.stringify(record));
  } catch { /* Keep the current selection even if persistence is unavailable. */ }
}

/** The system listener changes appearance only; it never touches a run. */
export function observeTheme(preference: ThemePreference, media: {readonly matches: boolean; addEventListener(type: 'change', listener: () => void): void; removeEventListener(type: 'change', listener: () => void): void},
  apply: (theme: 'dark' | 'light') => void): () => void {
  const update = () => apply(preference === 'system' ? (media.matches ? 'dark' : 'light') : preference);
  update();
  if (preference !== 'system') return () => {};
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(() => readTheme());
  useLayoutEffect(() => observeTheme(theme, matchMedia('(prefers-color-scheme: dark)'), value => {
    document.documentElement.dataset.theme = value;
  }), [theme]);
  return [theme, (value: ThemePreference) => {saveTheme(value); setTheme(value);}] as const;
}
