import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig, ConfigError} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {Runner} from '../runner/runner';
import {previewConfig} from './preview';
import {lunchFromDraft, lunchStatus, withLunch} from './lunch';
import {LunchPanel} from './LunchPanel';
import {FlowDiagram} from './FlowDiagram';
import {labels} from './i18n';
const M = 60_000;
it('applies independent station settings without changing buffers, plans or the source config', () => {
  const source = previewConfig('queue'), before = compileConfig(source);
  const a = withLunch(source, {work: lunchFromDraft(true, ' 12,5 ', 'work')});
  const b = withLunch(a, {prep: lunchFromDraft(true, '.2', 'prep')});
  const run = compileConfig(b);
  expect(source.stations.every(s => !s.lunchReplacement)).toBe(true);
  expect(run.resolved.stations.find(s => s.id === 'work')).toMatchObject({lunchReplacement: true, costs: {perLunchHour: 12500000n}});
  expect(run.resolved.stations.find(s => s.id === 'prep')).toMatchObject({lunchReplacement: true, costs: {perLunchHour: 200000n}});
  expect(run.source.stations.find(s => s.id === 'work')!.plan).toEqual(before.source.stations.find(s => s.id === 'work')!.plan);
  expect(run.source.stations.map(s => s.inputBuffer)).toEqual(before.source.stations.map(s => s.inputBuffer));
  expect(compileConfig(withLunch(b, {work: lunchFromDraft(false, '0', 'work')})).resolved.stations.find(s => s.id === 'work')!.lunchReplacement).toBe(false);
});
it.each(['', '-1', 'NaN', 'Infinity', '1.0000001', '9007199255'])('rejects an invalid lunch rate %j in both languages', rate => {
  try {lunchFromDraft(true, rate, 'work'); throw new Error('Expected invalid rate');} catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    expect(error).toMatchObject({path: 'ui.work.lunch.hourlyRate', messages: {ru: labels('ru').lunchRateError, en: labels('en').lunchRateError}});
  }
});
it.each(['ru', 'en'] as const)('shows active lunch and actual charges from the snapshot in %s', language => {
  const run = compileConfig(withLunch(previewConfig('queue'), {work: {enabled: true, hourlyRate: '12'}}));
  const sim = new Simulation(run), runner = new Runner(run), text = labels(language);
  const model = sim.advanceTo(250 * M), state = model.stations.find(s => s.stationId === 'work')!;
  expect(lunchStatus(state, run, model.timeMs, text)).toBe(text.lunchActive);
  expect(state).toMatchObject({lunchBusyMs: 10 * M, lunchCost: '2000000'});
  const markup = renderToStaticMarkup(<FlowDiagram run={run} view={{...runner.getView(), model, status: 'paused'}} text={text} reduced/>);
  expect(markup).toContain(text.lunchActive); expect(markup).toContain(text.lunchOff);
  expect(markup).toContain(`${text.lunchBusy}: 10 ${text.minutes}`);
  expect(markup).toContain(`${text.lunchCharge}: 2 ${text.moneyUnit}`);
  expect(markup).toContain('data-lunch-busy-ms="600000"'); expect(markup).not.toMatch(/NaN|Infinity/);
  const end = sim.runToEnd();
  expect(lunchStatus(end.stations.find(s => s.stationId === 'work')!, run, end.timeMs, text)).toBe(text.lunchOn);
  const panel = renderToStaticMarkup(<LunchPanel run={run} locked text={text} language={language} onApply={() => {}}/>);
  expect(panel).toContain(text.lunchStation); expect(panel).toContain(text.lunchRate); expect(panel).toContain('disabled=""');
  runner.dispose();
});
it.each(['setup', 'maintenance'] as const)('identifies %s in lunch without claiming that a paused or starved station is working', operation => {
  const c = previewConfig(operation === 'setup' ? 'plans' : 'batches');
  c.stations[0]!.lunchReplacement = true;
  if (operation === 'setup') c.stations[0]!.setupMs = 260 * M;
  else c.stations[0]!.maintenance = {enabled: true, durationMs: 260 * M, repetitionsThreshold: 1};
  const run = compileConfig(c), sim = new Simulation(run), model = sim.advanceTo(250 * M), state = model.stations.find(s => s.stationId === c.stations[0]!.id)!;
  expect(state.status).toBe(operation);
  for (const lang of ['ru', 'en'] as const) {
    expect(lunchStatus(state, run, model.timeMs, labels(lang))).toBe(labels(lang).lunchActive);
    expect(lunchStatus({...state, status: 'starved'}, run, model.timeMs, labels(lang))).toBe(labels(lang).lunchOn);
  }
});
