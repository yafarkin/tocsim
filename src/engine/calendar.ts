/** Model time zero is the first shift opening. Days repeat without real dates. */
export const DAY_MS = 86_400_000;
export interface CalendarSchedule {
  readonly shiftStartMs: number;
  readonly lunchStartMs: number;
  readonly lunchEndMs: number;
  readonly shiftEndMs: number;
}
export interface WorkCalendar {
  readonly schedule: CalendarSchedule;
  readonly days: number;
  readonly workDuringLunch: boolean;
  readonly endTimeMs: number;
  readonly dailyWorkMs: number;
  readonly intervals: readonly (readonly [number, number])[];
}
export class CalendarError extends Error {
  constructor(public readonly code: 'value' | 'range', public readonly messages: {ru: string; en: string}) {
    super(messages.en); this.name = 'CalendarError';
  }
}
function integer(value: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CalendarError('value', {ru: `Ожидается целое число от ${min} до ${max}.`, en: `Expected an integer from ${min} to ${max}.`});
  }
  return value;
}
function safe(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CalendarError('range', {ru: 'Модельное время превышает допустимый диапазон.', en: 'Model time exceeds the supported range.'});
  }
  return Number(value);
}
function time(calendar: WorkCalendar, value: number): number {
  return integer(value, 0, calendar.endTimeMs);
}
export function createCalendar(schedule: CalendarSchedule, days: number, workDuringLunch = false): WorkCalendar {
  const start = integer(schedule.shiftStartMs, 0, DAY_MS);
  const lunchStart = integer(schedule.lunchStartMs, 0, DAY_MS);
  const lunchEnd = integer(schedule.lunchEndMs, 0, DAY_MS);
  const end = integer(schedule.shiftEndMs, 0, DAY_MS);
  integer(days, 1);
  if (!(start < lunchStart && lunchStart < lunchEnd && lunchEnd < end) || typeof workDuringLunch !== 'boolean') {
    throw new CalendarError('value', {ru: 'Нужна одна смена с обедом строго внутри неё и явным признаком подмены.', en: 'A single shift, lunch strictly inside it and a boolean lunch replacement flag are required.'});
  }
  const intervals: [number, number][] = workDuringLunch
    ? [[0, end - start]] : [[0, lunchStart - start], [lunchEnd - start, end - start]];
  return Object.freeze({
    schedule: Object.freeze({...schedule}), days, workDuringLunch,
    endTimeMs: safe(BigInt(days - 1) * BigInt(DAY_MS) + BigInt(end - start)),
    dailyWorkMs: intervals.reduce((sum, [from, to]) => sum + to - from, 0),
    intervals: Object.freeze(intervals.map(interval => Object.freeze(interval))),
  });
}

/** The existing config field is elapsed model time, ending at a whole shift horizon. */
export function calendarForDuration(schedule: CalendarSchedule, durationMs: number, workDuringLunch = false): WorkCalendar {
  integer(durationMs, 1);
  const first = createCalendar(schedule, 1, workDuringLunch);
  const rest = BigInt(durationMs) - BigInt(first.endTimeMs);
  if (rest < 0n || rest % BigInt(DAY_MS) !== 0n) {
    throw new CalendarError('value', {ru: 'Горизонт должен заканчиваться в конце смены выбранного целого числа дней.', en: 'Horizon must end at the shift closing of a positive whole number of days.'});
  }
  return createCalendar(schedule, Number(rest / BigInt(DAY_MS)) + 1, workDuringLunch);
}

/** Opening intervals are half-open; a completion may still occur at their right end. */
export function canStart(calendar: WorkCalendar, timeMs: number): boolean {
  time(calendar, timeMs);
  if (timeMs === calendar.endTimeMs) return false;
  const phase = timeMs % DAY_MS;
  return calendar.intervals.some(([from, to]) => from <= phase && phase < to);
}
export function nextOpening(calendar: WorkCalendar, timeMs: number): number | null {
  time(calendar, timeMs);
  const phase = timeMs % DAY_MS;
  const base = BigInt(timeMs) - BigInt(phase);
  for (const [from, to] of calendar.intervals) {
    if (phase < to) {
      const candidate = base + BigInt(Math.max(phase, from));
      return candidate < BigInt(calendar.endTimeMs) ? safe(candidate) : null;
    }
  }
  const next = base + BigInt(DAY_MS);
  return next < BigInt(calendar.endTimeMs) ? safe(next) : null;
}

/** Exact accumulated active milliseconds in [0, timeMs), including previous days. */
export function workedMsUntil(calendar: WorkCalendar, timeMs: number): number {
  time(calendar, timeMs);
  const phase = timeMs % DAY_MS;
  let result = BigInt(Math.floor(timeMs / DAY_MS)) * BigInt(calendar.dailyWorkMs);
  for (const [from, to] of calendar.intervals) result += BigInt(Math.max(0, Math.min(phase, to) - from));
  return safe(result);
}
export function activeWorkMs(calendar: WorkCalendar, fromMs: number, toMs: number): number {
  time(calendar, fromMs); time(calendar, toMs);
  if (fromMs > toMs) throw new CalendarError('value', {ru: 'Конец интервала не может предшествовать началу.', en: 'Interval end cannot precede its start.'});
  return workedMsUntil(calendar, toMs) - workedMsUntil(calendar, fromMs);
}

/** Exact observation interval, independent of events, production and display frames.
 * workMs is available calendar time, not the station's busy/processing time.
 */
export function elapsedTime(calendar: WorkCalendar, fromMs: number, toMs: number): {calendarMs: number; workMs: number} {
  const workMs = activeWorkMs(calendar, fromMs, toMs);
  return {calendarMs: toMs - fromMs, workMs};
}

/** Inverse for a completion, choosing the closing boundary at an exact work total. */
function completionAt(calendar: WorkCalendar, accumulatedMs: number): number {
  const day = Math.floor((accumulatedMs - 1) / calendar.dailyWorkMs);
  let remaining = accumulatedMs - day * calendar.dailyWorkMs;
  for (const [from, to] of calendar.intervals) {
    const duration = to - from;
    if (remaining <= duration) return safe(BigInt(day) * BigInt(DAY_MS) + BigInt(from + remaining));
    remaining -= duration;
  }
  throw new CalendarError('range', {ru: 'Не удалось определить завершение.', en: 'Unable to determine completion.'});
}

/** Advance an existing operation, retaining any work beyond the chosen horizon. */
export function advanceWork(calendar: WorkCalendar, fromMs: number, requiredMs: number): {timeMs: number; remainingMs: number} {
  time(calendar, fromMs); integer(requiredMs);
  if (requiredMs === 0) return {timeMs: fromMs, remainingMs: 0};
  const before = workedMsUntil(calendar, fromMs);
  const available = workedMsUntil(calendar, calendar.endTimeMs) - before;
  if (requiredMs > available) return {timeMs: calendar.endTimeMs, remainingMs: requiredMs - available};
  return {timeMs: completionAt(calendar, before + requiredMs), remainingMs: 0};
}

/** Source attempts are indexed in accumulated COMMON work time, never reset daily.
 * Index zero is the first opening. Exact closing totals move to the next opening.
 */
export function sourceAttemptTime(calendar: WorkCalendar, ordinal: number, intervalMs: number): number | null {
  integer(ordinal); integer(intervalMs, 1);
  if (calendar.workDuringLunch) throw new CalendarError('value', {ru: 'Источник использует общий календарь без подмены в обед.', en: 'A source uses the common calendar without lunch replacement.'});
  const work = BigInt(ordinal) * BigInt(intervalMs);
  if (work >= BigInt(workedMsUntil(calendar, calendar.endTimeMs))) return null;
  const completion = work === 0n ? 0 : completionAt(calendar, safe(work));
  return nextOpening(calendar, completion);
}

/** A display/helper conversion only; calculation has no Date or timezone dependency. */
export function clockAt(calendar: WorkCalendar, timeMs: number): {dayIndex: number; timeOfDayMs: number} {
  time(calendar, timeMs);
  const absolute = BigInt(timeMs) + BigInt(calendar.schedule.shiftStartMs);
  return {dayIndex: Number(absolute / BigInt(DAY_MS)), timeOfDayMs: Number(absolute % BigInt(DAY_MS))};
}
