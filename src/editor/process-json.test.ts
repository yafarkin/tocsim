import {describe, expect, it, vi} from 'vitest';
import {ConfigError} from '@toc/engine';
import {Simulation} from '@toc/engine';
import {createLinearProcess, compileLinearProcess, appendLinearStation} from './linear-process';
import {openProcessStorage} from './process-storage';
import {copyImportedProcess, exportProcessJson, parseProcessJson, PROCESS_JSON_MAX_BYTES, readProcessJsonFile} from './process-json';

function envelope(config: unknown = createLinearProcess('original')) {
  return {format: 'toc-process', schemaVersion: 1, config};
}

function errorFrom(action: () => unknown): ConfigError {
  try { action(); } catch (error) { expect(error).toBeInstanceOf(ConfigError); return error as ConfigError; }
  throw new Error('Expected a validation error');
}

describe('portable process JSON', () => {
  it('preserves complete conditions and the deterministic simulation result', () => {
    const config = createLinearProcess('original', 'en');
    config.name = 'Процесс <script>alert(1)</script>';
    config.seed = 123; config.durationMs += 86_400_000;
    config.stations[0]!.plan[0]!.processing.cv = 0.5;
    config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '8'};
    const text = exportProcessJson(config), imported = parseProcessJson(text);
    expect(JSON.parse(text)).toEqual({...envelope(config), schemaVersion: 2, layout: {positions: []}});
    expect(Object.keys(JSON.parse(text))).toEqual(['format', 'schemaVersion', 'config', 'layout']);
    expect(imported).toEqual(config);
    expect(new Simulation(compileLinearProcess(imported)).runToEnd())
      .toEqual(new Simulation(compileLinearProcess(config)).runToEnd());
    imported.stations[0]!.name = 'Changed';
    expect(config.stations[0]!.name).toBe('Station 1');
  });

  it('prepares an independent accepted copy with a new configuration ID and stable internal IDs', () => {
    const original = createLinearProcess('original'), preview = parseProcessJson(exportProcessJson(original));
    const copy = copyImportedProcess(preview, 'imported');
    expect(copy).toEqual({...original, id: 'imported'});
    copy.stations[0]!.name = 'Changed';
    expect(preview).toEqual(original);
    expect(errorFrom(() => copyImportedProcess(preview, 'original')).path).toBe('config.id');
    expect(() => copyImportedProcess(preview, '')).toThrow(ConfigError);
  });

  it('does not change a library during preview, cancellation or invalid input', () => {
    const store = openProcessStorage(() => { throw new Error('No storage'); });
    store.save('existing', createLinearProcess('existing'), 0);
    const before = store.list();
    parseProcessJson(exportProcessJson(createLinearProcess('existing')));
    expect(() => parseProcessJson('{')).toThrow(ConfigError);
    expect(store.list()).toEqual(before);
    const copy = copyImportedProcess(parseProcessJson(exportProcessJson(before[0]!.record.config)), 'new-config');
    store.save('new-record', copy, 0);
    expect(store.list().map(entry => entry.record.id)).toEqual(['existing', 'new-record']);
    expect(store.list()[0]).toEqual(before[0]);
  });

  it.each(['', '{', 'null', '[]', '42', JSON.stringify(createLinearProcess('unwrapped')),
    JSON.stringify({...envelope(), format: 'other'}),
    JSON.stringify({...envelope(), schemaVersion: 2}),
    JSON.stringify({format: 'toc-process', config: createLinearProcess('x')}),
    JSON.stringify({format: 'toc-process', schemaVersion: 1}),
    JSON.stringify({...envelope(), revision: 1}),
    JSON.stringify(envelope({...createLinearProcess('x'), schemaVersion: 2}))])(
    'rejects malformed data or unsupported versions with RU/EN errors: %s', text => {
      const error = errorFrom(() => parseProcessJson(text));
      expect(error.messages.ru.length).toBeGreaterThan(0); expect(error.messages.en.length).toBeGreaterThan(0);
    });

  it('preserves specific validation paths for unsupported process settings', () => {
    const config = createLinearProcess('x'); config.stations[0]!.setupMs = 1;
    const before = structuredClone(config);
    expect(errorFrom(() => parseProcessJson(JSON.stringify(envelope(config)))).code).toBe('unsupported');
    expect(() => exportProcessJson(config)).toThrow(ConfigError);
    expect(config).toEqual(before);
  });

  it('round trips the maximum chain without truncation', () => {
    let config = createLinearProcess('x');
    while (config.stations.length < 30) config = appendLinearStation(config, 'Station', 180_000);
    expect(parseProcessJson(exportProcessJson(config))).toEqual(config);
  });

  it('checks UTF-8 bytes and allows exactly the limit', () => {
    const text = exportProcessJson(createLinearProcess('x'));
    const padded = text + ' '.repeat(PROCESS_JSON_MAX_BYTES - new TextEncoder().encode(text).byteLength);
    expect(parseProcessJson(padded).id).toBe('x');
    expect(errorFrom(() => parseProcessJson(padded + ' ')).path).toBe('file.size');
    expect(errorFrom(() => parseProcessJson('я'.repeat(PROCESS_JSON_MAX_BYTES / 2 + 1))).path).toBe('file.size');
  });

  it('rejects an oversized file before reading it', async () => {
    const text = vi.fn(async () => '{}');
    await expect(readProcessJsonFile({size: PROCESS_JSON_MAX_BYTES + 1, text})).rejects.toMatchObject({path: 'file.size'});
    expect(text).not.toHaveBeenCalled();
  });

  it('reads a file, checks actual text size and reports read failures', async () => {
    const config = createLinearProcess('x');
    expect(await readProcessJsonFile(new Blob([exportProcessJson(config)]))).toEqual(config);
    await expect(readProcessJsonFile({size: 0, text: async () => ' '.repeat(PROCESS_JSON_MAX_BYTES + 1)}))
      .rejects.toMatchObject({path: 'file.size'});
    await expect(readProcessJsonFile({size: 0, text: async () => { throw new Error('Denied'); }}))
      .rejects.toMatchObject({path: 'file.read', messages: {ru: expect.any(String), en: expect.any(String)}});
  });

  it('does not export a configuration larger than the import limit', () => {
    const config = createLinearProcess('x'); config.name = 'я'.repeat(PROCESS_JSON_MAX_BYTES);
    expect(errorFrom(() => exportProcessJson(config)).path).toBe('file.size');
  });
});
