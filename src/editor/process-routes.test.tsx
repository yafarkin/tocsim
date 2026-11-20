import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig, ConfigError, Simulation} from '@toc/engine';
import {compileEditableProcess, compileLinearProcess, createLinearProcess, moveLinearStation} from './linear-process';
import {configFromDraft, processDraft} from './process-form';
import {copyImportedProcess, exportProcessJson, parseProcessDocument} from './process-json';
import {openProcessStorage} from './process-storage';
import {layoutNodes} from './process-layout';
import {ProcessCanvas} from './ProcessCanvas';
import {ProcessRoutes} from './ProcessRoutes';

function branch() {
  const base = createLinearProcess('branch'), draft = processDraft(base);
  draft.stations.find(item => item.id === 's3')!.inputs[0]!.materialId = 'output-s1';
  draft.materials.find(item => item.id === 'output-s2')!.role = 'finished';
  draft.routes.find(item => item.id === 'route-s1')!.toId = 's3';
  const second = draft.routes.find(item => item.id === 'route-s2')!;
  second.toId = 'market';
  draft.routes.push({id: 'fork', fromId: 's1', toId: 's2', materialId: 'output-s1'});
  return configFromDraft(base, draft);
}
function memory() {
  const records = new Map<string, string>();
  return {get length() {return records.size;}, key: (index: number) => [...records.keys()][index] ?? null,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {records.set(key, value);}, removeItem: (key: string) => {records.delete(key);}};
}
describe('editable process connections', () => {
  it('runs a fork through the existing engine and preserves conditions and identities', () => {
    const config = branch(), before = structuredClone(config);
    const run = compileEditableProcess(config), snapshot = new Simulation(run).runToEnd();
    expect(snapshot).toEqual(new Simulation(compileConfig(config)).runToEnd());
    expect(snapshot.line!.counters.filter(item => ['output-s2', 'output-s3'].includes(item.materialId)).every(item => item.sold > 0)).toBe(true);
    expect(configFromDraft(config, processDraft(config))).toEqual(config);
    expect(config).toEqual(before);
    expect(() => compileLinearProcess(config)).toThrow(ConfigError);
    expect(() => moveLinearStation(config, 's2', 1)).toThrow(ConfigError);
  });
  it('persists a graph, reopens it and round trips layout and calculation results through JSON', () => {
    const config = branch(), storage = memory(), store = openProcessStorage(() => storage);
    const layout = {positions: [{id: 's3', x: 400, y: 300}]};
    expect(store.save('graph', config, 0, layout).persisted).toBe(true);
    const record = openProcessStorage(() => storage).list()[0]!.record;
    const imported = parseProcessDocument(exportProcessJson(record.config, record.layout));
    expect(imported).toEqual({config, layout});
    expect(new Simulation(compileEditableProcess(imported.config)).runToEnd())
      .toEqual(new Simulation(compileEditableProcess(config)).runToEnd());
    const copy = copyImportedProcess(config, 'copy');
    copy.routes[0]!.toId = 's3';
    expect(config.routes[0]!.toId).toBe('s1');
  });
  it('keeps missing routes only in the draft and leaves the last saved graph intact', () => {
    const config = branch(), storage = memory(), store = openProcessStorage(() => storage);
    store.save('graph', config, 0);
    const draft = processDraft(config);
    draft.routes = draft.routes.filter(item => item.fromId !== 's1');
    expect(() => configFromDraft(config, draft)).toThrow(ConfigError);
    const incomplete = {...config, routes: draft.routes};
    expect(() => store.save('graph', incomplete, 1)).toThrow(ConfigError);
    expect(() => exportProcessJson(incomplete)).toThrow(ConfigError);
    expect(() => copyImportedProcess(incomplete, 'copy')).toThrow(ConfigError);
    expect(openProcessStorage(() => storage).list()[0]!.record).toMatchObject({revision: 1, config});
    expect(draft.routes.some(item => item.fromId === 's1')).toBe(false);
    expect(config).toEqual(branch());
  });
  it.each(['duplicate', 'producer', 'consumer', 'cycle', 'self', 'unknown'] as const)(
    'rejects %s routes with the shared bilingual configuration error', kind => {
      const config = branch(), draft = processDraft(config), route = draft.routes.find(item => item.id === 'fork')!;
      if (kind === 'duplicate') draft.routes.push({...route, id: 'duplicate'});
      if (kind === 'producer') route.fromId = 's3';
      if (kind === 'consumer') route.toId = 's1';
      if (kind === 'cycle') {
        draft.materials.find(item => item.id === 'output-s2')!.role = 'intermediate';
        draft.stations.find(item => item.id === 's1')!.inputs[0]!.materialId = 'output-s2';
        draft.routes.find(item => item.id === 'source-route')!.toId = 's3';
        draft.stations.find(item => item.id === 's3')!.inputs[0]!.materialId = 'raw';
        draft.routes = draft.routes.filter(item => item.id !== 'route-s1');
        draft.routes.find(item => item.id === 'route-s2')!.toId = 's1';
      }
      if (kind === 'self') route.toId = route.fromId;
      if (kind === 'unknown') route.toId = 'missing';
      try {configFromDraft(config, draft); throw new Error('Expected rejection');}
      catch (error) {expect(error).toBeInstanceOf(ConfigError); expect(error).toMatchObject({messages: {ru: expect.any(String), en: expect.any(String)}});}
    });
  it('renders every disconnected or cyclic draft node without traversing forever', () => {
    const config = createLinearProcess('draft'), draft = processDraft(config);
    draft.routes = [{id: 'loop', fromId: 's1', toId: 's1', materialId: 'output-s1'}];
    const nodes = layoutNodes({...config, routes: draft.routes}, {positions: []});
    expect(nodes.map(item => item.id).sort()).toEqual(['market', 's1', 's2', 's3', 'source']);
    const html = renderToStaticMarkup(createElement(ProcessCanvas,
      {config, draft, layout: {positions: []}, language: 'ru', locked: false, onChange: () => {}}));
    expect(html.match(/data-node-id=/g)).toHaveLength(5);
    expect(html.match(/data-route-id=/g)).toHaveLength(1);
  });
  it.each(['ru', 'en'] as const)('provides labelled connection forms in %s with safely escaped names', language => {
    const config = branch(), draft = processDraft(config);
    draft.stations[0]!.name = '<script>alert(1)</script>';
    const html = renderToStaticMarkup(createElement(ProcessRoutes, {config, draft, language, onChange: () => {}}));
    expect(html).toContain(language === 'ru' ? 'Добавить связь' : 'Add connection');
    expect(html.match(/<select/g)).toHaveLength(draft.routes.length * 3);
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
  });
});
