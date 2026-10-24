import {describe, expect, it} from 'vitest';
import {compileConfig} from './config';
import type {DeepReadonly, EditorConfig} from './config';
import {createCalendar, DAY_MS} from './calendar';
import {EventScheduler} from './events';
import {completeInspection, completeProduction, completeProductionBatch, createInventory, InventoryError, receiveStock, reserveInputs, startProcessingInputs, transferStock} from './inventory';
import {Simulation} from './simulation';
import {createPushState} from './sources';
import type {InventoryState, ProcessingOrigin, Provenance, Snapshot} from './state';
import {createSnapshot} from './state';
import {cyclicLine, line} from './test-fixtures';
import {exampleIds, previewConfig} from '../ui/preview';
const M = 60_000, Q = 1_000_000, infinite = {kind: 'infinite'} as const;
const empty = (): InventoryState => ({stocks: [], nextStockOrdinal: 0});
function receive(state: InventoryState, materialId: string, quantity: number, firstProcessing: ProcessingOrigin = {kind: 'notStarted'}, releasedAtMs = 0, cost = 0n, bad = false) {
  const provenance: Provenance = {origin: {kind: 'known', startedAtMs: releasedAtMs}, firstProcessing,
    defective: bad, defectSourceIds: bad ? ['upstream'] : [], processingMs: {}};
  return receiveStock(state, {ownerId: 's1', location: 'input'}, {materialId, quantity, cost, provenance, readyAtMs: 20}, infinite);
}
function oneStation(mode: 'sequential' | 'simultaneous' = 'sequential', repetitions = 1): EditorConfig {
  const c = line(); c.initialStocks = []; c.stations = [c.stations[0]!];
  c.stations[0]!.inputBuffer = {kind: 'infinite'};
  Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions}); c.stations[0]!.transportThreshold = String(repetitions);
  c.materials = c.materials.filter(m => m.id !== 'product'); Object.assign(c.materials.find(m => m.id === 'part')!, {role: 'finished', salePrice: '0'});
  c.recipes = [c.recipes[0]!]; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
  c.routes = [c.routes[0]!, {...c.routes[1]!, toId: 'market'}];
  c.sources[0]!.quantity = String(repetitions); c.sources[0]!.intervalMs = 60 * M;
  return c;
}

describe('independent admission and first-processing provenance', () => {
  it('keeps initial WIP history unknown and raw warehouse stock unstarted', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse';
    c.initialStocks.push({id: 'raw-warehouse', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '3', cost: '0'});
    const state = createInventory(compileConfig(c));
    expect(state.stocks.find(s => s.location === 'input')!.provenance).toMatchObject({origin: {kind: 'unknown'}, firstProcessing: {kind: 'unknown'}});
    expect(state.stocks.find(s => s.location === 'warehouse')!.provenance).toMatchObject({origin: {kind: 'unreleased'}, firstProcessing: {kind: 'notStarted'}});
    const moved = transferStock(state, {ownerId: 'warehouse', location: 'warehouse'}, {ownerId: 's1', location: 'input'}, 'raw', Q, infinite, 100);
    expect(moved[0]!.provenance).toMatchObject({origin: {kind: 'known', startedAtMs: 100}, firstProcessing: {kind: 'notStarted'}});
  });

  it('keeps admission at zero while input waits through an initial setup', () => {
    const c = cyclicLine(); c.initialStocks = []; c.sources.forEach(s => {s.availability = 'virtual'; s.intervalMs = 60 * M;});
    c.stations[0]!.initialRecipeId = 'recipeB'; c.stations[0]!.setupMs = 7 * M;
    const sim = new Simulation(compileConfig(c));
    const setup = sim.advanceTo(5 * M);
    expect(setup.stations[0]!.status).toBe('setup');
    expect(setup.stocks.every(s => s.provenance.firstProcessing.kind === 'notStarted')).toBe(true);
    const started = sim.advanceTo(7 * M);
    expect(started.stocks.find(s => s.location === 'reserved')!.provenance).toMatchObject({origin: {kind: 'known', startedAtMs: 0}, firstProcessing: {kind: 'known', startedAtMs: 7 * M}});
    expect(started.stocks.find(s => s.materialId === 'rawB')!.provenance.firstProcessing).toEqual({kind: 'notStarted'});
  });

  it('does not assign the start of the first sequential repetition to the whole reservation', () => {
    const sim = new Simulation(compileConfig(oneStation('sequential', 3)));
    const initial = sim.advanceTo(0);
    expect(initial.stocks.filter(s => s.location === 'reserved').map(s => [s.quantity, s.provenance.firstProcessing])).toEqual([
      [Q, {kind: 'known', startedAtMs: 0}], [2 * Q, {kind: 'notStarted'}],
    ]);
    const second = sim.advanceTo(M);
    expect(second.stocks.filter(s => s.location === 'reserved').map(s => [s.quantity, s.provenance.firstProcessing])).toEqual([
      [Q, {kind: 'known', startedAtMs: M}], [Q, {kind: 'notStarted'}],
    ]);
    expect(second.stocks.find(s => s.location === 'held')!.provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 0});
    const third = sim.advanceTo(2 * M);
    expect(third.stocks.find(s => s.location === 'reserved')!.provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 2 * M});
    expect(third.stocks.filter(s => s.location === 'held').map(s => s.provenance.firstProcessing)).toEqual([{kind: 'known', startedAtMs: 0}, {kind: 'known', startedAtMs: M}]);
    expect(sim.advanceTo(3 * M).line!.counters.find(c => c.materialId === 'part')!.sold).toBe(3 * Q);
  });

  it('marks every simultaneous input at the shared actual start', () => {
    const sim = new Simulation(compileConfig(oneStation('simultaneous', 3)));
    const model = sim.advanceTo(M - 1);
    expect(model.stocks).toHaveLength(1);
    expect(model.stocks[0]).toMatchObject({location: 'reserved', quantity: 3 * Q, provenance: {origin: {kind: 'known', startedAtMs: 0}, firstProcessing: {kind: 'known', startedAtMs: 0}}});
    expect(sim.advanceTo(M).line!.counters.find(c => c.materialId === 'part')!.sold).toBe(3 * Q);
  });

  it.each([false, true])('keeps the first start through lunch, night and a partial stop, replacement=%s', replacement => {
    const c = oneStation(); c.stations[0]!.lunchReplacement = replacement; c.stations[0]!.plan[0]!.processing.timeMs = 100 * M;
    c.calendar = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 20 * M, shiftEndMs: 30 * M};
    c.durationMs = createCalendar(c.calendar, 2).endTimeMs;
    const sim = new Simulation(compileConfig(c));
    for (const t of [0, 10 * M, 20 * M, 30 * M, DAY_MS, DAY_MS + 3 * M]) {
      const model = sim.advanceTo(t);
      expect(model.stocks.find(s => s.location === 'reserved')!.provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 0});
    }
    const stopped = sim.stop(); expect(sim.runToEnd()).toEqual(stopped);
  });

  it('retains the ancestor start rather than replacing it with the downstream operation start', () => {
    const c = line(); c.initialStocks = []; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1'; c.sources[0]!.intervalMs = 60 * M;
    const model = new Simulation(compileConfig(c)).advanceTo(M + 1);
    expect(model.stocks.find(s => s.ownerId === 's2' && s.location === 'reserved')!.provenance).toMatchObject({origin: {kind: 'known', startedAtMs: 0}, firstProcessing: {kind: 'known', startedAtMs: 0}});
  });

  it('does not invent a first ancestor start for initial stock or its descendants', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse'; c.initialStocks[0]!.quantity = '1'; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
    const model = new Simulation(compileConfig(c)).advanceTo(M + 1);
    expect(model.stocks.find(s => s.ownerId === 's2' && s.location === 'reserved')!.provenance).toMatchObject({origin: {kind: 'unknown'}, firstProcessing: {kind: 'unknown'}});
  });

  it('keeps independent earliest admission and processing timestamps when assembling components', () => {
    const s = empty(); receive(s, 'A', Q, {kind: 'known', startedAtMs: 15}, 0); receive(s, 'B', Q, {kind: 'known', startedAtMs: 6}, 5);
    const kit = [{materialId: 'A', quantity: Q}, {materialId: 'B', quantity: Q}];
    reserveInputs(s, 's1', kit); startProcessingInputs(s, 's1', kit, 25);
    const result = completeProduction(s, 's1', {materialId: 'C', quantity: Q}, 10, 40, kit);
    expect(result.provenance).toMatchObject({origin: {kind: 'known', startedAtMs: 0}, firstProcessing: {kind: 'known', startedAtMs: 6}});
  });

  it('keeps processing history unknown if any assembly component has unknown history', () => {
    const s = empty(); receive(s, 'A', Q, {kind: 'known', startedAtMs: 15}); receive(s, 'B', Q, {kind: 'unknown'}, 5);
    const kit = [{materialId: 'A', quantity: Q}, {materialId: 'B', quantity: Q}]; reserveInputs(s, 's1', kit); startProcessingInputs(s, 's1', kit, 25);
    const result = completeProduction(s, 's1', {materialId: 'C', quantity: Q}, 10, 40, kit);
    expect(result.provenance).toMatchObject({origin: {kind: 'known', startedAtMs: 0}, firstProcessing: {kind: 'unknown'}});
  });

  it('marks only the active FIFO share across known, unknown and unstarted portions without losing cost', () => {
    const s = empty(); receive(s, 'A', 300_000, {kind: 'known', startedAtMs: 5}, 0, 3n);
    receive(s, 'A', 300_000, {kind: 'unknown'}, 0, 3n); receive(s, 'A', 1_400_000, {kind: 'notStarted'}, 0, 7n);
    reserveInputs(s, 's1', [{materialId: 'A', quantity: 2 * Q}]); startProcessingInputs(s, 's1', [{materialId: 'A', quantity: Q}], 25);
    expect(s.stocks.map(x => [x.quantity, x.cost, x.provenance.firstProcessing])).toEqual([
      [300_000, 3n, {kind: 'known', startedAtMs: 5}], [300_000, 3n, {kind: 'unknown'}],
      [400_000, 2n, {kind: 'known', startedAtMs: 25}], [Q, 5n, {kind: 'notStarted'}],
    ]);
    const before = structuredClone(s); startProcessingInputs(s, 's1', [{materialId: 'A', quantity: Q}], 30);
    expect(s).toEqual(before);
    completeProduction(s, 's1', {materialId: 'C', quantity: Q}, 10, 40, [{materialId: 'A', quantity: Q}]);
    expect(s.stocks.find(x => x.location === 'reserved')!).toMatchObject({quantity: Q, cost: 5n, provenance: {firstProcessing: {kind: 'notStarted'}}});
    expect(s.stocks.reduce((sum, x) => sum + x.cost, 0n)).toBe(13n);
  });

  it('copies the first start through 1-to-10 output, quality spans and fractional transfers', () => {
    const s = empty(); receive(s, 'A', Q, {kind: 'notStarted'}, 0, 7n);
    const kit = [{materialId: 'A', quantity: Q}]; reserveInputs(s, 's1', kit); startProcessingInputs(s, 's1', kit, 25);
    const outputs = completeProductionBatch(s, 's1', {materialId: 'C', quantity: 10 * Q}, 11, 40, kit, 1, {probability: 0.5, seed: 42, recipeId: 'cut', operationOrdinal: 0});
    expect(outputs.every(x => x.provenance.firstProcessing.kind === 'known' && x.provenance.firstProcessing.startedAtMs === 25)).toBe(true);
    const parts = transferStock(s, {ownerId: 's1', location: 'held'}, {ownerId: 's1', location: 'output'}, 'C', 400_000, infinite, 45);
    expect(parts[0]!.provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 25});
    const delivered = transferStock(s, {ownerId: 's1', location: 'output'}, {ownerId: 's2', location: 'input'}, 'C', 200_000, infinite, 50);
    expect(delivered[0]!.provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 25});
    expect(s.stocks.reduce((sum, x) => sum + x.cost, 0n)).toBe(7n);
    expect(s.stocks.reduce((sum, x) => sum + (x.provenance.processingMs.s1 ?? 0n), 0n)).toBe(11n);
    delivered[0]!.provenance.firstProcessing = {kind: 'unknown'};
    expect(s.stocks.every(x => x.provenance.firstProcessing.kind === 'known')).toBe(true);
  });

  it('preserves individual known and unknown starts through inspection and detected scrap', () => {
    const s = empty(); receive(s, 'A', Q, {kind: 'known', startedAtMs: 5}, 0, 3n, true); receive(s, 'A', Q, {kind: 'unknown'}, 0, 4n);
    const kit = [{materialId: 'A', quantity: 2 * Q}]; reserveInputs(s, 's1', kit); startProcessingInputs(s, 's1', kit, 25);
    const result = completeInspection(s, 's1', 'A', 10, 40, 2);
    expect(result.scrapped[0]!.provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 5});
    expect(result.passed[0]!.provenance.firstProcessing).toEqual({kind: 'unknown'});
  });

  it('records inspection as the first actual processing of previously unstarted material', () => {
    const s = empty(); receive(s, 'A', Q);
    const kit = [{materialId: 'A', quantity: Q}]; reserveInputs(s, 's1', kit); startProcessingInputs(s, 's1', kit, 25);
    expect(completeInspection(s, 's1', 'A', 10, 40).passed[0]!.provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 25});
  });

  it.each(['production', 'inspection'] as const)('does not infer a start from worked duration when a low-level %s caller did not record one', kind => {
    const s = empty(); receive(s, 'A', Q); reserveInputs(s, 's1', [{materialId: 'A', quantity: Q}]);
    const result = kind === 'production' ? completeProduction(s, 's1', {materialId: 'C', quantity: Q}, 10, 40)
      : completeInspection(s, 's1', 'A', 10, 40).passed[0]!;
    expect(result.provenance.firstProcessing).toEqual({kind: 'unknown'});
  });
});

describe('atomicity, snapshot and deterministic provenance', () => {
  it('rolls back an earlier material split and ID allocation when a later kit input is missing', () => {
    const s = empty(); receive(s, 'A', 2 * Q); reserveInputs(s, 's1', [{materialId: 'A', quantity: 2 * Q}]);
    const before = structuredClone(s);
    expect(() => startProcessingInputs(s, 's1', [{materialId: 'A', quantity: Q}, {materialId: 'B', quantity: Q}], 25)).toThrow(InventoryError);
    expect(s).toEqual(before);
  });

  it.each([-1, 19, 20.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid or pre-arrival processing time %s without changes', timeMs => {
    const s = empty(); receive(s, 'A', Q); reserveInputs(s, 's1', [{materialId: 'A', quantity: Q}]); const before = structuredClone(s);
    expect(() => startProcessingInputs(s, 's1', [{materialId: 'A', quantity: Q}], timeMs)).toThrow(InventoryError); expect(s).toEqual(before);
  });

  it('rejects a transfer or completion before a known first start', () => {
    const s = empty(); receive(s, 'A', Q, {kind: 'known', startedAtMs: 25}); const before = structuredClone(s);
    expect(() => transferStock(s, {ownerId: 's1', location: 'input'}, {ownerId: 's2', location: 'input'}, 'A', Q, infinite, 24)).toThrow(InventoryError); expect(s).toEqual(before);
    reserveInputs(s, 's1', [{materialId: 'A', quantity: Q}]); const reserved = structuredClone(s);
    expect(() => completeProduction(s, 's1', {materialId: 'C', quantity: Q}, 1, 24)).toThrow(InventoryError); expect(s).toEqual(reserved);
  });

  it('validates first-start history without inventing it from admission or attributed time', () => {
    for (const firstProcessing of [{kind: 'known', startedAtMs: -1}, {kind: 'known', startedAtMs: 3}, {kind: 'invalid'}, null]) {
      const s = empty();
      expect(() => receive(s, 'A', Q, firstProcessing as ProcessingOrigin, 5)).toThrow(InventoryError); expect(s.stocks).toEqual([]);
    }
  });

  it('serializes, copies and freezes first-start metadata without freezing the input state', () => {
    const run = compileConfig(oneStation()), state = createPushState(run);
    receive(state, 'raw', Q, {kind: 'known', startedAtMs: 5}); state.timeMs = 20;
    const snapshot = createSnapshot(run, state);
    expect(JSON.parse(JSON.stringify(snapshot)).stocks[0].provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 5});
    expect(snapshot.schemaVersion).toBe(22); expect(Object.isFrozen(snapshot.stocks[0]!.provenance.firstProcessing)).toBe(true);
    state.stocks[0]!.provenance.firstProcessing = {kind: 'unknown'};
    expect(snapshot.stocks[0]!.provenance.firstProcessing).toEqual({kind: 'known', startedAtMs: 5});
  });

  it('rolls first starts and split IDs back with an endpoint event failure', () => {
    const run = compileConfig(oneStation()), state = createPushState(run); receive(state, 'raw', 2 * Q);
    reserveInputs(state, 's1', [{materialId: 'raw', quantity: 2 * Q}]);
    const loop = new EventScheduler(run, state, {dispatch: ctx => {
      startProcessingInputs(ctx.state, 's1', [{materialId: 'raw', quantity: Q}], ctx.timeMs); throw new Error('failed dispatch');
    }});
    loop.schedule({kind: 'dispatch', id: 'fail', stationId: 's1', timeMs: 25}); const before = loop.getSnapshot();
    expect(() => loop.step()).toThrow('failed dispatch'); expect(loop.getSnapshot()).toBe(before);
  });

  it.each(exampleIds)('keeps provenance valid and identical under steps, irregular advances and array order in %s', example => {
    const c = previewConfig(example), run = compileConfig(c), stepped = new Simulation(run);
    function check(model: DeepReadonly<Snapshot>) {
      for (const stock of model.stocks) {
        const p = stock.provenance;
        if (p.firstProcessing.kind === 'known') {
          expect(p.firstProcessing.startedAtMs).toBeLessThanOrEqual(model.timeMs);
          if (p.origin.kind === 'known') expect(p.firstProcessing.startedAtMs).toBeGreaterThanOrEqual(p.origin.startedAtMs);
        }
        if (stock.location === 'held' || stock.location === 'output') expect(p.firstProcessing.kind).not.toBe('notStarted');
      }
    }
    while (stepped.step() !== null) check(stepped.getSnapshot());
    const expected = stepped.getSnapshot(), irregular = new Simulation(run);
    for (let t = 1; t < c.durationMs; t += 137_119) irregular.advanceTo(t);
    expect(irregular.runToEnd()).toEqual(expected); expect(new Simulation(run).runToEnd()).toEqual(expected);
    c.stations.reverse(); c.materials.reverse(); c.recipes.reverse(); c.sources.reverse(); c.routes.reverse(); c.initialStocks.reverse();
    expect(new Simulation(compileConfig(c)).runToEnd()).toEqual(expected);
  });
});
