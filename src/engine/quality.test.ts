import {describe, expect, it} from 'vitest';
import {compileConfig, ConfigError} from './config';
import {line} from './test-fixtures';
import {defectOccurs, processingDuration, RandomError, uniform} from './random';
import {completeProductionBatch, InventoryError, receiveStock, reserveInputs, transferStock} from './inventory';
import type {InventoryState, Provenance, StockState} from './state';
import {Simulation} from './simulation';
import {Runner} from '../runner/runner';
import {MAX_UNITS} from './arithmetic';
const Q = 1_000_000, M = 60_000, DAY = 86_400_000, infinite = {kind: 'infinite'} as const;
const state = (): InventoryState => ({stocks: [], nextStockOrdinal: 0});
function receive(s: InventoryState, material: string, count: number, cost: bigint, bad = false, prior = 0n) {
  const provenance: Provenance = {origin: {kind: 'known', startedAtMs: 0}, defective: bad, defectSourceIds: bad ? ['upstream'] : [], processingMs: {upstream: prior}};
  receiveStock(s, {ownerId: 's1', location: 'input'}, {materialId: material, quantity: count, cost, provenance}, infinite);
}
const quality = (probability: number) => ({probability, seed: 42, recipeId: 'cut', operationOrdinal: 0});
const flags = (stocks: readonly StockState[]) => stocks.flatMap(s => Array.from({length: s.quantity / Q}, () => s.provenance.defective));
const sumCost = (stocks: readonly StockState[]) => stocks.reduce((sum, s) => sum + s.cost, 0n);
const sumTime = (stocks: readonly StockState[], id: string) => stocks.reduce((sum, s) => sum + (s.provenance.processingMs[id] ?? 0n), 0n);
function finiteLine(probability = 0.35, mode: 'sequential' | 'simultaneous' = 'simultaneous') {
  const c = line(); c.calendar = {shiftStartMs: 0, lunchStartMs: 10 * M, lunchEndMs: 20 * M, shiftEndMs: 30 * M}; c.durationMs = DAY + 30 * M;
  c.sources[0]!.availability = 'warehouse'; c.initialStocks[0]!.quantity = '3.6'; c.initialStocks[0]!.cost = '36';
  c.stations[0]!.inputBuffer = {kind: 'infinite'}; c.stations[0]!.lunchReplacement = true;
  Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions: 3, timeMs: 4 * M, cv: 0.25, defectProbability: probability});
  c.recipes[0]!.output.quantity = '3'; c.stations[0]!.maintenance = {enabled: true, durationMs: 2 * M, repetitionsThreshold: 3};
  c.stations[1]!.plan[0]!.processing.cv = 0.25; c.stations[1]!.plan[0]!.processing.timeMs = M;
  return c;
}

describe('quality profile and independent RNG', () => {
  it('normalizes absent/zero probability, freezes the profile and changes identity for active quality', () => {
    const c = line(), absent = compileConfig(c);
    c.stations[0]!.plan[0]!.processing.defectProbability = 0;
    expect(compileConfig(c).calculationHash).toBe(absent.calculationHash);
    c.stations[0]!.plan[0]!.processing.defectProbability = 0.2;
    const active = compileConfig(c); expect(active.calculationHash).not.toBe(absent.calculationHash);
    expect(active.resolved.stations[0]!.plan[0]!.defectProbability).toBe(0.2);
    expect(Object.isFrozen(active.source.stations[0]!.plan[0]!.processing)).toBe(true);
    c.stations[0]!.plan[0]!.processing.defectProbability = 1;
    expect(active.source.stations[0]!.plan[0]!.processing.defectProbability).toBe(0.2);
  });
  it.each([-0.1, 1.1, NaN, Infinity, null, '0.2', {}])('rejects invalid probability %j before the run', probability => {
    const c = line(); Object.assign(c.stations[0]!.plan[0]!.processing, {defectProbability: probability});
    try {compileConfig(c); throw new Error('Expected invalid config');} catch (e) {
      expect(e).toBeInstanceOf(ConfigError); expect(e).toMatchObject({path: 'config.stations.0.plan.0.processing.defectProbability', objectId: 's1'});
      expect((e as ConfigError).messages.ru).toBeTruthy(); expect((e as ConfigError).messages.en).toBeTruthy();
    }
  });
  it('uses a distinct indexed quality stream with exact endpoints and a fixed reference sequence', () => {
    const expected = [true, true, true, true, true, false, false, false, true, false, false, false];
    expect(expected.map((_, i) => defectOccurs(0.5, 42, 's1', 'cut', 0, i))).toEqual(expected);
    for (let i = 0; i < 12; i++) {
      expect(defectOccurs(0, 42, 's1', 'cut', 0, i)).toBe(false); expect(defectOccurs(1, 42, 's1', 'cut', 0, i)).toBe(true);
      expect(defectOccurs(0.35, 42, 's1', 'cut', 0, i)).toBe(uniform(42, 's1', 'cut', 0, 'defect', i) < 0.35);
    }
    const duration = processingDuration(123456, 0.5, 42, 's1', 'cut', 0);
    for (let i = 0; i < 100; i++) defectOccurs(0.5, 42, 's1', 'cut', 0, i);
    expect(processingDuration(123456, 0.5, 42, 's1', 'cut', 0)).toBe(duration);
    expect(() => defectOccurs(0.5, 42, 's1', 'cut', -1, 0)).toThrow(RandomError);
    expect(() => defectOccurs(0.5, 42, 's1', 'cut', 0, -1)).toThrow(RandomError);
  });
});

describe('per-piece production and inherited kits', () => {
  it.each([0, 1])('preserves each deterministic kit and its accounting at p=%s', probability => {
    const s = state(); receive(s, 'A', 3 * Q, 7n, false, 11n); reserveInputs(s, 's1', [{materialId: 'A', quantity: 3 * Q}]);
    const result = completeProductionBatch(s, 's1', {materialId: 'B', quantity: 4 * Q}, 5, 100, [{materialId: 'A', quantity: Q}], 3, quality(probability));
    expect(result).toHaveLength(3);
    expect(result.map(s=>s.quantity)).toEqual([4*Q,4*Q,4*Q]);
    expect(result.map(s=>s.cost)).toEqual([2n,2n,3n]);
    expect(result.map(s=>s.provenance.processingMs.s1)).toEqual([1n,2n,2n]);
    expect(sumTime(result,'upstream')).toBe(11n);
    expect(result.every(s=>s.provenance.defective === !!probability)).toBe(true);
    expect(result.map(s=>s.provenance.defectSourceIds)).toEqual([0,1,2].map(()=>probability?['s1']:[]));
  });
  it('keeps huge healthy deterministic outputs compact', () => {
    const s = state(); receive(s, 'A', Q, 1n); reserveInputs(s, 's1', [{materialId: 'A', quantity: Q}]);
    const output = Number(MAX_UNITS / BigInt(Q)) * Q;
    expect(completeProductionBatch(s, 's1', {materialId: 'B', quantity: output}, 1, 0, [{materialId: 'A', quantity: Q}], 1, quality(0))).toHaveLength(1);
  });
  it('samples every output piece, preserves FIFO and balances indivisible cost/time remainders', () => {
    const s = state(); receive(s, 'A', Q, 7n, false, 11n); reserveInputs(s, 's1', [{materialId: 'A', quantity: Q}]);
    const outputs = completeProductionBatch(s, 's1', {materialId: 'B', quantity: 12 * Q}, 5, 100, [{materialId: 'A', quantity: Q}], 1, quality(0.5));
    expect(flags(outputs)).toEqual([true, true, true, true, true, false, false, false, true, false, false, false]);
    expect(outputs.map(s => s.quantity)).toEqual([5 * Q, 3 * Q, Q, 3 * Q]);
    expect(sumCost(outputs)).toBe(7n); expect(sumTime(outputs, 'upstream')).toBe(11n); expect(sumTime(outputs, 's1')).toBe(5n);
    // Prefix allocation gives these costs without making each quality run a new rounding origin.
    expect(outputs.map(s => s.cost)).toEqual([2n, 2n, 1n, 2n]);
    expect(outputs.every(s => s.readyAtMs === 100 && s.location === 'held')).toBe(true);
    outputs[0]!.provenance.defectSourceIds.push('mutated'); expect(s.stocks[0]!.provenance.defectSourceIds).toEqual(['s1']);
  });
  it('keeps the bad assembly kit separate from both good simultaneous neighbours', () => {
    const s = state();
    receive(s, 'A', Q, 7n, false, 31n); receive(s, 'A', Q, 11n, true, 41n); receive(s, 'A', Q, 13n, false, 59n);
    receive(s, 'C', 3 * Q, 10n, false, 17n);
    reserveInputs(s, 's1', [{materialId: 'A', quantity: 3 * Q}, {materialId: 'C', quantity: 3 * Q}]);
    const outputs = completeProductionBatch(s, 's1', {materialId: 'B', quantity: 2 * Q}, 5, 10, [{materialId: 'A', quantity: Q}, {materialId: 'C', quantity: Q}], 3);
    expect(flags(outputs)).toEqual([false, false, true, true, false, false]);
    expect(outputs.map(s => s.cost)).toEqual([10n, 14n, 17n]);
    expect(outputs.map(s => s.provenance.processingMs.s1)).toEqual([1n, 2n, 2n]);
    expect(sumTime(outputs, 'upstream')).toBe(148n); expect(sumTime(outputs, 's1')).toBe(5n);
    expect(outputs.map(s => s.provenance.defectSourceIds)).toEqual([[], ['upstream'], []]);
    expect(s.stocks.every(s => s.location === 'held')).toBe(true);
  });
  it('keeps different own samples across repetitions and records all inherited/own sources', () => {
    const s = state(); receive(s, 'A', Q, 5n, true, 3n); receive(s, 'A', Q, 7n, false, 2n);
    reserveInputs(s, 's1', [{materialId: 'A', quantity: 2 * Q}]);
    const outputs = completeProductionBatch(s, 's1', {materialId: 'B', quantity: 6 * Q}, 1, 0, [{materialId: 'A', quantity: Q}], 2, quality(0.5));
    expect(flags(outputs)).toEqual([true,true,true,true,true,true,false,false,true,false,false,false]);
    expect(outputs.map(s => s.provenance.defectSourceIds)).toEqual([['s1','upstream'],['upstream'],[],['s1'],[]]);
    expect(sumCost(outputs)).toBe(12n); expect(sumTime(outputs, 's1')).toBe(1n); expect(sumTime(outputs, 'upstream')).toBe(5n);
  });
  it('preserves fractions of an original defective piece and contaminates only repetitions consuming them', () => {
    const s = state(); receive(s, 'A', Q, 7n, true, 11n); receive(s, 'A', Q, 9n, false, 13n);
    const moved = transferStock(s, {ownerId: 's1', location: 'input'}, {ownerId: 's2', location: 'input'}, 'A', 600000, infinite, 1);
    expect(moved[0]).toMatchObject({quantity: 600000, provenance: {defective: true, defectSourceIds: ['upstream']}});
    reserveInputs(s, 's1', [{materialId: 'A', quantity: 1200000}]);
    const output = completeProductionBatch(s, 's1', {materialId: 'B', quantity: Q}, 3, 2, [{materialId: 'A', quantity: 400000}], 3);
    expect(flags(output)).toEqual([true, false, false]);
    expect(sumCost(s.stocks)).toBe(16n); expect(sumTime(s.stocks,'upstream')).toBe(24n); expect(sumTime(s.stocks,'s1')).toBe(3n);
    expect(s.stocks.find(s => s.ownerId === 's2')!.provenance.defective).toBe(true);
  });
  it('rolls back all repetitions if a later kit is missing or a sample is invalid', () => {
    const s = state(); receive(s, 'A', Q, 1n, true); reserveInputs(s, 's1', [{materialId: 'A', quantity: Q}]);
    const before = structuredClone(s);
    expect(() => completeProductionBatch(s,'s1',{materialId:'B',quantity:Q},1,0,[{materialId:'A',quantity:Q}],2,quality(0.5))).toThrow(InventoryError);
    expect(s).toEqual(before);
    expect(() => completeProductionBatch(s,'s1',{materialId:'B',quantity:Q},1,0,[{materialId:'A',quantity:Q}],1,quality(NaN))).toThrow(RandomError);
    expect(s).toEqual(before);
  });
});

describe('simulation and repeatability', () => {
  it.each(['sequential','simultaneous'] as const)('inherits per-kit outcomes in %s execution without changing timing RNG', mode => {
    const a = new Simulation(compileConfig(finiteLine(0,mode))), b = new Simulation(compileConfig(finiteLine(0.5,mode)));
    const trace = (sim: Simulation) => {const result = []; while (sim.step()) {const s = sim.getSnapshot(); result.push({time:s.timeMs,stations:s.stations.map(x=>({id:x.stationId,status:x.status,duration:x.operationDurationMs,remaining:x.remainingProcessingMs,setup:x.remainingSetupMs,maintenance:x.remainingMaintenanceMs}))});} return result;};
    expect(trace(b)).toEqual(trace(a));
    const bad = b.getSnapshot(); expect(bad.line!.counters.find(c=>c.materialId==='product')!.scrapped).toBeGreaterThan(0);
    expect(bad.line!.counters.find(c=>c.materialId==='product')!.sold).toBeGreaterThan(0);
    expect(bad.line!.counters.reduce((sum,c)=>sum+BigInt(c.soldCost)+BigInt(c.scrapCost),0n)+bad.stocks.reduce((sum,s)=>sum+BigInt(s.cost),0n)).toBe(36_000_000n);
  });
  it.each(['sequential','simultaneous'] as const)('matches irregular advances, speeds, pause, step, repeat and array order in %s mode', mode => {
    const c = finiteLine(0.35,mode), run = compileConfig(c), expected = new Simulation(run).runToEnd();
    const split = new Simulation(run); for (const t of [0,1,12347,10*M,12*M+1,20*M,30*M,DAY,DAY+M,c.durationMs]) split.advanceTo(t);
    expect(split.getSnapshot()).toEqual(expected);
    c.stations.reverse(); c.routes.reverse(); c.materials.reverse(); c.recipes.reverse();
    expect(new Simulation(compileConfig(c)).runToEnd()).toEqual(expected);
    for (const speed of [1,60,300,1800,'max'] as const) {
      let now=0, callback:(()=>void)|null=null;
      const runner=new Runner(run,undefined,{now:()=>now,request:cb=>{callback=cb;return cb;},cancel:()=>{callback=null;}});
      const drain=()=>{let n=0;while(callback){if(++n>3000)throw new Error('No progress');const cb=callback;callback=null;now+=M;cb();}};
      runner.setSpeed(speed);runner.step();runner.resume();runner.pause();const paused=runner.getView();now+=M;expect(runner.getView()).toBe(paused);
      runner.resume();drain();expect(runner.getView().model).toEqual(expected);runner.repeat();drain();expect(runner.getView().model).toEqual(expected);runner.dispose();
    }
  });
  it('assembles simultaneous kits in the real engine without spreading one bad component to the batch', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse';
    c.recipes[0]!.output.quantity = '12';
    Object.assign(c.stations[0]!.plan[0]!.processing, {timeMs: 1000, defectProbability: 0.5});
    c.stations[1]!.inputBuffer = {kind: 'infinite'};
    Object.assign(c.stations[1]!.plan[0]!.processing, {mode:'simultaneous', repetitions:12, timeMs:1001});
    c.recipes[1]!.inputs.push({materialId:'raw',quantity:'0.1'});
    c.routes.push({id:'side',fromId:'source',toId:'s2',materialId:'raw'});
    c.initialStocks.push({id:'side-kit',ownerId:'s2',location:'input',materialId:'raw',quantity:'1.2',cost:'7'});
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(1000).stations.find(s=>s.stationId==='s2')).toMatchObject({status:'processing',inputs:[{materialId:'part',reservedQuantity:12*Q},{materialId:'raw',reservedQuantity:1200000}]});
    const done = sim.advanceTo(2001), product = done.line!.counters.find(c=>c.materialId==='product')!;
    expect(product).toMatchObject({produced:12*Q,sold:6*Q,scrapped:6*Q});
    expect(BigInt(product.soldCost)+BigInt(product.scrapCost)+done.stocks.reduce((sum,s)=>sum+BigInt(s.cost),0n)).toBe(12_000_000n);
  });
  it('scraps all inherited bad finished output without treating it as a sale', () => {
    const c = finiteLine(1); c.stations[1]!.plan[0]!.processing.timeMs = 1;
    const end = new Simulation(compileConfig(c)).runToEnd(), product = end.line!.counters.find(c=>c.materialId==='product')!;
    expect(product.produced).toBeGreaterThan(0);expect(product.sold).toBe(0);expect(product.soldCost).toBe('0');expect(product.scrapped).toBe(product.produced);
  });
});
