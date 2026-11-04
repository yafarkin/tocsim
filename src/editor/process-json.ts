import {ConfigError} from '../engine/config';
import type {EditorConfig} from '../engine/config';
import {compileLinearProcess} from './linear-process';

export const PROCESS_JSON_MAX_BYTES = 2 * 1024 * 1024;

function fail(path: string, ru: string, en: string): never {
  throw new ConfigError('shape', path, null, {ru, en});
}

function checkSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > PROCESS_JSON_MAX_BYTES) {
    fail('file.size', 'Размер файла должен быть не больше 2 МиБ.', 'The file must be at most 2 MiB.');
  }
}

/** A portable configuration only: no library revision, timestamps or run results. */
export function exportProcessJson(config: EditorConfig): string {
  compileLinearProcess(config);
  const text = JSON.stringify({format: 'toc-process', schemaVersion: 1, config}, null, 2);
  checkSize(new TextEncoder().encode(text).byteLength);
  return text;
}

/** Preview data retains the source ID. This function never writes to the library. */
export function parseProcessJson(text: string): EditorConfig {
  checkSize(new TextEncoder().encode(text).byteLength);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { fail('file.json', 'Файл не содержит корректный JSON.', 'The file does not contain valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !('format' in value) || value.format !== 'toc-process') {
    fail('file.format', 'Ожидается файл одного процесса toc-process.', 'Expected a single toc-process file.');
  }
  if (!('schemaVersion' in value) || value.schemaVersion !== 1) {
    fail('file.schemaVersion', 'Версия файла не поддерживается.', 'The file version is unsupported.');
  }
  if (Object.keys(value).some(key => !['format', 'schemaVersion', 'config'].includes(key))) {
    fail('file', 'Оболочка файла содержит неподдерживаемые поля.', 'The file envelope contains unsupported fields.');
  }
  const config: unknown = 'config' in value ? value.config : undefined;
  compileLinearProcess(config);
  return structuredClone(config) as EditorConfig;
}

/** Check the file size before reading; selection and confirmation belong to the UI. */
export async function readProcessJsonFile(file: Pick<Blob, 'size' | 'text'>): Promise<EditorConfig> {
  checkSize(file.size);
  let text: string;
  try { text = await file.text(); }
  catch { fail('file.read', 'Не удалось прочитать файл.', 'Could not read the file.'); }
  return parseProcessJson(text);
}

/** Call only after accepting a preview, then save under a new library record ID. */
export function copyImportedProcess(config: EditorConfig, newConfigId: string): EditorConfig {
  compileLinearProcess(config);
  if (newConfigId === config.id) {
    fail('config.id', 'Для импорта нужен новый ID конфигурации.', 'Import requires a new configuration ID.');
  }
  const copy = structuredClone(config);
  copy.id = newConfigId;
  compileLinearProcess(copy);
  return copy;
}
