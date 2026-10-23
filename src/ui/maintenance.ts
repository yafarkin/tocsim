import {parseQuantity} from '../engine/arithmetic';
import {ConfigError} from '../engine/config';
import type {EditorConfig, MaintenanceConfig, RunConfig, DeepReadonly} from '../engine/config';
import type {StationSnapshot, MaintenanceTrigger, MaintenanceDeferral} from '../engine/state';
import {calendarForDuration, clockAt} from '../engine/calendar';
import type {Labels} from './i18n';
export interface MaintenanceDraft {enabled: boolean; duration: string; hours: string; repetitions: string}
export function withMaintenance(config: EditorConfig, id: string, maintenance: MaintenanceConfig): EditorConfig {
  const next = structuredClone(config); next.stations.find(s => s.id === id)!.maintenance = structuredClone(maintenance); return next;
}
export function maintenanceFromDraft(draft: MaintenanceDraft, id: string): MaintenanceConfig {
  if (!draft.enabled) return {enabled: false};
  const fail = (key: string): never => {throw new ConfigError('value', `ui.${id}.maintenance.${key}`, id, {
    ru: 'Введите неотрицательное число без переполнения. Время допускает до шести десятичных знаков и должно выражать целые миллисекунды; число повторений должно быть целым.',
    en: 'Enter a nonnegative value within range. Time allows up to six decimal places and must represent whole milliseconds; repetitions must be an integer.',
  });};
  const time = (value: string, multiplier: bigint, key: string) => {
    try {
      const units = BigInt(parseQuantity(value.trim().replace(',', '.').replace(/^\./, '0.'))) * multiplier;
      if (units % 1_000_000n !== 0n || units / 1_000_000n > BigInt(Number.MAX_SAFE_INTEGER)) return fail(key);
      return Number(units / 1_000_000n);
    } catch {return fail(key);}
  };
  if (!/^\d+$/.test(draft.repetitions.trim()) || !Number.isSafeInteger(Number(draft.repetitions))) return fail('repetitionsThreshold');
  return {enabled: true, durationMs: time(draft.duration, 60_000n, 'durationMs'), processingThresholdMs: time(draft.hours, 3_600_000n, 'processingThresholdMs'), repetitionsThreshold: Number(draft.repetitions)};
}
export const workMinutes = (ms: number) => String(Number((ms / 60_000).toFixed(6)));
export function maintenanceTriggers(reasons: readonly MaintenanceTrigger[], text: Labels): string {
  return reasons.map(reason => reason === 'processingTime' ? text.maintenanceTimeTrigger : text.maintenanceCountTrigger).join(', ');
}
export function maintenanceDeferrals(reasons: readonly MaintenanceDeferral[], text: Labels): string {
  return reasons.map(reason => reason === 'batch' ? text.maintenanceWaitBatch : reason === 'output' ? text.maintenanceWaitOutput : text.maintenanceWaitCalendar).join(' ');
}
export function maintenanceNotice(station: DeepReadonly<StationSnapshot>, run: RunConfig, text: Labels): string | null {
  if (station.maintenanceDueAtMs === null || station.remainingMaintenanceMs !== null) return null;
  const waiting = station.reason === 'lunch' || station.reason === 'offShift' || station.reason === 'horizon' ? text.maintenanceWaitCalendar
    : station.transferReady && station.outputs.some(o => o.heldQuantity > 0) ? text.maintenanceWaitOutput : text.maintenanceWaitBatch;
  return `${text.maintenanceRequired} ${maintenanceTime(run, station.maintenanceDueAtMs, text)}. ${maintenanceTriggers(station.maintenanceDueBy, text)}. ${waiting}`;
}
export function maintenanceCounters(station: DeepReadonly<StationSnapshot>, run: RunConfig, text: Labels): string {
  const m = run.resolved.stations.find(s => s.id === station.stationId)!.maintenance;
  if (!m.enabled) return '';
  return `${text.maintenanceClock}: ${workMinutes(station.maintenanceProcessingMs)}${m.processingThresholdMs === null ? '' : ` / ${workMinutes(m.processingThresholdMs)}`} ${text.minutes}. ${text.repetitions}: ${station.maintenanceRepetitions}${m.repetitionsThreshold === null ? '' : ` / ${m.repetitionsThreshold}`}.`;
}
export function maintenanceTime(run: RunConfig, timeMs: number, text: Labels): string {
  const clock = clockAt(calendarForDuration(run.resolved.calendar, run.resolved.durationMs), timeMs);
  const ms = clock.timeOfDayMs;
  const time = [Math.floor(ms / 3_600_000), Math.floor(ms / 60_000) % 60, Math.floor(ms / 1000) % 60].map(n => String(n).padStart(2, '0')).join(':');
  return `${text.day} ${clock.dayIndex + 1} ${time}${ms % 1000 ? `.${String(ms % 1000).padStart(3, '0')}` : ''}`;
}
