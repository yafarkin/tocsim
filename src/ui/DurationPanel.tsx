import {memo, useState} from 'react';
import {parseQuantity} from '../engine/arithmetic';
import {compileConfig, ConfigError} from '../engine/config';
import type {EditorConfig, RunConfig} from '../engine/config';
import type {DurationDistribution} from '../engine/random';
import type {Labels, Language} from './i18n';
import {nameFor} from './i18n';
export function withDuration(config: EditorConfig, distribution: DurationDistribution): EditorConfig {
  const next = structuredClone(config), row = next.stations.find(s => s.id === 'work')!.plan[0]!;
  row.processing = {mode: row.processing.mode, repetitions: row.processing.repetitions, distribution: structuredClone(distribution)};
  return next;
}
type Draft = {kind: DurationDistribution['kind']; time: string; cv: string; min: string; peak: string; max: string};
function draftFor(run: RunConfig): Draft {
  const row = run.source.stations.find(s => s.id === 'work')!.plan[0]!.processing, d = row.distribution;
  return {kind: d?.kind ?? ((row.cv ?? 0) === 0 ? 'constant' : 'lognormal'),
    time: String((d?.kind === 'constant' ? d.timeMs : d?.kind === 'lognormal' ? d.meanMs : row.timeMs ?? 480_000) / 60_000), cv: String(d?.kind === 'lognormal' ? d.cv : row.cv ?? 0.5),
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
export function durationFromDraft(draft: Draft): DurationDistribution {
  const path = 'config.stations.work.plan.0.processing.distribution';
  if (draft.kind === 'constant') return {kind: 'constant', timeMs: milliseconds(draft.time, `${path}.timeMs`)};
  if (draft.kind === 'lognormal') {
    const cvText = draft.cv.trim().replace(',', '.');
    const cv = /^\d*(?:\.\d+)?$/.test(cvText) && cvText !== '' ? Number(cvText) : NaN;
    return {kind: 'lognormal', meanMs: milliseconds(draft.time, `${path}.meanMs`), cv};
  }
  const minMs = milliseconds(draft.min, `${path}.minMs`), maxMs = milliseconds(draft.max, `${path}.maxMs`);
  return draft.kind === 'uniform' ? {kind: 'uniform', minMs, maxMs} : {kind: 'triangular', minMs, peakMs: milliseconds(draft.peak, `${path}.peakMs`), maxMs};
}
export const DurationPanel = memo(function DurationPanel({run, locked, text, language, onApply}: {run: RunConfig; locked: boolean; text: Labels; language: Language; onApply: (d: DurationDistribution) => void}) {
  const [draft, setDraft] = useState(() => draftFor(run));
  let candidate: RunConfig | undefined, distribution: DurationDistribution | undefined, error: ConfigError | undefined;
  try {distribution = durationFromDraft(draft); candidate = compileConfig(withDuration(structuredClone(run.source) as EditorConfig, distribution));}
  catch (cause) {if (!(cause instanceof ConfigError)) throw cause; error = cause;}
  const row = candidate?.resolved.stations.find(s => s.id === 'work')!.plan[0];
  const format = (value: number) => value.toLocaleString(language, {maximumFractionDigits: 6});
  const field = (key: 'time' | 'cv' | 'min' | 'peak' | 'max', label: string) => <label>{label}<input aria-label={label} inputMode="decimal" value={draft[key]} onChange={e => setDraft({...draft, [key]: e.target.value})}/></label>;
  return <details className="batch-editor duration-editor" open><summary>{text.processingTime}: {text.work}</summary><fieldset className="batch-settings" disabled={locked}>
    <legend>{text.processingTime}: {text.work}</legend><p>{text.durationHelp}</p><p>{text.durationStatsHelp}</p>
    <div className="batch-settings-row"><label>{text.processingTime}<select aria-label={text.processingTime} value={draft.kind} onChange={e => setDraft({...draft, kind: e.target.value as Draft['kind']})}>
      <option value="constant">{text.constantTime}</option><option value="lognormal">{text.lognormalTime}</option><option value="uniform">{text.uniformTime}</option><option value="triangular">{text.triangularTime}</option>
    </select></label>
    {(draft.kind === 'constant' || draft.kind === 'lognormal') ? field('time', draft.kind === 'constant' ? text.durationMinutes : text.meanMinutes) : <>{field('min', text.minMinutes)}{draft.kind === 'triangular' && field('peak', text.peakMinutes)}{field('max', text.maxMinutes)}</>}
    {draft.kind === 'lognormal' && field('cv', 'CV')}</div>
    {error ? <p className="buffer-error" role="alert">{error.messages[language]} <span>{error.path}</span></p> : row && <div className="duration-preview" aria-live="polite"><p>{text.bufferPreview}: {text.mean} {format(row.timeMs / 60_000)} {text.minutes}; CV {format(row.cv)}.</p>
      {candidate!.bufferCalculations.filter(c => c.stationId === 'work').map(c => <p key={c.materialId}>{text.input}: {nameFor(c.materialId, candidate!.source.materials.find(m => m.id === c.materialId)!.name, text)} {text.calculated} {format(c.roundedQuantity / 1_000_000)}{c.raisedToKit && ` · ${text.raisedKit}`}</p>)}
    </div>}
    <button type="button" disabled={!!error} onClick={() => distribution && onApply(distribution)}>{text.applyProcessingTime}</button><p className="duration-applied">{text.current}: {text.mean} {format(run.resolved.stations.find(s => s.id === 'work')!.timeMs / 60_000)} {text.minutes}; CV {format(run.resolved.stations.find(s => s.id === 'work')!.cv)}.</p>
  </fieldset></details>;
});
