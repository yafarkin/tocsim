import { describe, expect, it } from 'vitest';
import { compileConfig } from './config';
import type { DeepReadonly, EditorConfig, RunConfig } from './config';
import { createCalendar, DAY_MS } from './calendar';
import { Simulation } from './simulation';
import { line } from './test-fixtures';
import type { Snapshot } from './state';
const minute = 60_000, q = (value: number) => value * 1_000_000;
function production(times: number[] = [5, 5, 5]): EditorConfig {
  const config = line();
  config.id = 'production'; config.initialStocks = [];
  config.materials = Array.from({length: times.length + 1}, (_, i) => i === 0
    ? {id: `m${i}`, name: 'Raw', color: '#aaa', role: 'raw', purchasePrice: '10'}
    : i === times.length ? {id: `m${i}`, name: 'Product', color: '#222', role: 'finished', salePrice: '30'}
      : {id: `m${i}`, name: 'Part', color: '#888', role: 'intermediate'});
  config.recipes = times.map((_, i) => ({id: `recipe${i}`, name: 'Process', kind: 'production',
    inputs: [{materialId: `m${i}`, quantity: '1'}], output: {materialId: `m${i + 1}`, quantity: '1'}}));
  const template = structuredClone(config.stations[0]!);
  config.stations = times.map((duration, i) => ({...structuredClone(template), id: `p${i}`, name: `Station ${i}`,
    plan: [{id: `plan${i}`, recipeId: `recipe${i}`, batches: 1, processing: {mode: 'sequential', repetitions: 1, timeMs: duration * minute, cv: 0}}],
    inputBuffer: {kind: 'infinite'}, outputBuffer: {kind: 'quantity', quantity: '0'}}));
  config.sources = [{id: 'source', name: 'Raw source', materialId: 'm0', availability: 'virtual', quantity: '1', intervalMs: times[0]! * minute}];
  config.routes = [{id: 'routeSource', fromId: 'source', toId: 'p0', materialId: 'm0'},
    ...times.map((_, i) => ({id: `route${i}`, fromId: `p${i}`, toId: i === times.length - 1 ? 'market' : `p${i + 1}`, materialId: `m${i + 1}`}))];
  return config;
}
function finite(config: EditorConfig, quantity: string, cost = quantity) {
  config.sources[0]!.availability = 'warehouse';
  config.initialStocks.push({id: 'warehouseStock', ownerId: 'warehouse', location: 'warehouse', materialId: 'm0', quantity, cost});
}
const sold = (snapshot: DeepReadonly<Snapshot>, material?: string) => snapshot.line!.counters.filter(c => material === undefined || c.materialId === material).reduce((sum, c) => sum + c.sold, 0);
function checkBalance(run: RunConfig, snapshot: DeepReadonly<Snapshot>) {
  const costIn = run.resolved.initialStocks.reduce((sum, s) => sum + s.cost, 0n) + snapshot.sources.reduce((sum, s) => sum + BigInt(s.purchasedCost), 0n);
  const costOut = snapshot.stocks.reduce((sum, s) => sum + BigInt(s.cost), 0n)
    + snapshot.line!.counters.reduce((sum, c) => sum + BigInt(c.soldCost) + BigInt(c.scrapCost), 0n);
  expect(costOut).toBe(costIn);
  for (const counter of snapshot.line!.counters) {
    const initial = run.resolved.initialStocks.filter(s => s.materialId === counter.materialId).reduce((sum, s) => sum + s.quantity, 0);
    const admitted = snapshot.sources.filter(s => run.resolved.sources.find(source => source.id === s.sourceId)!.availability === 'virtual'
      && run.resolved.sources.find(source => source.id === s.sourceId)!.materialId === counter.materialId).reduce((sum, s) => sum + s.releasedQuantity, 0);
    const stock = snapshot.stocks.filter(s => s.materialId === counter.materialId).reduce((sum, s) => sum + s.quantity, 0);
    expect(initial + admitted + counter.produced).toBe(stock + counter.consumed + counter.sold + counter.scrapped);
  }
  for (const stock of snapshot.stocks) {expect(stock.quantity).toBeGreaterThan(0); expect(BigInt(stock.cost)).toBeGreaterThanOrEqual(0n);}
  for (const station of run.resolved.stations) {
    for (const location of ['input', 'output'] as const) {
      const capacity = location === 'input' ? station.inputBuffers[0]!.capacity : station.outputBuffer;
      if (capacity.kind === 'quantity') {
        const occupied = snapshot.stocks.filter(s => s.ownerId === station.id && s.location === location).reduce((sum, s) => sum + s.quantity, 0);
        expect(occupied).toBeLessThanOrEqual(capacity.quantity);
      }
    }
  }
}

describe('analytic deterministic line', () => {
  it('V01: three five-minute stations produce first at 15, ten by 60 inclusive', () => {
    const config = compileConfig(production()); const sim = new Simulation(config);
    sim.advanceTo(15 * minute - 1); expect(sold(sim.getSnapshot())).toBe(0);
    sim.advanceTo(15 * minute); expect(sold(sim.getSnapshot())).toBe(q(1));
    expect(sold(sim.advanceTo(60 * minute))).toBe(q(10));
    checkBalance(config, sim.getSnapshot());
  });

  it('V02: a 3/8/3 line follows the bottleneck bound and builds an upstream queue', () => {
    const sim = new Simulation(compileConfig(production([3, 8, 3])));
    sim.advanceTo(14 * minute - 1); expect(sold(sim.getSnapshot())).toBe(0);
    expect(sold(sim.advanceTo(14 * minute))).toBe(q(1));
    expect(sold(sim.advanceTo(240 * minute))).toBe(q(29));
    expect(sim.getSnapshot().stations.find(s => s.stationId === 'p1')!.inputs[0]!.quantity).toBeGreaterThan(0);
  });

  it.each([3, 4, 5, 6])('connects %i stations and first output occurs after their sum', count => {
    const sim = new Simulation(compileConfig(production(Array(count).fill(1))));
    expect(sold(sim.advanceTo(count * minute - 1))).toBe(0);
    expect(sold(sim.advanceTo(count * minute))).toBe(q(1));
  });

  it('keeps step, one advance and irregular advances identical through full horizon', () => {
    const config = production([2, 3, 2]); finite(config, '8', '80');
    config.stations.forEach(s => {s.inputBuffer = {kind: 'quantity', quantity: '2'}; s.outputBuffer = {kind: 'quantity', quantity: '1'};});
    const run = compileConfig(config), a = new Simulation(run), b = new Simulation(run), c = new Simulation(run);
    while (a.step() !== null) checkBalance(run, a.getSnapshot());
    b.runToEnd();
    for (const t of [1, 133_333, 599_999, 1_700_000, 15_000_000, run.resolved.durationMs]) c.advanceTo(t);
    expect(a.getSnapshot()).toEqual(b.getSnapshot()); expect(c.getSnapshot()).toEqual(b.getSnapshot());
    expect(sold(a.getSnapshot())).toBe(q(8));
  });
});

describe('buffer blocking and fractional material', () => {
  it('V03/V04: zero vs three output places shift blocking without losing WIP', () => {
    const execute = (output: string) => {
      const config = production([1, 1000]); config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '2'};
      config.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '1'};
      config.stations[0]!.outputBuffer = {kind: 'quantity', quantity: output};
      const run = compileConfig(config), sim = new Simulation(run); sim.advanceTo(10 * minute);
      checkBalance(run, sim.getSnapshot()); return sim.getSnapshot();
    };
    const zero = execute('0'), three = execute('3');
    expect(zero.stations[0]).toMatchObject({status: 'blocked', reason: 'output', output: {heldQuantity: q(1)}, blockedBy: [{stationId: 'p1', location: 'input'}]});
    expect(zero.stations[1]!.inputs[0]!.quantity).toBe(q(2));
    expect(zero.line!.counters.find(c => c.materialId === 'm1')!.produced).toBe(q(4));
    expect(three.line!.counters.find(c => c.materialId === 'm1')!.produced).toBe(q(7));
    expect(three.stations[0]!.output.quantity).toBe(q(3));
    expect(three.stations[0]!.blockedBy).toEqual([{stationId: 'p0', location: 'output'}]);
  });

  it('V05: transfers six out of ten, retains four, then frees the producer', () => {
    const config = production([1, 10]); finite(config, '1', '10');
    config.recipes[0]!.output.quantity = '10'; config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '6'};
    config.initialStocks.push({id: 'existing', ownerId: 'p1', location: 'input', materialId: 'm1', quantity: '1', cost: '7'});
    const run = compileConfig(config), sim = new Simulation(run);
    sim.advanceTo(minute);
    expect(sim.getSnapshot().stations[0]!.output.heldQuantity).toBe(q(4));
    expect(sim.getSnapshot().stations[1]!.inputs[0]!.quantity).toBe(q(6));
    expect(sim.getSnapshot().line!.transfers.some(t => t.fromId === 'p0' && t.toId === 'p1' && t.quantity === q(6))).toBe(true);
    sim.advanceTo(40 * minute); expect(sim.getSnapshot().stations[0]!.output.heldQuantity).toBe(0);
    sim.advanceTo(110 * minute); expect(sold(sim.getSnapshot())).toBe(q(11)); checkBalance(run, sim.getSnapshot());
  });

  it('consumes 0.3 repeatedly, leaves 0.1 and preserves actual costs', () => {
    const config = production([1]); finite(config, '1', '0.000013');
    config.recipes[0]!.inputs[0]!.quantity = '0.3';
    const run = compileConfig(config), sim = new Simulation(run); sim.runToEnd();
    expect(sold(sim.getSnapshot())).toBe(q(3));
    expect(sim.getSnapshot().stations[0]!.inputs[0]!.quantity).toBe(q(0.1));
    expect(sim.getSnapshot().line!.flow).toBe('missingInput'); checkBalance(run, sim.getSnapshot());
  });

  it('drains old output stock before newer held results', () => {
    const config = production([1, 1000]); finite(config, '1', '9');
    config.stations[0]!.outputBuffer = {kind: 'quantity', quantity: '1'};
    config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    config.initialStocks.push({id: 'older', ownerId: 'p0', location: 'output', materialId: 'm1', quantity: '1', cost: '7'});
    const sim = new Simulation(compileConfig(config)); sim.advanceTo(minute);
    expect(sim.getSnapshot().stocks.find(s => s.ownerId === 'p1' && s.location === 'reserved')!.cost).toBe('7000000');
    expect(sim.getSnapshot().stocks.find(s => s.ownerId === 'p1' && s.location === 'input')!.cost).toBe('9000000');
  });
});

describe('calendar pausing, stale completions and limits', () => {
  it('V06/V28: pauses 11:50 work at noon and completes once at 13:10', () => {
    const config = production([20]); config.sources[0]!.intervalMs = 230 * minute;
    const sim = new Simulation(compileConfig(config));
    sim.advanceTo(240 * minute);
    expect(sim.getSnapshot().stations[0]).toMatchObject({status: 'paused', reason: 'lunch', remainingProcessingMs: 10 * minute, progress: 0.5});
    expect(sold(sim.getSnapshot())).toBe(q(1));
    const stale = sim.step(); expect(stale!.timeMs).toBe(250 * minute); expect(stale!.staleCompletions).toBe(1);
    sim.advanceTo(310 * minute - 1); expect(sold(sim.getSnapshot())).toBe(q(1));
    sim.advanceTo(310 * minute); expect(sold(sim.getSnapshot())).toBe(q(2));
  });

  it('V07: carries 16:50 work across the night to next-day 08:10', () => {
    const config = production([20]); config.sources[0]!.intervalMs = 470 * minute;
    config.durationMs = createCalendar(config.calendar, 2).endTimeMs;
    const sim = new Simulation(compileConfig(config)); sim.advanceTo(540 * minute);
    expect(sim.getSnapshot().stations[0]).toMatchObject({reason: 'offShift', remainingProcessingMs: 10 * minute});
    expect(sold(sim.advanceTo(DAY_MS + 10 * minute - 1))).toBe(q(1));
    expect(sold(sim.advanceTo(DAY_MS + 10 * minute))).toBe(q(2));
  });

  it('V08: includes a noon completion before lunch without starting another operation', () => {
    const config = production([240]); config.sources[0]!.quantity = '2';
    const sim = new Simulation(compileConfig(config)); sim.advanceTo(240 * minute);
    expect(sold(sim.getSnapshot())).toBe(q(1));
    expect(sim.getSnapshot().stations[0]).toMatchObject({status: 'paused', reason: 'lunch', remainingProcessingMs: null});
    expect(sim.getSnapshot().stocks.some(s => s.location === 'reserved')).toBe(false);
    sim.advanceTo(300 * minute); expect(sim.getSnapshot().stations[0]!.remainingProcessingMs).toBe(240 * minute);
  });

  it('V08: accepts an exact horizon finish, retains input and prohibits further work', () => {
    const config = production([480]); config.sources[0]!.quantity = '2';
    const sim = new Simulation(compileConfig(config)); const result = sim.runToEnd();
    expect(sold(result)).toBe(q(1)); expect(result.line!.termination).toBe('horizon');
    expect(result.stations[0]!.inputs[0]!.quantity).toBe(q(1));
    expect(result.stations[0]!.remainingProcessingMs).toBeNull();
    expect(sim.step()).toBeNull(); expect(sim.stop().line!.termination).toBe('horizon');
  });

  it('carries work through several days and leaves exact remaining work at horizon', () => {
    const config = production([1000]); finite(config, '1', '10');
    config.durationMs = createCalendar(config.calendar, 3).endTimeMs;
    const sim = new Simulation(compileConfig(config));
    sim.advanceTo(2 * DAY_MS + 40 * minute); expect(sold(sim.getSnapshot())).toBe(q(1));
    const short = production([1000]); finite(short, '1', '10');
    short.durationMs = createCalendar(short.calendar, 2).endTimeMs;
    const unfinished = new Simulation(compileConfig(short)).runToEnd();
    expect(sold(unfinished)).toBe(0); expect(unfinished.stations[0]!.remainingProcessingMs).toBe(40 * minute);
  });

  it('replaces the completion token when 24:00 closing coincides with 00:00 opening', () => {
    const config = production([1460]); finite(config, '1', '10');
    config.calendar = {shiftStartMs: 0, lunchStartMs: 60 * minute, lunchEndMs: 61 * minute, shiftEndMs: DAY_MS};
    config.durationMs = createCalendar(config.calendar, 2).endTimeMs;
    const sim = new Simulation(compileConfig(config));
    sim.advanceTo(DAY_MS + 21 * minute - 1); expect(sold(sim.getSnapshot())).toBe(0);
    sim.advanceTo(DAY_MS + 21 * minute); expect(sold(sim.getSnapshot())).toBe(q(1));
    expect(sim.runToEnd().line!.termination).toBe('horizon');
  });
});

describe('sources, termination and snapshot diagnostics', () => {
  it('V21/V23: drains a common stock of five with two sources and no duplicate purchase', () => {
    const config = production(); finite(config, '5', '50');
    config.sources.push({...config.sources[0]!, id: 'secondSource'});
    config.routes.push({id: 'secondRawRoute', fromId: 'secondSource', toId: 'p0', materialId: 'm0'});
    const run = compileConfig(config), sim = new Simulation(run); sim.runToEnd();
    expect(sold(sim.getSnapshot())).toBe(q(5));
    expect(sim.getSnapshot().sources.reduce((sum, s) => sum + s.releasedQuantity, 0)).toBe(q(5));
    expect(sim.getSnapshot().sources.every(s => s.purchasedCost === '0' && s.attempts <= 4)).toBe(true);
    expect(sim.getSnapshot().line).toMatchObject({termination: 'horizon', flow: 'exhausted'});
    checkBalance(run, sim.getSnapshot());
  });

  it('V34: sources keep seven-minute work offsets inside the full engine', () => {
    const config = production([2000]); config.sources[0]!.intervalMs = 7 * minute;
    config.durationMs = createCalendar(config.calendar, 2).endTimeMs;
    const sim = new Simulation(compileConfig(config));
    for (const t of [238 * minute, 305 * minute, 536 * minute, DAY_MS + 3 * minute]) {
      sim.advanceTo(t); expect(sim.getSnapshot().sources[0]!.lastAttempt!.timeMs).toBe(t);
    }
    sim.runToEnd(); expect(sim.getSnapshot().sources[0]!.attempts).toBe(138);
  });

  it('distinguishes stopped, full horizon and lack of material without changing stopped state', () => {
    const run = compileConfig(production()), sim = new Simulation(run);
    sim.advanceTo(7 * minute); const stopped = sim.stop();
    expect(stopped.line!.termination).toBe('stopped'); expect(stopped.timeMs).toBe(7 * minute);
    expect(sim.runToEnd()).toBe(stopped); expect(sim.step()).toBeNull();
    const empty = production(); empty.sources[0]!.availability = 'warehouse';
    const noStock = new Simulation(compileConfig(empty)); noStock.advanceTo(0);
    expect(noStock.getSnapshot().line).toMatchObject({termination: 'running', flow: 'exhausted'});
    expect(noStock.getSnapshot().stations[0]).toMatchObject({status: 'starved', reason: 'input', inputs: [{missingQuantity: q(1)}]});
    expect(noStock.runToEnd().line).toMatchObject({termination: 'horizon', flow: 'exhausted'});
  });

  it('preserves unknown age of initial WIP and exposes independent progress/transfer data', () => {
    const config = production([5]); config.sources[0]!.availability = 'warehouse';
    config.initialStocks = [{id: 'initial', ownerId: 'p0', location: 'input', materialId: 'm0', quantity: '1', cost: '10'}];
    const sim = new Simulation(compileConfig(config)); sim.advanceTo(2 * minute);
    const old = sim.getSnapshot(); expect(old.stations[0]!.progress).toBeCloseTo(0.4);
    expect(old.stocks[0]!.provenance.origin).toEqual({kind: 'unknown'});
    sim.advanceTo(5 * minute); expect(old.stations[0]!.progress).toBeCloseTo(0.4);
    expect(sim.getSnapshot().line!.transfers[0]).toMatchObject({kind: 'sale', quantity: q(1), cost: '10000000'});
    expect(Object.isFrozen(sim.getSnapshot().line!.counters)).toBe(true);
    expect(JSON.parse(JSON.stringify(sim.getSnapshot())).schemaVersion).toBe(6);
  });

  it('reports an error separately from a user stop and keeps the last consistent time', () => {
    const sim = new Simulation(compileConfig(production()));
    sim.advanceTo(10);
    expect(() => sim.advanceTo(9)).toThrow();
    expect(sim.getSnapshot().line!.termination).toBe('error');
    expect(sim.getSnapshot().timeMs).toBe(10);
    expect(sim.getFailure()).not.toBeNull();
    expect(sim.step()).toBeNull();
  });
});
