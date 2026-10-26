import {describe, expect, it} from 'vitest';
import {compileConfig} from '../engine/config';
import {calendarForDuration, workedMsUntil} from '../engine/calendar';
import {Simulation} from '../engine/simulation';
import {lesson3Buffers, lesson3Config, lesson3Result} from './lesson-3';

describe('lesson 3 paired buffer experiments', () => {
  it.each([
    [0, [378, 398, 398]], [1, [383, 397, 397]], [2, [380, 395, 395]],
    [3, [383, 398, 398]], [4, [386, 398, 398]], [42, [379, 397, 397]],
  ] as const)('seed %s protects the constraint with diminishing output gains in the tested series', (seed, output) => {
    const results = lesson3Buffers.map(buffer => {
      const config = lesson3Config(buffer, 'ru', seed), run = compileConfig(config);
      const model = new Simulation(run).runToEnd(), result = lesson3Result(run, model);
      expect(model.line!.termination).toBe('horizon');
      expect(model.timeMs).toBe(378_000_000);
      expect(workedMsUntil(calendarForDuration(config.calendar, config.durationMs), model.timeMs)).toBe(2400 * 60_000);
      const station = model.stations.find(s => s.stationId === 's3')!;
      expect(station.timeByState.blockedMs).toBe(0);
      expect(station.timeByState.processingMs + result.starvedMs).toBe(2400 * 60_000);
      expect(result.queue.durationMs).toBe(2400 * 60_000);
      expect(BigInt(result.queue.quantityMs)).toBeGreaterThan(0n);
      expect(BigInt(result.queue.quantityMs)).toBeLessThanOrEqual(BigInt(buffer * 1_000_000) * BigInt(result.queue.durationMs));
      // The displayed average uses the existing exact input-place integral, excluding reserved work.
      expect(result.queue.quantityMs).toBe(model.line!.stockTime.find(row => row.ownerId === 's3' && row.location === 'input' && row.materialId === 'part-2')!.workQuantityMs);
      return result;
    });
    expect(results.map(result => result.total / 1_000_000)).toEqual(output);
    expect(results[1]!.starvedMs).toBeLessThan(results[0]!.starvedMs);
    expect(results[2]!.starvedMs).toBe(results[1]!.starvedMs);
    expect(BigInt(results[1]!.queue.quantityMs)).toBeGreaterThan(BigInt(results[0]!.queue.quantityMs));
    expect(BigInt(results[2]!.queue.quantityMs)).toBeGreaterThan(BigInt(results[1]!.queue.quantityMs));
  }, 45_000);

  it('changes only the third input capacity and returns independent configurations', () => {
    const base = lesson3Config(1);
    for (const buffer of lesson3Buffers) {
      const expected = structuredClone(base), actual = lesson3Config(buffer);
      expected.stations[2]!.inputBuffer = {kind: 'quantity', quantity: String(buffer)};
      expect(actual).toEqual(expected);
      actual.stations[0]!.outputBuffer = {kind: 'quantity', quantity: '99'};
      expect(lesson3Config(1)).toEqual(base);
    }
    expect(base.stations.map(s => [s.plan[0]!.processing.timeMs, s.plan[0]!.processing.cv])).toEqual([[180_000, 0.9], [240_000, 0.9], [360_000, 0]]);
  });

  it.each(lesson3Buffers)('buffer %s translates captions without changing the calculation', buffer => {
    const ru = compileConfig(lesson3Config(buffer, 'ru')), en = compileConfig(lesson3Config(buffer, 'en'));
    expect(ru.calculationHash).toBe(en.calculationHash);
    expect(ru.resolved).toEqual(en.resolved);
  });

  it('replays the same configuration exactly and handles the empty initial queue', () => {
    const run = compileConfig(lesson3Config());
    const sim = new Simulation(run);
    expect(lesson3Result(run, sim.getSnapshot()).queue).toEqual({quantityMs: '0', durationMs: 0});
    const end = sim.runToEnd();
    expect(new Simulation(run).runToEnd()).toEqual(end);
  }, 30_000);
});
