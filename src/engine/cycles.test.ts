import { describe, expect, it } from 'vitest';
import { activeWorkMs, calendarForDuration } from './calendar';
import { compileConfig } from './config';
import type { DeepReadonly } from './config';
import { processingDuration } from './random';
import { Simulation } from './simulation';
import type { Snapshot } from './state';
import { cyclicLine } from './test-fixtures';
const M = 60_000, Q = 1_000_000;
const counter = (s: DeepReadonly<Snapshot>, material: string) => s.line!.counters.find(c => c.materialId === material)!;
function balance(s: DeepReadonly<Snapshot>, initialRawA = 12 * Q, initialRawB = 12 * Q, cost = 144 * Q) {
  for (const [material, initial] of [['raw', initialRawA], ['rawB', initialRawB], ['a', 0], ['b', 0]] as const) {
    const c = counter(s, material);
    const remaining = s.stocks.filter(stock => stock.materialId === material).reduce((sum, stock) => sum + stock.quantity, 0);
    expect(remaining + c.consumed + c.sold + c.scrapped).toBe(initial + c.produced);
  }
  const remainingCost = s.stocks.reduce((sum, stock) => sum + BigInt(stock.cost), 0n);
  const disposedCost = s.line!.counters.reduce((sum, c) => sum + BigInt(c.soldCost) + BigInt(c.scrapCost), 0n);
  expect(remainingCost + disposedCost).toBe(BigInt(cost));
}
function blockedLine(buffered: boolean) {
  const config = cyclicLine();
  config.stations[0]!.plan[0]!.batches = 1;
  config.stations[0]!.outputBuffer = {kind: 'quantity', quantity: buffered ? '1' : '0'};
  for (const material of config.materials.filter(m => m.id === 'a' || m.id === 'b')) {
    material.role = 'intermediate'; delete material.salePrice;
  }
  config.materials.push({id: 'product', name: 'Product', role: 'finished', color: 'black', salePrice: '30'});
  config.recipes.push(
    {id: 'finishA', name: 'Finish A', kind: 'production', inputs: [{materialId: 'a', quantity: '1'}], output: {materialId: 'product', quantity: '1'}},
    {id: 'finishB', name: 'Finish B', kind: 'production', inputs: [{materialId: 'b', quantity: '1'}], output: {materialId: 'product', quantity: '1'}},
  );
  const consumer = structuredClone(config.stations[0]!);
  consumer.id = 's2'; consumer.outputBuffer = {kind: 'quantity', quantity: '0'};
  consumer.inputBuffer = {kind: 'quantity', quantity: '1'};
  consumer.plan = [
    {id: 'finishRowB', recipeId: 'finishB', batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: 10 * M, cv: 0}},
    {id: 'finishRowA', recipeId: 'finishA', batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: 10 * M, cv: 0}},
  ];
  config.stations.push(consumer);
  for (const route of config.routes.filter(r => r.toId === 'market')) route.toId = 's2';
  config.routes.push({id: 'sellProduct', fromId: 's2', toId: 'market', materialId: 'product'});
  config.initialStocks.push({id: 'waitingA', ownerId: 's2', location: 'input', materialId: 'a', quantity: '1', cost: '7'});
  return config;
}

describe('cyclic recipe execution', () => {
  it('executes A,A,B repeatedly and advances the row only on whole batch completion', () => {
    const sim = new Simulation(compileConfig(cyclicLine()));
    const expected = [
      [0, 0, 0, 0, 0], [1, 0, 1, 1, 0], [2, 1, 0, 2, 0],
      [4, 0, 0, 2, 1], [5, 0, 1, 3, 1], [6, 1, 0, 4, 1], [8, 0, 0, 4, 2],
    ];
    for (const [minute, planIndex, completedBatches, a, b] of expected) {
      const s = sim.advanceTo(minute! * M);
      expect(s.stations[0]).toMatchObject({planIndex, completedBatches, status: 'processing'});
      expect(counter(s, 'a').sold).toBe(a! * Q);
      expect(counter(s, 'b').sold).toBe(b! * Q);
      balance(s);
    }
  });

  it('counts batches separately from sequential repetitions and simultaneous cycles', () => {
    const config = cyclicLine();
    config.stations[0]!.plan[0]!.processing.repetitions = 2;
    config.stations[0]!.plan[1]!.processing.repetitions = 3;
    const sim = new Simulation(compileConfig(config));
    expect(sim.advanceTo(M).stations[0]).toMatchObject({planIndex: 0, completedBatches: 0});
    expect(sim.advanceTo(2 * M).stations[0]).toMatchObject({planIndex: 0, completedBatches: 1});
    const switched = sim.advanceTo(4 * M);
    expect(switched.stations[0]).toMatchObject({planIndex: 1, completedBatches: 0, operationDurationMs: 2 * M});
    expect(switched.stations[0]!.inputs.find(i => i.materialId === 'rawB')!.reservedQuantity).toBe(3 * Q);
    const nextCycle = sim.advanceTo(6 * M);
    expect(nextCycle.stations[0]!.planIndex).toBe(0);
    expect(counter(nextCycle, 'a').sold).toBe(4 * Q);
    expect(counter(nextCycle, 'b').sold).toBe(3 * Q);
    balance(nextCycle);
  });

  it('waits for B without skipping to available A or reserving a partial B kit', () => {
    const config = cyclicLine(); config.initialStocks[1]!.quantity = '1';
    config.stations[0]!.plan[1]!.processing.repetitions = 2;
    const sim = new Simulation(compileConfig(config));
    const waiting = sim.advanceTo(2 * M);
    expect(waiting.stations[0]).toMatchObject({planIndex: 1, completedBatches: 0, status: 'starved', reason: 'input'});
    expect(waiting.stations[0]!.inputs.find(i => i.materialId === 'rawB')).toMatchObject({quantity: Q, reservedQuantity: 0, missingQuantity: Q});
    const end = sim.runToEnd();
    expect(end.stations[0]!.planIndex).toBe(1);
    expect(counter(end, 'a').produced).toBe(2 * Q);
    expect(counter(end, 'b').produced).toBe(0);
    expect(end.stocks.some(s => s.location === 'reserved')).toBe(false);
    balance(end, 12 * Q, Q);
  });

  it.each(['sequential', 'simultaneous'] as const)('reserves the full later assembly kit atomically in %s mode', mode => {
    const config = cyclicLine();
    config.stations[0]!.plan[1]!.processing.mode = mode;
    config.stations[0]!.plan[1]!.processing.repetitions = 2;
    config.recipes[1]!.inputs = [{materialId: 'raw', quantity: '0.5'}, {materialId: 'rawB', quantity: '2'}];
    config.initialStocks[1]!.quantity = '3';
    const waiting = new Simulation(compileConfig(config)).advanceTo(2 * M);
    expect(waiting.stations[0]).toMatchObject({planIndex: 1, status: 'starved'});
    expect(waiting.stocks.some(stock => stock.location === 'reserved')).toBe(false);
    expect(waiting.stations[0]!.inputs.find(input => input.materialId === 'raw')!.quantity).toBe(10 * Q);
    config.initialStocks[1]!.quantity = '4';
    const sim = new Simulation(compileConfig(config));
    const started = sim.advanceTo(2 * M);
    expect(started.stations[0]!.inputs.map(input => input.reservedQuantity)).toEqual([Q, 4 * Q]);
    const completed = sim.advanceTo((mode === 'sequential' ? 6 : 4) * M);
    expect(counter(completed, 'b')).toMatchObject({sold: 2 * Q, soldCost: '34000000'});
    expect(completed.stations[0]!.planIndex).toBe(0);
    balance(completed, 12 * Q, 4 * Q);
  });

  it('admits future recipe inputs within their own limits before that row is current', () => {
    const config = cyclicLine();
    config.initialStocks = [];
    config.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '2'};
    config.stations[0]!.plan[0]!.processing.timeMs = 10 * M;
    config.sources.forEach(source => {source.availability = 'virtual';});
    const sim = new Simulation(compileConfig(config));
    const s = sim.advanceTo(5 * M);
    expect(s.stations[0]!.planIndex).toBe(0);
    expect(s.stations[0]!.inputs.find(i => i.materialId === 'rawB')).toMatchObject({quantity: 2 * Q, reservedQuantity: 0, missingQuantity: 0});
    expect(s.sources.find(source => source.sourceId === 'sourceB')!.releasedQuantity).toBe(2 * Q);
    expect(counter(sim.advanceTo(22 * M), 'b').produced).toBe(Q);
  });

  it.each([false, true])('advances after completion but blocks the next batch on held A (buffered=%s)', buffered => {
    const sim = new Simulation(compileConfig(blockedLine(buffered)));
    const s = sim.advanceTo(buffered ? 4 * M : M);
    expect(s.stations[0]).toMatchObject({planIndex: 1, completedBatches: 0, status: 'blocked', reason: 'output', remainingProcessingMs: null});
    expect(s.stations[0]!.output).toMatchObject({materialId: 'a', heldQuantity: Q});
    expect(s.stocks.some(stock => stock.ownerId === 's1' && stock.location === 'reserved')).toBe(false);
    if (buffered) {
      expect(counter(s, 'b').produced).toBe(Q);
      // B reaches its own input while an older A remains in the producer output.
      expect(s.stocks.some(stock => stock.ownerId === 's2' && stock.materialId === 'b' && stock.location === 'reserved')).toBe(true);
      expect(s.stocks.some(stock => stock.ownerId === 's1' && stock.materialId === 'a' && stock.location === 'output')).toBe(true);
      expect(sim.advanceTo(13 * M).stations[0]!.status).toBe('processing');
    } else {
      // The consumer waits for B while A cannot unload: the plan is never skipped.
      expect(counter(sim.runToEnd(), 'b').produced).toBe(0);
    }
  });

  it('keeps the current row and remaining reservation when an intermediate repetition is blocked', () => {
    const config = blockedLine(false);
    config.stations[0]!.plan[0]!.processing.repetitions = 2;
    const sim = new Simulation(compileConfig(config));
    const s = sim.advanceTo(M);
    expect(s.stations[0]).toMatchObject({planIndex: 0, completedBatches: 0, status: 'blocked', output: {materialId: 'a', heldQuantity: Q}});
    expect(s.stations[0]!.inputs.find(input => input.materialId === 'raw')!.reservedQuantity).toBe(Q);
    expect(counter(sim.runToEnd(), 'b').produced).toBe(0);
  });

  it('releases the last subthreshold remainder before changing recipes', () => {
    const config = cyclicLine();
    config.stations[0]!.transportThreshold = '2';
    config.stations[0]!.plan[0]!.processing.repetitions = 3;
    config.stations[0]!.plan[0]!.batches = 1;
    config.stations[0]!.plan[1]!.processing.repetitions = 2;
    const sim = new Simulation(compileConfig(config));
    expect(sim.advanceTo(M).stations[0]).toMatchObject({planIndex: 0, transferReady: false, output: {heldQuantity: Q}});
    expect(counter(sim.advanceTo(2 * M), 'a').sold).toBe(2 * Q);
    const b = sim.advanceTo(3 * M);
    expect(b.stations[0]!.planIndex).toBe(1);
    expect(counter(b, 'a').sold).toBe(3 * Q);
    expect(b.stocks.some(stock => stock.materialId === 'a')).toBe(false);
    balance(b);
  });

  it('supports adjacent rows with the same recipe and different profiles', () => {
    const config = cyclicLine();
    config.recipes.pop(); config.materials = config.materials.filter(m => !['b', 'rawB'].includes(m.id));
    config.sources.pop(); config.routes = config.routes.filter(r => !['rawB', 'b'].includes(r.materialId));
    config.initialStocks.pop();
    config.stations[0]!.plan[1]!.recipeId = 'recipeA';
    config.stations[0]!.plan[1]!.processing.repetitions = 3;
    const sim = new Simulation(compileConfig(config));
    const s = sim.advanceTo(4 * M);
    expect(counter(s, 'a').sold).toBe(5 * Q);
    expect(s.stations[0]).toMatchObject({planIndex: 0, operationDurationMs: M});
  });

  it('repeats a one-row plan with batches greater than one', () => {
    const config = cyclicLine();
    config.stations[0]!.plan.pop(); config.recipes.pop(); config.sources.pop(); config.initialStocks.pop();
    config.materials = config.materials.filter(m => !['b', 'rawB'].includes(m.id));
    config.routes = config.routes.filter(r => !['rawB', 'b'].includes(r.materialId));
    const sim = new Simulation(compileConfig(config));
    expect(sim.advanceTo(M).stations[0]).toMatchObject({planIndex: 0, completedBatches: 1});
    expect(sim.advanceTo(2 * M).stations[0]).toMatchObject({planIndex: 0, completedBatches: 0});
    expect(counter(sim.advanceTo(5 * M), 'a').sold).toBe(5 * Q);
  });

  it.each([240, 540])('preserves the later recipe over a calendar close at minute %s', closeMinute => {
    const config = cyclicLine();
    config.durationMs += 86_400_000;
    config.initialStocks[0]!.quantity = '2'; config.initialStocks[1]!.quantity = '1';
    config.stations[0]!.plan[1]!.processing.timeMs = (closeMinute === 240 ? 250 : 500) * M;
    const run = compileConfig(config), sim = new Simulation(run);
    const closed = sim.advanceTo(closeMinute * M);
    const remaining = closeMinute === 240 ? 12 * M : 22 * M;
    expect(closed.stations[0]).toMatchObject({planIndex: 1, status: 'paused', remainingProcessingMs: remaining});
    const opens = (closeMinute === 240 ? 300 : 1440) * M;
    const resumed = sim.advanceTo(opens);
    expect(resumed.stations[0]).toMatchObject({planIndex: 1, status: 'processing', remainingProcessingMs: remaining, operationDurationMs: config.stations[0]!.plan[1]!.processing.timeMs});
    const done = sim.advanceTo(opens + remaining);
    expect(counter(done, 'b').sold).toBe(Q);
    expect(done.stations[0]).toMatchObject({planIndex: 0, status: 'starved'});
    expect(BigInt(counter(done, 'b').soldCost)).toBe(24n * BigInt(Q));
  });

  it('accepts completion at a closed boundary and defers the next row until opening', () => {
    const config = cyclicLine(); config.stations[0]!.plan[0]!.processing.timeMs = 120 * M;
    const sim = new Simulation(compileConfig(config));
    const closed = sim.advanceTo(240 * M);
    expect(counter(closed, 'a').sold).toBe(2 * Q);
    expect(closed.stations[0]).toMatchObject({planIndex: 1, remainingProcessingMs: null, status: 'paused'});
    expect(closed.stocks.some(stock => stock.location === 'reserved')).toBe(false);
    expect(sim.advanceTo(300 * M).stations[0]).toMatchObject({planIndex: 1, operationDurationMs: 2 * M});
  });

  it('does not start a new cycle at the horizon or finish an operation extending past it', () => {
    const config = cyclicLine(); config.stations[0]!.plan[1]!.processing.timeMs = 478 * M;
    const end = new Simulation(compileConfig(config)).runToEnd();
    expect(end.stations[0]).toMatchObject({planIndex: 0, remainingProcessingMs: null});
    expect(counter(end, 'b').sold).toBe(Q);
    expect(end.stocks.some(stock => stock.location === 'reserved')).toBe(false);
    config.stations[0]!.plan[1]!.processing.timeMs++;
    const unfinished = new Simulation(compileConfig(config)).runToEnd();
    expect(unfinished.stations[0]).toMatchObject({planIndex: 1, remainingProcessingMs: 1});
    expect(counter(unfinished, 'b').produced).toBe(0);
    balance(unfinished);
  });

  it('keeps the sampled B duration and plan position through lunch, night and stale completions', () => {
    const config = cyclicLine(); config.seed = 0; config.durationMs += 4 * 86_400_000;
    const profile = config.stations[0]!.plan[1]!.processing;
    profile.timeMs = 1000 * M; profile.cv = 0.5;
    const duration = processingDuration(profile.timeMs, profile.cv, 0, 's1', 'recipeB', 2);
    expect(duration).toBeGreaterThan(478 * M);
    const run = compileConfig(config), sim = new Simulation(run), stepped = new Simulation(run);
    expect(sim.advanceTo(2 * M).stations[0]).toMatchObject({planIndex: 1, operationDurationMs: duration});
    const closed = sim.advanceTo(240 * M);
    expect(closed.stations[0]).toMatchObject({planIndex: 1, status: 'paused', remainingProcessingMs: duration - 238 * M});
    const resumed = sim.advanceTo(300 * M);
    expect(resumed.stations[0]).toMatchObject({planIndex: 1, status: 'processing', operationDurationMs: duration, remainingProcessingMs: duration - 238 * M});
    expect(sim.advanceTo(540 * M).stations[0]).toMatchObject({planIndex: 1, remainingProcessingMs: duration - 478 * M, status: 'paused'});
    sim.runToEnd(); while (stepped.step()) { /* includes obsolete provisional completions */ }
    expect(sim.getSnapshot()).toEqual(stepped.getSnapshot());
    balance(sim.getSnapshot());
  });

  it('uses the current recipe/profile RNG key without resampling through lunch or step', () => {
    const config = cyclicLine();
    config.seed = 0;
    for (const row of config.stations[0]!.plan) row.processing.cv = 0.5;
    const run = compileConfig(config), sim = new Simulation(run), stepped = new Simulation(run);
    const da0 = processingDuration(M, 0.5, 0, 's1', 'recipeA', 0);
    const da1 = processingDuration(M, 0.5, 0, 's1', 'recipeA', 1);
    const db2 = processingDuration(2 * M, 0.5, 0, 's1', 'recipeB', 2);
    expect(sim.advanceTo(0).stations[0]!.operationDurationMs).toBe(da0);
    expect(sim.advanceTo(da0).stations[0]!.operationDurationMs).toBe(da1);
    const b = sim.advanceTo(da0 + da1);
    expect(b.stations[0]).toMatchObject({planIndex: 1, operationDurationMs: db2});
    const calendar = calendarForDuration(config.calendar, config.durationMs);
    expect(activeWorkMs(calendar, da0 + da1, da0 + da1 + db2)).toBe(db2);
    sim.runToEnd(); while (stepped.step()) { balance(stepped.getSnapshot()); }
    expect(sim.getSnapshot()).toEqual(stepped.getSnapshot());
  });
});
