import { describe, expect, it } from 'vitest';
import { activeWorkMs, advanceWork, CalendarError, calendarForDuration, canStart, clockAt, createCalendar, DAY_MS, nextOpening, sourceAttemptTime, workedMsUntil } from './calendar';
import { compileConfig, ConfigError } from './config';
import { line } from './test-fixtures';
const minute = 60_000;
const hour = 60 * minute;
const standard = line().calendar;
const at = (hourOfDay: number, minutes = 0, dayIndex = 0) => dayIndex * DAY_MS + hourOfDay * hour + minutes * minute - standard.shiftStartMs;

describe('repeating shift and lunch', () => {
  it('starts at the first opening and ends at the last closing with no extra night', () => {
    const calendar = createCalendar(standard, 3);
    expect(calendar.endTimeMs).toBe(2 * DAY_MS + 9 * hour);
    expect(calendar.dailyWorkMs).toBe(8 * hour);
    expect(workedMsUntil(calendar, calendar.endTimeMs)).toBe(24 * hour);
    expect(clockAt(calendar, 0)).toEqual({dayIndex: 0, timeOfDayMs: 8 * hour});
    expect(clockAt(calendar, calendar.endTimeMs)).toEqual({dayIndex: 2, timeOfDayMs: 17 * hour});
  });

  it('distinguishes openings, closings, lunch and horizon at one-millisecond precision', () => {
    const c = createCalendar(standard, 2);
    expect(canStart(c, 0)).toBe(true);
    expect(canStart(c, at(12) - 1)).toBe(true);
    expect(canStart(c, at(12))).toBe(false);
    expect(canStart(c, at(13) - 1)).toBe(false);
    expect(canStart(c, at(13))).toBe(true);
    expect(canStart(c, at(17))).toBe(false);
    expect(canStart(c, DAY_MS)).toBe(true);
    expect(canStart(c, c.endTimeMs)).toBe(false);
    expect(nextOpening(c, at(12))).toBe(at(13));
    expect(nextOpening(c, at(17))).toBe(DAY_MS);
    expect(nextOpening(c, at(14))).toBe(at(14));
    expect(nextOpening(c, c.endTimeMs)).toBeNull();
  });

  it('counts only active work, keeping source and lunch replacement separate', () => {
    const common = createCalendar(standard, 2);
    const replacement = createCalendar(standard, 2, true);
    expect(activeWorkMs(common, at(11, 50), at(13, 10))).toBe(20 * minute);
    expect(activeWorkMs(replacement, at(11, 50), at(13, 10))).toBe(80 * minute);
    expect(activeWorkMs(common, at(17), DAY_MS)).toBe(0);
    expect(workedMsUntil(common, DAY_MS)).toBe(8 * hour);
    expect(workedMsUntil(replacement, DAY_MS)).toBe(9 * hour);
    expect(canStart(replacement, at(12, 30))).toBe(true);
    expect(canStart(replacement, at(17))).toBe(false);
  });

  it('copies and freezes the calendar without mutating editor data', () => {
    const schedule = {...standard}; const c = createCalendar(schedule, 1);
    schedule.shiftEndMs = 18 * hour;
    expect(c.endTimeMs).toBe(9 * hour);
    expect(Object.isFrozen(c.intervals[0])).toBe(true);
    expect(Object.isFrozen(c.schedule)).toBe(true);
  });
});

describe('operation work and remainder', () => {
  it('completes the agreed lunch and overnight examples', () => {
    const c = createCalendar(standard, 3);
    expect(advanceWork(c, at(11, 50), 20 * minute)).toEqual({timeMs: at(13, 10), remainingMs: 0});
    expect(advanceWork(c, at(16, 50), 20 * minute)).toEqual({timeMs: at(8, 10, 1), remainingMs: 0});
    expect(advanceWork(createCalendar(standard, 1, true), at(11, 50), 20 * minute)).toEqual({timeMs: at(12, 10), remainingMs: 0});
  });

  it('retains work through multiple lunches and nights', () => {
    const c = createCalendar(standard, 4);
    const result = advanceWork(c, at(11, 50), 18 * hour);
    expect(result).toEqual({timeMs: at(14, 50, 2), remainingMs: 0});
    expect(activeWorkMs(c, at(11, 50), result.timeMs)).toBe(18 * hour);
  });

  it('allows completions exactly at closing, while excluding a new start', () => {
    const c = createCalendar(standard, 2);
    expect(advanceWork(c, at(11, 50), 10 * minute).timeMs).toBe(at(12));
    expect(advanceWork(c, at(16, 50), 10 * minute).timeMs).toBe(at(17));
    expect(advanceWork(c, 0, 16 * hour)).toEqual({timeMs: c.endTimeMs, remainingMs: 0});
    expect(canStart(c, c.endTimeMs)).toBe(false);
    expect(advanceWork(c, at(12), 1).timeMs).toBe(at(13) + 1);
  });

  it('stops at horizon and preserves uncompleted work', () => {
    const c = createCalendar(standard, 1);
    expect(advanceWork(c, at(16, 50), 20 * minute)).toEqual({timeMs: c.endTimeMs, remainingMs: 10 * minute});
    expect(advanceWork(c, c.endTimeMs, 10)).toEqual({timeMs: c.endTimeMs, remainingMs: 10});
    expect(advanceWork(c, at(12), 0)).toEqual({timeMs: at(12), remainingMs: 0});
    expect(advanceWork(c, 0, Number.MAX_SAFE_INTEGER).remainingMs).toBe(Number.MAX_SAFE_INTEGER - 8 * hour);
  });

  it('has the same result in one advance or advances split at calendar closures', () => {
    const c = createCalendar(standard, 4);
    for (const required of [1, 10 * minute, 20 * minute, 8 * hour, 18 * hour, 40 * hour]) {
      const start = at(11, 50);
      const full = advanceWork(c, start, required);
      const beforeLunch = Math.min(required, activeWorkMs(c, start, at(12)));
      const first = advanceWork(c, start, beforeLunch);
      expect(advanceWork(c, first.timeMs, required - beforeLunch)).toEqual(full);
    }
  });
});

describe('source working intervals (V34)', () => {
  it('keeps seven-minute attempts continuous across lunch and night', () => {
    const c = createCalendar(standard, 2);
    expect(sourceAttemptTime(c, 0, 7 * minute)).toBe(0);
    expect(sourceAttemptTime(c, 34, 7 * minute)).toBe(at(11, 58));
    expect(sourceAttemptTime(c, 35, 7 * minute)).toBe(at(13, 5));
    expect(sourceAttemptTime(c, 68, 7 * minute)).toBe(at(16, 56));
    expect(sourceAttemptTime(c, 69, 7 * minute)).toBe(at(8, 3, 1));
  });

  it('moves an exact closing slot to the next opening and suppresses horizon starts', () => {
    const c = createCalendar(standard, 2);
    expect(sourceAttemptTime(c, 1, 4 * hour)).toBe(at(13));
    expect(sourceAttemptTime(c, 2, 4 * hour)).toBe(DAY_MS);
    expect(sourceAttemptTime(c, 4, 4 * hour)).toBeNull();
    expect(sourceAttemptTime(c, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(() => sourceAttemptTime(createCalendar(standard, 1, true), 0, 1)).toThrow(CalendarError);
  });
});

describe('custom calendars and safe ranges', () => {
  it('connects selected days and the existing RunConfig horizon without an extra night', () => {
    const config = line();
    config.durationMs = createCalendar(config.calendar, 3).endTimeMs;
    const run = compileConfig(config);
    expect(calendarForDuration(run.resolved.calendar, run.resolved.durationMs).days).toBe(3);
    config.durationMs = DAY_MS;
    expect(() => compileConfig(config)).toThrow(ConfigError);
    expect(() => calendarForDuration(standard, 1)).toThrow(CalendarError);
    expect(() => calendarForDuration(standard, 9 * hour + 1)).toThrow(CalendarError);
  });
  it('supports custom millisecond boundaries, including a shift ending at midnight', () => {
    const c = createCalendar({shiftStartMs: 0, lunchStartMs: 1, lunchEndMs: 2, shiftEndMs: DAY_MS}, 2);
    expect(advanceWork(c, 0, 1)).toEqual({timeMs: 1, remainingMs: 0});
    expect(nextOpening(c, 1)).toBe(2);
    expect(canStart(c, DAY_MS)).toBe(true);
    expect(workedMsUntil(c, c.endTimeMs)).toBe(2 * (DAY_MS - 1));
  });

  it.each([0, -1, 0.5, NaN, Infinity])('rejects invalid day count %s', days => {
    expect(() => createCalendar(standard, days)).toThrow(CalendarError);
  });

  it('rejects invalid schedules, reversed intervals and out-of-horizon times', () => {
    expect(() => createCalendar({...standard, lunchStartMs: standard.shiftStartMs}, 1)).toThrow(CalendarError);
    expect(() => createCalendar({...standard, shiftEndMs: DAY_MS + 1}, 1)).toThrow(CalendarError);
    const c = createCalendar(standard, 1);
    expect(() => activeWorkMs(c, 2, 1)).toThrow(CalendarError);
    for (const t of [-1, 0.5, c.endTimeMs + 1, NaN]) expect(() => nextOpening(c, t)).toThrow(CalendarError);
    expect(() => advanceWork(c, 0, -1)).toThrow(CalendarError);
    expect(() => sourceAttemptTime(c, 0, 0)).toThrow(CalendarError);
  });

  it('uses exact products for horizons and rejects overflow explicitly', () => {
    const days = Math.floor(Number.MAX_SAFE_INTEGER / DAY_MS);
    const c = createCalendar(standard, days);
    expect(BigInt(c.endTimeMs)).toBe(BigInt(days - 1) * BigInt(DAY_MS) + 9n * BigInt(hour));
    expect(workedMsUntil(c, c.endTimeMs)).toBe(days * 8 * hour);
    expect(advanceWork(c, 0, days * 8 * hour)).toEqual({timeMs: c.endTimeMs, remainingMs: 0});
    expect(() => createCalendar(standard, Number.MAX_SAFE_INTEGER)).toThrow(CalendarError);
  });
});
