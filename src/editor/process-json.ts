import {compileConfig, ConfigError, parseProcessFile, PROCESS_FILE_VERSION} from '@toc/engine';
import type {EditorConfig} from '@toc/engine';
import {parseProcessLayout} from './process-layout';
import type {ProcessDocument, ProcessLayout} from './process-layout';

export const PROCESS_JSON_MAX_BYTES = 2 * 1024 * 1024;

function fail(path: string, ru: string, en: string): never {
  throw new ConfigError('shape', path, null, {ru, en});
}

function checkSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > PROCESS_JSON_MAX_BYTES) {
    fail('file.size', 'Размер файла должен быть не больше 2 МиБ.', 'The file must be at most 2 MiB.');
  }
}

/** Format an already validated document for the JSON editor or file export. */
export function formatProcessDocument({config, layout}: ProcessDocument, indent = 2): string {
  const {displayOrder, materials, ...conditions} = config;
  return JSON.stringify({
    format: 'toc-process',
    schemaVersion: PROCESS_FILE_VERSION,
    config: {...conditions, materials: materials.map(({color, ...material}) => material)},
    web: {
      layout,
      displayOrder,
      materialColors: Object.fromEntries(materials.map(({id, color}) => [id, color])),
    },
  }, null, indent);
}

/** Portable configuration and editor layout, without library revision, timestamps or run results. */
export function exportProcessJson(config: EditorConfig, layout: ProcessLayout = {positions: []}): string {
  compileConfig(config);
  const document = {config, layout: parseProcessLayout(layout, config)};
  const text = formatProcessDocument(document);
  if (new TextEncoder().encode(text).byteLength <= PROCESS_JSON_MAX_BYTES) return text;
  const compact = formatProcessDocument(document, 0);
  checkSize(new TextEncoder().encode(compact).byteLength);
  return compact;
}

/** Parse the JSON editor contents without applying the file import size limit. */
export function decodeProcessDocument(text: string): ProcessDocument {
  const {config, web} = parseProcessFile(text);
  compileConfig(config);
  const source = structuredClone(config) as EditorConfig;
  if (web === undefined) return {config: source, layout: {positions: []}};
  if (!web || typeof web !== 'object' || Array.isArray(web)
    || Object.keys(web).some(key => !['layout', 'displayOrder', 'materialColors'].includes(key))) {
    fail('web', 'Некорректные настройки отображения.', 'Invalid presentation settings.');
  }
  const layout = 'layout' in web ? parseProcessLayout(web.layout, source) : {positions: []};
  if ('displayOrder' in web) {
    // The compiler checks IDs and duplicates against the complete configuration below.
    source.displayOrder = web.displayOrder as string[];
  }
  if ('materialColors' in web) {
    const colors = web.materialColors;
    if (!colors || typeof colors !== 'object' || Array.isArray(colors)
      || Object.entries(colors).some(([id, color]) => typeof color !== 'string' || !color.trim()
        || !source.materials.some(material => material.id === id))) {
      fail('web.materialColors', 'Укажите цвета существующих материалов.', 'Specify colors for existing materials.');
    }
    for (const material of source.materials) {
      if (Object.hasOwn(colors, material.id)) material.color = (colors as Record<string, string>)[material.id]!;
    }
  }
  if ('displayOrder' in web) compileConfig(source);
  return {config: source, layout};
}

/** Preview data retains the source ID. This function never writes to the library. */
export function parseProcessDocument(text: string): ProcessDocument {
  checkSize(new TextEncoder().encode(text).byteLength);
  return decodeProcessDocument(text);
}

// Config-only API retained for callers that do not display an editor.
export function parseProcessJson(text: string): EditorConfig {return parseProcessDocument(text).config;}

/** Check the file size before reading; selection and confirmation belong to the UI. */
export async function readProcessDocumentFile(file: Pick<Blob, 'size' | 'text'>): Promise<ProcessDocument> {
  checkSize(file.size);
  let text: string;
  try { text = await file.text(); }
  catch { fail('file.read', 'Не удалось прочитать файл.', 'Could not read the file.'); }
  return parseProcessDocument(text);
}

export async function readProcessJsonFile(file: Pick<Blob, 'size' | 'text'>): Promise<EditorConfig> {
  return (await readProcessDocumentFile(file)).config;
}

/** Call only after accepting a preview, then save under a new library record ID. */
export function copyImportedProcess(config: EditorConfig, newConfigId: string): EditorConfig {
  compileConfig(config);
  if (newConfigId === config.id) {
    fail('config.id', 'Для импорта нужен новый ID конфигурации.', 'Import requires a new configuration ID.');
  }
  const copy = structuredClone(config);
  copy.id = newConfigId;
  if (copy.displayOrder?.includes(config.id)) {
    copy.displayOrder = copy.displayOrder.map(id => id === config.id ? newConfigId : id);
  }
  compileConfig(copy);
  return copy;
}
