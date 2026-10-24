import {describe, expect, it} from 'vitest';
import {compileConfig} from './config';
import type {DeepReadonly, EditorConfig} from './config';
import {FlowHistoryCollector, MAX_FLOW_POINTS} from './flow-history';
import type {FlowPoint} from './flow-history';
import {createCalendar, DAY_MS, workedMsUntil} from './calendar';
import {Simulation} from './simulation';
import {line} from './test-fixtures';
import {flowReport} from './flow-report';
import type {Snapshot} from './state';
import {exampleIds, previewConfig} from '../ui/preview';
const Q = 1_000_000, M = 60_000;
function single(): EditorConfig {
  const c = line(); c.stations = [c.stations[0]!]; c.initialStocks = [];
  c.stations[0]!.inputBuffer = {kind: 'infinite'};
  c.materials = c.materials.filter(m => m.id !== 'part');
  c.recipes = [{id: 'cut', name: 'One', kind: 'production', inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: 'product', quantity: '1'}}];
  c.routes = [c.routes[0]!, {id: 'sale', fromId: 's1', toId: 'market', materialId: 'product'}];
  c.sources[0]!.quantity = '3'; c.sources[0]!.intervalMs = 60 * M;
  return c;
}
function checkPoint(c: EditorConfig, point: DeepReadonly<FlowPoint>, model: DeepReadonly<Snapshot>) {
  const run = compileConfig(c), report = flowReport(run, model);
  expect(point.timeMs).toBe(model.timeMs);
  for (const row of point.values.materials) {
    const stock = report.materials.find(m => m.materialId === row.materialId)!;
    for (const stage of ['input','reserved','held','output'] as const) expect(row[stage]).toBe(stock[stage]);
    expect(row.wip).toBe(stock.total);
    const counter = model.line!.counters.find(m => m.materialId === row.materialId)!;
    expect(row.produced).toBe(String(counter.produced)); expect(row.consumed).toBe(String(counter.consumed));
    expect(row.delivered).toBe(String(counter.sold)); expect(row.scrapped).toBe(String(counter.scrapped));
    const initial = run.resolved.initialStocks.filter(s => s.location !== 'warehouse' && s.materialId === row.materialId).reduce((sum,s) => sum + BigInt(s.quantity), 0n);
    expect(initial + BigInt(row.released) + BigInt(row.produced)).toBe(BigInt(row.wip) + BigInt(row.consumed) + BigInt(row.delivered) + BigInt(row.scrapped));
    expect(point.values.places.filter(p => p.materialId === row.materialId).reduce((sum,p) => sum + BigInt(p.quantity), 0n)).toBe(BigInt(row.wip));
  }
}

describe('bounded history from settled model time', () => {
  it('preserves pre-event initial stock separately from the atomic time-zero state', () => {
    const c = single(); c.initialStocks = [{id: 'initial-kit', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '1', cost: '0'}];
    const run = compileConfig(c), sim = new Simulation(run), ready = sim.getHistory();
    expect(ready.schemaVersion).toBe(1); expect(ready.points).toHaveLength(1); expect(ready.points[0]!.phase).toBe('initial');
    expect(ready.initial.values.materials.find(m => m.materialId === 'raw')).toMatchObject({input: String(Q), reserved: '0', released: '0'});
    sim.advanceTo(0); const after = sim.getHistory();
    expect(after.initial).toBe(ready.initial); expect(after.points.filter(p => p.timeMs === 0)).toHaveLength(1);
    expect(after.points[0]!.phase).toBe('settled');
    expect(after.points[0]!.values.materials.find(m => m.materialId === 'raw')).toMatchObject({input: String(3 * Q), reserved: String(Q), released: String(3 * Q)});
    expect(ready.points[0]!.values.materials.find(m => m.materialId === 'raw')!.reserved).toBe('0');
  });

  it('samples before an event from previous quantities and at the event after every phase', () => {
    const c = single(); c.calendar = {shiftStartMs: 0, lunchStartMs: 1000, lunchEndMs: 1100, shiftEndMs: 2046}; c.durationMs = 2046;
    c.stations[0]!.plan[0]!.processing.timeMs = 10; c.sources[0]!.intervalMs = 1000;
    const sim = new Simulation(compileConfig(c)); sim.advanceTo(10);
    const h = sim.getHistory(); expect(h.sampling.intervalMs).toBe(1);
    expect(h.points[9]!.values.materials.find(m => m.materialId === 'product')).toMatchObject({produced: '0', delivered: '0'});
    expect(h.points[10]!.values.materials.find(m => m.materialId === 'product')).toMatchObject({produced: String(Q), delivered: String(Q), held: '0', output: '0'});
    expect(h.points[10]!.values.materials.find(m => m.materialId === 'raw')).toMatchObject({reserved: String(Q), consumed: String(Q)});
    expect(h.points.filter(p => p.timeMs === 10)).toHaveLength(1);
  });

  it('keeps the final endpoint off the fixed grid and freezes it at a partial stop', () => {
    const c = single(), sim = new Simulation(compileConfig(c)); sim.advanceTo(123_457); const h = sim.getHistory();
    expect(h.points.at(-1)!.timeMs).toBe(123_457); expect(h.points.at(-2)!.timeMs).toBeLessThan(123_457);
    sim.stop(); const stopped = sim.getHistory();
    expect(stopped.termination).toBe('stopped'); expect(stopped.points).toEqual(h.points);
    sim.advanceTo(c.durationMs); expect(sim.getHistory()).toBe(stopped);
    expect(h.termination).toBe('running'); expect(sim.getSnapshot().line!.stockTime.length).toBeGreaterThan(0);
  });

  it('retains the full horizon and exact cumulative output even when the last event falls between grid points', () => {
    const c = single(), sim = new Simulation(compileConfig(c)); sim.runToEnd(); const h = sim.getHistory();
    expect(h.points[0]!.timeMs).toBe(0); expect(h.points.at(-1)!.timeMs).toBe(c.durationMs);
    expect(h.termination).toBe('horizon'); expect(h.points.length).toBeLessThanOrEqual(MAX_FLOW_POINTS);
    checkPoint(c, h.points.at(-1)!, sim.getSnapshot());
  });

  it.each(['sequential', 'simultaneous'] as const)('keeps actual reserved inputs and held completed outputs for a %s batch', mode => {
    const c = single(); Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions: 3, timeMs: M}); c.stations[0]!.transportThreshold = '3';
    const sim = new Simulation(compileConfig(c)); sim.advanceTo(M + 1);
    const point = sim.getHistory().points.at(-1)!; checkPoint(c, point, sim.getSnapshot());
    expect(point.values.materials.find(m => m.materialId === 'raw')!.reserved).toBe(mode === 'sequential' ? String(2 * Q) : '0');
    expect(point.values.materials.find(m => m.materialId === 'product')).toMatchObject(mode === 'sequential' ? {held: String(Q), delivered: '0'} : {held: '0', delivered: String(3 * Q)});
  });

  it('separates rejected output from accepted goods and never reveals hidden defects in WIP', () => {
    const c = single(); c.stations[0]!.plan[0]!.processing.defectProbability = 1;
    const run = compileConfig(c), sim = new Simulation(run); sim.advanceTo(M);
    const point = sim.getHistory().points.at(-1)!;
    expect(point.values.materials.find(m => m.materialId === 'product')).toMatchObject({produced: String(Q), delivered: '0', scrapped: String(Q)});
    checkPoint(c, point, sim.getSnapshot());
    const model = structuredClone(sim.getSnapshot()) as Snapshot;
    const collector = new FlowHistoryCollector(run, new Simulation(run).getSnapshot()); collector.settled(model);
    const expected = collector.get(model).points.at(-1)!.values;
    for (const stock of model.stocks) {stock.provenance.defective = !stock.provenance.defective; stock.provenance.defectSourceIds = ['secret'];}
    const disguised = new FlowHistoryCollector(run, new Simulation(run).getSnapshot()); disguised.settled(model);
    expect(disguised.get(model).points.at(-1)!.values).toEqual(expected);
    expect(JSON.stringify(expected)).not.toContain('secret');
  });

  it('excludes raw warehouse stock from the boundary and counts only actual admission', () => {
    const c = single(); c.sources[0]!.availability = 'warehouse'; c.sources[0]!.quantity = '1';
    c.initialStocks = [{id: 'raw-kit', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '7', cost: '0'}];
    const sim = new Simulation(compileConfig(c));
    expect(sim.getHistory().initial.values.materials.find(m => m.materialId === 'raw')!.wip).toBe('0');
    sim.advanceTo(0); const point = sim.getHistory().points.at(-1)!;
    expect(point.values.materials.find(m => m.materialId === 'raw')).toMatchObject({wip: String(Q), released: String(Q)});
    expect(point.values.places.some(p => (p.location as string) === 'warehouse')).toBe(false);
    checkPoint(c, point, sim.getSnapshot());
  });

  it('uses the common work calendar through lunch, nights and replacement', () => {
    const c = single(); c.calendar = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 20 * M, shiftEndMs: 30 * M};
    c.durationMs = DAY_MS + 30 * M; c.stations[0]!.lunchReplacement = true; c.stations[0]!.plan[0]!.processing.timeMs = 100 * M;
    const sim = new Simulation(compileConfig(c)); sim.advanceTo(DAY_MS + 5 * M);
    const h = sim.getHistory(), calendar = createCalendar(c.calendar, 2);
    for (const p of h.points) expect(p.workMs).toBe(workedMsUntil(calendar, p.timeMs));
    expect(h.points.at(-1)!.workMs).toBe(25 * M);
  });

  it('serializes immutable detached data and caches reads without copying full snapshots', () => {
    const sim = new Simulation(compileConfig(single())); sim.advanceTo(M); const before = sim.getHistory(), json = JSON.parse(JSON.stringify(before));
    expect(sim.getHistory()).toBe(before); expect(Object.isFrozen(before.points)).toBe(true);
    expect(Object.isFrozen(before.points[0]!.values.materials[0]!)).toBe(true);
    expect(before.points[0]!.values).not.toHaveProperty('stocks'); expect(before).not.toHaveProperty('stationTime');
    sim.advanceTo(2 * M); expect(before).toEqual(json);
  });

  it('keeps history at the last committed endpoint after an invalid advance', () => {
    const sim = new Simulation(compileConfig(single())); sim.advanceTo(M); const before = sim.getHistory();
    expect(() => sim.advanceTo(-1)).toThrow(); const after = sim.getHistory();
    expect(after.termination).toBe('error'); expect(after.points).toEqual(before.points);
  });

  it.each(exampleIds)('matches real snapshots, balances and playback partitions in %s', example => {
    const c = previewConfig(example), run = compileConfig(c), stepped = new Simulation(run);
    while (stepped.step() !== null) checkPoint(c, stepped.getHistory().points.at(-1)!, stepped.getSnapshot());
    const expected = stepped.getHistory(), direct = new Simulation(run); direct.runToEnd();
    expect(direct.getHistory()).toEqual(expected);
    const irregular = new Simulation(run); for (let t = 1; t < c.durationMs; t += 137_119) irregular.advanceTo(t); irregular.runToEnd();
    expect(irregular.getHistory()).toEqual(expected); expect(irregular.getSnapshot()).toEqual(stepped.getSnapshot());
    // Independent reads of retained interior samples, including values between events.
    const reference = new Simulation(run);
    for (const p of expected.points.filter((_, i) => i % 257 === 0)) checkPoint(c, p, reference.advanceTo(p.timeMs));
    c.stations.reverse(); c.materials.reverse(); c.recipes.reverse(); c.sources.reverse(); c.routes.reverse(); c.initialStocks.reverse();
    const reordered = new Simulation(compileConfig(c)); reordered.runToEnd(); expect(reordered.getHistory()).toEqual(expected);
  });

  it('does not retain any intermediate output from a failed atomic timestamp', () => {
    const c = single(); c.sources[0]!.quantity = '9007199254.740991'; c.sources[0]!.intervalMs = M;
    c.materials.find(m => m.id === 'raw')!.purchasePrice = '0';
    const sim = new Simulation(compileConfig(c)); sim.advanceTo(0); const before = sim.getHistory();
    // Completion and another admission share minute 1; the cumulative source count overflows.
    expect(() => sim.advanceTo(M)).toThrow(); const after = sim.getHistory();
    expect(after.termination).toBe('error'); expect(after.timeMs).toBe(0); expect(after.points).toEqual(before.points);
    expect(after.points.at(-1)!.values.materials.find(m => m.materialId === 'product')!.produced).toBe('0');
  });

  it('runs 100 real days with a finite source, retaining exact final counters and a bounded series', () => {
    const c = single(); c.sources[0]!.availability = 'warehouse'; c.sources[0]!.quantity = '1';
    c.initialStocks = [{id: 'finite-kit', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '3', cost: '0'}];
    c.durationMs = createCalendar(c.calendar, 100).endTimeMs;
    const sim = new Simulation(compileConfig(c)); sim.runToEnd(); const h = sim.getHistory();
    expect(h.points.length).toBeLessThanOrEqual(MAX_FLOW_POINTS); expect(h.points.at(-1)!.timeMs).toBe(c.durationMs);
    expect(h.points.at(-1)!.values.materials.find(m => m.materialId === 'product')).toMatchObject({wip: '0', delivered: String(3 * Q)});
    checkPoint(c, h.points.at(-1)!, sim.getSnapshot());
  });

  it('bounds a 100-day trajectory and preserves endpoints without storing an event log', () => {
    const c = single(); c.sources[0]!.availability = 'warehouse'; c.durationMs = createCalendar(c.calendar, 100).endTimeMs;
    const run = compileConfig(c), initial = new Simulation(run).getSnapshot(), collector = new FlowHistoryCollector(run, initial);
    // Many synthetic settled timestamps, each with unchanged physical quantities.
    const model = structuredClone(initial) as Snapshot;
    for (let i = 0; i <= 100_000; i++) {model.timeMs = Number(BigInt(c.durationMs) * BigInt(i) / 100_000n); collector.settled(model);}
    model.line!.termination = 'horizon'; const h = collector.get(model);
    expect(h.points.length).toBeLessThanOrEqual(MAX_FLOW_POINTS); expect(h.points.length).toBeGreaterThan(2000);
    expect(h.points[0]!.timeMs).toBe(0); expect(h.points.at(-1)!.timeMs).toBe(c.durationMs);
    expect(h.points.every((p,i) => i === 0 || p.timeMs > h.points[i-1]!.timeMs)).toBe(true);
    expect(JSON.stringify(h).length).toBeLessThan(2_000_000);
  });
});
