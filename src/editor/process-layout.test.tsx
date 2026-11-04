import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Simulation} from '../engine/simulation';
import {compileLinearProcess, createLinearProcess, removeLinearStation} from './linear-process';
import {configFromDraft, processDraft} from './process-form';
import {layoutNodes, parseProcessLayout, placeNode, retainLayout} from './process-layout';
import {copyImportedProcess, exportProcessJson, parseProcessDocument, readProcessDocumentFile} from './process-json';
import {openProcessStorage, PROCESS_STORAGE_PREFIX} from './process-storage';
import {ProcessCanvas} from './ProcessCanvas';

const config = () => createLinearProcess('layout-test');
const layout = () => ({positions: [{id: 's2', x: 485, y: 275}]});
function fixture() {
  const data = new Map<string, string>();
  const storage = {get length() {return data.size;}, key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => {data.set(key, value);},
    removeItem: (key: string) => {data.delete(key);}};
  return {data, storage, open: () => openProcessStorage(() => storage)};
}
describe('process canvas layout', () => {
  it('uses chain order for initial positions and keeps explicitly moved nodes', () => {
    const source = config(); source.stations.reverse();
    const nodes = layoutNodes(source, layout());
    expect(nodes.map(node => node.id)).toEqual(['source', 's1', 's2', 's3', 'market']);
    expect(nodes[2]).toEqual(layout().positions[0]);
    expect(new Set(nodes.filter(node => node.id !== 's2').map(node => node.x)).size).toBe(4);
  });
  it('clamps coordinates, keeps independent data and removes deleted nodes', () => {
    const before = layout(), next = placeNode(before, {id: 's1', x: -4, y: 20001});
    expect(next.positions.find(node => node.id === 's1')).toEqual({id: 's1', x: 0, y: 20000});
    expect(before).toEqual(layout());
    expect(retainLayout(removeLinearStation(config(), 's2'), before)).toEqual({positions: []});
  });
  it.each([null, {}, {positions: [{id: 'unknown', x: 0, y: 0}]},
    {positions: [{id: 's1', x: -1, y: 0}]}, {positions: [{id: 's1', x: 0.5, y: 0}]},
    {positions: [{id: 's1', x: Infinity, y: 0}]}, {positions: [{id: 's1', x: 0, y: 20001}]},
    {positions: [{id: 's1', x: 0, y: 0, extra: 1}]},
    {positions: [{id: 's1', x: 0, y: 0}, {id: 's1', x: 1, y: 1}]}, {positions: [], future: 1}])(
    'rejects malformed layout %j', value => {
      expect(() => parseProcessLayout(value, config())).toThrow();
      expect(() => parseProcessDocument(JSON.stringify({format: 'toc-process', schemaVersion: 2, config: config(), layout: value}))).toThrow();
    });
  it('migrates legacy storage in memory and writes version 2 only on explicit save', () => {
    const f = fixture(), source = config();
    const raw = JSON.stringify({schemaVersion: 1, id: 'old', revision: 3, updatedAt: '2026-11-04T10:00:00Z', config: source});
    f.data.set(PROCESS_STORAGE_PREFIX + 'old', raw);
    const store = f.open();
    expect(store.list()[0]!.record).toMatchObject({schemaVersion: 2, revision: 3, layout: {positions: []}, config: source});
    expect(f.data.get(PROCESS_STORAGE_PREFIX + 'old')).toBe(raw);
    store.save('old', source, 3, layout());
    expect(f.open().list()[0]!.record).toMatchObject({schemaVersion: 2, revision: 4, layout: layout()});
  });
  it('retains layout on quota failure and preserves a conflicting remote record', () => {
    const f = fixture(), store = f.open(), source = config();
    store.save('a', source, 0, layout());
    const original = f.data.get(PROCESS_STORAGE_PREFIX + 'a');
    const write = f.storage.setItem;
    f.storage.setItem = () => {throw new Error('Quota');};
    const changed = placeNode(layout(), {id: 's2', x: 900, y: 500});
    expect(store.save('a', source, 1, changed).persisted).toBe(false);
    expect(store.list()[0]!.record.layout).toEqual(changed);
    expect(f.data.get(PROCESS_STORAGE_PREFIX + 'a')).toBe(original);
    f.storage.setItem = write;
    f.open().save('a', source, 1, layout());
    expect(store.save('a', source, 1, changed).issue!.code).toBe('conflict');
    expect(f.open().list()[0]!.record.layout).toEqual(layout());
  });
  it('preserves corrupted coordinates and future records without overwriting them', () => {
    const f = fixture(), store = f.open(); store.save('a', config(), 0, layout());
    const record = JSON.parse(f.data.get(PROCESS_STORAGE_PREFIX + 'a')!);
    record.layout.positions[0].id = 'missing';
    const broken = JSON.stringify(record); f.data.set(PROCESS_STORAGE_PREFIX + 'a', broken);
    expect(f.open().list()).toEqual([]);
    expect(f.open().save('a', config(), 0).persisted).toBe(false);
    expect(f.data.get(PROCESS_STORAGE_PREFIX + 'a')).toBe(broken);
    record.schemaVersion = 99; f.data.set(PROCESS_STORAGE_PREFIX + 'a', JSON.stringify(record));
    expect(f.open().issues()[0]!.code).toBe('version');
  });
  it('round trips layout through files and copies without changing conditions, hash or results', async () => {
    const source = config(), before = structuredClone(source), positions = layout();
    const document = await readProcessDocumentFile(new Blob([exportProcessJson(source, positions)]));
    const copy = copyImportedProcess(document.config, 'copied');
    expect(document).toEqual({config: source, layout: positions});
    expect(layoutNodes(copy, document.layout)[2]).toEqual(positions.positions[0]);
    const run = compileLinearProcess(configFromDraft(document.config, processDraft(document.config)));
    expect(run.calculationHash).toBe(compileLinearProcess(source).calculationHash);
    expect(new Simulation(run).runToEnd()).toEqual(new Simulation(compileLinearProcess(source)).runToEnd());
    expect(source).toEqual(before);
    document.layout.positions[0]!.x = 0;
    expect(positions).toEqual(layout());
  });
  it('migrates legacy JSON into automatic layout without changing its configuration', () => {
    const source = config();
    expect(parseProcessDocument(JSON.stringify({format: 'toc-process', schemaVersion: 1, config: source})))
      .toEqual({config: source, layout: {positions: []}});
    expect(() => parseProcessDocument(JSON.stringify({format: 'toc-process', schemaVersion: 3, config: source}))).toThrow();
  });
  it.each(['ru', 'en'] as const)('renders keyboard instructions, named handles and fixed routes in %s', language => {
    const source = config(), draft = processDraft(source); draft.stations[1]!.name = '<script>name</script>';
    const html = renderToStaticMarkup(createElement(ProcessCanvas, {config: source, draft, layout: layout(), language, locked: true, onChange: () => {}}));
    expect(html).toContain('data-node-id="s2"'); expect(html).toContain('data-route-id="route-s2"');
    expect(html).toContain('&lt;script&gt;name&lt;/script&gt;'); expect(html).not.toContain('<script>');
    expect(html.match(/ disabled=""/g)).toHaveLength(6);
  });
});
