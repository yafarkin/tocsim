import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig, ConfigError} from '../engine/config';
import type {MaintenanceConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {Runner} from '../runner/runner';
import {previewConfig} from './preview';
import {withMaintenance, maintenanceFromDraft, maintenanceNotice, maintenanceCounters, maintenanceTime} from './maintenance';
import {MaintenancePanel} from './MaintenancePanel';
import {FlowDiagram, operationProgress, stationReason} from './FlowDiagram';
import {graphLayout} from './diagram';
import {labels} from './i18n';
const M = 60_000, DAY = 86_400_000;
function maintenanceRun(m: MaintenanceConfig = {enabled: true, durationMs: 15 * M, repetitionsThreshold: 2}) {
  const c = withMaintenance(previewConfig('batches'), 'prep', m);
  c.sources[0]!.availability = 'warehouse';
  c.initialStocks = [{id: 'initialKit', ownerId: 'prep', location: 'input', materialId: 'raw', quantity: '6', cost: '60'}];
  return c;
}
it('applies a validated UI draft without mutating the old configuration or changing buffers', () => {
  const draft = maintenanceFromDraft({enabled: true, duration: '15', hours: '0,05', repetitions: '10'}, 'prep');
  expect(draft).toEqual({enabled: true, durationMs: 15 * M, processingThresholdMs: 3 * M, repetitionsThreshold: 10});
  const c = previewConfig('batches'), before = compileConfig(c), after = compileConfig(withMaintenance(c, 'prep', draft));
  expect(c.stations[0]!.maintenance).toEqual({enabled: false});
  expect(after.resolved.stations.find(s => s.id === 'prep')!.inputBuffers).toEqual(before.resolved.stations.find(s => s.id === 'prep')!.inputBuffers);
  expect(after.source.stations[0]!.maintenance).toEqual(draft);
  expect(maintenanceFromDraft({enabled: false, duration: 'invalid', hours: '-1', repetitions: 'x'}, 'prep')).toEqual({enabled: false});
});
it.each([
  {duration: '-1', hours: '4', repetitions: '10'}, {duration: '0', hours: '4', repetitions: '10'},
  {duration: '15', hours: '0', repetitions: '0'}, {duration: '15', hours: '4', repetitions: '1.5'},
  {duration: '15', hours: '0.0000001', repetitions: '10'}, {duration: '9007199254740991', hours: '4', repetitions: '10'},
])('rejects invalid panel settings %j before applying', fields => {
  expect(() => compileConfig(withMaintenance(previewConfig('batches'), 'prep', maintenanceFromDraft({enabled: true, ...fields}, 'prep')))).toThrow(ConfigError);
});
it.each(['ru', 'en'] as const)('shows the threshold moment, batch deferral and both counters in %s', language => {
  const run = compileConfig(maintenanceRun()), sim = new Simulation(run), text = labels(language);
  const s = sim.advanceTo(4 * M).stations.find(s => s.stationId === 'prep')!;
  expect(maintenanceNotice(s, run, text)).toContain(text.maintenanceRequired);
  expect(maintenanceNotice(s, run, text)).toContain(text.maintenanceWaitBatch);
  expect(maintenanceNotice(s, run, text)).toContain('08:04:00');
  expect(maintenanceCounters(s, run, text)).toContain('2 / 2');
  const runner = new Runner(run); while (runner.getView().model.timeMs < 4 * M) runner.step();
  const html = renderToStaticMarkup(<FlowDiagram run={run} view={runner.getView()} text={text} reduced/>);
  expect(html).toContain(text.maintenanceRequired); expect(html).toContain(text.maintenanceWaitBatch);
  expect(graphLayout(run).height).toBeGreaterThan(graphLayout(compileConfig(previewConfig('batches'))).height);
  runner.dispose();
});
it.each(['ru', 'en'] as const)('renders maintenance progress, a calendar pause and the last deferral record in %s', language => {
  const text = labels(language), c = maintenanceRun(), run = compileConfig(c), sim = new Simulation(run);
  const active = sim.advanceTo(17 * M).stations.find(s => s.stationId === 'prep')!;
  expect(active.status).toBe('maintenance'); expect(operationProgress(active)).toBeCloseTo(1 / 3);
  expect(stationReason(active, run, text)).toContain('10');
  const long = maintenanceRun({enabled: true, durationMs: 233 * M, repetitionsThreshold: 6}), longRun = compileConfig(long), paused = new Simulation(longRun).advanceTo(240 * M).stations.find(s => s.stationId === 'prep')!;
  // With the initial kit, maintenance starts at 12 min and has five minutes left at lunch.
  expect(stationReason(paused, longRun, text)).toContain(text.lunch); expect(stationReason(paused, longRun, text)).toContain(text.maintenance);
  const night = maintenanceRun({enabled: true, durationMs: 500 * M, repetitionsThreshold: 6}); night.durationMs += DAY;
  const nightRun = compileConfig(night), nightStation = new Simulation(nightRun).advanceTo(540 * M).stations.find(s => s.stationId === 'prep')!;
  expect(stationReason(nightStation, nightRun, text)).toContain(text.offShift); expect(operationProgress(nightStation)).toBeGreaterThan(0);
  const runner = new Runner(run); runner.setSpeed('max'); while (runner.getView().model.timeMs < 27 * M) runner.step();
  const html = renderToStaticMarkup(<FlowDiagram run={run} view={runner.getView()} text={text} reduced/>);
  expect(html).toContain(text.maintenanceRecords); expect(html).toContain(text.maintenanceWaitBatch);
  expect(html).toContain('08:04:00'); expect(html).toContain('08:12:00'); expect(html).toContain('08:27:00');
  const panel = renderToStaticMarkup(<MaintenancePanel run={run} locked text={text} language={language} onApply={() => {}}/>);
  expect(panel).toContain(text.enableMaintenance); expect(panel).toContain(text.maintenanceHours); expect(panel).toContain(text.maintenanceRepeatLimit); expect(panel).toContain('disabled=""');
  runner.dispose();
});
it('identifies unloading rather than batch completion as the current wait and labels model days', () => {
  const c = maintenanceRun({enabled: true, durationMs: M, repetitionsThreshold: 1});
  c.stations[0]!.plan[0]!.processing.mode = 'simultaneous'; c.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '6'};
  c.initialStocks[0]!.quantity = '24'; c.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '24'};
  const run = compileConfig(c), sim = new Simulation(run);
  let found = false;
  while (sim.step()) {const s = sim.getSnapshot().stations.find(s => s.stationId === 'prep')!; if (s.maintenanceDueAtMs !== null && s.remainingMaintenanceMs === null && s.status === 'blocked') {expect(maintenanceNotice(s, run, labels('en'))).toContain(labels('en').maintenanceWaitOutput); found = true; break;}}
  expect(found).toBe(true);
  const long = maintenanceRun(); long.durationMs += DAY;
  expect(maintenanceTime(compileConfig(long), DAY + M + 123, labels('en'))).toBe('Day 2 08:01:00.123');
});
