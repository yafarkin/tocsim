import { describe, expect, it } from 'vitest';
import { createCalendar, DAY_MS, elapsedTime } from './calendar';
import { compileConfig } from './config';
import { Simulation } from './simulation';
import { line } from './test-fixtures';

const hour = 3_600_000;
function setup(days = 2) {
  const config = line();
  config.durationMs = createCalendar(config.calendar, days).endTimeMs;
  config.stations[1]!.lunchReplacement = true;
  // A long operation stays unfinished across lunch and night.
  config.stations[0]!.plan[0]!.processing.timeMs = 20 * hour;
  return compileConfig(config);
}

describe('exact observed calendar and available work time', () => {
  it.each([
    [0, 0, 0], [4 * hour - 1, 4 * hour - 1, 4 * hour - 1],
    [4 * hour, 4 * hour, 4 * hour], [4.5 * hour, 4 * hour, 4.5 * hour],
    [5 * hour, 4 * hour, 5 * hour], [9 * hour, 8 * hour, 9 * hour],
    [DAY_MS, 8 * hour, 9 * hour], [DAY_MS + 9 * hour, 16 * hour, 18 * hour],
  ])('observes t=%i with common work=%i and replacement work=%i', (timeMs, common, replacement) => {
    const snapshot = new Simulation(setup()).advanceTo(timeMs);
    expect(snapshot.observation).toEqual({calendarMs: timeMs, workMs: common});
    expect(snapshot.stations.map(s => s.availableWorkMs)).toEqual([common, replacement]);
    expect(snapshot.timeMs).toBe(timeMs);
  });

  it('adds arbitrary interval partitions exactly, including empty intervals and calendar closures', () => {
    const run = setup(3);
    for (const replacement of [false, true]) {
      const calendar = createCalendar(run.resolved.calendar, 3, replacement);
      const cuts = [0, 1, 4 * hour, 4 * hour, 4.5 * hour + 1, 5 * hour, 9 * hour, DAY_MS, calendar.endTimeMs];
      const sum = {calendarMs: 0, workMs: 0};
      for (let i = 1; i < cuts.length; i++) {
        const interval = elapsedTime(calendar, cuts[i - 1]!, cuts[i]!);
        sum.calendarMs += interval.calendarMs; sum.workMs += interval.workMs;
      }
      expect(sum).toEqual({calendarMs: 2 * DAY_MS + 9 * hour, workMs: (replacement ? 27 : 24) * hour});
    }
  });

  it('keeps event steps, direct advance and irregular display advances identical', () => {
    const run = setup(), direct = new Simulation(run), stepped = new Simulation(run), split = new Simulation(run);
    direct.runToEnd();
    while (stepped.step() !== null) { /* includes multiple events at the same timestamp */ }
    for (const t of [0, 1, 123_457, 4 * hour, 4 * hour + 1, 5 * hour, 9 * hour + 1, DAY_MS + 1, run.resolved.durationMs]) split.advanceTo(t);
    expect(stepped.getSnapshot()).toEqual(direct.getSnapshot());
    expect(split.getSnapshot()).toEqual(direct.getSnapshot());
  });

  it('freezes observation at a manual stop inside an operation without charging the remaining horizon', () => {
    const sim = new Simulation(setup());
    sim.advanceTo(4.5 * hour + 7);
    const stopped = sim.stop();
    expect(stopped.line!.termination).toBe('stopped');
    expect(stopped.observation).toEqual({calendarMs: 4.5 * hour + 7, workMs: 4 * hour});
    expect(stopped.stations[0]!.remainingProcessingMs).not.toBeNull();
    expect(sim.getSnapshot()).toEqual(stopped);
    expect(Object.isFrozen(stopped.observation)).toBe(true);
    expect(JSON.parse(JSON.stringify(stopped)).schemaVersion).toBe(21);
  });

  it('observes the full requested horizon after raw material runs out', () => {
    const config = line();
    config.initialStocks = [];
    config.sources[0]!.availability = 'warehouse';
    const snapshot = new Simulation(compileConfig(config)).runToEnd();
    expect(snapshot.line!.flow).toBe('exhausted');
    expect(snapshot.observation).toEqual({calendarMs: 9 * hour, workMs: 8 * hour});
    expect(snapshot.stations.every(s => s.availableWorkMs === 8 * hour)).toBe(true);
  });

  it('keeps millisecond custom boundaries and midnight closing exact', () => {
    const config = line();
    config.calendar = {shiftStartMs: 0, lunchStartMs: 1, lunchEndMs: 2, shiftEndMs: DAY_MS};
    config.durationMs = 2 * DAY_MS;
    config.stations[1]!.lunchReplacement = true;
    const snapshot = new Simulation(compileConfig(config)).runToEnd();
    expect(snapshot.observation).toEqual({calendarMs: 2 * DAY_MS, workMs: 2 * DAY_MS - 2});
    expect(snapshot.stations.map(s => s.availableWorkMs)).toEqual([2 * DAY_MS - 2, 2 * DAY_MS]);
  });

  it('keeps long horizons within the safe integer range without looping over days', () => {
    const days = Math.floor(Number.MAX_SAFE_INTEGER / DAY_MS);
    const calendar = createCalendar(line().calendar, days);
    expect(elapsedTime(calendar, 0, calendar.endTimeMs)).toEqual({calendarMs: calendar.endTimeMs, workMs: days * 8 * hour});
  });
});
