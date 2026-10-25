import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {constraintFactsReport} from '../engine/constraint-facts';
import {Runner} from '../runner/runner';
import {RunMetrics} from './RunMetrics';
import {stockTimeReport} from '../engine/stock-time';
import {RunSummary} from './RunSummary';
import {exampleIds, previewConfig} from './preview';
import {labels} from './i18n';
import {averageText, durationText, percentText} from './metric-format';
import {quantityText} from './diagram';

describe('constraint evidence visible report', () => {
  it.each(exampleIds.flatMap(id => (['ru','en'] as const).flatMap(language => [0, 150_000, 32_400_000].map(time => ({id, language, time})))))('$id $language at $time displays existing facts without mixed material totals', ({id, language, time}) => {
    const run = compileConfig(previewConfig(id)), sim = new Simulation(run); sim.advanceTo(time);
    const model = sim.getSnapshot(), before = JSON.stringify(model), facts = constraintFactsReport(run, model), text = labels(language);
    const html = renderToStaticMarkup(<RunMetrics run={run} model={model} text={text}/>);
    expect(JSON.stringify(model)).toBe(before);
    expect(html).toContain(`data-constraint-complete="${facts.complete}"`);
    expect(html.includes(text.incompleteResult)).toBe(!facts.complete);
    for (const value of [text.constraintHelp, text.constraintPeriod, text.constraintQueueHelp, text.constraintTrend, text.constraintStep1, text.constraintStep3, text.constraintExperimentHelp]) expect(html).toContain(value);
    expect(html).toContain(`${durationText(0)} → ${durationText(model.timeMs)}`);
    expect((html.match(/data-time-station=/g) ?? []).length).toBe(facts.stations.length);
    expect((html.match(/data-constraint-material=/g) ?? []).length).toBe(facts.stations.reduce((n,s) => n+s.inputQueues.length, 0));
    for (const station of facts.stations) {
      const stationRow = html.split(`data-time-station="${station.stationId}"`)[1]!.split('</tr>')[0]!;
      expect(stationRow).toContain(`data-available-work-ms="${station.availableWorkMs}"`);
      expect(stationRow).toContain(`data-share="busy">${percentText(station.busyShare,text.notCalculated)}`);
      for (const queue of station.inputQueues) {
        const row = html.split(`data-constraint-station="${station.stationId}" data-constraint-material="${queue.materialId}"`)[1]!.split('</tr>')[0]!;
        expect(row).toContain(`data-constraint-quantity="${queue.quantity}">${quantityText(queue.quantity)}`);
        expect(row).toContain(`data-constraint-average="calendar">${averageText(queue.calendarAverage,text.notCalculated).replaceAll('<','&lt;')}`);
        expect(row).toContain(`data-constraint-average="work">${averageText(queue.workAverage,text.notCalculated).replaceAll('<','&lt;')}`);
      }
      for (const [key,value] of Object.entries(station.timeByState)) {
        const stateRow = html.split(`data-time-state="${key}"`)[1]!.split('</tr>')[0]!;
        expect(stateRow).toContain(`data-time-owner="${station.stationId}" data-time-ms="${value}">${durationText(value)}`);
      }
    }
    expect(html).not.toContain('data-constraint-product');
    expect(html).toContain('href="#output-summary-toggle"');
    // Input histories live in the queue table; every other historical location remains available.
    const places = stockTimeReport(run, model).places;
    expect((html.match(/data-average-owner=/g) ?? []).length).toBe(places.filter(p => p.location !== 'input').length);
    expect(html).not.toContain('data-average-location="input"');
    for (const place of places.filter(p => p.location !== 'input')) {
      expect(html).toContain(`data-average-owner="${place.ownerId}" data-average-place-material="${place.materialId}" data-average-location="${place.location}"`);
    }
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).toContain('tabindex="0" role="region"');expect(html).toContain('scope="col"');expect(html).toContain('scope="row"');
  });
  it('keeps whole-run facts with warmup and integrates the report into paused, stopped and repeated runs', () => {
    const config = previewConfig('assembly');config.warmupMs=60_000;
    const run=compileConfig(config), runner=new Runner(run);
    runner.step();
    const paused=runner.getView();
    const render=()=>renderToStaticMarkup(<RunSummary run={run} view={runner.getView()} text={labels('en')} language="en"/>);
    expect(render()).toContain('data-testid="constraint-report"');
    runner.stop();expect(render()).toContain('data-constraint-complete="false"');
    expect(runner.getView().model.timeMs).toBe(paused.model.timeMs);
    runner.dispose();
    const repeat=new Runner(run);expect(repeat.getView().model.timeMs).toBe(0);repeat.dispose();
  });
});
