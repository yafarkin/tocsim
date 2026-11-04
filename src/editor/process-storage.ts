import type {EditorConfig} from '../engine/config';
import {compileLinearProcess} from './linear-process';

export const PROCESS_STORAGE_PREFIX = 'toc.process.';
type ProcessStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
export interface ProcessRecord {
  schemaVersion: 1;
  id: string;
  /** Last persisted revision; zero means the record has never been persisted. */
  revision: number;
  updatedAt: string;
  config: EditorConfig;
}
export interface ProcessEntry {record: ProcessRecord; persisted: boolean}
type IssueCode = 'unavailable' | 'invalid' | 'version' | 'conflict';
export interface ProcessStorageIssue {code: IssueCode; key: string | null; ru: string; en: string}
export interface ProcessStorageResult {persisted: boolean; issue: ProcessStorageIssue | null}

function issue(code: IssueCode, key: string | null): ProcessStorageIssue {
  const messages = {
    unavailable: {ru: 'Хранилище недоступно. Изменения остаются только в памяти вкладки. При доступности экспорта сохраните JSON.',
      en: 'Storage is unavailable. Changes remain only in this tab. Export JSON when export is available.'},
    invalid: {ru: 'Запись повреждена или не поддерживается. Исходные данные сохранены.',
      en: 'The record is invalid or unsupported. Original data has been retained.'},
    version: {ru: 'Версия записи не поддерживается. Исходные данные сохранены.',
      en: 'The record version is unsupported. Original data has been retained.'},
    conflict: {ru: 'Запись изменилась. Перечитайте её или сохраните свою копию с новым ID.',
      en: 'The record has changed. Reopen it or save your copy with a new ID.'},
  };
  return {code, key, ...messages[code]};
}

function readRecord(raw: string, key: string): ProcessRecord {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('schemaVersion' in value)) throw issue('invalid', key);
  if (value.schemaVersion !== 1) throw issue('version', key);
  const record = value as ProcessRecord;
  if (typeof record.id !== 'string' || !record.id || key !== PROCESS_STORAGE_PREFIX + record.id
    || !Number.isSafeInteger(record.revision) || record.revision < 1
    || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw issue('invalid', key);
  }
  compileLinearProcess(record.config);
  return record;
}

function recordIssue(error: unknown, key: string): ProcessStorageIssue {
  return error && typeof error === 'object' && 'code' in error && error.code === 'version'
    ? issue('version', key) : issue('invalid', key);
}

/** No DOM access until opened. Storage failures never prevent use of the in-memory list. */
export function openProcessStorage(storage: () => ProcessStorage = () => localStorage) {
  const entries = new Map<string, ProcessEntry>();
  const issues: ProcessStorageIssue[] = [];
  try {
    const target = storage();
    const keys = Array.from({length: target.length}, (_, index) => target.key(index))
      .filter((key): key is string => key !== null && key.startsWith(PROCESS_STORAGE_PREFIX));
    for (const key of keys) {
      let raw: string | null;
      try { raw = target.getItem(key); }
      catch { issues.push(issue('unavailable', key)); continue; }
      if (raw === null) continue;
      try {
        const record = readRecord(raw, key);
        entries.set(record.id, {record, persisted: true});
      } catch (error) { issues.push(recordIssue(error, key)); }
    }
  } catch { issues.push(issue('unavailable', null)); }

  // Always reread before mutation. This detects stale revisions, but is not an atomic lock.
  function check(target: ProcessStorage, id: string, revision: number): ProcessStorageIssue | null {
    const key = PROCESS_STORAGE_PREFIX + id;
    const raw = target.getItem(key);
    if (raw === null) return revision === 0 ? null : issue('conflict', key);
    try {
      return readRecord(raw, key).revision === revision ? null : issue('conflict', key);
    } catch (error) { return recordIssue(error, key); }
  }

  function validateIdentity(id: string, revision: number) {
    if (!id || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
      throw new Error('A nonempty record ID and a safe nonnegative expected revision are required.');
    }
  }

  return {
    list: (): ProcessEntry[] => structuredClone([...entries.values()]),
    issues: (): ProcessStorageIssue[] => structuredClone(issues),
    /** Pass zero for a new ID. Failed writes retain the draft with its last persisted revision. */
    save(id: string, config: EditorConfig, expectedRevision: number): ProcessStorageResult {
      validateIdentity(id, expectedRevision);
      compileLinearProcess(config);
      const key = PROCESS_STORAGE_PREFIX + id;
      const record: ProcessRecord = {schemaVersion: 1, id, revision: expectedRevision,
        updatedAt: new Date().toISOString(), config: structuredClone(config)};
      let failure: ProcessStorageIssue | null = null;
      try {
        const target = storage();
        failure = check(target, id, expectedRevision);
        if (!failure) {
          const saved = {...record, revision: expectedRevision + 1};
          target.setItem(key, JSON.stringify(saved));
          entries.set(id, {record: saved, persisted: true});
          return {persisted: true, issue: null};
        }
      } catch { failure = issue('unavailable', key); }
      entries.set(id, {record, persisted: false});
      return {persisted: false, issue: failure};
    },
    remove(id: string, expectedRevision: number): ProcessStorageResult {
      validateIdentity(id, expectedRevision);
      const key = PROCESS_STORAGE_PREFIX + id;
      try {
        const target = storage(), failure = check(target, id, expectedRevision);
        if (failure) return {persisted: false, issue: failure};
        target.removeItem(key);
        entries.delete(id);
        return {persisted: true, issue: null};
      } catch {
        entries.delete(id);
        return {persisted: false, issue: issue('unavailable', key)};
      }
    },
  };
}
