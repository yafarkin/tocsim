import {describe, expect, it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Simulation} from '@toc/engine';
import {compileEditableProcess, createLinearProcess} from './linear-process';
import {configFromDraft, processDraft} from './process-form';
import {connectProcessNodes, connectionIssue, nextConnectionId} from './process-connections';
import {ProcessCanvas} from './ProcessCanvas';
import {exportProcessJson, parseProcessDocument} from './process-json';

describe('canvas connections', () => {
  it('repairs an incomplete graph without modifying other draft fields, route IDs or the base configuration', () => {
    const config = createLinearProcess('canvas'), draft = processDraft(config);
    const original = structuredClone(config), previous = structuredClone(draft.routes);
    draft.routes = draft.routes.filter(item => item.fromId !== 's1');
    draft.name = 'Repaired'; draft.stations[0]!.minutes = '4';
    const before = structuredClone(draft);
    const routes = connectProcessNodes(config, draft, 's1', 's2');
    expect(draft).toEqual(before); expect(config).toEqual(original);
    expect(routes.slice(0, -1)).toEqual(previous.filter(item => item.fromId !== 's1'));
    expect(routes.at(-1)).toMatchObject({fromId: 's1', toId: 's2', materialId: 'output-s1'});
    const repaired = configFromDraft(config, {...draft, routes});
    expect(repaired.name).toBe('Repaired');
    expect(repaired.stations[0]!.plan[0]!.processing.timeMs).toBe(240_000);
    const imported = parseProcessDocument(exportProcessJson(repaired)).config;
    expect(new Simulation(compileEditableProcess(imported)).runToEnd())
      .toEqual(new Simulation(compileEditableProcess(repaired)).runToEnd());
    routes[0]!.toId = 'mutated'; expect(draft.routes[0]!.toId).toBe('s1');
  });
  it('can build a complete process from empty route drafts and preserves the existing result', () => {
    const config = createLinearProcess('canvas'), draft = processDraft(config);
    draft.routes = [];
    for (const [from, to] of [['source', 's1'], ['s1', 's2'], ['s2', 's3'], ['s3', 'market']]) {
      draft.routes = connectProcessNodes(config, draft, from!, to!);
    }
    const restored = configFromDraft(config, draft);
    const actual = new Simulation(compileEditableProcess(restored)).runToEnd();
    const expected = new Simulation(compileEditableProcess(config)).runToEnd();
    // Recreated route IDs belong to the calculation hash; all simulated state must agree.
    expect(actual).toEqual({...expected, calculationHash: actual.calculationHash});
  });
  it.each([
    ['s1', 's1', 'самим собой'], ['source', 's1', 'уже есть'], ['s1', 's3', 'не совпадает'],
    ['s1', 'market', 'Готовый продукт'], ['missing', 's1', 'Выберите выход'], ['s3', 'warehouse', 'Выберите выход'],
  ])('rejects %s → %s without changing the draft', (from, to, message) => {
    const config = createLinearProcess('canvas'), draft = processDraft(config), before = structuredClone(draft);
    expect(connectionIssue(config, draft, from!, to!)).toMatchObject({ru: expect.stringContaining(message!), en: expect.any(String)});
    expect(() => connectProcessNodes(config, draft, from!, to!)).toThrow();
    expect(draft).toEqual(before);
  });
  it('rejects a new cycle even when the rest of the draft is incomplete or already cyclic', () => {
    const config = createLinearProcess('canvas'), draft = processDraft(config);
    draft.stations[0]!.inputMaterialId = 'output-s2';
    draft.routes = [{id: 'a', fromId: 's1', toId: 's2', materialId: 'output-s1'},
      {id: 'existing-loop', fromId: 's3', toId: 's3', materialId: 'output-s3'}];
    expect(connectionIssue(config, draft, 's2', 's1')).toMatchObject({ru: 'Эта связь создаст цикл.'});
    // An unrelated existing cycle must not make the reachability check loop forever.
    draft.stations[2]!.inputMaterialId = 'output-s1';
    expect(connectionIssue(config, draft, 's1', 's3')).toBeNull();
  });
  it('allocates one namespace for form and canvas IDs, including unsaved routes', () => {
    const config = createLinearProcess('connection-1'), draft = processDraft(config);
    draft.routes[0]!.id = 'connection-2';
    expect(nextConnectionId(config, draft.routes)).toBe('connection-3');
  });
  it.each(['ru', 'en'] as const)('renders focusable ports even for disconnected nodes and disables them while locked in %s', language => {
    const config = createLinearProcess('canvas'), draft = processDraft(config); draft.routes = [];
    const props = {config, draft, layout: {positions: []}, language, locked: false, onChange: () => {}, onRoutesChange: () => {}};
    const html = renderToStaticMarkup(createElement(ProcessCanvas, props));
    expect(html.match(/data-connect-from=/g)).toHaveLength(4);
    expect(html.match(/data-connect-to=/g)).toHaveLength(4);
    expect(html).toContain(language === 'ru' ? 'Соединить из: Источник' : 'Connect from: Источник');
    const locked = renderToStaticMarkup(createElement(ProcessCanvas, {...props, locked: true}));
    expect(locked.match(/data-connect-(?:from|to)="[^"]+"[^>]*disabled=""/g)).toHaveLength(8);
  });
});
