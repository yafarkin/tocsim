import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileConfig } from '../engine/config';
import { Runner } from '../runner/runner';
import { Simulation } from '../engine/simulation';
import { blockedCyclicLine, cyclicLine } from '../engine/test-fixtures';
import { FIRST_X, NODE_GAP, fillRatio, graphLayout, quantityText, tokenFills } from './diagram';
import { previewConfig, exampleRuns } from './preview';
import { labels } from './i18n';
import { FlowDiagram, operationProgress, stationReason } from './FlowDiagram';

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
    expect(svg).toContain('Выход / Готово'); expect(svg).toContain('Без буфера');
    expect(svg).not.toMatch(/NaN|Infinity|0\/0/);
    expect(svg).toContain(`viewBox="0 0 ${FIRST_X + 3 * NODE_GAP + 130} 512"`);
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


it('uses the current cycle row profile and keeps every input route attached in RU/EN', () => {
  const run = compileConfig(cyclicLine()), runner = new Runner(run);
  const model = new Simulation(run).advanceTo(2 * 60_000);
  const view = {...runner.getView(), model, status: 'paused' as const};
  expect(model.stations[0]!.planIndex).toBe(1);
  const layout = graphLayout(run);
  expect(layout.paths.get('rawBRoute')!.y).toBeGreaterThan(layout.paths.get('r1')!.y);
  for (const language of ['ru', 'en'] as const) {
    const text = labels(language);
    const markup = renderToStaticMarkup(<FlowDiagram run={run} view={view} text={text} reduced/>);
    expect(markup).toContain(`2 ${text.minutes} ${text.perCycle}`);
    expect(markup).toContain('Raw B');
    expect(markup).toContain('data-sold-material="a"');
    expect(markup).toContain('data-sold-material="b"');
    expect(markup).not.toMatch(/NaN|Infinity/);
  }
  runner.dispose();
});


it('shows old buffered A, held A and every output route after the cursor has moved to B', () => {
  const run = compileConfig(blockedCyclicLine(true)), runner = new Runner(run);
  const model = new Simulation(run).advanceTo(4 * 60_000), layout = graphLayout(run);
  expect(model.stations[0]!.planIndex).toBe(1);
  expect(layout.paths.get('sellA')!.path).not.toBe(layout.paths.get('sellB')!.path);
  for (const language of ['ru', 'en'] as const) {
    const markup = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model, status: 'paused'}} text={labels(language)} reduced/>);
    expect(markup).toContain('data-output-material="a" data-output-quantity="1000000" data-held-quantity="1000000"');
    expect(markup).toContain('data-output-material="b" data-output-quantity="0" data-held-quantity="0"');
    expect(markup).toContain(`A: ${labels(language).output} 1, ${labels(language).readyOutput} 1`);
    expect(markup).toContain(`${labels(language).fullOutput}: Первый`);
    expect(markup).not.toMatch(/NaN|Infinity|0\/0/);
  }
  runner.dispose();
});

it('keeps multiple direct outputs named and expands row height for three or more output materials', () => {
  const config = cyclicLine();
  for (const id of ['c', 'd']) {
    config.materials.push({id, name: id.toUpperCase(), color: 'blue', role: 'finished', salePrice: '1'});
    config.recipes.push({id: `recipe-${id}`, name: id, kind: 'production', inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: id, quantity: '1'}});
    config.stations[0]!.plan.push({id: `row-${id}`, recipeId: `recipe-${id}`, batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: 60_000, cv: 0}});
    config.routes.push({id: `sell-${id}`, fromId: 's1', toId: 'market', materialId: id});
  }
  const run = compileConfig(config), runner = new Runner(run), layout = graphLayout(run);
  const markup = renderToStaticMarkup(<FlowDiagram run={run} view={runner.getView()} text={labels('en')} reduced/>);
  for (const id of ['a', 'b', 'c', 'd']) expect(markup).toContain(`data-output-material="${id}"`);
  expect(markup).not.toMatch(/NaN|Infinity|0\/0/);
  expect(layout.height).toBeGreaterThan(600);
  const starts = ['sellA', 'sellB', 'sell-c', 'sell-d'].map(id => layout.paths.get(id)!.path.split(' H ')[0]);
  expect(new Set(starts).size).toBe(4);
  runner.dispose();
});


it('labels setup separately from processing on the existing diagram in both languages', () => {
  const config = cyclicLine(); config.stations[0]!.setupMs = 7 * 60_000;
  const run = compileConfig(config), runner = new Runner(run);
  const model = new Simulation(run).advanceTo(2 * 60_000);
  for (const language of ['ru', 'en'] as const) {
    const text = labels(language);
    const html = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model}} text={text} reduced/>);
    expect(html).toContain('data-state="setup"');
    expect(html).toContain(text.setup);
    expect(stationReason(model.stations[0]!, run, text)).toContain(`${text.setup}: A → B`);
    expect(model.stations[0]!.progress).toBeNull();
    expect(html).not.toMatch(/NaN|Infinity/);
  }
  runner.dispose();
});

it('preserves setup progress and recipe details through lunch, night and language changes', () => {
  const config = cyclicLine(); config.durationMs += 86_400_000;
  config.stations[0]!.initialRecipeId = 'recipeB'; config.stations[0]!.setupMs = 500 * 60_000;
  const run = compileConfig(config), sim = new Simulation(run), runner = new Runner(run);
  for (const [time, reason, remaining] of [[240, 'lunch', 260], [300, null, 260], [540, 'offShift', 20], [1440, null, 20]] as const) {
    const model = sim.advanceTo(time * 60_000), station = model.stations[0]!;
    expect(station.remainingSetupMs).toBe(remaining * 60_000);
    expect(station.reason).toBe(reason);
    expect(operationProgress(station)).toBeCloseTo(1 - remaining / 500);
    const original = JSON.stringify(model);
    for (const language of ['ru', 'en'] as const) {
      const text = labels(language), detail = stationReason(station, run, text);
      expect(detail).toContain(`${text.setup}: B → A`);
      expect(detail).toContain(`${text.remaining}: ${remaining} ${text.minutes}`);
      if (reason) expect(detail).toContain(text[reason]);
      const html = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model}} text={text} reduced/>);
      expect(html).toContain(`${text.setup}: ${Math.round((1 - remaining / 500) * 100)}%`);
      expect(html).toContain(`data-setup-remaining-ms="${remaining * 60_000}"`);
      expect(html).not.toMatch(/NaN|Infinity/);
    }
    expect(JSON.stringify(model)).toBe(original);
  }
  const done = sim.advanceTo(1460 * 60_000).stations[0]!;
  expect(done.remainingSetupMs).toBeNull(); expect(operationProgress(done)).toBe(0);
  runner.dispose();
});

it('shows the current plan row, completed batches and specific missing recipe in both languages', () => {
  const config = previewConfig('plans', 0, 42, undefined, {batchesA: 2, batchesB: 1, setupMinutes: 7, supplyB: false});
  const run = compileConfig(config), sim = new Simulation(run), runner = new Runner(run);
  const first = sim.advanceTo(3 * 60_000), waiting = sim.advanceTo(6 * 60_000);
  for (const language of ['ru', 'en'] as const) {
    const text = labels(language);
    const active = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model: first}} text={text} reduced/>);
    expect(active).toContain(`${text.planRow} 1/2: ${text.recipeA}. ${text.rowBatches}: 1/2`);
    const starved = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model: waiting}} text={text} reduced/>);
    expect(starved).toContain(`${text.planRow} 2/2: ${text.recipeB}. ${text.rowBatches}: 0/1`);
    expect(stationReason(waiting.stations[0]!, run, text)).toBe(`${text.waitingForRecipe}: ${text.recipeB}. ${text.needs}: 1 ${text.rawB}`);
    expect(starved).toContain('data-plan-row="2"');
    expect(starved).not.toMatch(/NaN|Infinity/);
  }
  runner.dispose();
});

it('renders each output using its own capacity, including direct B beside buffered A', () => {
  const config = blockedCyclicLine(true);
  config.stations[0]!.outputBuffer = {kind: 'materials', materials: [
    {materialId: 'a', capacity: {kind: 'infinite'}},
    {materialId: 'b', capacity: {kind: 'quantity', quantity: '0'}},
  ]};
  const run = compileConfig(config), model = new Simulation(run).advanceTo(2 * 60_000), runner = new Runner(run);
  for (const language of ['ru', 'en'] as const) {
    const text = labels(language), html = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model}} text={text} reduced/>);
    expect(html).toContain(`A: ${text.output} 1 / ∞; ${text.readyOutput}: 0`);
    expect(html).toContain(`B: ${text.output} 0; ${text.readyOutput}: 0`);
    expect(html).toContain(text.direct);
    expect(html).not.toMatch(/NaN|Infinity|0\/0/);
  }
  runner.dispose();
});
