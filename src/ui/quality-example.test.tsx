import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {Runner} from '../runner/runner';
import {previewConfig} from './preview';
import {defaultQuality, lostProcessingMs, minutesText, withQuality} from './quality';
import {FlowDiagram} from './FlowDiagram';
import {QualitySummary} from './QualitySummary';
import {labels} from './i18n';
const Q = 1_000_000;
const config = (position: 'early'|'late', source: 'prep'|'work' = 'prep', probability = 0.25) => withQuality(previewConfig('quality'), {...defaultQuality, position, source, probability});
const finish = (position: 'early'|'late', source: 'prep'|'work' = 'prep', probability = 0.25) => new Simulation(compileConfig(config(position, source, probability))).runToEnd();
const sold = (s: ReturnType<typeof finish>) => s.line!.counters.find(c => c.materialId === 'product')!.sold / Q;
it('calibrates the one-shift early/late example on the same seed and a fixed defect source', () => {
  const early = finish('early'), late = finish('late');
  expect(lostProcessingMs(early, 'work')).toBe(0n);
  expect(lostProcessingMs(late, 'work')).toBe(168n * 60_000n);
  expect(sold(early)).toBe(58);expect(sold(late)).toBe(38);
  for (const snapshot of [early, late]) for (const row of snapshot.line!.inspections) expect(row.checkedQuantity).toBe(row.passedQuantity + row.scrappedQuantity);
});
it('cannot protect against a defect created at Processing after early inspection', () => {
  const early = finish('early', 'work'), late = finish('late', 'work');
  expect(sold(early)).toBe(42);expect(sold(late)).toBe(42);
  expect(lostProcessingMs(early, 'work')).toBe(136n * 60_000n);expect(lostProcessingMs(late, 'work')).toBe(136n * 60_000n);
  expect(early.line!.inspections[0]!.scrappedQuantity).toBe(0);
  expect(early.line!.scraps.some(row => row.detectedAtId === 'market' && row.defectSourceIds.includes('work'))).toBe(true);
  expect(lostProcessingMs(early, 'work')).toBeGreaterThan(0n);
});
it.each(['early','late'] as const)('supports zero and complete defects with %s inspection', position => {
  const good = finish(position, 'prep', 0), bad = finish(position, 'prep', 1);
  expect(good.line!.scraps).toEqual([]); expect(sold(good)).toBeGreaterThan(0);
  expect(sold(bad)).toBe(0);expect(bad.line!.inspections[0]!.scrappedQuantity).toBeGreaterThan(0);
  expect(lostProcessingMs(bad, 'work') > 0n).toBe(position === 'late');
});
it('moves only the inspection material and routes, preserving the other station settings and seed', () => {
  const early = config('early');
  early.stations.find(s => s.id === 'qc')!.inputBuffer = {kind:'materials',materials:[{materialId:'prepared',capacity:{kind:'quantity',quantity:'7'}}]};
  const late = withQuality(early, {...defaultQuality, position:'late'});
  for (const id of ['prep','work','finish']) expect(late.stations.find(s=>s.id===id)).toEqual(early.stations.find(s=>s.id===id));
  expect(late.seed).toBe(early.seed); expect(late.calendar).toEqual(early.calendar); expect(late.durationMs).toBe(early.durationMs);
  expect(late.stations.find(s=>s.id==='qc')!.plan).toEqual(early.stations.find(s=>s.id==='qc')!.plan);
  expect(late.stations.find(s=>s.id==='qc')!.inputBuffer).toEqual({kind:'materials',materials:[{materialId:'processed',capacity:{kind:'quantity',quantity:'7'}}]});
  expect(()=>compileConfig(late)).not.toThrow();
});
it.each(['ru','en'] as const)('renders only detected losses and an inspection progress in %s', language => {
  const run = compileConfig(config('early', 'prep', 1)), runner = new Runner(run), simulation = new Simulation(run), text = labels(language);
  const before = simulation.advanceTo(3.5*60_000), after = simulation.advanceTo(4*60_000);
  const render = (model: typeof before) => renderToStaticMarkup(<><FlowDiagram run={run} view={{...runner.getView(), model, status:'paused'}} text={text} reduced/><QualitySummary run={run} view={{...runner.getView(), model, status:'paused'}} text={text}/></>);
  expect(before.stocks.some(s=>s.provenance.defective)).toBe(true);
  const htmlBefore = render(before), htmlAfter = render(after);
  expect(htmlBefore).toContain(text.inspecting); expect(htmlBefore).toContain(text.noDetectedScraps);
  expect(htmlBefore).toContain('data-scrap-quantity="0"');
  expect(htmlAfter).toContain('data-scrap-quantity="1000000"');expect(htmlAfter).toContain(text.detectedScraps);
  expect(htmlAfter).toContain('data-quality-lost-ms="0"');runner.dispose();
});
it('sums only attributed detected processing with exact bigint arithmetic', () => {
  const snapshot = structuredClone(finish('late'));
  expect(minutesText(60_000n)).toBe('1');expect(minutesText(1n)).toBe('0');expect(minutesText(90_000n)).toBe('1.5');
  expect(lostProcessingMs(snapshot, 'constructor')).toBe(0n);
  expect(lostProcessingMs(snapshot, 'work')).toBe(snapshot.line!.scraps.reduce((sum, s)=>sum+BigInt(s.processingMs.work ?? '0'),0n));
});

it.each(['ru','en'] as const)('keeps actual quality-example items indistinguishable until detection in %s', language => {
  const markup = (probability: number) => {
    const run = compileConfig(config('early','prep',probability)), runner = new Runner(run);
    const model = new Simulation(run).advanceTo(3.5*60_000);
    const html = renderToStaticMarkup(<><FlowDiagram run={run} view={{...runner.getView(),model,status:'paused'}} text={labels(language)} reduced/><QualitySummary run={run} view={{...runner.getView(),model,status:'paused'}} text={labels(language)}/></>);
    runner.dispose();return html;
  };
  expect(markup(0)).toBe(markup(1));
});
