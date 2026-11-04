import {ConfigError} from '../engine/config';
import type {EditorConfig, InputBufferConfig} from '../engine/config';
import {calendarForDuration, DAY_MS} from '../engine/calendar';
import {parseQuantity} from '../engine/arithmetic';
import {compileLinearProcess} from './linear-process';

export interface BufferDraft {kind: 'inherit' | 'quantity' | 'shift' | 'infinite'; value: string}
export interface ProcessDraft {
  name: string; seed: string; shifts: string; input: BufferDraft; output: BufferDraft;
  stations: {id: string; name: string; minutes: string; cv: string; input: BufferDraft; output: BufferDraft}[];
}
function bufferDraft(rule: InputBufferConfig): BufferDraft {
  if (rule.kind === 'materials') throw new Error('Linear buffers do not use material lists');
  return {kind: rule.kind, value: rule.kind === 'quantity' ? rule.quantity : rule.kind === 'shift' ? rule.shifts : ''};
}
export function processDraft(config: EditorConfig): ProcessDraft {
  compileLinearProcess(config);
  // Use graph order, including for files with a different station array order.
  const stations: ProcessDraft['stations'] = [];
  let id = config.sources[0]!.id;
  while (true) {
    id = config.routes.find(route => route.fromId === id)!.toId;
    if (id === 'market') break;
    const station = config.stations.find(item => item.id === id)!, processing = station.plan[0]!.processing;
    stations.push({id, name: station.name, minutes: String(processing.timeMs! / 60_000), cv: String(processing.cv!),
      input: bufferDraft(station.inputBuffer), output: bufferDraft(station.outputBuffer)});
  }
  return {name: config.name, seed: String(config.seed),
    shifts: String(calendarForDuration(config.calendar, config.durationMs).days),
    input: bufferDraft(config.bufferDefaults?.input ?? {kind: 'shift', shifts: '0.5'}),
    output: bufferDraft(config.bufferDefaults?.output ?? {kind: 'quantity', quantity: '0'}), stations};
}
function invalid(path: string, id: string | null, ru: string, en: string): never {
  throw new ConfigError('value', path, id, {ru, en});
}
function decimal(value: string, path: string, id: string | null): number {
  const text = value.trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) || !Number.isFinite(Number(text))) {
    invalid(path, id, 'Введите неотрицательное число.', 'Enter a nonnegative number.');
  }
  return Number(text);
}
function integer(value: string, path: string): number {
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) {
    invalid(path, null, 'Введите целое неотрицательное число.', 'Enter a nonnegative whole number.');
  }
  return Number(value);
}
function buffer(rule: BufferDraft, path: string, id: string | null): InputBufferConfig {
  if (rule.kind === 'inherit' || rule.kind === 'infinite') return {kind: rule.kind};
  const value = rule.value.trim().replace(',', '.').replace(/^\./, '0.');
  try {parseQuantity(value);} catch {invalid(path, id, 'Введите допустимое количество.', 'Enter a valid quantity.');}
  return rule.kind === 'shift' ? {kind: 'shift', shifts: value} : {kind: 'quantity', quantity: value};
}
/** Incomplete fields stay in the draft. Only a fully validated copy leaves the form. */
export function configFromDraft(base: EditorConfig, draft: ProcessDraft): EditorConfig {
  const config = structuredClone(base);
  config.name = draft.name;
  config.seed = integer(draft.seed, 'config.seed');
  const shifts = integer(draft.shifts, 'config.durationMs');
  config.durationMs = (shifts - 1) * DAY_MS + config.calendar.shiftEndMs - config.calendar.shiftStartMs;
  const previous = processDraft(base);
  if (JSON.stringify(draft.input) !== JSON.stringify(previous.input)) {
    config.bufferDefaults = {...config.bufferDefaults,
      input: buffer(draft.input, 'config.bufferDefaults.input', null) as NonNullable<NonNullable<EditorConfig['bufferDefaults']>['input']>};
  }
  if (JSON.stringify(draft.output) !== JSON.stringify(previous.output)) {
    config.bufferDefaults = {...config.bufferDefaults,
      output: buffer(draft.output, 'config.bufferDefaults.output', null) as NonNullable<NonNullable<EditorConfig['bufferDefaults']>['output']>};
  }
  for (const [i, station] of config.stations.entries()) {
    const fields = draft.stations.find(item => item.id === station.id)!;
    const path = `config.stations.${i}`;
    station.name = fields.name;
    if (fields.minutes !== previous.stations.find(item => item.id === station.id)!.minutes) {
      decimal(fields.minutes, `${path}.plan.0.processing.timeMs`, station.id);
      const [whole, fraction = ''] = fields.minutes.trim().replace(',', '.').split('.');
      const scale = 10n ** BigInt(fraction.length), time = BigInt((whole || '0') + fraction) * 60_000n;
      if (time % scale !== 0n || time / scale > BigInt(Number.MAX_SAFE_INTEGER)) {
        invalid(`${path}.plan.0.processing.timeMs`, station.id, 'Время должно задаваться с точностью до миллисекунды.', 'Time must be a whole number of milliseconds.');
      }
      station.plan[0]!.processing.timeMs = Number(time / scale);
    }
    station.plan[0]!.processing.cv = decimal(fields.cv, `${path}.plan.0.processing.cv`, station.id);
    station.inputBuffer = buffer(fields.input, `${path}.inputBuffer`, station.id);
    station.outputBuffer = buffer(fields.output, `${path}.outputBuffer`, station.id) as typeof station.outputBuffer;
  }
  compileLinearProcess(config);
  return config;
}
