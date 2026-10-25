import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {constraintFactsReport} from '../engine/constraint-facts';
import {Runner} from '../runner/runner';
import {ConstraintReport} from './ConstraintReport';
import {RunSummary} from './RunSummary';
import {exampleIds, previewConfig} from './preview';
import {labels} from './i18n';
import {averageText, durationText, percentText} from './metric-format';
import {quantityText} from './diagram';

describe('constraint evidence visible report', () => {
  it.each(exampleIds.flatMap(id => (['ru','en'] as const).flatMap(language => [0, 150_000, 32_400_000].map(time => ({id, language, time})))))('$id $language at $time displays existing facts without mixed material totals', ({id, language, time}) => {
    const run = compileConfig(previewConfig(id)), sim = new Simulation(run); sim.advanceTo(time);
    const model = sim.getSnapshot(), before = JSON.stringify(model), facts = constraintFactsReport(run, model), text = labels(language);
    const html = renderToStaticMarkup(<ConstraintReport run={run} model={model} text={text}/>);
    expect(JSON.stringify(model)).toBe(before);
    expect(html).toContain(`data-constraint-complete="${facts.complete}"`);
    expect(html.includes(text.incompleteResult)).toBe(!facts.complete);
    for (const value of [text.constraintHelp, text.constraintPeriod, text.constraintQueueHelp, text.constraintTrend, text.constraintStep1, text.constraintStep3, text.constraintExperimentHelp]) expect(html).toContain(value);
    expect(html).toContain(`${durationText(0)} → ${durationText(model.timeMs)}`);
    expect((html.match(/data-constraint-station=/g) ?? []).length).toBe(facts.stations.length);
    expect((html.match(/data-constraint-material=/g) ?? []).length).toBe(facts.stations.reduce((n,s) => n+s.inputQueues.length, 0));
    for (const station of facts.stations) {
      const section = html.split(`data-constraint-station="${station.stationId}"`)[1]!.split('</section>')[0]!;
      expect(section).not.toContain('data-constraint-product');
      expect(section).toContain(`data-constraint-available="${station.availableWorkMs}"`);
      expect(section).toContain(`data-constraint-share="busyShare">${percentText(station.busyShare,text.notCalculated)}`);
      for (const queue of station.inputQueues) {
        const row = section.split(`data-constraint-material="${queue.materialId}"`)[1]!.split('</tr>')[0]!;
        expect(row).toContain(`data-constraint-quantity="${queue.quantity}">${quantityText(queue.quantity)}`);
        expect(row).toContain(`data-constraint-average="calendar">${averageText(queue.calendarAverage,text.notCalculated).replaceAll('<','&lt;')}`);
        expect(row).toContain(`data-constraint-average="work">${averageText(queue.workAverage,text.notCalculated).replaceAll('<','&lt;')}`);
      }
      for (const [key,value] of Object.entries(station.timeByState)) expect(section).toContain(`data-constraint-state="${key}" data-time-ms="${value}">${durationText(value)}`);
    }
    for (const product of facts.products) expect(html).toContain(`data-constraint-product="${product.materialId}">${quantityText(product.delivered)}`);
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
