import {describe, expect, it} from 'vitest';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {lesson1Config, lesson1Result, lesson1Variants} from './lesson-1';

describe('lesson 1 paired experiments', () => {
  it.each([[0, 177, 180], [1, 175, 176], [2, 169, 170], [3, 171, 175], [4, 174, 174], [42, 170, 172]])('calibrates seed %s', (seed, small, large) => {
    const results = lesson1Variants.map(variant => {
      const run = compileConfig(lesson1Config(variant, 'ru', seed));
      const model = new Simulation(run).runToEnd();
      expect(model.line!.termination).toBe('horizon');
      return lesson1Result(model);
    });
    expect(results.map(result => result.total / 1_000_000)).toEqual([190, small, large]);
    expect(results[0]!.total).toBe(190_000_000);
    expect(results[1]!.total).toBeLessThan(results[0]!.total);
    expect(results[2]!.total).toBeGreaterThanOrEqual(results[1]!.total);
    expect(results[1]!.blockedMs).toBeGreaterThan(0);
    expect(results[1]!.starvedMs).toBeGreaterThan(results[0]!.starvedMs);
  }, 30_000);
  it('keeps variants independent and translates without changing calculation', () => {
    for (const variant of lesson1Variants) {
      const config = lesson1Config(variant);
      expect(compileConfig(config).calculationHash).toBe(compileConfig(lesson1Config(variant, 'en')).calculationHash);
      config.stations[0]!.setupMs = 123;
      expect(lesson1Config(variant).stations[0]!.setupMs).toBe(0);
    }
    const base = lesson1Config(), variable = lesson1Config('variable'), buffered = lesson1Config('buffered');
    base.stations.forEach(s => {s.plan[0]!.processing.cv = 0.5;});
    expect(variable).toEqual(base);
    variable.stations.forEach(s => {s.inputBuffer = {kind: 'quantity', quantity: '40'};});
    expect(buffered).toEqual(variable);
  });
  it('replays exactly', () => {
    const run = compileConfig(lesson1Config('variable'));
    expect(new Simulation(run).runToEnd()).toEqual(new Simulation(run).runToEnd());
  }, 20_000);
});
