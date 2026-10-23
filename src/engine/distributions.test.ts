import {describe, expect, it} from 'vitest';
import {processingDuration, distributionMoments, RandomError, meanDurationSixths} from './random';
import type {BoundedDistribution, DurationDistribution} from './random';
import {compileConfig, ConfigError, inputCapacity} from './config';
import {line, cyclicLine} from './test-fixtures';
import {Simulation} from './simulation';
import {Runner} from '../runner/runner';
const distributions: BoundedDistribution[] = [
  {kind: 'uniform', minMs: 120_000, maxMs: 360_000},
  {kind: 'triangular', minMs: 120_000, peakMs: 180_000, maxMs: 480_000},
];
function configFor(distribution: DurationDistribution) {
  const c = line(); c.initialStocks = []; c.sources[0]!.intervalMs = 15 * 60_000;
  const row = c.stations[1]!.plan[0]!;
  row.processing = {mode: 'sequential', repetitions: 1, distribution};
  c.stations[1]!.inputBuffer = {kind: 'inherit'};
  return c;
}
const sample = (d: BoundedDistribution, ordinal: number, seed = 0) => {const m = distributionMoments(d); return processingDuration(m.meanMs, m.cv, seed, 'work', 'recipe-work', ordinal, d);};

describe('bounded processing distributions', () => {
  it('pins portable millisecond vectors including seed zero and large ordinals', () => {
    expect(distributions.map(d => [0,1,2,1000,65536,Number.MAX_SAFE_INTEGER-1].map(i => sample(d, i)))).toEqual([
      [193838, 225254, 285521, 208256, 202981, 302847],
      [206553, 233757, 296927, 218686, 214184, 319629],
    ]);
  });
  it.each(distributions)('matches bounds, mean and CV of $kind over a fixed sample', d => {
    const expected = distributionMoments(d); let sum = 0, squares = 0;
    for (let i = 0; i < 20_000; i++) {const value = sample(d, i, 42); expect(value).toBeGreaterThanOrEqual(d.minMs); expect(value).toBeLessThanOrEqual(d.maxMs); sum += value; squares += value * value;}
    const mean = sum / 20_000, cv = Math.sqrt(squares / 20_000 - mean * mean) / mean;
    expect(mean / expected.meanMs).toBeGreaterThan(0.98); expect(mean / expected.meanMs).toBeLessThan(1.02);
    expect(cv / expected.cv).toBeGreaterThan(0.96); expect(cv / expected.cv).toBeLessThan(1.04);
  });
  it.each(['uniform', 'triangular'] as const)('normalizes degenerate %s to the same calculation as a constant', kind => {
    const d: BoundedDistribution = kind === 'uniform' ? {kind, minMs: 42, maxMs: 42} : {kind, minMs: 42, peakMs: 42, maxMs: 42};
    expect(sample(d, 0)).toBe(42); expect(distributionMoments(d)).toEqual({meanMs: 42, cv: 0});
    const a = compileConfig(configFor(d)), b = compileConfig(configFor({kind: 'constant', timeMs: 42}));
    expect(a.resolved).toEqual(b.resolved); expect(a.calculationHash).toBe(b.calculationHash);
  });
  it('supports triangular peaks at either boundary and safe maximum durations', () => {
    for (const peakMs of [1, Number.MAX_SAFE_INTEGER]) {
      const d: BoundedDistribution = {kind: 'triangular', minMs: 1, peakMs, maxMs: Number.MAX_SAFE_INTEGER};
      for (let i = 0; i < 100; i++) {const duration = sample(d, i); expect(Number.isSafeInteger(duration)).toBe(true); expect(duration).toBeGreaterThan(0);}
    }
    expect(distributionMoments({kind: 'triangular', minMs: Number.MAX_SAFE_INTEGER - 1, peakMs: Number.MAX_SAFE_INTEGER, maxMs: Number.MAX_SAFE_INTEGER}).meanMs).toBe(Number.MAX_SAFE_INTEGER);
    const d: BoundedDistribution = {kind: 'uniform', minMs: Number.MAX_SAFE_INTEGER - 1, maxMs: Number.MAX_SAFE_INTEGER};
    expect(Number.isSafeInteger(sample(d, 0))).toBe(true);
    expect(() => sample({kind: 'triangular', minMs: 2, peakMs: 1, maxMs: 3}, 0)).toThrow(RandomError);
  });
  it.each([
    {kind: 'uniform', minMs: 0, maxMs: 10}, {kind: 'uniform', minMs: 10, maxMs: 9},
    {kind: 'uniform', minMs: 1.5, maxMs: 10}, {kind: 'uniform', minMs: 1, maxMs: Number.MAX_SAFE_INTEGER + 1},
    {kind: 'triangular', minMs: 1, peakMs: 4, maxMs: 3}, {kind: 'triangular', minMs: 2, peakMs: 1, maxMs: 3},
    {kind: 'triangular', minMs: 1, maxMs: 3}, {kind: 'lognormal', meanMs: 10, cv: 3},
    {kind: 'uniform', minMs: 1, maxMs: 3, cv: 0.5}, {kind: 'other', minMs: 1, maxMs: 3},
  ])('rejects invalid or conflicting distribution parameters: %j', distribution => {
    const c = configFor(distributions[0]!); Object.assign(c.stations[1]!.plan[0]!.processing, {distribution});
    try {compileConfig(c); throw new Error('Expected error');} catch (error) {
      expect(error).toBeInstanceOf(ConfigError); const e = error as ConfigError;
      expect(e.path).toMatch(/^config.stations.1.plan.0.processing.distribution/); expect(e.messages.ru).toBeTruthy(); expect(e.messages.en).toBeTruthy();
    }
  });
  it('keeps legacy lognormal semantics and disallows independent mean/CV with a distribution', () => {
    const c = configFor({kind: 'lognormal', meanMs: 12345, cv: 0.5}), run = compileConfig(c);
    c.stations[1]!.plan[0]!.processing = {mode: 'sequential', repetitions: 1, timeMs: 12345, cv: 0.5};
    expect(compileConfig(c).calculationHash).toBe(run.calculationHash);
    Object.assign(c.stations[1]!.plan[0]!.processing, {distribution: distributions[0]});
    expect(() => compileConfig(c)).toThrow(/without separate/);
  });
  it('keeps fractional means exact in buffer calculation and freezes independent source parameters', () => {
    const d: BoundedDistribution = {kind: 'triangular', minMs: 1, peakMs: 1, maxMs: 2};
    expect(meanDurationSixths(4 / 3, d)).toBe(8n);
    const c = configFor(d); c.stations[1]!.inputBuffer = {kind: 'shift', shifts: '0.000001'};
    const run = compileConfig(c);
    // 0.000001 * 28,800,000 / (4/3) = 21.6 parts, rounded up to 22.
    expect(inputCapacity(run.resolved.stations[1]!, 'part')).toEqual({kind: 'quantity', quantity: 22_000_000});
    expect(run.bufferCalculations[0]!.cycleWorkMs).toBe('8/6');
    expect(Object.isFrozen(run.resolved.stations[1]!.plan[0]!.distribution)).toBe(true);
    d.maxMs = 10;
    expect(run.source.stations[1]!.plan[0]!.processing.distribution).toEqual({kind: 'triangular', minMs: 1, peakMs: 1, maxMs: 2});
    const uniform = compileConfig(configFor({kind: 'uniform', minMs: 120_000, maxMs: 360_000}));
    expect(inputCapacity(uniform.resolved.stations[1]!, 'part')).toEqual({kind: 'quantity', quantity: 60_000_000});
  });
  it('does not round a uniform half-millisecond mean before calculating capacity', () => {
    const c = configFor({kind: 'uniform', minMs: 1, maxMs: 2});
    c.stations[1]!.inputBuffer = {kind: 'shift', shifts: '0.000001'};
    const run = compileConfig(c);
    expect(run.resolved.stations[1]!.timeMs).toBe(1.5);
    expect(inputCapacity(run.resolved.stations[1]!, 'part')).toEqual({kind: 'quantity', quantity: 20_000_000});
  });
  it.each(distributions)('retains a sampled $kind operation through lunch, night and repeated pauses', d => {
    const c = configFor(d); c.durationMs += 86_400_000 * 3;
    c.initialStocks = [{id: 'startPart', ownerId: 's2', location: 'input', materialId: 'part', quantity: '1', cost: '0'}];
    c.stations[1]!.plan[0]!.processing = {mode: 'sequential', repetitions: 1, distribution: d.kind === 'uniform'
      ? {kind: 'uniform', minMs: 900 * 60_000, maxMs: 901 * 60_000}
      : {kind: 'triangular', minMs: 900 * 60_000, peakMs: 901 * 60_000, maxMs: 902 * 60_000}};
    const run = compileConfig(c), sim = new Simulation(run);
    sim.advanceTo(240 * 60_000); const lunch = sim.getSnapshot().stations.find(s => s.stationId === 's2')!;
    sim.advanceTo(300 * 60_000); const resumed = sim.getSnapshot().stations.find(s => s.stationId === 's2')!;
    expect(resumed.remainingProcessingMs).toBe(lunch.remainingProcessingMs); expect(resumed.operationDurationMs).toBe(lunch.operationDurationMs);
    sim.advanceTo(540 * 60_000); const night = sim.getSnapshot().stations.find(s => s.stationId === 's2')!;
    sim.advanceTo(86_400_000); const morning = sim.getSnapshot().stations.find(s => s.stationId === 's2')!;
    expect(morning.remainingProcessingMs).toBe(night.remainingProcessingMs); expect(morning.operationDurationMs).toBe(lunch.operationDurationMs);
    expect(sim.runToEnd()).toEqual(new Simulation(run).runToEnd());
  });
  it.each(['sequential', 'simultaneous'] as const)('preserves bounded cyclic %s batches across order, speeds, pause, step and repeat', mode => {
    const c = cyclicLine(); c.initialStocks.forEach(s => {s.quantity = '4';}); c.stations[0]!.setupMs = 60_000;
    for (const [i, row] of c.stations[0]!.plan.entries()) row.processing = {mode, repetitions: 2, distribution: distributions[i]!};
    c.stations[0]!.inputBuffer = {kind: 'inherit'};
    const run = compileConfig(c), expected = new Simulation(run).runToEnd();
    c.routes.reverse(); c.recipes.reverse(); c.materials.reverse();
    expect(new Simulation(compileConfig(c)).runToEnd()).toEqual(expected);
    for (const speed of [1,60,300,1800,'max'] as const) {
      let now = 0, callback: (() => void) | null = null;
      const runner = new Runner(run, undefined, {now: () => now, request: cb => {callback = cb; return cb;}, cancel: () => {callback = null;}});
      const drain = () => {let count = 0; while (callback) {if (++count > 2000) throw new Error('No progress');const cb = callback; callback = null; now += 60_000; cb();}};
      runner.setSpeed(speed); runner.step(); runner.resume(); runner.pause(); const paused = runner.getView(); now += 100_000; expect(runner.getView()).toBe(paused);
      runner.resume(); drain(); expect(runner.getView().model).toEqual(expected); runner.repeat(); drain(); expect(runner.getView().model).toEqual(expected); runner.dispose();
    }
  });
});
