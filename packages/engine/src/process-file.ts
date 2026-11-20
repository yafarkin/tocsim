import {ConfigError} from './config.js';

interface ProcessFileParts {
  config: unknown;
  web?: unknown;
}

export const PROCESS_FILE_VERSION = 3;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Decode portable files and legacy bare configurations for both CLI and web. */
export function parseProcessFile(json: string): ProcessFileParts {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ConfigError('json', 'file.json', null,
      {ru: 'Входные данные не являются корректным JSON.', en: 'Input is not valid JSON.'});
  }
  if (!isObject(value) || !Object.hasOwn(value, 'format')) return {config: value};

  if (value.format !== 'toc-process') {
    throw new ConfigError('shape', 'file.format', null,
      {ru: 'Ожидается файл процесса toc-process.', en: 'Expected a toc-process file.'});
  }
  const version = value.schemaVersion;
  if (version !== 1 && version !== 2 && version !== PROCESS_FILE_VERSION) {
    throw new ConfigError('shape', 'file.schemaVersion', null,
      {ru: 'Версия файла не поддерживается.', en: 'The file version is unsupported.'});
  }
  const allowed = ['format', 'schemaVersion', 'config'];
  if (version === 2) allowed.push('layout');
  if (version === PROCESS_FILE_VERSION) allowed.push('web');
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new ConfigError('shape', 'file', null,
      {ru: 'Оболочка файла содержит неподдерживаемые поля.', en: 'The file envelope contains unsupported fields.'});
  }
  if (version === 1) return {config: value.config};
  if (version === 2) return {config: value.config, web: {layout: value.layout}};

  const config = value.config;
  if (!isObject(config) || !Array.isArray(config.materials)) return {config, web: value.web};
  // Adapt the portable fields to the existing in-memory contract.
  const materials = config.materials.map((material: unknown) =>
    isObject(material) ? {color: '#357dad', ...material} : material);
  return {config: {...config, materials}, web: value.web};
}
