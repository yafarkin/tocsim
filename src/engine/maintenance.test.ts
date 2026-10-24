import {describe, expect, it} from 'vitest';
import {compileConfig, ConfigError} from './config';
import type {EditorConfig, MaintenanceConfig} from './config';
import {Simulation} from './simulation';
import {line, cyclicLine} from './test-fixtures';
import {processingDuration} from './random';
import {Runner} from '../runner/runner';
const M = 60_000, Q = 1_000_000, DAY = 86_400_000;
function serviceLine(maintenance: MaintenanceConfig = {enabled: true, durationMs: 5 * M, repetitionsThreshold: 1}): EditorConfig {
  const c = line(); c.stations = [c.stations[0]!]; c.stations[0]!.maintenance = maintenance;
  c.stations[0]!.inputBuffer = {kind: 'infinite'};
  c.materials = c.materials.filter(m => m.id !== 'product'); c.materials[1]!.role = 'finished'; c.materials[1]!.salePrice = '20';
  c.recipes = [c.recipes[0]!]; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
  c.sources[0]!.availability = 'warehouse'; c.sources[0]!.intervalMs = 60 * M;
  c.routes = [c.routes[0]!, {...c.routes[1]!, toId: 'market'}];
  c.initialStocks = [{id: 'stock', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '20', cost: '200'}];
  return c;
}
function failure(c: unknown): ConfigError {
  try {compileConfig(c);} catch (e) {expect(e).toBeInstanceOf(ConfigError); return e as ConfigError;}
  throw new Error('Expected ConfigError');
}
const station = (sim: Simulation, t: number) => sim.advanceTo(t).stations[0]!;

describe('maintenance configuration', () => {
  it.each([
    {enabled: true}, {enabled: true, durationMs: 0, repetitionsThreshold: 1},
    {enabled: true, durationMs: 1}, {enabled: true, durationMs: 1, processingThresholdMs: 0, repetitionsThreshold: 0},
    {enabled: true, durationMs: 1, repetitionsThreshold: 1.5}, {enabled: true, durationMs: 1, processingThresholdMs: -1},
    {enabled: true, durationMs: Number.MAX_SAFE_INTEGER + 1, repetitionsThreshold: 1},
    {enabled: false, durationMs: 1}, {enabled: true, durationMs: 1, repetitionsThreshold: 1, extra: 'instructions'},
  ])('rejects invalid service settings %j', maintenance => {
    const c = serviceLine(); Object.assign(c.stations[0]!, {maintenance});
    const e = failure(c); expect(e.path).toMatch(/^config.stations.0.maintenance/); expect(e.objectId).toBe('s1'); expect(e.messages.ru).toBeTruthy(); expect(e.messages.en).toBeTruthy();
  });
  it('normalizes unused zero thresholds, freezes source, and changes the hash for active settings', () => {
    const c = serviceLine(), a = compileConfig(c);
    c.stations[0]!.maintenance = {enabled: true, durationMs: 5 * M, processingThresholdMs: 0, repetitionsThreshold: 1};
    const b = compileConfig(c); expect(b.resolved).toEqual(a.resolved); expect(b.calculationHash).toBe(a.calculationHash);
    expect(Object.isFrozen(a.source.stations[0]!.maintenance)).toBe(true);
    c.stations[0]!.maintenance.durationMs = 6 * M;
    expect(compileConfig(c).calculationHash).not.toBe(a.calculationHash);
    expect(a.resolved.stations[0]!.maintenance).toEqual({enabled: true, durationMs: 5 * M, processingThresholdMs: null, repetitionsThreshold: 1});
    expect(compileConfig(c).resolved.stations[0]!.inputBuffers).toEqual(a.resolved.stations[0]!.inputBuffers);
  });
});

describe('maintenance execution and batch boundaries', () => {
  it('services a released batch even without the next input kit and resets both counters only at completion', () => {
    const c = serviceLine(); c.initialStocks[0]!.quantity = '1'; c.initialStocks[0]!.cost = '10';
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, M)).toMatchObject({status: 'maintenance', maintenanceDueAtMs: M, maintenanceDueBy: ['repetitions'], maintenanceStartedAtMs: M,
      remainingMaintenanceMs: 5 * M, maintenanceProcessingMs: M, maintenanceRepetitions: 1, remainingProcessingMs: null, progress: null});
    expect(station(sim, 5 * M)).toMatchObject({maintenanceProcessingMs: M, maintenanceRepetitions: 1, remainingMaintenanceMs: M});
    const done = station(sim, 6 * M);
    expect(done).toMatchObject({status: 'starved', remainingMaintenanceMs: null, maintenanceProcessingMs: 0, maintenanceRepetitions: 0,
      maintenanceDueAtMs: null, maintenanceDueBy: [], lastMaintenance: {dueAtMs: M, startedAtMs: M, completedAtMs: 6 * M, processingMs: M, repetitions: 1}});
    expect(JSON.parse(JSON.stringify(sim.getSnapshot())).schemaVersion).toBe(21);
  });
  it('marks a time threshold at its exact instant inside a long operation and waits for completion', () => {
    const c = serviceLine({enabled: true, durationMs: 5 * M, processingThresholdMs: 4 * M, repetitionsThreshold: 1});
    c.stations[0]!.plan[0]!.processing.timeMs = 10 * M;
    const sim = new Simulation(compileConfig(c)); sim.step(); expect(sim.nextEventTime()).toBe(4 * M);
    expect(station(sim, 4 * M - 1).maintenanceDueAtMs).toBeNull();
    expect(station(sim, 4 * M)).toMatchObject({status: 'processing', maintenanceDueAtMs: 4 * M, maintenanceDueBy: ['processingTime'],
      maintenanceProcessingMs: 4 * M, maintenanceRepetitions: 0, remainingProcessingMs: 6 * M, remainingMaintenanceMs: null});
    expect(station(sim, 10 * M)).toMatchObject({status: 'maintenance', maintenanceDueAtMs: 4 * M, maintenanceDueBy: ['processingTime'], maintenanceProcessingMs: 10 * M, maintenanceRepetitions: 1, maintenanceStartedAtMs: 10 * M, maintenanceDeferredBy: ['batch']});
  });
  it('records both thresholds when the same completion first reaches them together', () => {
    const sim = new Simulation(compileConfig(serviceLine({enabled: true, durationMs: M, processingThresholdMs: M, repetitionsThreshold: 1})));
    expect(station(sim, M)).toMatchObject({maintenanceDueAtMs: M, maintenanceDueBy: ['processingTime', 'repetitions'], status: 'maintenance'});
  });
  it('finishes sequential repetitions and releases output below the transfer threshold before servicing', () => {
    const c = serviceLine({enabled: true, durationMs: 5 * M, repetitionsThreshold: 1, processingThresholdMs: 2 * M});
    c.stations[0]!.plan[0]!.processing.repetitions = 3; c.stations[0]!.transportThreshold = '3';
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, M)).toMatchObject({status: 'processing', maintenanceDueAtMs: M, maintenanceDueBy: ['repetitions'], maintenanceRepetitions: 1, output: {heldQuantity: Q}, transferReady: false, remainingMaintenanceMs: null});
    expect(station(sim, 2 * M)).toMatchObject({status: 'processing', maintenanceDueBy: ['repetitions'], maintenanceRepetitions: 2});
    expect(station(sim, 3 * M)).toMatchObject({status: 'maintenance', maintenanceStartedAtMs: 3 * M, maintenanceRepetitions: 3, maintenanceProcessingMs: 3 * M, output: {heldQuantity: 0}});
    expect(sim.getSnapshot().line!.counters.find(c => c.materialId === 'part')!.sold).toBe(3 * Q);
  });
  it.each([2, 4])('counts simultaneous repetitions, rather than output quantity, with threshold %s', repetitionsThreshold => {
    const c = serviceLine({enabled: true, durationMs: M, repetitionsThreshold});
    c.initialStocks[0]!.quantity = '3'; c.stations[0]!.plan[0]!.processing = {mode: 'simultaneous', repetitions: 3, timeMs: M, cv: 0};
    c.recipes[0]!.output.quantity = '5';
    const sim = new Simulation(compileConfig(c)), s = station(sim, M);
    expect(s.maintenanceRepetitions).toBe(3); expect(s.maintenanceProcessingMs).toBe(M);
    expect(s.status).toBe(repetitionsThreshold === 2 ? 'maintenance' : 'starved');
    expect(sim.getSnapshot().line!.counters.find(c => c.materialId === 'part')!.produced).toBe(15 * Q);
  });
  it('waits for held output to clear and retains an exact bounded deferral record', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse';
    c.stations[0]!.maintenance = {enabled: true, durationMs: 5 * M, repetitionsThreshold: 1};
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, M)).toMatchObject({status: 'blocked', maintenanceDueAtMs: M, remainingMaintenanceMs: null, output: {heldQuantity: 3 * Q}});
    expect(station(sim, 4 * M)).toMatchObject({status: 'blocked', remainingMaintenanceMs: null});
    expect(station(sim, 5.5 * M)).toMatchObject({status: 'maintenance', maintenanceStartedAtMs: 5.5 * M, maintenanceProcessingMs: M});
    expect(station(sim, 10.5 * M).lastMaintenance).toMatchObject({dueAtMs: M, startedAtMs: 5.5 * M, completedAtMs: 10.5 * M, deferredBy: ['output'], processingMs: M, repetitions: 1});
    const snapshot = sim.runToEnd();
    expect(snapshot.stocks.reduce((sum, s) => sum + BigInt(s.cost), 0n) + snapshot.line!.counters.reduce((sum, c) => sum + BigInt(c.soldCost), 0n)).toBe(5_000_000n);
  });
  it('treats unloading into its own output buffer as releasing the station and adds no processing provenance for service', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse'; c.stations[0]!.outputBuffer = {kind: 'quantity', quantity: '10'};
    c.stations[0]!.maintenance = {enabled: true, durationMs: 5 * M, repetitionsThreshold: 1};
    const snapshot = new Simulation(compileConfig(c)).advanceTo(2 * M);
    expect(snapshot.stations[0]).toMatchObject({status: 'maintenance', maintenanceStartedAtMs: M, maintenanceProcessingMs: M});
    const output = snapshot.stocks.filter(s => s.ownerId === 's1' && s.location === 'output'); expect(output.length).toBeGreaterThan(0);
    for (const stock of output) expect(BigInt(stock.provenance.processingMs.s1!)).toBe(BigInt(stock.quantity) * BigInt(M) / BigInt(10 * Q));
  });
  it('preserves the configured recipe, waits to service before the next setup, and excludes setup time from counters', () => {
    const c = cyclicLine(); c.stations[0]!.setupMs = 7 * M; c.stations[0]!.maintenance = {enabled: true, durationMs: 5 * M, repetitionsThreshold: 1};
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, M)).toMatchObject({status: 'maintenance', configuredRecipeId: 'recipeA'});
    expect(station(sim, 6 * M)).toMatchObject({status: 'processing', configuredRecipeId: 'recipeA', maintenanceProcessingMs: 0});
    expect(station(sim, 7 * M)).toMatchObject({status: 'maintenance', configuredRecipeId: 'recipeA'});
    expect(station(sim, 12 * M)).toMatchObject({status: 'setup', configuredRecipeId: 'recipeA', targetRecipeId: 'recipeB', maintenanceProcessingMs: 0, maintenanceRepetitions: 0});
    expect(station(sim, 19 * M)).toMatchObject({status: 'processing', configuredRecipeId: 'recipeB', maintenanceProcessingMs: 0});
  });
  it('never advances maintenance counters while starved or while maintenance is disabled', () => {
    const c = serviceLine({enabled: true, durationMs: M, processingThresholdMs: M}); c.initialStocks = [];
    expect(new Simulation(compileConfig(c)).runToEnd().stations[0]).toMatchObject({maintenanceProcessingMs: 0, maintenanceRepetitions: 0, maintenanceDueAtMs: null, lastMaintenance: null});
    const disabled = new Simulation(compileConfig(serviceLine({enabled: false}))).runToEnd();
    expect(disabled.stations[0]).toMatchObject({maintenanceProcessingMs: 0, maintenanceRepetitions: 0, maintenanceDueAtMs: null, lastMaintenance: null});
    expect(disabled.line!.counters.find(c => c.materialId === 'part')!.produced).toBe(20 * Q);
  });
  it('does not consume processing random ordinals during service', () => {
    const c = serviceLine(); c.stations[0]!.plan[0]!.processing.cv = 0.5;
    const first = processingDuration(M, 0.5, c.seed, 's1', 'cut', 0), second = processingDuration(M, 0.5, c.seed, 's1', 'cut', 1);
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, first + 5 * M)).toMatchObject({status: 'processing', operationDurationMs: second, maintenanceProcessingMs: 0, maintenanceRepetitions: 0});
  });
});

describe('maintenance calendar and repeatability', () => {
  it('retains the maintenance remainder and processing counters through lunch', () => {
    const c = serviceLine({enabled: true, durationMs: 15 * M, repetitionsThreshold: 1}); c.stations[0]!.plan[0]!.processing.timeMs = 235 * M;
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, 240 * M)).toMatchObject({status: 'paused', reason: 'lunch', remainingMaintenanceMs: 10 * M, maintenanceProcessingMs: 235 * M});
    expect(station(sim, 250 * M).remainingMaintenanceMs).toBe(10 * M);
    expect(station(sim, 300 * M)).toMatchObject({status: 'maintenance', remainingMaintenanceMs: 10 * M, maintenanceProcessingMs: 235 * M});
    expect(station(sim, 310 * M)).toMatchObject({status: 'processing', maintenanceProcessingMs: 0, lastMaintenance: {completedAtMs: 310 * M}});
  });
  it('pauses a time-threshold event through lunch and marks it only after active processing reaches the threshold', () => {
    const c = serviceLine({enabled: true, durationMs: M, processingThresholdMs: 250 * M}); c.stations[0]!.plan[0]!.processing.timeMs = 400 * M;
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, 300 * M)).toMatchObject({maintenanceDueAtMs: null, maintenanceProcessingMs: 240 * M});
    expect(station(sim, 310 * M)).toMatchObject({maintenanceDueAtMs: 310 * M, maintenanceDueBy: ['processingTime'], remainingProcessingMs: 150 * M});
  });
  it('resumes service over multiple nights and ignores obsolete completion events', () => {
    const c = serviceLine({enabled: true, durationMs: 1000 * M, repetitionsThreshold: 1}); c.durationMs += 2 * DAY;
    c.initialStocks[0]!.quantity = '1';
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, 540 * M)).toMatchObject({remainingMaintenanceMs: 521 * M, maintenanceProcessingMs: M});
    expect(station(sim, DAY)).toMatchObject({status: 'maintenance', remainingMaintenanceMs: 521 * M});
    expect(station(sim, 2 * DAY)).toMatchObject({remainingMaintenanceMs: 41 * M});
    expect(station(sim, 2 * DAY + 41 * M)).toMatchObject({remainingMaintenanceMs: null, maintenanceProcessingMs: 0, lastMaintenance: {completedAtMs: 2 * DAY + 41 * M}});
  });
  it('handles coincident 24:00 closing and 00:00 opening with one service completion', () => {
    const c = serviceLine({enabled: true, durationMs: 120 * M, repetitionsThreshold: 1});
    c.calendar = {shiftStartMs: 0, lunchStartMs: 720 * M, lunchEndMs: 780 * M, shiftEndMs: DAY}; c.durationMs = 2 * DAY;
    c.stations[0]!.plan[0]!.processing.timeMs = 1320 * M; c.initialStocks[0]!.quantity = '1';
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, DAY)).toMatchObject({status: 'maintenance', remainingMaintenanceMs: 60 * M});
    expect(station(sim, DAY + 60 * M)).toMatchObject({status: 'starved', remainingMaintenanceMs: null, lastMaintenance: {completedAtMs: DAY + 60 * M}});
  });
  it('defers the service start through lunch and records calendar waiting separately from the service remainder', () => {
    const c = serviceLine(); c.stations[0]!.plan[0]!.processing.timeMs = 240 * M;
    const sim = new Simulation(compileConfig(c));
    expect(station(sim, 240 * M)).toMatchObject({reason: 'lunch', maintenanceDueAtMs: 240 * M, remainingMaintenanceMs: null, maintenanceStartedAtMs: null});
    expect(station(sim, 300 * M)).toMatchObject({status: 'maintenance', maintenanceDeferredBy: ['calendar'], maintenanceStartedAtMs: 300 * M});
    expect(station(sim, 305 * M).lastMaintenance).toMatchObject({dueAtMs: 240 * M, startedAtMs: 300 * M, completedAtMs: 305 * M, deferredBy: ['calendar']});
  });
  it('completes service exactly on lunch before the calendar close without reserving the next kit', () => {
    const c = serviceLine({enabled: true, durationMs: 10 * M, repetitionsThreshold: 1}); c.stations[0]!.plan[0]!.processing.timeMs = 230 * M;
    const sim = new Simulation(compileConfig(c)), lunch = station(sim, 240 * M);
    expect(lunch).toMatchObject({reason: 'lunch', remainingMaintenanceMs: null, maintenanceProcessingMs: 0, lastMaintenance: {completedAtMs: 240 * M}});
    expect(sim.getSnapshot().stocks.some(s => s.location === 'reserved')).toBe(false);
    expect(station(sim, 300 * M).status).toBe('processing');
  });
  it('completes service on the horizon, resets counters and never starts another batch there', () => {
    const c = serviceLine({enabled: true, durationMs: 479 * M, repetitionsThreshold: 1});
    const end = new Simulation(compileConfig(c)).runToEnd();
    expect(end.stations[0]).toMatchObject({reason: 'horizon', remainingMaintenanceMs: null, maintenanceRepetitions: 0, lastMaintenance: {completedAtMs: 540 * M}});
    expect(end.line!.counters.find(c => c.materialId === 'part')!.produced).toBe(Q); expect(end.stocks.some(s => s.location === 'reserved')).toBe(false);
  });
  it('retains uncompleted service and does not reset its counters, even at maximum safe duration', () => {
    const c = serviceLine({enabled: true, durationMs: Number.MAX_SAFE_INTEGER, repetitionsThreshold: 1});
    const end = new Simulation(compileConfig(c)).runToEnd();
    expect(end.stations[0]).toMatchObject({reason: 'horizon', remainingMaintenanceMs: Number.MAX_SAFE_INTEGER - 479 * M, maintenanceProcessingMs: M, maintenanceRepetitions: 1, lastMaintenance: null});
  });
  it('marks maintenance due at the horizon but does not start service there', () => {
    const c = serviceLine(); c.stations[0]!.plan[0]!.processing.timeMs = 480 * M;
    expect(new Simulation(compileConfig(c)).runToEnd().stations[0]).toMatchObject({maintenanceDueAtMs: 540 * M, remainingMaintenanceMs: null, maintenanceStartedAtMs: null, reason: 'horizon'});
  });
  it.each(['sequential', 'simultaneous'] as const)('matches mixed plans at all speeds, irregular advances, pauses, steps and repeat in %s mode', mode => {
    const c = cyclicLine(); const s = c.stations[0]!; s.setupMs = 7 * M;
    s.maintenance = {enabled: true, durationMs: 15 * M, processingThresholdMs: 90_000, repetitionsThreshold: 3};
    s.plan.forEach((r, i) => {r.processing = {mode, repetitions: 2, distribution: i === 0 ? {kind: 'uniform', minMs: M, maxMs: 2 * M} : {kind: 'triangular', minMs: M, peakMs: 2 * M, maxMs: 3 * M}};});
    const run = compileConfig(c), expected = new Simulation(run).runToEnd();
    const irregular = new Simulation(run); for (const time of [1, M, 7 * M + 1, 240 * M, 300 * M, c.durationMs]) irregular.advanceTo(time);
    expect(irregular.getSnapshot()).toEqual(expected); c.routes.reverse(); c.materials.reverse(); expect(new Simulation(compileConfig(c)).runToEnd()).toEqual(expected);
    for (const speed of [1,60,300,1800,'max'] as const) {
      let now = 0, callback: (() => void) | null = null;
      const runner = new Runner(run, undefined, {now: () => now, request: cb => {callback = cb; return cb;}, cancel: () => {callback = null;}});
      const drain = () => {let count = 0; while (callback) {if (++count > 2000) throw new Error('No progress');const cb = callback; callback = null; now += 60_000; cb();}};
      runner.setSpeed(speed);
      let steps = 0; while (runner.getView().model.stations[0]!.remainingMaintenanceMs === null) {runner.step(); if (++steps > 30) throw new Error('Service did not start');}
      runner.resume(); runner.pause(); const paused = runner.getView(); now += 100_000; expect(runner.getView()).toBe(paused); runner.resume(); drain();
      expect(runner.getView().model).toEqual(expected); runner.repeat(); drain(); expect(runner.getView().model).toEqual(expected); runner.dispose();
    }
    const stepped = new Simulation(run); while (stepped.step()) {} expect(stepped.getSnapshot()).toEqual(expected);
  });
});
