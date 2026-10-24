import {describe, expect, it} from 'vitest';
import {compileConfig} from './config';
import type {EditorConfig} from './config';
import {createCalendar, DAY_MS} from './calendar';
import {emptyFlowTime, recordFlowTime} from './flow-time';
import {EventScheduler} from './events';
import {createPushState} from './sources';
import {Simulation} from './simulation';
import {line} from './test-fixtures';
import {exampleIds, previewConfig} from '../ui/preview';
import type {ProductFlowTime, StockState} from './state';
const M = 60_000, Q = 1_000_000;
function single(mode: 'sequential' | 'simultaneous' = 'sequential', repetitions = 1): EditorConfig {
  const c = line(); c.initialStocks = []; c.stations = [c.stations[0]!];
  c.stations[0]!.inputBuffer = {kind: 'infinite'};
  Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions});
  c.stations[0]!.transportThreshold = String(repetitions);
  c.materials = c.materials.filter(m => m.id !== 'part');
  c.recipes = [{id: 'cut', name: 'one', kind: 'production', inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: 'product', quantity: '1'}}];
  c.routes = [c.routes[0]!, {id: 'sale', fromId: 's1', toId: 'market', materialId: 'product'}];
  c.sources[0]!.quantity = String(repetitions); c.sources[0]!.intervalMs = 60 * M;
  return c;
}
const simulate = (c: EditorConfig) => new Simulation(compileConfig(c));
const totals = (sim: Simulation, t: number) => sim.advanceTo(t).line!.flowTime[0]!;

describe('completed good quantity-weighted flow time', () => {
  it.each(['sequential', 'simultaneous'] as const)('waits for acceptance of the full transport batch: %s', mode => {
    const sim = simulate(single(mode, 3));
    expect(totals(sim, 0).admission).toMatchObject({knownQuantity: 0, unknownQuantity: 0, meanCalendarMs: null, meanWorkMs: null});
    const finish = mode === 'sequential' ? 3 * M : M;
    expect(totals(sim, finish - 1).admission.knownQuantity).toBe(0);
    const row = totals(sim, finish);
    expect(row.admission).toMatchObject({knownQuantity: 3 * Q, unknownQuantity: 0, meanCalendarMs: finish, meanWorkMs: finish, calendarQuantityMs: String(BigInt(3 * Q) * BigInt(finish))});
    expect(row.firstProcessing.meanCalendarMs).toBe(mode === 'sequential' ? 2 * M : M);
  });

  it('includes the queue before a first operation only in admission time', () => {
    const c = single(); c.sources[0]!.quantity = '2'; c.stations[0]!.transportThreshold = '1';
    const row = totals(simulate(c), 2 * M);
    expect(row.admission.meanCalendarMs).toBe(1.5 * M);
    expect(row.firstProcessing.meanCalendarMs).toBe(M);
  });

  it.each([false, true])('uses common work time through lunch and night, replacement=%s', replacement => {
    const c = single(); c.calendar = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 20 * M, shiftEndMs: 30 * M};
    c.durationMs = DAY_MS + 30 * M; c.stations[0]!.lunchReplacement = replacement;
    c.stations[0]!.plan[0]!.processing.timeMs = 35 * M;
    const at = DAY_MS + (replacement ? 5 : 25) * M;
    const row = totals(simulate(c), at);
    expect(row.admission).toMatchObject({knownQuantity: Q, meanCalendarMs: at, meanWorkMs: (replacement ? 25 : 35) * M});
    expect(row.firstProcessing).toEqual(row.admission);
  });

  it('excludes unknown initial finished history and scrap without inventing zero durations', () => {
    const c = single(); c.stations[0]!.outputBuffer = {kind: 'infinite'}; c.initialStocks = [{id: 'goods', ownerId: 's1', location: 'output', materialId: 'product', quantity: '0.5', cost: '0'}];
    c.stations[0]!.plan[0]!.processing.defectProbability = 1;
    const row = totals(simulate(c), M);
    expect(row.admission).toMatchObject({knownQuantity: 0, unknownQuantity: Q / 2, meanCalendarMs: null});
    expect(row.firstProcessing).toEqual(row.admission);
  });

  it('keeps known and unknown shares separate in a weighted mean', () => {
    const c = single(); c.initialStocks = [{id: 'kit', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '1', cost: '0'}];
    const row = totals(simulate(c), 2 * M);
    expect(row.admission).toMatchObject({knownQuantity: Q, unknownQuantity: Q, meanCalendarMs: 2 * M});
    expect(row.firstProcessing).toMatchObject({knownQuantity: Q, unknownQuantity: Q, meanCalendarMs: M});
  });

  it('includes downstream queue and split output with ancestor time', () => {
    const c = line(); c.initialStocks = []; c.sources[0]!.availability = 'warehouse';
    c.initialStocks = [{id: 'raw-stock', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '0.3', cost: '0'}];
    const row = totals(simulate(c), 4 * M);
    expect(row.admission).toMatchObject({knownQuantity: 2 * Q, meanCalendarMs: 3.25 * M});
    expect(row.firstProcessing).toEqual(row.admission);
  });

  it('adds inspection duration and counts only passed goods', () => {
    const c = single(); c.sources[0]!.quantity = '2';
    c.recipes.push({id: 'qc', name: 'qc', kind: 'inspection', inputs: [{materialId: 'product', quantity: '1'}], output: {materialId: 'product', quantity: '1'}});
    const qc = structuredClone(c.stations[0]!); qc.id = 'inspector'; qc.plan = [{id: 'qc-row', recipeId: 'qc', batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: M, cv: 0}}];
    c.stations.push(qc); c.routes[1]!.toId = 'inspector'; c.routes.push({id: 'accept', fromId: 'inspector', toId: 'market', materialId: 'product'});
    expect(totals(simulate(c), 3 * M).admission).toMatchObject({knownQuantity: 2 * Q, meanCalendarMs: 2.5 * M});
    c.stations[0]!.plan[0]!.processing.defectProbability = 1;
    expect(totals(simulate(c), 3 * M).admission).toMatchObject({knownQuantity: 0, unknownQuantity: 0, meanCalendarMs: null});
  });

  it('uses earliest component admission when assembly waits for a complete kit', () => {
    const c = single();
    c.materials.push({id: 'other', name: 'B', role: 'raw', color: '#abc', purchasePrice: '0'});
    c.recipes[0]!.inputs.push({materialId: 'other', quantity: '2'});
    c.sources.push({id: 'other-source', name: 'B', materialId: 'other', availability: 'virtual', quantity: '1', intervalMs: M});
    c.routes.push({id: 'other-route', fromId: 'other-source', toId: 's1', materialId: 'other'});
    const row = totals(simulate(c), 2 * M);
    expect(row.admission).toMatchObject({knownQuantity: Q, meanCalendarMs: 2 * M});
    expect(row.firstProcessing).toMatchObject({knownQuantity: Q, meanCalendarMs: M});
  });

  it('rolls back accumulated times when a later handler in the timestamp fails', () => {
    const run = compileConfig(single()), state = createPushState(run);
    state.line = {transferPending: false, dispatchPending: false, counters: [], inspections: [], shiftOutput: [], stockTime: [], scraps: [], transfers: [],
      flowTime: [{materialId: 'product', admission: emptyFlowTime(), firstProcessing: emptyFlowTime()}]};
    const scheduler = new EventScheduler(run, state, {transfer: ctx => {
      const row = ctx.state.line!.flowTime[0]!;
      row.admission.knownQuantity = Q; row.admission.calendarQuantityMs = BigInt(Q * M);
      throw new Error('failed acceptance');
    }});
    scheduler.schedule({kind: 'transfer', id: 'fail', producerId: 's1', timeMs: M});
    const previous = scheduler.getSnapshot();
    expect(() => scheduler.step()).toThrow('failed acceptance'); expect(scheduler.getSnapshot()).toBe(previous);
    expect(previous.line!.flowTime[0]!.admission.calendarQuantityMs).toBe('0');
  });

  it('freezes detached serializable totals and preserves them at stop', () => {
    const sim = simulate(single()); const first = sim.advanceTo(M);
    const saved = JSON.parse(JSON.stringify(first));
    expect(Object.isFrozen(first.line!.flowTime[0]!.admission)).toBe(true);
    sim.advanceTo(2 * M); expect(first).toEqual(saved);
    const stopped = sim.stop(); expect(sim.runToEnd()).toEqual(stopped);
  });

  it.each(exampleIds)('conserves accepted quantities and matches stepping in %s', id => {
    const c = previewConfig(id), sim = simulate(c);
    while (sim.step() !== null) {
      const s = sim.getSnapshot();
      for (const row of s.line!.flowTime) for (const value of [row.admission, row.firstProcessing]) {
        expect(value.knownQuantity + value.unknownQuantity).toBe(s.line!.counters.find(x => x.materialId === row.materialId)!.sold);
      }
    }
    expect(simulate(c).runToEnd()).toEqual(sim.getSnapshot());
    const irregular = simulate(c); for (let t = 17; t < c.durationMs; t += 371_119) irregular.advanceTo(t);
    expect(irregular.runToEnd()).toEqual(sim.getSnapshot());
  });
});

describe('exact bounded flow accumulators', () => {
  it('weights fractional quantities and independent known beginnings with sums above safe integers', () => {
    const row: ProductFlowTime = {materialId: 'product', admission: emptyFlowTime(), firstProcessing: emptyFlowTime()};
    const calendar = createCalendar({shiftStartMs: 0, lunchStartMs: M, lunchEndMs: 2 * M, shiftEndMs: 3 * M}, 1000);
    const part: StockState = {id: 'test', ownerId: 's1', location: 'output', materialId: 'product', quantity: 500_001, cost: 0n, readyAtMs: 0,
      provenance: {origin: {kind: 'known', startedAtMs: 0}, firstProcessing: {kind: 'unknown'}, defective: false, defectSourceIds: [], processingMs: {}}};
    const t = 999 * DAY_MS + 3 * M; recordFlowTime(row, part, calendar, t);
    expect(row.admission.calendarQuantityMs).toBe(500_001n * BigInt(t));
    expect(row.admission.workQuantityMs).toBe(500_001n * BigInt(2000 * M));
    expect(row.firstProcessing).toEqual({...emptyFlowTime(), unknownQuantity: 500_001});
    part.provenance.origin = {kind: 'unknown'}; part.provenance.firstProcessing = {kind: 'known', startedAtMs: t - M};
    recordFlowTime(row, part, calendar, t);
    expect(row.admission.unknownQuantity).toBe(500_001);
    expect(row.firstProcessing.calendarQuantityMs).toBe(500_001n * BigInt(M));
  });
});
