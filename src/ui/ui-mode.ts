import {useCallback, useState} from 'react';
import type {SyntheticEvent} from 'react';

export type UiMode = 'simple' | 'expert';
export const UI_MODE_STORAGE_KEY = 'toc.uiMode';
interface UiModeRecord {schemaVersion: 1; mode: UiMode}
type StorageReader = () => Pick<Storage, 'getItem'>;
type StorageWriter = () => Pick<Storage, 'setItem'>;

export function readUiMode(storage: StorageReader = () => localStorage): UiMode {
  try {
    const record: unknown = JSON.parse(storage().getItem(UI_MODE_STORAGE_KEY) ?? 'null');
    if (record && typeof record === 'object' && 'schemaVersion' in record && record.schemaVersion === 1
      && 'mode' in record && (record.mode === 'simple' || record.mode === 'expert')) return record.mode;
  } catch { /* Viewing preferences are optional, including on file://. */ }
  return 'simple';
}

export function saveUiMode(mode: UiMode, storage: StorageWriter = () => localStorage): void {
  try {
    const record: UiModeRecord = {schemaVersion: 1, mode};
    storage().setItem(UI_MODE_STORAGE_KEY, JSON.stringify(record));
  } catch { /* Retain the in-memory choice when storage is unavailable. */ }
}

/** A viewing preference only. It has no simulation or configuration dependencies. */
export function useUiMode(): readonly [UiMode, (mode: UiMode) => void] {
  const [mode, setMode] = useState(readUiMode);
  const selectMode = useCallback((next: UiMode) => {
    setMode(next);
    saveUiMode(next);
  }, []);
  return [mode, selectMode];
}

/** Show the short form without losing the user's expert disclosure state. */
export function useModeDisclosure(mode: UiMode, initiallyOpen = false) {
  const [expertOpen, setExpertOpen] = useState(initiallyOpen);
  return {open: mode === 'simple' || expertOpen, onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (mode === 'expert') setExpertOpen(event.currentTarget.open);
  }};
}
