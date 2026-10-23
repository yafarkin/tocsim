import {memo, useState} from 'react';
import {compileConfig, ConfigError} from '../engine/config';
import type {EditorConfig, RunConfig} from '../engine/config';
import {lunchFromDraft, withLunch} from './lunch';
import type {LunchSetting} from './lunch';
import {nameFor} from './i18n';
import type {Labels, Language} from './i18n';
function LunchFields({run, id, locked, text, language, onApply}: {run: RunConfig; id: string; locked: boolean; text: Labels; language: Language; onApply: (id: string, setting: LunchSetting) => void}) {
  const station = run.source.stations.find(s => s.id === id)!;
  const [enabled, setEnabled] = useState(station.lunchReplacement), [rate, setRate] = useState(station.costs.perLunchHour);
  let candidate: LunchSetting | undefined, error: ConfigError | undefined;
  try {candidate = lunchFromDraft(enabled, rate, id); compileConfig(withLunch(structuredClone(run.source) as EditorConfig, {[id]: candidate}));}
  catch (cause) {if (!(cause instanceof ConfigError)) throw cause; error = cause;}
  return <>
    <label className="maintenance-enable"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/>{text.lunchEnable}</label>
    <div className="batch-settings-row"><label>{text.lunchRate}<input aria-label={text.lunchRate} inputMode="decimal" value={rate} aria-invalid={!!error} onChange={e => setRate(e.target.value)}/></label></div>
    {error ? <p role="alert" className="buffer-error">{error.messages[language]}</p> : candidate && <p aria-live="polite">{text.bufferPreview}: {candidate.enabled ? text.lunchOn : text.lunchOff}. {text.lunchRate}: {candidate.hourlyRate} {text.moneyUnit}.</p>}
    <button type="button" disabled={locked || !!error} onClick={() => !locked && candidate && onApply(id, candidate)}>{text.lunchApply}</button>
    <p className="lunch-applied">{text.current}: {station.lunchReplacement ? text.lunchOn : text.lunchOff}. {text.lunchRate}: {station.costs.perLunchHour} {text.moneyUnit}.</p>
  </>;
}
export const LunchPanel = memo(function LunchPanel({run, locked, text, language, onApply}: {run: RunConfig; locked: boolean; text: Labels; language: Language; onApply: (id: string, setting: LunchSetting) => void}) {
  const [id, setId] = useState(run.source.stations[0]!.id);
  const station = run.source.stations.find(s => s.id === id)!;
  return <details className="batch-editor lunch-editor"><summary>{text.lunchSettings}</summary><fieldset className="batch-settings" disabled={locked}>
    <legend>{text.lunchSettings}</legend><p>{text.lunchHelp}</p>
    <div className="batch-settings-row"><label>{text.lunchStation}<select aria-label={text.lunchStation} value={id} onChange={e => setId(e.target.value)}>{run.source.stations.map(s => <option key={s.id} value={s.id}>{nameFor(s.id, s.name, text)}</option>)}</select></label></div>
    <LunchFields key={`${id}-${station.lunchReplacement}-${station.costs.perLunchHour}`} run={run} id={id} locked={locked} text={text} language={language} onApply={onApply}/>
  </fieldset></details>;
});
