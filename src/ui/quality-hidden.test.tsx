import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {line} from '../engine/test-fixtures';
import {Runner} from '../runner/runner';
import {FlowDiagram} from './FlowDiagram';
import {labels} from './i18n';
it.each(['ru','en'] as const)('does not reveal an uninspected defect through colours, labels or text view in %s', language => {
  const markup = (probability: number) => {
    const c = line(); c.sources[0]!.availability = 'warehouse';
    c.stations[0]!.plan[0]!.processing.defectProbability = probability;
    const run = compileConfig(c), model = new Simulation(run).advanceTo(60_000), runner = new Runner(run);
    const uninspected = model.stocks.filter(s=>s.materialId==='part');
    expect(uninspected.length).toBeGreaterThan(0);
    expect(uninspected.every(s=>s.provenance.defective === !!probability)).toBe(true);
    const html = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(),model,status:'paused'}} text={labels(language)} reduced/>);
    runner.dispose(); return html;
  };
  expect(markup(1)).toBe(markup(0));
});
