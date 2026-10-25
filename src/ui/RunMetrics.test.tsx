import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {line, cyclicLine} from '../engine/test-fixtures';
import {exampleIds, previewConfig} from './preview';
import {RunMetrics} from './RunMetrics';
import {labels} from './i18n';
const M = 60_000;
function oneStation() {
  const c = line(); c.stations = [c.stations[0]!]; c.stations[0]!.inputBuffer = {kind: 'infinite'};
  c.recipes = [c.recipes[0]!]; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
  c.materials = c.materials.filter(m => m.id !== 'product'); Object.assign(c.materials.find(m => m.id === 'part')!, {role: 'finished', salePrice: '0'});
  c.routes = [c.routes[0]!, {...c.routes[1]!, toId: 'market'}]; c.sources[0]!.availability = 'warehouse';
  c.initialStocks[0]!.quantity = '3'; return c;
}

describe('average stock and station-time tables', () => {
  it.each(['ru', 'en'] as const)('explains zero-time missing values and units in %s', language => {
    const run = compileConfig(oneStation()), text = labels(language), model = new Simulation(run).getSnapshot();
    const html = renderToStaticMarkup(<RunMetrics run={run} model={model} text={text}/>);
    expect(html).toContain(text.zeroObservationHelp); expect(html).toContain(text.notCalculated);
    expect(html).toContain(text.calendarPeriod); expect(html).toContain(text.commonWorkPeriod);
    expect(html).toContain(text.timeFormatHelp); expect(html).toContain(text.noOtherAveragePlaces);
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });
  it('shows an independently known average and exact period at a partial stop', () => {
    const run = compileConfig(oneStation()), sim = new Simulation(run); sim.advanceTo(2.5 * M); const model = sim.stop();
    const html = renderToStaticMarkup(<RunMetrics run={run} model={model} text={labels('en')}/>);
    expect(html).toContain('data-quantity-ms="330000000000" data-duration-ms="150000">2.2</td>');
    expect(html).toContain('data-period="calendar">0:02:30');
    expect(html).toContain('data-time-state="processingMs"><th scope="row">Processing time</th><td data-time-owner="s1" data-time-ms="150000">0:02:30');
    expect(html).toContain('data-time-state="total"');
  });
  it('distinguishes processing from occupancy and shows exact setup/lunch time', () => {
    const c = cyclicLine(); c.calendar = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 20 * M, shiftEndMs: 30 * M}; c.durationMs = 30 * M;
    c.stations[0]!.initialRecipeId = 'recipeB'; c.stations[0]!.setupMs = 7 * M;
    const run = compileConfig(c), model = new Simulation(run).runToEnd();
    const html = renderToStaticMarkup(<RunMetrics run={run} model={model} text={labels('ru')}/>);
    expect(html).toContain('data-share="processing">20%'); expect(html).toContain('data-share="busy">100%');
    expect(html).toContain('data-time-ms="960000">0:16:00'); expect(html).toContain('data-time-ms="600000">0:10:00');
    expect(html).toContain(labels('ru').stationTimeHelp);
  });
  it('shows per-station lunch replacement availability while preserving the common stock denominator', () => {
    const c = line(); c.stations[1]!.lunchReplacement = true;
    const run = compileConfig(c), model = new Simulation(run).advanceTo(4.5 * 60 * M);
    const html = renderToStaticMarkup(<RunMetrics run={run} model={model} text={labels('en')}/>);
    expect(html).toContain('data-time-station="s1" data-available-work-ms="14400000"');
    expect(html).toContain('data-time-station="s2" data-available-work-ms="16200000"');
    expect(html).toContain('data-work-ms="14400000"');
  });
  it('keeps historical average places after current stocks disappear and excludes the warehouse', () => {
    const c = oneStation(); c.initialStocks.push({id: 'warehouse-lot', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '7', cost: '0'});
    c.sources[0]!.intervalMs = 60 * M;
    const run = compileConfig(c), model = new Simulation(run).advanceTo(10 * M);
    const html = renderToStaticMarkup(<RunMetrics run={run} model={model} text={labels('en')}/>);
    expect(html).toContain('data-average-owner="s1"'); expect(html).not.toContain('data-average-owner="warehouse"');
    expect(html).toContain(labels('en').otherAveragePlacesHelp);
  });
  it.each(exampleIds)('renders both languages and independent material rows in %s', example => {
    const run = compileConfig(previewConfig(example)), model = new Simulation(run).runToEnd();
    for (const language of ['ru', 'en'] as const) {
      const text = labels(language), html = renderToStaticMarkup(<RunMetrics run={run} model={model} text={text}/>);
      for (const m of run.resolved.materials) expect(html).toContain(`data-average-material="${m.id}"`);
      expect(html).not.toMatch(/NaN|Infinity|undefined/);
      expect(html).toContain('tabindex="0" role="region"');
      expect(html).toContain('<caption>'); expect(html).toContain('scope="col"'); expect(html).toContain('scope="row"');
      expect(html).toContain(text.stateTimeHelp); expect(html).toContain(text.metricRoundingHelp.replace('<', '&lt;'));
    }
  });
});
