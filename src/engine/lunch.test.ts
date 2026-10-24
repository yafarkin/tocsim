import {describe, expect, it} from 'vitest';
import {compileConfig, ConfigError} from './config';
import {Simulation} from './simulation';
import {line} from './test-fixtures';
import {lunchCost, parseMoney, ArithmeticError, MAX_UNITS} from './arithmetic';
import {DAY_MS} from './calendar';
import {Runner} from '../runner/runner';
const M = 60_000;
function lunchLine(replacement = true) {
  const c = line();
  c.calendar = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 20 * M, shiftEndMs: 30 * M};
  c.durationMs = 30 * M;
  c.stations = [c.stations[0]!];
  const s = c.stations[0]!;
  s.lunchReplacement = replacement; s.costs.perLunchHour = '12'; s.inputBuffer = {kind: 'infinite'};
  s.plan[0]!.processing.timeMs = 12 * M;
  c.recipes = [c.recipes[0]!]; c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
  c.materials = c.materials.filter(m => m.id !== 'product'); c.materials[1]!.role = 'finished'; c.materials[1]!.salePrice = '20';
  c.sources[0]!.availability = 'warehouse';
  c.routes = [c.routes[0]!, {...c.routes[1]!, toId: 'market'}];
  c.initialStocks = [{id: 'stock', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '1', cost: '10'}];
  return c;
}
const simFor = (c = lunchLine()) => new Simulation(compileConfig(c));

describe('per-station lunch configuration', () => {
  it('freezes the flag and includes it in calculation identity', () => {
    const c = lunchLine(), run = compileConfig(c); c.stations[0]!.lunchReplacement = false;
    expect(run.resolved.stations[0]!.lunchReplacement).toBe(true);
    expect(Object.isFrozen(run.source.stations[0])).toBe(true);
    expect(compileConfig(c).calculationHash).not.toBe(run.calculationHash);
  });
  it.each([undefined, null, 1, 'true', {}])('rejects a non-boolean flag %j', flag => {
    const c = lunchLine(); Object.assign(c.stations[0]!, {lunchReplacement: flag});
    try {compileConfig(c); throw new Error('Expected failure');} catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({path: 'config.stations.0.lunchReplacement', objectId: 's1'});
    }
  });
});

describe('lunch operations and charging', () => {
  it.each([false, true])('retains or works the remainder with replacement %s', replacement => {
    const sim = simFor(lunchLine(replacement));
    expect(sim.advanceTo(10 * M).stations[0]).toMatchObject({status: replacement ? 'processing' : 'paused', remainingProcessingMs: 2 * M, lunchBusyMs: 0, lunchCost: '0'});
    const at12 = sim.advanceTo(12 * M);
    expect(at12.stations[0]).toMatchObject(replacement ? {status: 'starved', lunchBusyMs: 2 * M, lunchCost: '400000'} : {status: 'paused', remainingProcessingMs: 2 * M, lunchBusyMs: 0, lunchCost: '0'});
    const end = sim.runToEnd();
    expect(end.line!.counters.find(x => x.materialId === 'part')!.sold).toBe(1_000_000);
    expect(end.stocks).toEqual([]);
  });
  it('starts new operations during lunch and stops charging when input runs out', () => {
    const c = lunchLine(); c.initialStocks[0]!.quantity = '4'; c.stations[0]!.plan[0]!.processing.timeMs = 4 * M;
    const end = simFor(c).runToEnd();
    expect(end.stations[0]).toMatchObject({lunchBusyMs: 6 * M, lunchCost: '1200000'});
    expect(end.line!.counters.find(x => x.materialId === 'part')!.sold).toBe(4_000_000);
  });
  it.each(['sequential', 'simultaneous'] as const)('finishes the whole %s batch in lunch', mode => {
    const c = lunchLine(); c.initialStocks[0]!.quantity = '3';
    Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions: 3, timeMs: (mode === 'sequential' ? 4 : 12) * M});
    const at12 = simFor(c).advanceTo(12 * M);
    expect(at12.line!.counters.find(x => x.materialId === 'part')!.sold).toBe(3_000_000);
    expect(at12.stations[0]).toMatchObject({lunchBusyMs: 2 * M, lunchCost: '400000'});
  });
  it('charges setup followed by processing, without treating setup as maintenance processing time', () => {
    const c = lunchLine(), s = c.stations[0]!;
    c.recipes.push({...structuredClone(c.recipes[0]!), id: 'other'});
    s.plan.push({...structuredClone(s.plan[0]!), id: 'otherPlan', recipeId: 'other'});
    s.initialRecipeId = 'other'; s.setupMs = 12 * M; s.plan[0]!.processing.timeMs = 2 * M;
    s.maintenance = {enabled: true, durationMs: M, processingThresholdMs: M};
    const at14 = simFor(c).advanceTo(14 * M);
    expect(at14.stations[0]).toMatchObject({status: 'maintenance', lunchBusyMs: 4 * M, maintenanceProcessingMs: 2 * M, maintenanceDueAtMs: 13 * M});
  });
  it('charges maintenance and counts lunch processing toward its threshold', () => {
    const c = lunchLine(); c.stations[0]!.maintenance = {enabled: true, durationMs: 4 * M, processingThresholdMs: 11 * M};
    const sim = simFor(c);
    expect(sim.advanceTo(11 * M).stations[0]).toMatchObject({maintenanceDueAtMs: 11 * M, maintenanceProcessingMs: 11 * M});
    expect(sim.advanceTo(16 * M).stations[0]).toMatchObject({status: 'starved', lunchBusyMs: 6 * M, lunchCost: '1200000', lastMaintenance: {completedAtMs: 16 * M}});
  });
  it('does not charge output blocking', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse';
    c.stations[0]!.lunchReplacement = true; c.stations[0]!.costs.perLunchHour = '12';
    c.stations[0]!.plan[0]!.processing.timeMs = 252 * M; c.stations[1]!.plan[0]!.processing.timeMs = 500 * M;
    c.initialStocks.push({id: 'second', ownerId: 's2', location: 'input', materialId: 'part', quantity: '6', cost: '1'});
    const sim = simFor(c);
    expect(sim.advanceTo(300 * M).stations[0]).toMatchObject({status: 'blocked', lunchBusyMs: 12 * M, lunchCost: '2400000'});
  });
  it.each([10, 20, 30])('accounts exactly for completion at minute %s', minutes => {
    const c = lunchLine(); c.stations[0]!.plan[0]!.processing.timeMs = minutes * M;
    const end = simFor(c).runToEnd();
    expect(end.stations[0]).toMatchObject({lunchBusyMs: (minutes === 10 ? 0 : 10 * M), lunchCost: minutes === 10 ? '0' : '2000000', remainingProcessingMs: null});
    expect(end.line!.counters.find(x => x.materialId === 'part')!.sold).toBe(1_000_000);
  });
  it('retains processing through night and charges only lunch across days', () => {
    const c = lunchLine(); c.durationMs = DAY_MS + 30 * M; c.stations[0]!.plan[0]!.processing.timeMs = 45 * M;
    const sim = simFor(c);
    expect(sim.advanceTo(DAY_MS).stations[0]).toMatchObject({status: 'processing', remainingProcessingMs: 15 * M, lunchBusyMs: 10 * M});
    expect(sim.runToEnd().stations[0]).toMatchObject({lunchBusyMs: 15 * M, lunchCost: '3000000', remainingProcessingMs: null});
  });
  it.each(['setup', 'maintenance'] as const)('retains %s through night and charges only active lunch time', kind => {
    const c = lunchLine(); c.durationMs = DAY_MS + 30 * M;
    const s = c.stations[0]!;
    if (kind === 'setup') {
      c.recipes.push({...structuredClone(c.recipes[0]!), id: 'other'});
      s.plan.push({...structuredClone(s.plan[0]!), id: 'otherPlan', recipeId: 'other'});
      s.initialRecipeId = 'other'; s.setupMs = 45 * M; s.plan[0]!.processing.timeMs = M;
    } else {
      s.plan[0]!.processing.timeMs = M; s.maintenance = {enabled: true, durationMs: 44 * M, repetitionsThreshold: 1};
    }
    const sim = simFor(c);
    const close = sim.advanceTo(30 * M).stations[0]!;
    expect(close).toMatchObject({status: 'paused', reason: 'offShift', lunchBusyMs: 10 * M});
    expect(kind === 'setup' ? close.remainingSetupMs : close.remainingMaintenanceMs).toBe(15 * M);
    const beforeOpen = sim.advanceTo(DAY_MS - 1).stations[0]!;
    expect(beforeOpen.lunchBusyMs).toBe(10 * M);
    expect(sim.runToEnd().stations[0]).toMatchObject({lunchBusyMs: (kind === 'setup' ? 16 : 15) * M, remainingSetupMs: null, remainingMaintenanceMs: null});
  });
  it('handles a 24:00 close coinciding with the next opening for a replacement station', () => {
    const c = lunchLine(); c.calendar = {shiftStartMs: 0, lunchStartMs: 720 * M, lunchEndMs: 780 * M, shiftEndMs: DAY_MS};
    c.durationMs = 2 * DAY_MS; c.stations[0]!.plan[0]!.processing.timeMs = DAY_MS + M;
    const sim = simFor(c);
    expect(sim.advanceTo(DAY_MS).stations[0]).toMatchObject({status: 'processing', remainingProcessingMs: M, lunchBusyMs: 60 * M});
    expect(sim.advanceTo(DAY_MS + M).stations[0]).toMatchObject({status: 'starved', remainingProcessingMs: null, lunchBusyMs: 60 * M});
  });
  it('counts busy lunch time even when the hourly rate is zero', () => {
    const c = lunchLine(); c.stations[0]!.costs.perLunchHour = '0';
    expect(simFor(c).runToEnd().stations[0]).toMatchObject({lunchBusyMs: 2 * M, lunchCost: '0'});
  });
  it('keeps sources on the common calendar despite replacement', () => {
    const c = lunchLine(); c.initialStocks = []; c.sources[0]!.availability = 'virtual'; c.sources[0]!.intervalMs = 10 * M;
    const sim = simFor(c);
    expect(sim.advanceTo(19 * M).sources[0]!.attempts).toBe(1);
    expect(sim.advanceTo(20 * M).sources[0]!.attempts).toBe(2);
  });
  it('runs one station during lunch while its neighbour pauses', () => {
    const c = line(); c.stations[0]!.lunchReplacement = true;
    c.stations.forEach(s => {s.plan[0]!.processing.timeMs = 260 * M; s.inputBuffer = {kind: 'infinite'};});
    c.initialStocks.push({id: 'second', ownerId: 's2', location: 'input', materialId: 'part', quantity: '1', cost: '1'});
    const sim = simFor(c);
    const lunch = sim.advanceTo(250 * M);
    expect(lunch.stations[0]).toMatchObject({status: 'processing', remainingProcessingMs: 10 * M, lunchBusyMs: 10 * M});
    expect(lunch.stations[1]).toMatchObject({status: 'paused', remainingProcessingMs: 20 * M, lunchBusyMs: 0});
  });
});

describe('cumulative charge and repeatability', () => {
  it('rounds the cumulative amount to micro-units, with safe bounds', () => {
    expect(lunchCost(1n, 1_799_999)).toBe(0n); expect(lunchCost(1n, 1_800_000)).toBe(1n);
    expect(lunchCost(parseMoney('12'), M)).toBe(200000n);
    expect(lunchCost(MAX_UNITS, 3_600_000)).toBe(MAX_UNITS);
    expect(() => lunchCost(MAX_UNITS, 3_600_001)).toThrow(ArithmeticError);
  });
  it('has identical random outcomes, charges and snapshots for direct, split and stepped runs', () => {
    const c = lunchLine(); c.initialStocks[0]!.quantity = '20';
    Object.assign(c.stations[0]!.plan[0]!.processing, {timeMs: 123456, cv: 0.2}); c.stations[0]!.costs.perLunchHour = '0.000001';
    const run = compileConfig(c), direct = simFor(c).runToEnd(), split = simFor(c), stepped = simFor(c);
    for (let t = 0; t < c.durationMs; t += 12347) split.advanceTo(t);
    while (stepped.step()) { /* Full timestamps. */ }
    expect(split.runToEnd()).toEqual(direct); expect(stepped.getSnapshot()).toEqual(direct);
    for (const speed of [1, 60, 300, 1800, 'max'] as const) {
      let now = 0, callback: (() => void) | null = null;
      const runner = new Runner(run, undefined, {now: () => now, request: cb => {callback = cb; return cb;}, cancel: () => {callback = null;}});
      const drain = () => {let count = 0; while (callback) {if (++count > 2000) throw new Error('No progress'); const cb = callback; callback = null; now += M; cb();}};
      runner.setSpeed(speed); runner.step(); runner.resume(); runner.pause();
      const paused = runner.getView(); now += M; expect(runner.getView()).toBe(paused);
      runner.resume(); drain(); expect(runner.getView().model).toEqual(direct);
      runner.repeat(); drain(); expect(runner.getView().model).toEqual(direct); runner.dispose();
    }
    expect(JSON.parse(JSON.stringify(direct)).schemaVersion).toBe(23);
  });
});
