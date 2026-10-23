import {formatMoney, parseMoney} from '../engine/arithmetic';
import {ConfigError} from '../engine/config';
import type {DeepReadonly, EditorConfig, RunConfig} from '../engine/config';
import type {StationSnapshot} from '../engine/state';
import {canStart, calendarForDuration} from '../engine/calendar';
import {messages} from './i18n';
import type {Labels} from './i18n';
export interface LunchSetting {enabled: boolean; hourlyRate: string}
export type LunchSettings = Record<string, LunchSetting>;
export function withLunch(config: EditorConfig, settings: LunchSettings): EditorConfig {
  const next = structuredClone(config);
  for (const station of next.stations) {
    const setting = settings[station.id];
    if (setting) {station.lunchReplacement = setting.enabled; station.costs.perLunchHour = setting.hourlyRate;}
  }
  return next;
}
export function lunchFromDraft(enabled: boolean, rate: string, stationId: string): LunchSetting {
  try {
    const value = parseMoney(rate.trim().replace(',', '.').replace(/^\./, '0.'));
    if (value < 0n) throw new Error('negative');
    return {enabled, hourlyRate: formatMoney(value)};
  } catch {throw new ConfigError('value', `ui.${stationId}.lunch.hourlyRate`, stationId, {ru: messages.ru.lunchRateError, en: messages.en.lunchRateError});}
}
export function lunchStatus(station: DeepReadonly<StationSnapshot>, run: RunConfig, timeMs: number, text: Labels): string {
  const config = run.resolved.stations.find(s => s.id === station.stationId)!;
  if (!config.lunchReplacement) return text.lunchOff;
  const common = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const own = calendarForDuration(run.resolved.calendar, run.resolved.durationMs, true);
  const active = ['processing', 'setup', 'maintenance'].includes(station.status);
  return active && canStart(own, timeMs) && !canStart(common, timeMs) ? text.lunchActive : text.lunchOn;
}
