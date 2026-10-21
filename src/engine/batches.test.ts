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


describe('transport batches', () => {
  it.each(['1', '3', '6'])('V17: threshold %s changes the first transfer, not processing duration', threshold => {
    const c = batch('sequential', 6); c.stations[0]!.transportThreshold = threshold; c.initialStocks[0]!.quantity = '1.8';
    const sim = new Simulation(compileConfig(c)), first = Number(threshold) * 2 * M;
    const before = sim.advanceTo(first - 1);
    expect(before.line!.counters.find(x => x.materialId === 'part')!.sold).toBe(0);
    expect(before.stations[0]!.blockedBy).toEqual([]); check(sim, 1.8 * Q);
    const at = sim.advanceTo(first);
    expect(at.line!.counters.find(x => x.materialId === 'part')!.sold).toBe(Number(threshold) * Q);
    expect(at.line!.transfers.every(x => x.kind === 'sale')).toBe(true);
    const done = sim.advanceTo(12 * M);
    expect(done.line!.counters.find(x => x.materialId === 'part')!.sold).toBe(6 * Q);
    check(sim, 1.8 * Q);
  });
  it('V17: full threshold ten waits twenty minutes while threshold one transfers at minute two', () => {
    for (const threshold of ['1', '10']) {
      const c = batch(); c.stations[0]!.transportThreshold = threshold;
      const sim = new Simulation(compileConfig(c));
      expect(sim.advanceTo(2 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(threshold === '1' ? Q : 0);
      expect(sim.advanceTo(20 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(10 * Q); check(sim);
    }
  });
  it('flushes the final two items of a five repetition batch with threshold three', () => {
    const c = batch('sequential', 5); c.initialStocks[0]!.quantity = '1.5'; c.stations[0]!.transportThreshold = '3';
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(6 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(3 * Q);
    const accumulating = sim.advanceTo(8 * M);
    expect(accumulating.stations[0]).toMatchObject({status: 'processing', transferReady: false, output: {heldQuantity: Q}});
    check(sim, 1.5 * Q);
    expect(sim.advanceTo(10 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(5 * Q);
    expect(sim.getSnapshot().stocks).toHaveLength(0); check(sim, 1.5 * Q);
  });
  it.each([{kind: 'quantity' as const, quantity: '2'}, {kind: 'infinite' as const}])('gates entry to the output buffer as well as routing: %j', outputBuffer => {
    const c = batch('sequential', 5); c.initialStocks[0]!.quantity = '1.5'; c.stations[0]!.transportThreshold = '3'; c.stations[0]!.outputBuffer = outputBuffer;
    const sim = new Simulation(compileConfig(c)), before = sim.advanceTo(4 * M);
    expect(before.stations[0]!.output).toMatchObject({quantity: 0, heldQuantity: 2 * Q});
    expect(before.line!.transfers).toEqual([]);
    expect(sim.advanceTo(6 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(3 * Q);
    expect(sim.advanceTo(10 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(5 * Q); check(sim, 1.5 * Q);
  });
  it('releases the whole available output when one repetition exceeds the threshold', () => {
    const c = batch('sequential', 2); c.initialStocks[0]!.quantity = '0.6'; c.recipes[0]!.output.quantity = '3'; c.stations[0]!.transportThreshold = '2';
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(2 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(3 * Q);
    expect(sim.advanceTo(4 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(6 * Q); check(sim, 0.6 * Q);
  });
  it('V18: a small transport threshold never releases simultaneous output early', () => {
    const c = batch('simultaneous'); c.stations[0]!.transportThreshold = '3';
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(2 * M - 1).line!.counters.every(x => x.produced === 0)).toBe(true);
    expect(sim.advanceTo(2 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(10 * Q); check(sim);
  });
  it('V38: transfers six of ten, then drains the remaining four without reaching the threshold again', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse'; c.initialStocks[0]!.quantity = '0.3';
    c.stations[0]!.transportThreshold = '10'; c.stations[1]!.plan[0]!.processing.timeMs = 60 * M;
    c.initialStocks.push({id: 'receiverInitial', ownerId: 's2', location: 'input', materialId: 'part', quantity: '1', cost: '1'});
    const sim = new Simulation(compileConfig(c)), first = sim.advanceTo(M);
    expect(first.line!.transfers.find(x => x.fromId === 's1' && x.toId === 's2')!.quantity).toBe(6 * Q);
    expect(first.stations[0]).toMatchObject({status: 'blocked', transferReady: true, output: {heldQuantity: 4 * Q}});
    expect(first.stations[1]!.inputs[0]!.quantity).toBe(6 * Q);
    expect(first.stocks.find(x => x.ownerId === 's1' && x.location === 'held')).toMatchObject({quantity: 4 * Q, cost: '2000000', readyAtMs: M, provenance: {processingMs: {s1: '24000'}}});
    const next = sim.advanceTo(60 * M);
    expect(next.stations[0]).toMatchObject({status: 'blocked', transferReady: true, output: {heldQuantity: 3 * Q}});
    const released = sim.advanceTo(300 * M);
    expect(released.stations[0]).toMatchObject({transferReady: false, output: {heldQuantity: 0}});
    expect(released.stocks.reduce((sum, x) => sum + BigInt(x.cost), 0n) + released.line!.counters.reduce((sum, x) => sum + BigInt(x.soldCost), 0n)).toBe(6n * BigInt(Q));
  });
  it('blocks further repetitions while an approved remainder is held at a finite output buffer', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse'; c.initialStocks[0]!.quantity = '0.6';
    Object.assign(c.stations[0]!, {transportThreshold: '10', outputBuffer: {kind: 'quantity', quantity: '6'}});
    c.stations[0]!.plan[0]!.processing.repetitions = 2;
    c.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    c.stations[1]!.plan[0]!.processing.timeMs = 60 * M;
    c.initialStocks.push({id: 'receiverInitial', ownerId: 's2', location: 'input', materialId: 'part', quantity: '1', cost: '1'});
    const sim = new Simulation(compileConfig(c)), first = sim.advanceTo(2 * M);
    expect(first.stations[0]).toMatchObject({status: 'blocked', transferReady: true, inputs: [{reservedQuantity: 0.3 * Q}], output: {quantity: 6 * Q, heldQuantity: 3 * Q}});
    expect(first.line!.counters.find(x => x.materialId === 'part')!.produced).toBe(10 * Q);
    expect(sim.advanceTo(60 * M).stations[0]!.output.heldQuantity).toBe(2 * Q);
    expect(sim.advanceTo(180 * M).stations[0]!.status).toBe('processing');
  });
  it('retains FIFO lots, cost and processing provenance during accumulation and partial unload', () => {
    const c = batch('sequential', 3); c.initialStocks[0]!.quantity = '0.9'; c.stations[0]!.transportThreshold = '3';
    c.stations[0]!.plan[0]!.processing.cv = 0.5;
    const run = compileConfig(c), sim = new Simulation(run);
    const durations = [0, 1, 2].map(i => processingDuration(2 * M, 0.5, c.seed, 's1', 'cut', i));
    const before = sim.advanceTo(durations[0]! + durations[1]!);
    expect(before.stocks.filter(x => x.location === 'held').map(x => ({quantity: x.quantity, time: x.provenance.processingMs.s1}))).toEqual(durations.slice(0, 2).map(d => ({quantity: Q, time: String(d)})));
    expect(before.stocks.filter(x => x.location === 'held').map(x => x.readyAtMs)).toEqual([durations[0], durations[0]! + durations[1]!]);
    check(sim, 0.9 * Q);
    const done = sim.advanceTo(durations.reduce((a, b) => a + b, 0));
    expect(done.line!.transfers.map(x => x.cost)).toEqual(['3333333', '3333333', '3333334']);
    expect(done.line!.counters.find(x => x.materialId === 'part')!.sold).toBe(3 * Q); check(sim, 0.9 * Q);
  });
  it('unloads accumulated FIFO lots without merging their costs or completion times', () => {
    const c = line(); c.sources[0]!.availability = 'warehouse';
    Object.assign(c.initialStocks[0]!, {quantity: '3', cost: '10.000001'});
    c.stations[0]!.inputBuffer = {kind: 'infinite'}; c.stations[0]!.transportThreshold = '10';
    c.stations[0]!.plan[0]!.processing.repetitions = 10; c.recipes[0]!.output.quantity = '1';
    c.stations[1]!.plan[0]!.processing.timeMs = 60 * M;
    c.initialStocks.push({id: 'receiverInitial', ownerId: 's2', location: 'input', materialId: 'part', quantity: '1', cost: '1'});
    const sim = new Simulation(compileConfig(c)), at = sim.advanceTo(10 * M);
    expect(at.stocks.filter(x => x.ownerId === 's1' && x.location === 'held').map(x => ({ready: x.readyAtMs, cost: x.cost, time: x.provenance.processingMs.s1}))).toEqual([7, 8, 9, 10].map(n => ({ready: n * M, cost: n === 10 ? '1000001' : '1000000', time: String(M)})));
    expect(at.line!.transfers.filter(x => x.fromId === 's1').map(x => x.quantity)).toEqual(Array(6).fill(Q));
    const next = sim.advanceTo(60 * M);
    expect(next.stocks.filter(x => x.ownerId === 's1' && x.location === 'held').map(x => x.readyAtMs)).toEqual([8, 9, 10].map(n => n * M));
    expect(next.stocks.reduce((sum, x) => sum + BigInt(x.cost), 0n) + next.line!.counters.reduce((sum, x) => sum + BigInt(x.soldCost), 0n)).toBe(11_000_001n);
  });
  it('preserves accumulated output and the active operation across lunch and overnight', () => {
    const c = batch('sequential', 3); c.initialStocks[0]!.quantity = '0.9'; c.stations[0]!.transportThreshold = '3';
    c.stations[0]!.plan[0]!.processing.timeMs = 200 * M; c.durationMs += 86_400_000;
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(240 * M).stations[0]).toMatchObject({status: 'paused', transferReady: false, output: {heldQuantity: Q}, remainingProcessingMs: 160 * M});
    expect(sim.advanceTo(540 * M).stations[0]).toMatchObject({status: 'paused', transferReady: false, output: {heldQuantity: 2 * Q}, remainingProcessingMs: 120 * M});
    check(sim, 0.9 * Q);
    expect(sim.advanceTo(86_400_000 + 120 * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(3 * Q); check(sim, 0.9 * Q);
  });
  it('flushes each batch independently before accumulating the next batch', () => {
    const c = batch('sequential', 5); c.stations[0]!.transportThreshold = '3';
    const sim = new Simulation(compileConfig(c));
    for (const [time, sold] of [[6, 3], [10, 5], [14, 5], [16, 8], [20, 10]]) {
      expect(sim.advanceTo(time! * M).line!.counters.find(x => x.materialId === 'part')!.sold).toBe(sold! * Q);
      check(sim);
    }
  });
  it('is reproducible through step and advanceTo with a nontrivial threshold', () => {
    const c = batch('sequential', 5); c.stations[0]!.transportThreshold = '3'; c.stations[0]!.plan[0]!.processing.cv = 0.5;
    const run = compileConfig(c), a = new Simulation(run), b = new Simulation(run);
    a.runToEnd(); while (b.step()) { /* advance by consistent boundaries */ }
    expect(a.getSnapshot()).toEqual(b.getSnapshot()); check(a);
  });
  it.each(['0', '-1', '0.5', '11', '1e0', '1,0', '9007199255', 1, null])('rejects invalid transport threshold %s', threshold => {
    const c = batch(); Object.assign(c.stations[0]!, {transportThreshold: threshold});
    expect(() => compileConfig(c)).toThrow();
  });
  it('defaults to one item and hashes explicit default identically', () => {
    const c = batch(), before = compileConfig(c); c.stations[0]!.transportThreshold = '1';
    expect(compileConfig(c).calculationHash).toBe(before.calculationHash);
    c.stations[0]!.transportThreshold = '3'; expect(compileConfig(c).calculationHash).not.toBe(before.calculationHash);
  });
});
