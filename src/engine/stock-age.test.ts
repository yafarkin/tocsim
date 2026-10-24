import {describe, expect, it} from 'vitest';
import {stockAge} from './stock-age';
import {createCalendar, DAY_MS} from './calendar';
import {compileConfig} from './config';
import type {EditorConfig} from './config';
import {Simulation} from './simulation';
import {line} from './test-fixtures';
import type {ProcessingOrigin, StockOrigin, StockState} from './state';
import {createSnapshot} from './state';
import {createPushState} from './sources';
import {exampleIds, previewConfig} from '../ui/preview';
const M = 60_000, Q = 1_000_000;
const schedule = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 20 * M, shiftEndMs: 30 * M};
const calendar = createCalendar(schedule, 2);
function lot(location: StockState['location'], quantity: number, origin: StockOrigin = {kind: 'known', startedAtMs: 0}, firstProcessing: ProcessingOrigin = {kind: 'notStarted'}, ownerId = 's1'): StockState {
  return {id: `${ownerId}-${location}`, ownerId: location === 'warehouse' ? 'warehouse' : ownerId, location, materialId: 'raw', quantity, cost: 0n, readyAtMs: 0,
    provenance: {origin, firstProcessing, defective: false, defectSourceIds: [], processingMs: {}}};
}
function single(mode: 'sequential' | 'simultaneous' = 'sequential', repetitions = 1): EditorConfig {
  const c = line(); c.initialStocks = []; c.stations = [c.stations[0]!]; c.calendar = schedule; c.durationMs = calendar.endTimeMs;
  c.stations[0]!.inputBuffer = {kind: 'infinite'};
  Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions, timeMs: 3 * M});
  c.stations[0]!.transportThreshold = String(repetitions);
  c.materials = c.materials.filter(m => m.id !== 'part');
  c.recipes = [{id: 'cut', name: 'one', kind: 'production', inputs: [{materialId: 'raw', quantity: '1'}], output: {materialId: 'product', quantity: '1'}}];
  c.routes = [c.routes[0]!, {id: 'sale', fromId: 's1', toId: 'market', materialId: 'product'}];
  c.sources[0]!.quantity = String(repetitions); c.sources[0]!.intervalMs = 60 * M;
  return c;
}
const simulate = (c: EditorConfig) => new Simulation(compileConfig(c));

describe('age of current disjoint physical stocks', () => {
  it('separates unknown history, not started processing and known zero age', () => {
    const report = stockAge([lot('input', Q), lot('reserved', Q, {kind: 'unknown'}, {kind: 'unknown'}),
      lot('held', Q, {kind: 'known', startedAtMs: 0}, {kind: 'known', startedAtMs: 0})], ['raw', 'product'], calendar, 0);
    expect(report.materials.find(r => r.materialId === 'raw')).toMatchObject({quantity: String(3 * Q),
      admission: {knownQuantity: String(2 * Q), unknownQuantity: String(Q), notStartedQuantity: '0', meanCalendarMs: 0, meanWorkMs: 0},
      firstProcessing: {knownQuantity: String(Q), unknownQuantity: String(Q), notStartedQuantity: String(Q), meanCalendarMs: 0}});
    expect(report.materials.find(r => r.materialId === 'product')).toMatchObject({quantity: '0', admission: {meanCalendarMs: null}, firstProcessing: {meanWorkMs: null}});
  });

  it('weights fractional quantities and preserves exact totals beyond safe integers across places', () => {
    const stocks = [lot('input', 500_001), lot('output', Number.MAX_SAFE_INTEGER, {kind: 'known', startedAtMs: M}, {kind: 'known', startedAtMs: 2 * M}, 's2')];
    const at = DAY_MS + 30 * M, report = stockAge(stocks, ['raw'], calendar, at), raw = report.materials[0]!;
    const quantity = 500_001n + BigInt(Number.MAX_SAFE_INTEGER);
    expect(raw.quantity).toBe(String(quantity));
    expect(raw.admission.calendarQuantityMs).toBe(String(500_001n * BigInt(at) + BigInt(Number.MAX_SAFE_INTEGER) * BigInt(at - M)));
    expect(raw.firstProcessing.notStartedQuantity).toBe('500001');
    expect(raw.firstProcessing.meanCalendarMs).toBe(at - 2 * M);
    expect(raw.firstProcessing.meanWorkMs).toBe(38 * M);
    expect(report.places.reduce((s,r) => s + BigInt(r.quantity), 0n)).toBe(quantity);
  });

  it('excludes warehouse and quality flags, is pure and independent of input order', () => {
    const stocks = [lot('warehouse', Q, {kind: 'unreleased'}), lot('output', Q, {kind: 'known', startedAtMs: M}, {kind: 'unknown'})];
    const before = structuredClone(stocks), expected = stockAge(stocks, ['raw', 'product'], calendar, 3 * M);
    expect(stocks).toEqual(before); expect(expected.places).toHaveLength(1); expect(expected.materials.find(r => r.materialId === 'raw')!.quantity).toBe(String(Q));
    stocks[1]!.provenance.defective = true; stocks[1]!.provenance.defectSourceIds = ['secret'];
    expect(stockAge(stocks.reverse(), ['product', 'raw'], calendar, 3 * M)).toEqual(expected);
    expect(JSON.stringify(expected)).not.toContain('secret');
  });

  it.each(['sequential', 'simultaneous'] as const)('uses existing inputs and completed outputs of a %s batch only', mode => {
    const c = single(mode, 3); c.recipes[0]!.output.quantity = '10'; c.stations[0]!.transportThreshold = '30';
    const sim = simulate(c), at = mode === 'sequential' ? 4 * M : 2 * M;
    const model = sim.advanceTo(at), age = model.line!.stockAge;
    if (mode === 'sequential') {
      expect(age.materials.find(r => r.materialId === 'raw')).toMatchObject({quantity: String(2 * Q),
        firstProcessing: {knownQuantity: String(Q), notStartedQuantity: String(Q), meanCalendarMs: M}});
      expect(age.materials.find(r => r.materialId === 'product')).toMatchObject({quantity: String(10 * Q), admission: {meanCalendarMs: 4 * M}, firstProcessing: {meanCalendarMs: 4 * M}});
    } else {
      expect(age.materials.find(r => r.materialId === 'raw')).toMatchObject({quantity: String(3 * Q), firstProcessing: {knownQuantity: String(3 * Q), notStartedQuantity: '0', meanCalendarMs: 2 * M}});
      expect(age.materials.find(r => r.materialId === 'product')!.quantity).toBe('0');
    }
    expect(age.places.some(p => p.location === 'reserved' && p.materialId === 'raw')).toBe(true);
    expect(age.places.some(p => p.materialId === 'product')).toBe(mode === 'sequential');
  });

  it('ages held finished material without counting consumed inputs again, then removes accepted goods', () => {
    const sim = simulate(single('sequential', 3)), model = sim.advanceTo(4 * M);
    expect(model.line!.stockAge.places).toEqual(expect.arrayContaining([
      expect.objectContaining({materialId: 'product', location: 'held', quantity: String(Q), admission: expect.objectContaining({meanCalendarMs: 4 * M}), firstProcessing: expect.objectContaining({meanCalendarMs: 4 * M})}),
      expect.objectContaining({materialId: 'raw', location: 'reserved', quantity: String(2 * Q), firstProcessing: expect.objectContaining({knownQuantity: String(Q), notStartedQuantity: String(Q), meanCalendarMs: M})}),
    ]));
    expect(model.line!.stockAge.materials.reduce((s,r) => s + BigInt(r.quantity), 0n)).toBe(BigInt(3 * Q));
    expect(sim.advanceTo(9 * M).line!.stockAge.places).toEqual([]);
  });

  it.each([false, true])('uses common work age during lunch and night with replacement=%s', replacement => {
    const c = single(); c.stations[0]!.lunchReplacement = replacement; c.stations[0]!.plan[0]!.processing.timeMs = 100 * M;
    const sim = simulate(c);
    for (const [at, work] of [[15 * M, 10 * M], [30 * M, 20 * M], [DAY_MS + 5 * M, 25 * M]]) {
      const age = sim.advanceTo(at!).line!.stockAge.materials.find(r => r.materialId === 'raw')!;
      expect(age.admission).toMatchObject({meanCalendarMs: at, meanWorkMs: work});
      expect(age.firstProcessing).toEqual(age.admission);
    }
    const stopped = sim.stop(); expect(sim.runToEnd()).toEqual(stopped);
  });

  it('keeps initial finished and unfinished history unknown', () => {
    const c = single(); c.sources[0]!.availability = 'warehouse'; c.stations[0]!.outputBuffer = {kind: 'infinite'};
    c.initialStocks = [{id: 'initial-input', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '1', cost: '0'},
      {id: 'initial-output', ownerId: 's1', location: 'output', materialId: 'product', quantity: '1', cost: '0'}];
    const sim = simulate(c), initial = sim.getSnapshot();
    for (const row of initial.line!.stockAge.materials) {
      expect(row.admission).toMatchObject({unknownQuantity: String(Q), knownQuantity: '0', meanCalendarMs: null});
      expect(row.firstProcessing).toEqual(row.admission);
    }
    expect(sim.advanceTo(M).line!.stockAge.materials.find(r => r.materialId === 'raw')!.firstProcessing).toMatchObject({unknownQuantity: String(Q), meanCalendarMs: null});
  });

  it('inherits assembly beginnings while waiting for downstream processing', () => {
    const c = line(); c.initialStocks = []; c.sources[0]!.quantity = '1'; c.sources[0]!.intervalMs = 60 * M;
    c.materials.push({id: 'other', name: 'B', role: 'raw', color: '#abc', purchasePrice: '0'});
    c.recipes[0]!.inputs = [{materialId: 'raw', quantity: '1'}, {materialId: 'other', quantity: '2'}];
    c.recipes[0]!.output.quantity = '1'; c.stations[0]!.inputBuffer = {kind: 'infinite'};
    c.sources.push({id: 'other-source', name: 'B', materialId: 'other', availability: 'virtual', quantity: '1', intervalMs: M});
    c.routes.push({id: 'other-route', fromId: 'other-source', toId: 's1', materialId: 'other'});
    const model = simulate(c).advanceTo(2 * M);
    expect(model.line!.stockAge.materials.find(r => r.materialId === 'part')).toMatchObject({quantity: String(Q),
      admission: {meanCalendarMs: 2 * M}, firstProcessing: {meanCalendarMs: M}});
    expect(model.line!.stockAge.places.find(r => r.materialId === 'part')).toMatchObject({ownerId: 's2', location: 'reserved'});
  });

  it('keeps finished output blocked behind a full downstream input as current WIP', () => {
    const c = line(); c.initialStocks = []; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
    c.stations[0]!.outputBuffer = {kind: 'quantity', quantity: '1'};
    c.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    c.stations[1]!.plan[0]!.processing.timeMs = 100 * M;
    const model = simulate(c).advanceTo(5 * M), age = model.line!.stockAge;
    const output = age.places.find(r => r.ownerId === 's1' && r.location === 'output')!;
    expect(output).toMatchObject({materialId: 'part', quantity: String(Q), admission: {meanCalendarMs: 3 * M}, firstProcessing: {meanCalendarMs: 3 * M}});
    expect(age.places.find(r => r.ownerId === 's1' && r.location === 'held')).toMatchObject({materialId: 'part', quantity: String(Q), admission: {meanCalendarMs: 2 * M}});
  });

  it('copies, freezes and serializes age data without retaining mutable state', () => {
    const run = compileConfig(single()), state = createPushState(run);
    state.line = {transferPending: false, dispatchPending: false, counters: [], inspections: [], shiftOutput: [], stockTime: [], flowTime: [], scraps: [], transfers: []};
    state.stocks = [lot('input', Q)]; state.timeMs = M;
    const snapshot = createSnapshot(run, state), saved = JSON.parse(JSON.stringify(snapshot));
    expect(snapshot.schemaVersion).toBe(22); expect(Object.isFrozen(snapshot.line!.stockAge.materials[1]!.admission)).toBe(true);
    state.stocks[0]!.quantity = 2 * Q; expect(snapshot).toEqual(saved);
  });

  it.each(exampleIds)('matches physical quantities and deterministic playback in %s', id => {
    const c = previewConfig(id), run = compileConfig(c), sim = new Simulation(run);
    while (sim.step() !== null) {
      const model = sim.getSnapshot(), age = model.line!.stockAge;
      for (const row of age.materials) {
        const stocks = model.stocks.filter(s => s.location !== 'warehouse' && s.materialId === row.materialId);
        const physical = stocks.reduce((s,x) => s + BigInt(x.quantity), 0n);
        expect(BigInt(row.quantity)).toBe(physical);
        expect(age.places.filter(p => p.materialId === row.materialId).reduce((s,p) => s + BigInt(p.quantity), 0n)).toBe(physical);
        for (const t of [row.admission, row.firstProcessing]) expect(BigInt(t.knownQuantity) + BigInt(t.unknownQuantity) + BigInt(t.notStartedQuantity)).toBe(physical);
      }
    }
    expect(new Simulation(run).runToEnd()).toEqual(sim.getSnapshot());
    const irregular = new Simulation(run); for (let t = 13; t < c.durationMs; t += 371_119) irregular.advanceTo(t);
    expect(irregular.runToEnd()).toEqual(sim.getSnapshot());
  });
});
