import {describe, expect, it} from 'vitest';
import {compileConfig} from '../engine/config';
import {calendarForDuration, workedMsUntil} from '../engine/calendar';
import {Simulation} from '../engine/simulation';
import {lesson2Config, lesson2Text, lesson2Variants} from './lesson-2';

describe('lesson 2 reference scenarios', () => {
  it.each([
    ['base', 178, [58, 60, 60], 18, 8],
    ['faster-second', 179, [59, 60, 60], 16, 8],
    ['faster-third', 238, [78, 80, 80], 16, 6],
  ] as const)('%s separates line filling from the sustained output rate', (variant, total, shifts, first, interval) => {
    const config = lesson2Config(variant), run = compileConfig(config), sim = new Simulation(run);
    // Independent arithmetic in working minutes: first product traverses all four posts.
    expect(Math.floor((1440 - first) / interval) + 1).toBe(total);
    expect(sim.advanceTo((first - 1) * 60_000).line!.counters.find(c => c.materialId === 'product')!.sold).toBe(0);
    expect(sim.advanceTo(first * 60_000).line!.counters.find(c => c.materialId === 'product')!.sold).toBe(1_000_000);
    const end = sim.runToEnd();
    expect(end.line!.termination).toBe('horizon');
    expect(end.timeMs).toBe(205_200_000);
    expect(end.line!.counters.find(c => c.materialId === 'product')!.sold).toBe(total * 1_000_000);
    expect(end.line!.shiftOutput.filter(row => row.materialId === 'product').map(row => row.quantity / 1_000_000)).toEqual(shifts);
    const calendar = calendarForDuration(config.calendar, config.durationMs);
    expect(workedMsUntil(calendar, config.durationMs)).toBe(1440 * 60_000);
    const middle = new Simulation(run).advanceTo(120 * 60_000);
    expect(middle.stations[2]!.inputs[0]!.quantity).toBeGreaterThan(0);
    expect(middle.stations[3]!.timeByState.starvedMs).toBeGreaterThan(0);
    expect(end.stations[2]!.timeByState.processingMs).toBe((1440 - (variant === 'faster-second' ? 5 : 7)) * 60_000);
    expect(end.stations[2]!.timeByState.starvedMs).toBe((variant === 'faster-second' ? 5 : 7) * 60_000);
    expect(end.stations[2]!.timeByState.blockedMs).toBe(0);
    expect(new Simulation(run).runToEnd()).toEqual(end);
  }, 15_000);

  it.each(lesson2Variants)('%s preserves unfinished work across lunch and overnight', variant => {
    const sim = new Simulation(compileConfig(lesson2Config(variant)));
    const lunch = sim.advanceTo(240 * 60_000);
    const afterLunch = sim.advanceTo(300 * 60_000);
    expect(afterLunch.line!.counters).toEqual(lunch.line!.counters);
    for (const station of lunch.stations.filter(s => s.remainingProcessingMs !== null)) {
      expect(afterLunch.stations.find(s => s.stationId === station.stationId)!.remainingProcessingMs).toBe(station.remainingProcessingMs);
    }
    const close = sim.advanceTo(540 * 60_000);
    const nextOpening = sim.advanceTo(1440 * 60_000);
    expect(nextOpening.line!.counters).toEqual(close.line!.counters);
    for (const station of close.stations.filter(s => s.remainingProcessingMs !== null)) {
      expect(nextOpening.stations.find(s => s.stationId === station.stationId)!.remainingProcessingMs).toBe(station.remainingProcessingMs);
    }
  });

  it('creates independent experiments with exactly one changed processing time', () => {
    const base = lesson2Config();
    for (const [variant, index, minutes] of [['faster-second', 1, 2], ['faster-third', 2, 6]] as const) {
      const changed = lesson2Config(variant), expected = structuredClone(base);
      expected.stations[index]!.plan[0]!.processing.timeMs = minutes * 60_000;
      expect(changed).toEqual(expected);
      changed.stations[0]!.inputBuffer = {kind: 'infinite'};
      expect(lesson2Config()).toEqual(base);
    }
    expect(base.stations.map(s => s.plan[0]!.processing.timeMs! / 60_000)).toEqual([3, 4, 8, 3]);
  });

  it.each(lesson2Variants)('%s has the same calculation and result in both languages', variant => {
    const ru = compileConfig(lesson2Config(variant, 'ru')), en = compileConfig(lesson2Config(variant, 'en'));
    expect(ru.calculationHash).toBe(en.calculationHash);
    expect(new Simulation(ru).runToEnd()).toEqual(new Simulation(en).runToEnd());
    for (const language of ['ru', 'en'] as const) {
      expect(lesson2Text[language].actions).toHaveLength(3);
      expect(lesson2Text[language].questions).toHaveLength(3);
    }
  }, 15_000);
});
