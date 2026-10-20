import { describe, expect, it } from 'vitest';
import { compileConfig, ConfigError, inputCapacity } from './config';
import type { DeepReadonly, RunConfig } from './config';
import { Simulation } from './simulation';
import type { Snapshot } from './state';
import { line } from './test-fixtures';
const minute = 60_000, q = (n: number) => Math.round(n * 1_000_000);
function assembly() {
  const config = line();
  config.materials = [config.materials[0]!, {id: 'other', name: 'B', role: 'raw', color: '#a45', purchasePrice: '3'}, config.materials[2]!];
  config.recipes = [{id: 'assemble', name: 'Assembly', kind: 'production', inputs: [{materialId: 'raw', quantity: '1'}, {materialId: 'other', quantity: '2'}], output: {materialId: 'product', quantity: '1'}}];
  config.stations = [structuredClone(config.stations[1]!)];
  const station = config.stations[0]!; station.plan[0]!.recipeId = 'assemble'; station.plan[0]!.processing.timeMs = 3 * minute;
  station.inputBuffer = {kind: 'materials', materials: [{materialId: 'raw', capacity: {kind: 'quantity', quantity: '2'}}, {materialId: 'other', capacity: {kind: 'quantity', quantity: '4'}}]};
  config.sources = [
    {id: 'sourceA', name: 'A', materialId: 'raw', availability: 'warehouse', quantity: '1', intervalMs: minute},
    {id: 'sourceB', name: 'B', materialId: 'other', availability: 'warehouse', quantity: '1', intervalMs: minute},
  ];
  config.routes = [{id: 'toA', fromId: 'sourceA', toId: 's2', materialId: 'raw'}, {id: 'toB', fromId: 'sourceB', toId: 's2', materialId: 'other'}, {id: 'toMarket', fromId: 's2', toId: 'market', materialId: 'product'}];
  config.initialStocks = [{id: 'stockA', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '5', cost: '50'}, {id: 'stockB', ownerId: 'warehouse', location: 'warehouse', materialId: 'other', quantity: '10', cost: '30'}];
  return config;
}
function balance(run: RunConfig, snapshot: DeepReadonly<Snapshot>) {
  const costIn = run.resolved.initialStocks.reduce((sum, s) => sum + s.cost, 0n) + snapshot.sources.reduce((sum, s) => sum + BigInt(s.purchasedCost), 0n);
  expect(snapshot.stocks.reduce((sum, s) => sum + BigInt(s.cost), 0n) + snapshot.line!.counters.reduce((sum, c) => sum + BigInt(c.soldCost) + BigInt(c.scrapCost), 0n)).toBe(costIn);
  for (const counter of snapshot.line!.counters) {
    const initial = run.resolved.initialStocks.filter(s => s.materialId === counter.materialId).reduce((sum, s) => sum + s.quantity, 0);
    const admitted = snapshot.sources.filter(s => run.resolved.sources.some(source => source.id === s.sourceId && source.materialId === counter.materialId && source.availability === 'virtual')).reduce((sum, s) => sum + s.releasedQuantity, 0);
    const stock = snapshot.stocks.filter(s => s.materialId === counter.materialId).reduce((sum, s) => sum + s.quantity, 0);
    expect(initial + admitted + counter.produced).toBe(stock + counter.consumed + counter.sold + counter.scrapped);
  }
  for (const station of run.resolved.stations) for (const input of station.inputBuffers) {
    if (input.capacity.kind === 'quantity') expect(snapshot.stocks.filter(s => s.ownerId === station.id && s.location === 'input' && s.materialId === input.materialId).reduce((sum, s) => sum + s.quantity, 0)).toBeLessThanOrEqual(input.capacity.quantity);
  }
}
const input = (snapshot: DeepReadonly<Snapshot>, id: string) => snapshot.stations[0]!.inputs.find(input => input.materialId === id)!;

describe('assembly kits', () => {
  it('V12: waits for the second B without reserving A, then consumes the whole kit once', () => {
    const run = compileConfig(assembly()), simulation = new Simulation(run), waiting = simulation.advanceTo(0);
    expect(waiting.stations[0]).toMatchObject({status: 'starved', reason: 'input'});
    expect(input(waiting, 'raw')).toMatchObject({quantity: q(1), missingQuantity: 0, reservedQuantity: 0});
    expect(input(waiting, 'other')).toMatchObject({quantity: q(1), missingQuantity: q(1), reservedQuantity: 0});
    expect(waiting.stocks.some(s => s.location === 'reserved')).toBe(false);
    const started = simulation.advanceTo(minute);
    expect(started.stations[0]!.status).toBe('processing');
    expect(input(started, 'raw')).toMatchObject({quantity: q(1), reservedQuantity: q(1), missingQuantity: 0});
    expect(input(started, 'other')).toMatchObject({quantity: 0, reservedQuantity: q(2), missingQuantity: 0});
    expect(started.line!.counters.every(c => c.consumed === 0 && c.produced === 0)).toBe(true);
    expect(simulation.advanceTo(4 * minute).line!.counters.find(c => c.materialId === 'product')).toMatchObject({produced: q(1), sold: q(1), soldCost: '16000000'});
    expect(simulation.getSnapshot().line!.counters.find(c => c.materialId === 'raw')!.consumed).toBe(q(1));
    expect(simulation.getSnapshot().line!.counters.find(c => c.materialId === 'other')!.consumed).toBe(q(2));
    expect(input(waiting, 'other').quantity).toBe(q(1));
    balance(run, simulation.getSnapshot());
  });
  it('keeps incomplete kits and diagnoses no progress when one component runs out', () => {
    const config = assembly(); config.initialStocks.find(s => s.materialId === 'other')!.quantity = '1';
    const run = compileConfig(config), snapshot = new Simulation(run).advanceTo(20 * minute);
    expect(snapshot.stations[0]!.status).toBe('starved');
    expect(input(snapshot, 'raw').quantity).toBe(q(2));
    expect(input(snapshot, 'other').missingQuantity).toBe(q(1));
    expect(snapshot.stocks.some(s => s.location === 'reserved')).toBe(false);
    expect(snapshot.line).toMatchObject({flow: 'missingInput'});
    expect(snapshot.line!.counters.find(c => c.materialId === 'product')!.sold).toBe(0);
    balance(run, snapshot);
  });
  it('requires every component when a third material is added', () => {
    const config = assembly();
    config.materials.push({id: 'third', name: 'C', role: 'raw', color: '#389', purchasePrice: '2'});
    config.recipes[0]!.inputs.push({materialId: 'third', quantity: '1'});
    config.sources.push({id: 'sourceC', name: 'C', materialId: 'third', availability: 'warehouse', quantity: '1', intervalMs: minute});
    config.routes.push({id: 'toC', fromId: 'sourceC', toId: 's2', materialId: 'third'});
    const buffer = config.stations[0]!.inputBuffer;
    if (buffer.kind !== 'materials') throw new Error('Expected fixture capacities');
    buffer.materials.push({materialId: 'third', capacity: {kind: 'quantity', quantity: '1'}});
    const run = compileConfig(config), snapshot = new Simulation(run).advanceTo(minute);
    expect(snapshot.stations[0]!.inputs).toHaveLength(3);
    expect(input(snapshot, 'raw').missingQuantity).toBe(0); expect(input(snapshot, 'other').missingQuantity).toBe(0);
    expect(input(snapshot, 'third').missingQuantity).toBe(q(1));
    expect(snapshot.stocks.some(s => s.location === 'reserved')).toBe(false);
    balance(run, snapshot);
  });
  it('V24: preserves fractional leftovers, FIFO costs and unknown initial age', () => {
    const config = assembly(); config.recipes[0]!.inputs = [{materialId: 'raw', quantity: '0.3'}, {materialId: 'other', quantity: '0.2'}];
    config.initialStocks = [{id: 'a', ownerId: 's2', location: 'input', materialId: 'raw', quantity: '1', cost: '10'}, {id: 'b', ownerId: 's2', location: 'input', materialId: 'other', quantity: '1', cost: '7'}];
    const run = compileConfig(config), snapshot = new Simulation(run).runToEnd();
    expect(snapshot.line!.counters.find(c => c.materialId === 'product')!.sold).toBe(q(3));
    expect(input(snapshot, 'raw').quantity).toBe(q(0.1)); expect(input(snapshot, 'other').quantity).toBe(q(0.4));
    expect(snapshot.stocks.every(s => s.provenance.origin.kind === 'unknown')).toBe(true);
    balance(run, snapshot);
  });
  it('V32: can refill fractional space separately for both materials without deadlock', () => {
    const config = assembly(); config.recipes[0]!.inputs = [{materialId: 'raw', quantity: '0.6'}, {materialId: 'other', quantity: '0.3'}];
    config.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    config.initialStocks[0]!.quantity = '1.8'; config.initialStocks[0]!.cost = '18'; config.initialStocks[1]!.quantity = '0.9'; config.initialStocks[1]!.cost = '2.7';
    config.sources[1]!.quantity = '0.5';
    const run = compileConfig(config), snapshot = new Simulation(run).runToEnd();
    expect(snapshot.line!.counters.find(c => c.materialId === 'product')!.sold).toBe(q(3));
    expect(snapshot.stocks).toEqual([]); balance(run, snapshot);
  });
  it('preserves every timestamp balance and matches advances and permuted component arrays', () => {
    const config = assembly(), run = compileConfig(config), stepped = new Simulation(run);
    while (stepped.step() !== null) balance(run, stepped.getSnapshot());
    const advanced = new Simulation(run);
    for (const t of [1, 199_999, 500_001, run.resolved.durationMs]) advanced.advanceTo(t);
    expect(advanced.getSnapshot()).toEqual(stepped.getSnapshot());
    expect(advanced.getSnapshot().line!.counters.find(c => c.materialId === 'product')!.sold).toBe(q(5));
    config.recipes[0]!.inputs.reverse(); config.sources.reverse(); config.routes.reverse();
    if (config.stations[0]!.inputBuffer.kind === 'materials') config.stations[0]!.inputBuffer.materials.reverse();
    const permuted = compileConfig(config); expect(permuted.calculationHash).toBe(run.calculationHash);
    expect(new Simulation(permuted).runToEnd()).toEqual(stepped.getSnapshot());
  });
});

describe('assembly configuration boundary', () => {
  it('treats a scalar capacity as an independent capacity for each material', () => {
    const config = assembly(); config.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '3'};
    const run = compileConfig(config), station = run.resolved.stations[0]!;
    expect(inputCapacity(station, 'raw')).toEqual({kind: 'quantity', quantity: q(3)});
    expect(inputCapacity(station, 'other')).toEqual({kind: 'quantity', quantity: q(3)});
  });
  it('validates initial capacities separately rather than summing unlike materials', () => {
    const config = assembly();
    config.initialStocks = [{id: 'a', ownerId: 's2', location: 'input', materialId: 'raw', quantity: '2', cost: '20'}, {id: 'b', ownerId: 's2', location: 'input', materialId: 'other', quantity: '4', cost: '12'}];
    const run = compileConfig(config), snapshot = new Simulation(run).getSnapshot();
    expect(input(snapshot, 'raw').quantity).toBe(q(2)); expect(input(snapshot, 'other').quantity).toBe(q(4));
    balance(run, snapshot);
  });
  it.each(['empty', 'duplicate', 'missingCapacity', 'unknownCapacity', 'smallCapacity', 'overfilled', 'missingRoute'] as const)('rejects %s with localized diagnostics', kind => {
    const config = assembly(), buffer = config.stations[0]!.inputBuffer;
    if (buffer.kind !== 'materials') throw new Error('Expected fixture capacities');
    if (kind === 'empty') config.recipes[0]!.inputs = [];
    if (kind === 'duplicate') config.recipes[0]!.inputs.push({...config.recipes[0]!.inputs[0]!});
    if (kind === 'missingCapacity') buffer.materials.pop();
    if (kind === 'unknownCapacity') buffer.materials[0]!.materialId = 'unknown';
    if (kind === 'smallCapacity') buffer.materials[1]!.capacity = {kind: 'quantity', quantity: '1'};
    if (kind === 'overfilled') config.initialStocks.push({id: 'tooMuch', ownerId: 's2', location: 'input', materialId: 'other', quantity: '5', cost: '15'});
    if (kind === 'missingRoute') config.routes = config.routes.filter(r => r.materialId !== 'other');
    try {compileConfig(config); throw new Error('Expected a configuration error');}
    catch (error) {expect(error).toBeInstanceOf(ConfigError); const failure = error as ConfigError; expect(failure.messages.ru.length).toBeGreaterThan(0); expect(failure.messages.en.length).toBeGreaterThan(0);}
  });
});
