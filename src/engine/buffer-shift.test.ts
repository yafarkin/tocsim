import {describe, expect, it} from 'vitest';
import {compileConfig, ConfigError, inputCapacity} from './config';
import {line, cyclicLine} from './test-fixtures';
import {Simulation} from './simulation';
const Q = 1_000_000, M = 60_000;
const capacity = (config: ReturnType<typeof line>, index = 1, material = 'part') => inputCapacity(compileConfig(config).resolved.stations[index]!, material);

describe('shift-based input capacity', () => {
  it('uses 480 working minutes and defaults to half a shift: 80 doors → 40', () => {
    const c = line(); c.stations[1]!.inputBuffer = {kind: 'inherit'};
    c.stations[1]!.plan[0]!.processing.timeMs = 6 * M;
    const run = compileConfig(c);
    expect(capacity(c)).toEqual({kind: 'quantity', quantity: 40 * Q});
    expect(run.source.stations[1]!.inputBuffer).toEqual({kind: 'inherit'});
    expect(run.source.bufferDefaults).toBeUndefined();
    expect(Object.isFrozen(run.bufferCalculations[0])).toBe(true);
    c.stations[1]!.plan[0]!.processing.timeMs = 12 * M;
    expect(capacity(c)).toEqual({kind: 'quantity', quantity: 20 * Q});
    expect(run.resolved.stations[1]!.inputBuffers[0]!.capacity).toEqual({kind: 'quantity', quantity: 40 * Q});
  });
  it('raises calculated 40 to a complete kit of 50 and records the reason', () => {
    const c = line(), p = c.stations[1]!.plan[0]!.processing;
    p.repetitions = 50; p.timeMs = 6 * M; c.stations[1]!.inputBuffer = {kind: 'shift', shifts: '0.5'};
    const run = compileConfig(c);
    expect(capacity(c)).toEqual({kind: 'quantity', quantity: 50 * Q});
    expect(run.bufferCalculations[0]).toMatchObject({roundedQuantity: 40 * Q, minimumKit: 50 * Q, raisedToKit: true});
    c.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '40'};
    expect(() => compileConfig(c)).toThrow(ConfigError);
  });
  it.each(['sequential', 'simultaneous'] as const)('counts batches, repetitions, both cyclic setups and materials for %s', mode => {
    const c = cyclicLine(); c.initialStocks = [];
    const s = c.stations[0]!; s.inputBuffer = {kind: 'inherit'}; s.setupMs = M;
    s.plan[0]!.processing.repetitions = 3; s.plan[0]!.processing.mode = mode;
    const run = compileConfig(c), cycleMinutes = mode === 'sequential' ? 10 : 6;
    expect(run.bufferCalculations.map(x => [x.cycleWorkMs, x.cycleConsumption])).toEqual([[String(cycleMinutes * M), String(6 * Q)], [String(cycleMinutes * M), String(Q)]]);
    expect(run.resolved.stations[0]!.inputBuffers.map(x => x.capacity)).toEqual([{kind: 'quantity', quantity: 240 * 6 / cycleMinutes * Q}, {kind: 'quantity', quantity: 240 / cycleMinutes * Q}]);
    s.initialRecipeId = 'recipeB';
    expect(compileConfig(c).bufferCalculations).toEqual(run.bufferCalculations);

  });
  it('counts assembly components separately and skips setup between identical recipe IDs', () => {
    const c = cyclicLine(); c.initialStocks = [];
    c.recipes[0]!.inputs.push({materialId: 'rawB', quantity: '4'});
    const s = c.stations[0]!; s.inputBuffer = {kind: 'shift', shifts: '0.5'}; s.setupMs = M;
    s.plan.splice(1, 0, {...structuredClone(s.plan[0]!), id: 'repeatA', batches: 1});
    const run = compileConfig(c);
    // A,A,A,B: 5 minutes processing + two recipe transitions.
    expect(run.bufferCalculations.map(x => [x.cycleWorkMs, x.cycleConsumption])).toEqual([['420000', String(3 * Q)], ['420000', String(13 * Q)]]);
    expect(run.bufferCalculations[1]!.roundedQuantity).toBe(Math.ceil(240 * 13 * Q / 7));
  });
  it('rounds raw materials to micro-units and intermediate materials to whole units', () => {
    const c = line(); c.initialStocks = [];
    c.bufferDefaults = {input: {kind: 'shift', shifts: '0.000001'}};
    c.stations.forEach(s => {s.inputBuffer = {kind: 'inherit'};});
    c.recipes[0]!.inputs[0]!.quantity = '0.000001';
    c.recipes[1]!.inputs[0]!.quantity = '0.3';
    expect(capacity(c, 0, 'raw')).toEqual({kind: 'quantity', quantity: 1});
    expect(capacity(c)).toEqual({kind: 'quantity', quantity: Q});
    expect(compileConfig(c).bufferCalculations.map(x => x.raisedToKit)).toEqual([false, false]);
  });
  // Two complete 1:10 network executions need the same CI allowance as other acceptance runs.
  it('has the same calculation identity and execution as equivalent explicit capacities', () => {
    const c = line(); c.stations[1]!.inputBuffer = {kind: 'shift', shifts: '0.5'};
    c.sources[0]!.intervalMs = 6 * M;
    const a = compileConfig(c); c.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '160'};
    const b = compileConfig(c);
    expect(a.resolved).toEqual(b.resolved); expect(a.calculationHash).toBe(b.calculationHash);
    expect(new Simulation(a).runToEnd()).toEqual(new Simulation(b).runToEnd());
  }, 15_000);
  it.each(['0', '-1', '0.0000001', 'NaN'])('rejects invalid shift coefficient %s even when unused', shifts => {
    const c = line(); c.bufferDefaults = {input: {kind: 'shift', shifts}};
    expect(() => compileConfig(c)).toThrow(ConfigError);
  });
  it('rejects overflow with a station path and keeps huge cycle sums exact', () => {
    const c = line(); c.stations[1]!.inputBuffer = {kind: 'shift', shifts: '9007199254'};
    expect(() => compileConfig(c)).toThrow(/config.stations.1.inputBuffer/);
    c.stations[1]!.inputBuffer = {kind: 'shift', shifts: '0.5'};
    c.stations[1]!.plan[0]!.batches = Number.MAX_SAFE_INTEGER;
    c.stations[1]!.plan[0]!.processing.timeMs = Number.MAX_SAFE_INTEGER;
    expect(capacity(c)).toEqual({kind: 'quantity', quantity: Q});
  });
});
