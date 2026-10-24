import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import type {Snapshot} from '../engine/state';
import {line} from '../engine/test-fixtures';
import {exampleIds, previewConfig} from './preview';
import {FlowTimeReport} from './FlowTimeReport';
import {RunSummary} from './RunSummary';
import {Runner} from '../runner/runner';
import {labels} from './i18n';
const M = 60_000;
function single() {
  const c = line(); c.stations = [c.stations[0]!]; c.initialStocks = [];
  c.stations[0]!.inputBuffer = {kind: 'infinite'};
  c.materials = c.materials.filter(m => m.id !== 'part');
  c.recipes = [{id: 'cut', name: 'One', kind: 'production', inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: 'product', quantity: '1'}}];
  c.routes = [c.routes[0]!, {id: 'sale', fromId: 's1', toId: 'market', materialId: 'product'}];
  c.sources[0]!.quantity = '3'; c.sources[0]!.intervalMs = 60 * M;
  return c;
}

describe('flow time and stock age visible report', () => {
  it.each(['ru', 'en'] as const)('shows missing means with the two beginnings, scales and quantities in %s', language => {
    const run = compileConfig(single()), text = labels(language), model = new Simulation(run).getSnapshot();
    const html = renderToStaticMarkup(<FlowTimeReport run={run} model={model} text={text}/>);
    for (const label of [text.fromAdmission, text.fromFirstProcessing, text.meanCalendarTime, text.meanCommonWorkTime,
      text.includedOutputCount, text.unknownStartCount, text.unstartedAgeCount, text.currentStockAgeHelp, text.ageCategoriesHelp, text.flowTimeScalesHelp]) expect(html).toContain(label);
    expect(html).toContain(text.notCalculated); expect(html).toContain(text.noGoodOutput); expect(html).toContain(text.noPhysicalStock);
    expect(html).not.toMatch(/NaN|Infinity|undefined|\(0%\)/);
    expect(html).toContain('tabindex="0" role="region"'); expect(html).toContain('scope="row"'); expect(html).toContain('scope="col"');
  });

  it('renders independent known completed means and current ages at a partial stop', () => {
    const run = compileConfig(single()), sim = new Simulation(run); sim.advanceTo(2.5 * M); const model = sim.stop();
    const html = renderToStaticMarkup(<FlowTimeReport run={run} model={model} text={labels('en')}/>);
    // First two products leave at minutes 1 and 2; the remaining raw item started at minute 2.
    expect(html).toContain('data-flow-start="admission"><th scope="row">Product</th><td data-time-scale="calendar" data-quantity-ms="180000000000" data-known-quantity="2000000">0:01:30');
    expect(html).toContain('data-flow-start="firstProcessing"><th scope="row">Product</th><td data-time-scale="calendar" data-quantity-ms="120000000000" data-known-quantity="2000000">0:01:00');
    expect(html).toContain('data-age-start="firstProcessing"><th scope="row">Blank</th><td data-age-quantity="1000000">1</td><td data-time-scale="calendar" data-quantity-ms="30000000000" data-known-quantity="1000000">0:00:30');
    expect(html).toContain('data-count="known">2<small class="quantity-share"> (100%)');
  });

  it('shows unstarted future repetitions separately from known zero processing age', () => {
    const c = single(); c.stations[0]!.plan[0]!.processing.repetitions = 3; c.stations[0]!.transportThreshold = '3';
    const run = compileConfig(c), model = new Simulation(run).advanceTo(0);
    const html = renderToStaticMarkup(<FlowTimeReport run={run} model={model} text={labels('ru')}/>);
    expect(html).toContain('data-known-quantity="1000000">0:00:00');
    expect(html).toContain('data-count="notStarted">2<small class="quantity-share"> (≈ 66.7%)');
    expect(html).toContain('data-count="known">1<small class="quantity-share"> (≈ 33.3%)');
  });

  it('excludes unknown initial goods from means and shows the incomplete coverage', () => {
    const c = single(); c.stations[0]!.outputBuffer = {kind: 'infinite'};
    c.initialStocks = [{id: 'old-goods', ownerId: 's1', location: 'output', materialId: 'product', quantity: '1', cost: '0'}];
    const run = compileConfig(c), model = new Simulation(run).advanceTo(M);
    const html = renderToStaticMarkup(<FlowTimeReport run={run} model={model} text={labels('en')}/>);
    expect(html).toContain('data-count="known">1<small class="quantity-share"> (50%)');
    expect(html).toContain('data-count="unknown">1<small class="quantity-share"> (50%)');
    expect(html).toContain('data-quantity-ms="60000000000" data-known-quantity="1000000">0:01:00');
  });

  it('uses exact sums for display rather than approximate snapshot means', () => {
    const run = compileConfig(single()), model = structuredClone(new Simulation(run).advanceTo(M)) as Snapshot;
    model.line!.flowTime[0]!.admission.meanCalendarMs = 999_999;
    const html = renderToStaticMarkup(<FlowTimeReport run={run} model={model} text={labels('en')}/>);
    expect(html).toContain('data-quantity-ms="60000000000" data-known-quantity="1000000">0:01:00');
    expect(html).not.toContain('0:16:39.999');
  });

  it('does not expose hidden quality or include the raw warehouse in age tables', () => {
    const c = single(); c.sources[0]!.availability = 'warehouse'; c.initialStocks = [{id: 'warehouse-kit', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '7', cost: '0'}];
    const run = compileConfig(c), model = structuredClone(new Simulation(run).advanceTo(M / 2)) as Snapshot;
    const before = renderToStaticMarkup(<FlowTimeReport run={run} model={model} text={labels('en')}/>);
    for (const stock of model.stocks) {stock.provenance.defective = true; stock.provenance.defectSourceIds = ['secret-source'];}
    expect(renderToStaticMarkup(<FlowTimeReport run={run} model={model} text={labels('en')}/>)).toBe(before);
    expect(before).not.toContain('data-age-owner="warehouse"'); expect(before).not.toContain('secret-source');
  });

  it.each(exampleIds)('renders both languages across the observed lifecycle in %s', example => {
    const run = compileConfig(previewConfig(example)), sim = new Simulation(run), runner = new Runner(run);
    const models = [sim.getSnapshot(), sim.advanceTo(0), sim.advanceTo(300_123), sim.runToEnd()];
    for (const language of ['ru', 'en'] as const) for (const [i, status] of (['ready', 'running', 'paused', 'finished'] as const).entries()) {
      const text = labels(language), html = renderToStaticMarkup(<RunSummary run={run} view={{...runner.getView(), model: models[i]!, status}} text={text} language={language}/>);
      expect(html).toContain(text.flowTimeReport); expect(html).toContain(text.fromAdmission); expect(html).toContain(text.fromFirstProcessing);
      expect(html).toContain(i === 3 ? text.endedHorizon : text.incompleteResult);
      expect(html).not.toMatch(/NaN|Infinity|undefined/);
      for (const material of run.resolved.materials) expect(html).toContain(`data-age-material="${material.id}"`);
    }
    runner.dispose();
  });
});
