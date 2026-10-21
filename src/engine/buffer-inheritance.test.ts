import { describe, expect, it } from 'vitest';
import { compileConfig, ConfigError, inputCapacity, outputCapacity } from './config';
import { Simulation } from './simulation';
import { blockedCyclicLine, cyclicLine, line } from './test-fixtures';
const Q = 1_000_000, M = 60_000;
function failure(config: unknown) {
  try { compileConfig(config); } catch (error) {expect(error).toBeInstanceOf(ConfigError); return error as ConfigError;}
  throw new Error('Expected a configuration error');
}

describe('explicit global capacities and station inheritance', () => {
  it('changes inherited input 10→15 while retaining the station override of 30', () => {
    const config = line(); config.bufferDefaults = {input: {kind: 'quantity', quantity: '10'}};
    config.stations[0]!.inputBuffer = {kind: 'inherit'};
    config.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '30'};
    const first = compileConfig(config);
    config.bufferDefaults.input = {kind: 'quantity', quantity: '15'};
    const second = compileConfig(config);
    expect(first.resolved.stations.map(s => s.inputBuffers[0]!.capacity)).toEqual([{kind: 'quantity', quantity: 10 * Q}, {kind: 'quantity', quantity: 30 * Q}]);
    expect(second.resolved.stations.map(s => s.inputBuffers[0]!.capacity)).toEqual([{kind: 'quantity', quantity: 15 * Q}, {kind: 'quantity', quantity: 30 * Q}]);
    expect(first.calculationHash).not.toBe(second.calculationHash);
    expect(first.source.bufferDefaults!.input).toEqual({kind: 'quantity', quantity: '10'});
    expect(first.source.stations[0]!.inputBuffer).toEqual({kind: 'inherit'});
    expect(Object.isFrozen(second.resolved.stations[0]!.inputBuffers[0]!.capacity)).toBe(true);
  });

  it('inherits outputs independently and uses the concept default of direct transfer', () => {
    const config = line(); config.stations[0]!.outputBuffer = {kind: 'inherit'};
    const direct = compileConfig(config);
    expect(outputCapacity(direct.resolved.stations[0]!, 'part')).toEqual({kind: 'quantity', quantity: 0});
    config.bufferDefaults = {output: {kind: 'quantity', quantity: '3'}};
    const buffered = compileConfig(config);
    expect(buffered.resolved.stations.map(s => s.outputBuffers[0]!.capacity)).toEqual([{kind: 'quantity', quantity: 3 * Q}, {kind: 'quantity', quantity: 2 * Q}]);
  });

  it('normalizes inherited and equivalent explicit capacities to identical calculations', () => {
    const inherited = cyclicLine(); inherited.bufferDefaults = {input: {kind: 'infinite'}, output: {kind: 'quantity', quantity: '2'}};
    inherited.stations[0]!.inputBuffer = {kind: 'inherit'}; inherited.stations[0]!.outputBuffer = {kind: 'inherit'};
    const explicit = structuredClone(inherited); delete explicit.bufferDefaults;
    explicit.stations[0]!.inputBuffer = {kind: 'infinite'};
    explicit.stations[0]!.outputBuffer = {kind: 'materials', materials: [{materialId: 'b', capacity: {kind: 'quantity', quantity: '2'}}, {materialId: 'a', capacity: {kind: 'quantity', quantity: '2'}}]};
    const a = compileConfig(inherited), b = compileConfig(explicit);
    expect(a.resolved).toEqual(b.resolved); expect(a.calculationHash).toBe(b.calculationHash);
    expect(new Simulation(a).runToEnd()).toEqual(new Simulation(b).runToEnd());
    expect(a.resolved.stations[0]!.inputBuffers.map(x => x.capacity)).toEqual([{kind: 'infinite'}, {kind: 'infinite'}]);
    expect(a.resolved.stations[0]!.inputBuffers[0]!.capacity).not.toBe(a.resolved.stations[0]!.inputBuffers[1]!.capacity);
  });

  it('does not include unused defaults in calculation identity or modify explicit station rules', () => {
    const config = line(), base = compileConfig(config);
    config.bufferDefaults = {input: {kind: 'quantity', quantity: '10'}, output: {kind: 'infinite'}};
    expect(compileConfig(config).resolved).toEqual(base.resolved);
    expect(compileConfig(config).calculationHash).toBe(base.calculationHash);
  });

  it('rejects an inherited input without an explicit global until shift calculation is implemented', () => {
    const config = line(); config.stations.reverse(); config.stations[0]!.inputBuffer = {kind: 'inherit'};
    const error = failure(config);
    expect(error).toMatchObject({code: 'unsupported', path: 'config.stations.0.inputBuffer', objectId: 's2'});
    expect(error.messages.ru).toContain('долю смены'); expect(error.messages.en).toContain('shift-based');
  });

  it('checks inherited capacity against the entire processing batch without silently increasing it', () => {
    const config = line(); config.bufferDefaults = {input: {kind: 'quantity', quantity: '0.5'}};
    config.stations[0]!.inputBuffer = {kind: 'inherit'}; config.stations[0]!.plan[0]!.processing.repetitions = 2;
    expect(failure(config)).toMatchObject({code: 'capacity', path: 'config.stations.0.inputBuffer', objectId: 's1'});
  });

  it.each([null, {input: {kind: 'inherit'}}, {input: {kind: 'quantity', quantity: '-1'}}, {output: {kind: 'infinite', quantity: '1'}}, {other: {kind: 'infinite'}}])('validates global settings even when unused: %j', bufferDefaults => {
    const config = line(); Object.assign(config, {bufferDefaults});
    expect(failure(config).path).toMatch(/^config.bufferDefaults/);
  });

  it('does not accept fields on inherit or nested inheritance inside material overrides', () => {
    const config = line(); config.bufferDefaults = {input: {kind: 'infinite'}};
    Object.assign(config.stations[0]!, {inputBuffer: {kind: 'inherit', quantity: '3'}});
    expect(failure(config).path).toBe('config.stations.0.inputBuffer.quantity');
    Object.assign(config.stations[0]!, {inputBuffer: {kind: 'materials', materials: [{materialId: 'raw', capacity: {kind: 'inherit'}}]}});
    expect(failure(config).path).toBe('config.stations.0.inputBuffer.materials.0.capacity.kind');
  });
});

describe('material-specific output capacities', () => {
  it.each([
    [],
    [{materialId: 'a', capacity: {kind: 'infinite'}}],
    [{materialId: 'a', capacity: {kind: 'infinite'}}, {materialId: 'a', capacity: {kind: 'infinite'}}],
    [{materialId: 'a', capacity: {kind: 'infinite'}}, {materialId: 'raw', capacity: {kind: 'infinite'}}],
  ].map(materials => ({materials})))('rejects incomplete, duplicate or foreign output materials: %j', ({materials}) => {
    const config = cyclicLine(); Object.assign(config.stations[0]!, {outputBuffer: {kind: 'materials', materials}});
    expect(failure(config).path).toMatch(/^config.stations.0.outputBuffer/);
  });

  it('validates initial output stock against its own material capacity', () => {
    const config = cyclicLine(); config.stations[0]!.outputBuffer = {kind: 'materials', materials: [{materialId: 'a', capacity: {kind: 'infinite'}}, {materialId: 'b', capacity: {kind: 'quantity', quantity: '0.5'}}]};
    config.initialStocks.push({id: 'initialB', ownerId: 's1', location: 'output', materialId: 'b', quantity: '1', cost: '1'});
    expect(failure(config)).toMatchObject({code: 'capacity', path: 'config.initialStocks', objectId: 's1'});
    expect(inputCapacity(compileConfig(cyclicLine()).resolved.stations[0]!, 'raw')).toEqual({kind: 'infinite'});
  });

  it.each(['0', '0.5'])('keeps A in its buffer while B independently uses capacity %s', quantity => {
    const config = blockedCyclicLine(true); config.stations[0]!.outputBuffer = {kind: 'materials', materials: [{materialId: 'a', capacity: {kind: 'infinite'}}, {materialId: 'b', capacity: {kind: 'quantity', quantity}}]};
    const sim = new Simulation(compileConfig(config)), snapshot = sim.advanceTo(9 * M);
    expect(snapshot.stations[0]).toMatchObject({status: 'blocked', outputs: [
      {materialId: 'a', quantity: 3 * Q, heldQuantity: 0},
      {materialId: 'b', quantity: Number(quantity) * Q, heldQuantity: (1 - Number(quantity)) * Q},
    ], blockedBy: quantity === '0' ? [{stationId: 's2', location: 'input'}] : [{stationId: 's1', location: 'output'}]});
    const initialCost = 151_000_000n;
    expect(snapshot.stocks.reduce((sum, stock) => sum + BigInt(stock.cost), 0n)).toBe(initialCost);
    for (const stock of snapshot.stocks.filter(s => s.ownerId === 's1' && s.materialId === 'b')) {
      expect(BigInt(stock.provenance.processingMs.s1!)).toBe(BigInt(stock.quantity) * 120_000n / BigInt(Q));
    }
  });
});
