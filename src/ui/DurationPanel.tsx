import {memo, useState} from 'react';
import {parseQuantity} from '../engine/arithmetic';
import {compileConfig, ConfigError} from '../engine/config';
import type {EditorConfig, RunConfig} from '../engine/config';
import type {DurationDistribution} from '../engine/random';
import type {Labels, Language} from './i18n';
import {nameFor} from './i18n';
import {useModeDisclosure} from './ui-mode';
import type {UiMode} from './ui-mode';
export const CV_PRESETS = [0, 0.1, 0.25, 0.5, 1, 2] as const;
export function withDuration(config: EditorConfig, distribution: DurationDistribution): EditorConfig {
  const next = structuredClone(config), row = next.stations.find(s => s.id === 'work')!.plan[0]!;
  row.processing = {mode: row.processing.mode, repetitions: row.processing.repetitions, distribution: structuredClone(distribution)};
  return next;
}
export type DurationDraft = {kind: DurationDistribution['kind']; time: string; cv: string; min: string; peak: string; max: string};
function draftFor(run: RunConfig): DurationDraft {
  const row = run.source.stations.find(s => s.id === 'work')!.plan[0]!.processing, d = row.distribution;
  return {kind: d?.kind ?? ((row.cv ?? 0) === 0 ? 'constant' : 'lognormal'),
    time: String((d?.kind === 'constant' ? d.timeMs : d?.kind === 'lognormal' ? d.meanMs : run.resolved.stations.find(s => s.id === 'work')!.plan[0]!.timeMs) / 60_000), cv: String(d?.kind === 'lognormal' ? d.cv : row.cv ?? 0.5),
    min: String(d?.kind === 'uniform' || d?.kind === 'triangular' ? d.minMs / 60_000 : 2),
    peak: String(d?.kind === 'triangular' ? d.peakMs / 60_000 : 3),
    max: String(d?.kind === 'uniform' || d?.kind === 'triangular' ? d.maxMs / 60_000 : 6)};
}
function milliseconds(value: string, path: string): number {
  try {
    const normalized = value.trim().replace(',', '.').replace(/^\./, '0.');
    const units = BigInt(parseQuantity(normalized)) * 60_000n;
    if (units === 0n || units % 1_000_000n !== 0n || units / 1_000_000n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('range');
    return Number(units / 1_000_000n);
  } catch {
    throw new ConfigError('value', path, 'work', {ru: 'Введите положительное время в минутах, до шести знаков после точки или запятой, с точностью до целой миллисекунды и без переполнения.', en: 'Enter positive minutes, up to six decimal places, representing whole milliseconds within range.'});
  }
}
function cvFromText(value: string): number {
  const normalized = value.trim().replace(',', '.');
  return /^\d*(?:\.\d+)?$/.test(normalized) && normalized !== '' ? Number(normalized) : NaN;
}
export function durationCvPreset(draft: DurationDraft): string {
  if (draft.kind === 'constant') return '0';
  const cv = cvFromText(draft.cv);
  return draft.kind === 'lognormal' && CV_PRESETS.some(value => value === cv) ? String(cv) : 'custom';
}
export function durationFromDraft(draft: DurationDraft): DurationDistribution {
  const path = 'config.stations.work.plan.0.processing.distribution';
  if (draft.kind === 'constant') return {kind: 'constant', timeMs: milliseconds(draft.time, `${path}.timeMs`)};
  if (draft.kind === 'lognormal') {
    const cv = cvFromText(draft.cv);
    return {kind: 'lognormal', meanMs: milliseconds(draft.time, `${path}.meanMs`), cv};
  }
  const minMs = milliseconds(draft.min, `${path}.minMs`), maxMs = milliseconds(draft.max, `${path}.maxMs`);
  return draft.kind === 'uniform' ? {kind: 'uniform', minMs, maxMs} : {kind: 'triangular', minMs, peakMs: milliseconds(draft.peak, `${path}.peakMs`), maxMs};
}
export const DurationPanel = memo(function DurationPanel({run, locked, text, language, onApply, mode = 'expert'}: {mode?: UiMode; run: RunConfig; locked: boolean; text: Labels; language: Language; onApply: (d: DurationDistribution) => void}) {
  const [draft, setDraft] = useState(() => draftFor(run));
  const disclosure = useModeDisclosure(mode, true);
  let candidate: RunConfig | undefined, distribution: DurationDistribution | undefined, error: ConfigError | undefined;
  try {distribution = durationFromDraft(draft); candidate = compileConfig(withDuration(structuredClone(run.source) as EditorConfig, distribution));}
  catch (cause) {if (!(cause instanceof ConfigError)) throw cause; error = cause;}
  const row = candidate?.resolved.stations.find(s => s.id === 'work')!.plan[0];
  const format = (value: number) => value.toLocaleString(language, {maximumFractionDigits: 6});
  const field = (key: 'time' | 'cv' | 'min' | 'peak' | 'max', label: string) => <label>{label}<input aria-label={label} inputMode="decimal" value={draft[key]} onChange={e => setDraft({...draft, [key]: e.target.value})}/></label>;
  const custom = draft.kind === 'uniform' || draft.kind === 'triangular';
  const cvValue = durationCvPreset(draft);
  const meanMs = row?.timeMs;
  let presetTime: string | undefined;
  if (meanMs !== undefined) {
    const value = String(Number((meanMs / 60_000).toFixed(6)));
    try {if (milliseconds(value, 'mean') === meanMs) presetTime = value;} catch { /* Keep exact expert values. */ }
  }
  const appliedDistribution = run.source.stations.find(s => s.id === 'work')!.plan[0]!.processing.distribution;
  const dirty = !!error || JSON.stringify(distribution) !== JSON.stringify(appliedDistribution);
  return <details className="batch-editor duration-editor" {...disclosure}><summary>{text.processingTime}: {text.work}</summary><fieldset className="batch-settings" disabled={locked}>
    <legend>{text.processingTime}: {text.work}</legend><div className="settings-layout"><div className="settings-help expert-only"><p>{text.durationHelp}</p><p>{text.durationStatsHelp}</p></div><div className="settings-fields">
    <div className="batch-settings-row"><label className="expert-only">{text.processingTime}<select aria-label={text.processingTime} value={draft.kind} onChange={e => setDraft({...draft, kind: e.target.value as DurationDraft['kind']})}>
      <option value="constant">{text.constantTime}</option><option value="lognormal">{text.lognormalTime}</option><option value="uniform">{text.uniformTime}</option><option value="triangular">{text.triangularTime}</option>
    </select></label>
    {(draft.kind === 'constant' || draft.kind === 'lognormal') ? field('time', draft.kind === 'constant' ? text.durationMinutes : text.meanMinutes) : <div className="expert-only">{field('min', text.minMinutes)}{draft.kind === 'triangular' && field('peak', text.peakMinutes)}{field('max', text.maxMinutes)}</div>}
    {draft.kind === 'lognormal' && <div className="expert-only">{field('cv', 'CV')}</div>}</div>
    <div className="simple-only simple-duration"><label>{text.variability} CV<select aria-label={`${text.variability} CV`} disabled={locked || (custom && presetTime === undefined)} value={cvValue} onChange={e => {
      if (e.target.value === 'custom') return;
      const cv = e.target.value;
      setDraft({...draft, kind: cv === '0' ? 'constant' : 'lognormal', cv, time: custom ? presetTime! : draft.time});
    }}><option value="custom" disabled>{text.otherParameters}</option>{CV_PRESETS.map(cv => <option key={cv} value={cv}>CV {String(cv).replace('.', language === 'ru' ? ',' : '.')}</option>)}</select></label>
    <p>{text.simpleCvHelp}</p>{custom && <p>{text.otherParameters}: {text[draft.kind === 'uniform' ? 'uniformTime' : 'triangularTime']}. {row && <>{text.bufferPreview}: {text.mean} {format(row.timeMs / 60_000)} {text.minutes}; CV {format(row.cv)}. </>}{text.replaceDistribution} {presetTime === undefined && text.simpleCustomTime}</p>}</div>
    {error ? <p className="buffer-error" role="alert">{error.messages[language]} <span className="expert-only">{error.path}</span></p> : row && <div className="duration-preview" aria-live="polite"><p>{text.bufferPreview}: {text.mean} {format(row.timeMs / 60_000)} {text.minutes}; CV {format(row.cv)}.</p>
      {candidate!.bufferCalculations.filter(c => c.stationId === 'work').map(c => <p className="expert-only" key={c.materialId}>{text.input}: {nameFor(c.materialId, candidate!.source.materials.find(m => m.id === c.materialId)!.name, text)} {text.calculated} {format(c.roundedQuantity / 1_000_000)}{c.raisedToKit && ` · ${text.raisedKit}`}</p>)}
    </div>}
    <button type="button" disabled={!!error || !dirty} onClick={() => distribution && onApply(distribution)}>{text.applyProcessingTime}</button>{dirty && <p className="simple-only">{text.unappliedSettings}</p>}<p className={`duration-applied ${dirty ? '' : 'expert-only'}`}>{text.current}: {text.mean} {format(run.resolved.stations.find(s => s.id === 'work')!.timeMs / 60_000)} {text.minutes}; CV {format(run.resolved.stations.find(s => s.id === 'work')!.cv)}.</p>
  </div></div></fieldset></details>;
});
