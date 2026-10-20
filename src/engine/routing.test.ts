import { describe, expect, it } from 'vitest';
import { compileConfig, ConfigError } from './config';
import type { DeepReadonly, RunConfig } from './config';
import { Simulation } from './simulation';
import type { Snapshot } from './state';
import { line } from './test-fixtures';
const minute = 60_000, q = (n: number) => n * 1_000_000;

function split() {
  const config = line(); config.initialStocks = [];
  config.sources[0]!.availability = 'warehouse'; config.sources[0]!.quantity = '0.3';
  config.initialStocks = [{id: 'rawStock', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '0.3', cost: '3'}];
  config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '10'};
  config.stations[1]!.plan[0]!.processing.timeMs = 100 * minute;
  const other = structuredClone(config.stations[1]!); other.id = 's3'; other.plan[0]!.id = 'plan3'; other.priority = 10;
  config.stations.push(other);
  config.routes.push({id: 'toS3', fromId: 's1', toId: 's3', materialId: 'part'}, {id: 's3Market', fromId: 's3', toId: 'market', materialId: 'product'});
  return config;
}
function balance(run: RunConfig, snapshot: DeepReadonly<Snapshot>) {
  const initialCost = run.resolved.initialStocks.reduce((sum, stock) => sum + stock.cost, 0n);
  const purchases = snapshot.sources.reduce((sum, source) => sum + BigInt(source.purchasedCost), 0n);
  const disposed = snapshot.line!.counters.reduce((sum, c) => sum + BigInt(c.soldCost) + BigInt(c.scrapCost), 0n);
  expect(snapshot.stocks.reduce((sum, s) => sum + BigInt(s.cost), 0n) + disposed).toBe(initialCost + purchases);
  for (const counter of snapshot.line!.counters) {
    const initial = run.resolved.initialStocks.filter(s => s.materialId === counter.materialId).reduce((sum, s) => sum + s.quantity, 0);
    const admitted = snapshot.sources.filter(s => run.resolved.sources.some(source => source.id === s.sourceId && source.materialId === counter.materialId && source.availability === 'virtual')).reduce((sum, s) => sum + s.releasedQuantity, 0);
    const stock = snapshot.stocks.filter(s => s.materialId === counter.materialId).reduce((sum, s) => sum + s.quantity, 0);
    expect(initial + admitted + counter.produced).toBe(stock + counter.consumed + counter.sold + counter.scrapped);
  }
}

describe('explicit branching routes', () => {
  it('V13: gives a shared output to receiver priority, independent of route IDs', () => {
    const run = compileConfig(split()), snapshot = new Simulation(run).advanceTo(minute);
    expect(snapshot.line!.transfers.filter(t => t.kind === 'route').map(t => [t.toId, t.quantity])).toEqual([['s3', q(10)]]);
    expect(snapshot.stations.find(s => s.stationId === 's2')!.status).toBe('starved');
    expect(snapshot.stations.find(s => s.stationId === 's3')!.input.quantity).toBe(q(9));
    balance(run, snapshot);
  });
  it('breaks equal priorities by receiver ID and never takes allocated input back', () => {
    const config = split(); config.stations.find(s => s.id === 's3')!.priority = 0;
    const snapshot = new Simulation(compileConfig(config)).advanceTo(2 * minute);
    expect(snapshot.stations.find(s => s.stationId === 's2')!.input.quantity).toBe(q(9));
    expect(snapshot.stations.find(s => s.stationId === 's3')!.input.quantity).toBe(0);
  });
  it.each(['0', '2'])('partially transfers through output capacity %s and names all blockers', outputCapacity => {
    const config = split(); config.stations[0]!.outputBuffer = {kind: 'quantity', quantity: outputCapacity};
    config.stations.find(s => s.id === 's2')!.inputBuffer = {kind: 'quantity', quantity: '2'};
    config.stations.find(s => s.id === 's3')!.inputBuffer = {kind: 'quantity', quantity: '2'};
    const run = compileConfig(config), simulation = new Simulation(run), snapshot = simulation.advanceTo(minute);
    expect(snapshot.stations.find(s => s.stationId === 's2')!.input.quantity).toBe(q(2));
    expect(snapshot.stations.find(s => s.stationId === 's3')!.input.quantity).toBe(q(2));
    const producer = snapshot.stations.find(s => s.stationId === 's1')!;
    expect(producer.output.heldQuantity + producer.output.quantity).toBe(q(4));
    expect(producer.blockedBy).toEqual(outputCapacity === '0' ? [{stationId: 's3', location: 'input'}, {stationId: 's2', location: 'input'}] : [{stationId: 's1', location: 'output'}]);
    balance(run, snapshot);
  });
  it('preserves every timestamp balance and matches irregular advances and permuted arrays', () => {
    const config = split(); config.stations.forEach(s => {s.plan[0]!.processing.timeMs = minute;});
    config.initialStocks[0]!.quantity = '3'; config.initialStocks[0]!.cost = '30';
    const run = compileConfig(config), stepped = new Simulation(run);
    while (stepped.step() !== null) balance(run, stepped.getSnapshot());
    const expected = stepped.getSnapshot(), advanced = new Simulation(run);
    for (const time of [1, 66_666, 500_001, config.durationMs]) advanced.advanceTo(time);
    expect(advanced.getSnapshot()).toEqual(expected);
    config.stations.reverse(); config.routes.reverse(); config.recipes.reverse(); config.materials.reverse(); config.initialStocks.reverse();
    const permuted = compileConfig(config);
    expect(permuted.calculationHash).toBe(run.calculationHash);
    expect(new Simulation(permuted).runToEnd()).toEqual(expected);
  });
  it('still rejects duplicate edges, missing routes and cycles', () => {
    const duplicate = split(); duplicate.routes.push({...duplicate.routes[1]!, id: 'duplicate'});
    expect(() => compileConfig(duplicate)).toThrow(ConfigError);
    const missing = split(); missing.routes = missing.routes.filter(r => r.fromId !== 's3');
    expect(() => compileConfig(missing)).toThrow(ConfigError);
    const cycle = split(); cycle.recipes[1]!.output.materialId = 'part';
    expect(() => compileConfig(cycle)).toThrow(ConfigError);
  });
});

describe('competing producers', () => {
  it.each([
    {capacity: '0', delay: 2, priority: 100, first: '3000000', next: '7000000'},
    {capacity: '3', delay: 2, priority: 100, first: '3000000', next: '7000000'},
    {capacity: '3', delay: 1, priority: -100, first: '7000000', next: '3000000'},
  ])('orders competing output by readiness then ID: $capacity / $delay / $priority', ({capacity, delay, priority, first, next}) => {
    const config = line(); config.sources[0]!.availability = 'warehouse'; config.initialStocks = [];
    config.recipes[0]!.output.quantity = '1'; config.recipes[0]!.inputs[0]!.quantity = '1';
    config.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '1'}; config.stations[0]!.outputBuffer = {kind: 'quantity', quantity: capacity};
    config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '1'}; config.stations[1]!.plan[0]!.processing.timeMs = 5 * minute;
    const other = structuredClone(config.stations[0]!); other.id = 's0'; other.plan[0]!.id = 'plan0'; other.plan[0]!.processing.timeMs = delay * minute; other.priority = priority;
    const backfill = structuredClone(config.stations[0]!); backfill.id = 'backfill'; backfill.plan[0]!.id = 'planBackfill'; backfill.outputBuffer = {kind: 'quantity', quantity: '1'};
    config.stations.push(other, backfill); config.routes.push({id: 'sourceBackfill', fromId: 'source', toId: 'backfill', materialId: 'raw'}, {id: 'backfillS2', fromId: 'backfill', toId: 's2', materialId: 'part'}, {id: 'sourceS0', fromId: 'source', toId: 's0', materialId: 'raw'}, {id: 's0S2', fromId: 's0', toId: 's2', materialId: 'part'});
    config.initialStocks = [
      {id: 'backfillPart', ownerId: 'backfill', location: 'output', materialId: 'part', quantity: '1', cost: '2'},
      {id: 'initialPart', ownerId: 's2', location: 'input', materialId: 'part', quantity: '1', cost: '1'},
      {id: 'initialS1', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '1', cost: '3'},
      {id: 'initialS0', ownerId: 's0', location: 'input', materialId: 'raw', quantity: '1', cost: '7'},
    ];
    const run = compileConfig(config), simulation = new Simulation(run);
    simulation.advanceTo(2 * minute);
    // Initial output fills the input at t=0. Both producers then wait for space.
    const waiting = simulation.getSnapshot();
    expect(waiting.stocks.find(s => s.ownerId === 's2' && s.location === 'input')!.cost).toBe('2000000');
    const second = waiting.stocks.find(s => s.ownerId === 's0' && (s.location === 'held' || s.location === 'output'))!;
    expect(second.readyAtMs).toBe(delay * minute);
    simulation.advanceTo(5 * minute);
    expect(simulation.getSnapshot().stocks.find(s => s.ownerId === 's2' && s.location === 'reserved')!.cost).toBe('2000000');
    expect(simulation.getSnapshot().stocks.find(s => s.ownerId === 's2' && s.location === 'input')!.cost).toBe(first);
    simulation.advanceTo(10 * minute);
    expect(simulation.getSnapshot().stocks.find(s => s.ownerId === 's2' && s.location === 'reserved')!.cost).toBe(first);
    expect(simulation.getSnapshot().stocks.find(s => s.ownerId === 's2' && s.location === 'input')!.cost).toBe(next);
    balance(run, simulation.runToEnd());
  });
  it('drains older buffered stock before newly finished output', () => {
    const config = split(); config.stations[0]!.outputBuffer = {kind: 'quantity', quantity: '20'};
    config.initialStocks.push({id: 'old', ownerId: 's1', location: 'output', materialId: 'part', quantity: '1', cost: '17'});
    const simulation = new Simulation(compileConfig(config));
    simulation.advanceTo(minute);
    expect(simulation.getSnapshot().stocks.find(s => s.ownerId === 's3' && s.location === 'reserved')!.cost).toBe('17000000');
  });
});
