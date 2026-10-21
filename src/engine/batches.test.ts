import { describe, expect, it } from 'vitest';
import { compileConfig } from './config';
import { Simulation } from './simulation';
import { processingDuration } from './random';
import { line } from './test-fixtures';
const M = 60_000, Q = 1_000_000;
function batch(mode: 'sequential' | 'simultaneous' = 'sequential', repetitions = 10) {
  const c = line();
  c.stations = [c.stations[0]!];
  c.stations[0]!.inputBuffer = {kind: 'infinite'};
  Object.assign(c.stations[0]!.plan[0]!.processing, {mode, repetitions, timeMs: 2 * M});
  c.recipes = [c.recipes[0]!]; c.recipes[0]!.output.quantity = '1';
  c.materials = c.materials.slice(0, 2); c.materials[1]!.role = 'finished'; c.materials[1]!.salePrice = '30';
  c.sources[0]!.availability = 'warehouse';
  c.routes = [c.routes[0]!, {id: 'sale', fromId: 's1', toId: 'market', materialId: 'part'}];
  c.initialStocks = [{id: 'initial', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '3', cost: '10'}];
  return c;
}
function check(sim: Simulation, initialQuantity = 3 * Q, initialCost = 10 * Q) {
  const s = sim.getSnapshot(), counters = s.line!.counters;
  expect(s.stocks.reduce((sum, x) => sum + BigInt(x.cost), 0n) + counters.reduce((sum, x) => sum + BigInt(x.soldCost), 0n)).toBe(BigInt(initialCost));
  const raw = counters.find(x => x.materialId === 'raw')!, part = counters.find(x => x.materialId === 'part')!;
  expect(s.stocks.filter(x => x.materialId === 'raw').reduce((sum, x) => sum + x.quantity, 0) + raw.consumed).toBe(initialQuantity);
  expect(s.stocks.filter(x => x.materialId === 'part').reduce((sum, x) => sum + x.quantity, 0) + part.sold).toBe(part.produced);
}
describe('processing batches', () => {
  it('V09: waits for all ten kits and reserves atomically', () => {
    const c = batch(); c.initialStocks[0]!.quantity = '2.7';
    const sim = new Simulation(compileConfig(c)), s = sim.advanceTo(0);
    expect(s.stations[0]).toMatchObject({status: 'starved', inputs: [{quantity: 2.7 * Q, missingQuantity: 0.3 * Q, reservedQuantity: 0}]});
    expect(sim.advanceTo(20 * M).line!.counters.every(x => x.produced === 0)).toBe(true);
  });
  it.each(['sequential', 'simultaneous'] as const)('V10/V18/V25: exact fractional kits, cost and WIP in %s mode', mode => {
    const sim = new Simulation(compileConfig(batch(mode)));
    expect(sim.advanceTo(0).stations[0]!.inputs[0]!.reservedQuantity).toBe(3 * Q); check(sim);
    expect(sim.advanceTo(2 * M - 1).line!.counters[0]!.produced).toBe(0); check(sim);
    sim.advanceTo(2 * M); check(sim);
    expect(sim.getSnapshot().line!.counters.find(x => x.materialId === 'part')!.produced).toBe((mode === 'sequential' ? 1 : 10) * Q);
    sim.advanceTo(20 * M); check(sim);
    expect(sim.getSnapshot().stocks).toHaveLength(0);
    expect(sim.getSnapshot().line!.counters.find(x => x.materialId === 'part')!.sold).toBe(10 * Q);
  });
  it('V11: repetitions multiply the recipe output, not its processing time', () => {
    const c = batch('simultaneous', 2); c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '10'; c.initialStocks[0]!.quantity = '2';
    const sim = new Simulation(compileConfig(c)); sim.advanceTo(2 * M); check(sim, 2 * Q);
    expect(sim.getSnapshot().line!.counters.find(x => x.materialId === 'part')!.sold).toBe(20 * Q);
  });
  it.each(['sequential', 'simultaneous'] as const)('samples CV per repetition or cycle and repeats by step in %s mode', mode => {
    const c = batch(mode, 3); c.initialStocks[0]!.quantity = '0.9'; c.stations[0]!.plan[0]!.processing.cv = 0.5;
    const run = compileConfig(c), a = new Simulation(run), b = new Simulation(run);
    const duration = (ordinal: number) => processingDuration(2 * M, 0.5, c.seed, 's1', 'cut', ordinal);
    expect(a.advanceTo(0).stations[0]!.operationDurationMs).toBe(duration(0));
    if (mode === 'sequential') expect(a.advanceTo(duration(0)).stations[0]!.operationDurationMs).toBe(duration(1));
    a.runToEnd(); while (b.step()) { /* same run, event by event */ }
    expect(a.getSnapshot()).toEqual(b.getSnapshot()); check(a, 0.9 * Q);
  });
  it('preserves a sequential reservation across lunch without resampling', () => {
    const c = batch('sequential', 2); c.initialStocks[0]!.quantity = '0.6'; c.stations[0]!.plan[0]!.processing.timeMs = 150 * M;
    const sim = new Simulation(compileConfig(c));
    const lunch = sim.advanceTo(240 * M);
    expect(lunch.stations[0]).toMatchObject({status: 'paused', remainingProcessingMs: 60 * M, operationDurationMs: 150 * M});
    expect(lunch.stations[0]!.inputs[0]!.reservedQuantity).toBe(0.3 * Q); check(sim, 0.6 * Q);
    expect(sim.advanceTo(360 * M).line!.counters.find(x => x.materialId === 'part')!.produced).toBe(2 * Q); check(sim, 0.6 * Q);
  });
  it('retains unprocessed reserved kits while output is blocked', () => {
    const c = line(); c.stations[0]!.inputBuffer = {kind: 'infinite'};
    c.stations[0]!.plan[0]!.processing.repetitions = 3;
    c.sources[0]!.availability = 'warehouse'; c.initialStocks[0]!.quantity = '0.9';
    c.stations[1]!.plan[0]!.processing.timeMs = 60 * M;
    const sim = new Simulation(compileConfig(c)), s = sim.advanceTo(2 * M);
    expect(s.stations[0]).toMatchObject({status: 'blocked', remainingProcessingMs: null});
    expect(s.stations[0]!.inputs[0]!.reservedQuantity).toBe(0.6 * Q);
    expect(s.line!.counters.find(x => x.materialId === 'part')!.produced).toBe(10 * Q);
    sim.advanceTo(300 * M);
    expect(sim.getSnapshot().stations[0]!.inputs[0]!.reservedQuantity).toBeLessThan(0.6 * Q);
  });
  it.each(['sequential', 'simultaneous'] as const)('reserves every assembly component for the full %s batch', mode => {
    const c = batch(mode, 2);
    c.materials.push({id: 'other', name: 'Other', role: 'raw', color: '#333', purchasePrice: '1'});
    c.recipes[0]!.inputs.push({materialId: 'other', quantity: '2'});
    c.sources.push({id: 'otherSource', name: 'Other source', materialId: 'other', availability: 'warehouse', quantity: '1', intervalMs: M});
    c.routes.push({id: 'otherRoute', fromId: 'otherSource', toId: 's1', materialId: 'other'});
    c.initialStocks[0]!.quantity = '0.6';
    c.initialStocks.push({id: 'otherStock', ownerId: 's1', location: 'input', materialId: 'other', quantity: '3', cost: '3'});
    const waiting = new Simulation(compileConfig(c)).advanceTo(0);
    expect(waiting.stations[0]!.status).toBe('starved');
    expect(waiting.stocks.some(stock => stock.location === 'reserved')).toBe(false);
    c.initialStocks[1]!.quantity = '4';
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(0).stations[0]!.inputs.map(x => x.reservedQuantity)).toEqual([4 * Q, 0.6 * Q]);
    const done = sim.advanceTo(4 * M);
    expect(done.stocks).toHaveLength(0);
    expect(done.line!.counters.find(x => x.materialId === 'part')).toMatchObject({sold: 2 * Q, soldCost: '13000000'});
  });
  it.each(['sequential', 'simultaneous'] as const)('preserves the %s operation and reserve overnight', mode => {
    const c = batch(mode, 2); c.initialStocks[0]!.quantity = '0.6';
    c.durationMs += 86_400_000; c.stations[0]!.plan[0]!.processing.timeMs = 500 * M;
    const sim = new Simulation(compileConfig(c));
    const night = sim.advanceTo(540 * M);
    expect(night.stations[0]).toMatchObject({status: 'paused', remainingProcessingMs: 20 * M, operationDurationMs: 500 * M});
    check(sim, 0.6 * Q);
    const next = sim.advanceTo(86_400_000 + 20 * M);
    expect(next.line!.counters.find(x => x.materialId === 'part')!.produced).toBe((mode === 'sequential' ? 1 : 2) * Q);
    check(sim, 0.6 * Q);
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])('rejects invalid or overflowing repetition count %s', repetitions => {
    expect(() => compileConfig(batch('sequential', repetitions))).toThrow();
  });
  it('requires input capacity for the entire batch', () => {
    const c = batch(); c.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '2.7'};
    expect(() => compileConfig(c)).toThrow(/batch kit/);
  });
});
