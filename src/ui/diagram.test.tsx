import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileConfig } from '../engine/config';
import { Runner } from '../runner/runner';
import { Simulation } from '../engine/simulation';
import { FIRST_X, NODE_GAP, fillRatio, graphLayout, quantityText, tokenFills } from './diagram';
import { previewConfig, exampleRuns } from './preview';
import { labels } from './i18n';
import { FlowDiagram, stationReason } from './FlowDiagram';

const previewRun = exampleRuns.blocking;

describe('diagram derived from configuration and snapshot', () => {
  it('follows route IDs rather than display array order', () => {
    const config = previewConfig(); config.stations.reverse(); config.materials.reverse(); config.routes.reverse();
    expect(graphLayout(compileConfig(config)).order).toEqual(['prep', 'work', 'finish']);
  });
  it('bounds queue glyphs while retaining fractions and exact labels', () => {
    expect(tokenFills(0)).toEqual([]); expect(tokenFills(1_500_000)).toEqual([1, 0.5]);
    expect(tokenFills(Number.MAX_SAFE_INTEGER)).toHaveLength(6);
    expect(quantityText(Number.MAX_SAFE_INTEGER)).toBe('9007199254.740991');
    expect(quantityText('18014398509481982')).toBe('18014398509.481982');
    expect(fillRatio(0, {kind: 'quantity', quantity: 0})).toBeNull();
    expect(fillRatio(1, {kind: 'infinite'})).toBeNull();
  });
  it('shows actual blockage, missing material, quantities and an alternative text view', () => {
    const model = new Simulation(previewRun).advanceTo(46 * 60_000);
    const runner = new Runner(previewRun);
    const view = {...runner.getView(), model, status: 'paused' as const};
    const svg = renderToStaticMarkup(<FlowDiagram run={previewRun} view={view} text={labels('ru')} reduced/>);
    expect(svg).toContain('Заполнен вход: Обработка');
    expect(svg).toContain('Не хватает: 1 Обработанная деталь');
    expect(svg).toContain('Текстовое представление');
    expect(svg).toContain('На посту'); expect(svg).toContain('Без буфера');
    expect(svg).not.toMatch(/NaN|Infinity|0\/0/);
    expect(svg).toContain(`viewBox="0 0 ${FIRST_X + 3 * NODE_GAP + 130} 480"`);
    runner.dispose();
  });
  it('translates state and material reasons without changing model data', () => {
    const model = new Simulation(previewRun).advanceTo(46 * 60_000);
    const hash = model.calculationHash;
    expect(stationReason(model.stations.find(s => s.stationId === 'prep')!, previewRun, labels('en'))).toBe('Input full: Processing');
    expect(stationReason(model.stations.find(s => s.stationId === 'finish')!, previewRun, labels('en'))).toBe('Missing: 1 Processed part');
    expect(model.calculationHash).toBe(hash);
  });
});


describe('layered flow diagram', () => {
  it('shows every split route, receiver priority and both blockers in RU/EN', () => {
    const run = exampleRuns.split, runner = new Runner(run);
    const simulation = new Simulation(run);
    let model = simulation.advanceTo(9 * 60_000);
    // Inspect an actual blocked timestamp in this technical example.
    while (model.stations.find(s => s.stationId === 'prep')!.status !== 'blocked' && simulation.nextEventTime() !== null) {simulation.step(); model = simulation.getSnapshot();}
    const view = {...runner.getView(), model, status: 'paused' as const};
    const layout = graphLayout(run);
    expect(layout.nodes.get('work')!.x).toBe(layout.nodes.get('finish')!.x);
    expect(layout.nodes.get('work')!.y).not.toBe(layout.nodes.get('finish')!.y);
    for (const language of ['ru', 'en'] as const) {
      const svg = renderToStaticMarkup(<FlowDiagram run={run} view={view} text={labels(language)} reduced/>);
      for (const route of run.resolved.routes) expect(svg).toContain(`data-route="${route.id}"`);
      expect(svg).toContain(`${labels(language).priority}: 10`);
      expect(svg).toContain(`${labels(language).fullInput}: ${labels(language).work}`);
      expect(svg).toContain(`${labels(language).fullInput}: ${labels(language).finish}`);
      expect(svg).not.toMatch(/NaN|Infinity/);
    }
    runner.dispose();
  });
  it('lays out multiple sources and long edges outside station rows, independent of array order', () => {
    const config = previewConfig('queue');
    config.sources.push({...config.sources[0]!, id: 'secondSource'});
    config.routes.push({id: 'secondSourceRoute', fromId: 'secondSource', toId: 'prep', materialId: 'raw'});
    // Extend one branch so the other market route skips a column.
    const station = structuredClone(config.stations[0]!); station.id = 'extra'; station.plan[0]!.id = 'extraPlan'; station.plan[0]!.recipeId = 'extraRecipe';
    config.recipes.push({id: 'extraRecipe', name: 'Extra', kind: 'production', inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: 'processed', quantity: '1'}});
    config.stations.push(station);
    config.routes.push({id: 'toExtra', fromId: 'source', toId: 'extra', materialId: 'raw'}, {id: 'extraFinish', fromId: 'extra', toId: 'finish', materialId: 'processed'});
    const run = compileConfig(config), layout = graphLayout(run), runner = new Runner(run);
    const svg = renderToStaticMarkup(<FlowDiagram run={run} view={runner.getView()} text={labels('en')} reduced/>);
    expect(layout.paths.get('extraFinish')!.path).toContain(' V ');
    expect(layout.height).toBeGreaterThan(900);
    expect(layout.nodes.get('secondSource')!.y).not.toBe(layout.nodes.get('source')!.y);
    for (const node of layout.nodes.values()) {expect(node.x).toBeGreaterThanOrEqual(0); expect(node.y).toBeGreaterThanOrEqual(0);}
    config.stations.reverse(); config.routes.reverse(); config.sources.reverse();
    expect(graphLayout(compileConfig(config))).toEqual(layout);
    expect(svg).toContain('secondSource'); expect(svg).not.toMatch(/NaN|Infinity/);
    runner.dispose();
  });
});


describe('assembly diagram', () => {
  it('shows both material queues, exact missing components and reserved quantities in RU/EN', () => {
    const run = exampleRuns.assembly, simulation = new Simulation(run), runner = new Runner(run);
    const waiting = simulation.advanceTo(8 * 60_000), layout = graphLayout(run);
    const station = waiting.stations.find(s => s.stationId === 'assembly')!;
    expect(station.status).toBe('starved');
    expect(station.inputs.find(input => input.materialId === 'processed')!.missingQuantity).toBe(1_000_000);
    expect(layout.paths.get('prep-assembly')!.y).not.toBe(layout.paths.get('work-assembly')!.y);
    for (const language of ['ru', 'en'] as const) {
      const text = labels(language), reason = stationReason(station, run, text);
      expect(reason).toBe(`${text.needs}: 1 ${text.processed}`);
      const svg = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model: waiting, status: 'paused'}} text={text} reduced/>);
      expect(svg).toContain('data-input-material="prepared"'); expect(svg).toContain('data-input-material="processed"');
      expect(svg).toContain(text.assembly); expect(svg).toContain(text.reserved);
      expect(svg).not.toMatch(/NaN|Infinity/);
    }
    const started = simulation.advanceTo(16 * 60_000);
    const inputs = started.stations.find(s => s.stationId === 'assembly')!.inputs;
    expect(inputs.find(input => input.materialId === 'prepared')!.reservedQuantity).toBe(1_000_000);
    expect(inputs.find(input => input.materialId === 'processed')!.reservedQuantity).toBe(2_000_000);
    runner.dispose();
  });
});

describe('batch diagram', () => {
  it('distinguishes reserved inputs, a current repetition, accumulated output and a missing full batch', () => {
    const run = exampleRuns.batches, model = new Simulation(run).advanceTo(9 * 60_000), runner = new Runner(run);
    expect(model.stations.find(s => s.stationId === 'prep')).toMatchObject({transferReady: false, inputs: [{reservedQuantity: 4_000_000}], output: {heldQuantity: 2_000_000}});
    for (const language of ['ru', 'en'] as const) {
      const text = labels(language), svg = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model, status: 'paused'}} text={text} reduced/>);
      expect(svg).toContain(`${text.reserved}: 4`);
      expect(svg).toContain(`${text.repetition} 3/6: 0%`);
      expect(svg).toContain(`${text.readyOutput}: <tspan class="quantity">2</tspan>`);
      expect(svg).toContain(`${text.accumulating}: 2 / 3`);
      expect(svg).toContain(`${text.needs}: 6 ${text.prepared}`);
      expect(svg).toContain(`${text.batch} 6, ${text.thresholdShort} 3`);
      expect(svg).not.toContain('class="tiny batch-output-released"');
      expect(svg).not.toMatch(/NaN|Infinity/);
    }
    runner.dispose();
  });
  it('shows a blocked partial remainder as awaiting unload with its actual destination', () => {
    const c = previewConfig('batches'); c.stations[0]!.plan[0]!.processing.mode = 'simultaneous';
    const run = compileConfig(c), simulation = new Simulation(run), runner = new Runner(run);
    let model = simulation.advanceTo(0);
    while (model.stations.find(s => s.stationId === 'prep')!.status !== 'blocked' && simulation.nextEventTime() !== null) {simulation.step(); model = simulation.getSnapshot();}
    expect(model.stations.find(s => s.stationId === 'prep')!.transferReady).toBe(true);
    for (const language of ['ru', 'en'] as const) {
      const text = labels(language), svg = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model, status: 'paused'}} text={text} reduced/>);
      expect(svg).toContain(text.awaitingUnload);
      expect(svg).toContain(`${text.fullInput}: ${text.work}`);
      expect(svg).toContain(`2 ${text.minutes} ${text.perCycle}`);
      expect(svg).toContain('data-transfer-ready="true"');
    }
    runner.dispose();
  });
  it('shows a simultaneous cycle without inventing early output or animation while paused', () => {
    const c = previewConfig('batches'); c.stations[0]!.plan[0]!.processing.mode = 'simultaneous';
    const run = compileConfig(c), model = new Simulation(run).advanceTo(6 * 60_000), runner = new Runner(run);
    const station = model.stations.find(s => s.stationId === 'prep')!;
    expect(station).toMatchObject({progress: 0.5, output: {heldQuantity: 0}, inputs: [{reservedQuantity: 6_000_000}]});
    const svg = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model, status: 'paused'}} text={labels('en')} reduced={false}/>);
    expect(svg).toContain('Cycle: 50%'); expect(svg).toContain('Reserved: 6');
    expect(svg).not.toContain('<animateMotion');
    runner.dispose();
  });
});
