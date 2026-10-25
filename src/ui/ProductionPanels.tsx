import {useState} from 'react';
import {compileConfig, ConfigError} from '../engine/config';
import type {EditorConfig, RunConfig} from '../engine/config';
import type {BatchProfile, PlanProfile} from './preview';
import type {Labels, Language} from './i18n';
import {nameFor} from './i18n';
import {useModeDisclosure} from './ui-mode';
import type {UiMode} from './ui-mode';

export function withBatchProfiles(config: EditorConfig, profiles: Record<'prep' | 'work', BatchProfile>): EditorConfig {
  const next = structuredClone(config);
  for (const id of ['prep', 'work'] as const) {
    const station = next.stations.find(s => s.id === id)!;
    Object.assign(station.plan[0]!.processing, {mode: profiles[id].mode, repetitions: profiles[id].repetitions});
    station.transportThreshold = String(profiles[id].transportThreshold);
  }
  return next;
}
export function withPlanProfile(config: EditorConfig, profile: PlanProfile): EditorConfig {
  const next = structuredClone(config), station = next.stations.find(s => s.id === 'planner')!;
  station.plan[0]!.batches = profile.batchesA; station.plan[1]!.batches = profile.batchesB;
  station.setupMs = profile.setupMinutes * 60_000;
  next.sources.find(s => s.id === 'source-b')!.availability = profile.supplyB ? 'virtual' : 'warehouse';
  return next;
}
function validation(config: EditorConfig, language: Language) {
  try {compileConfig(config); return '';}
  catch (error) {if (!(error instanceof ConfigError)) throw error; return error.messages[language];}
}
export function BatchPanel({run, applied, locked, text, language, mode, onApply}: {
  run: RunConfig; applied: Record<'prep' | 'work', BatchProfile>; locked: boolean; text: Labels; language: Language; mode: UiMode;
  onApply: (profiles: Record<'prep' | 'work', BatchProfile>) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(applied));
  const disclosure = useModeDisclosure(mode);
  const error = validation(withBatchProfiles(structuredClone(run.source) as EditorConfig, draft), language);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  return <details className="batch-editor production-editor" {...disclosure}><summary>{text.batchSettings}</summary>
    <fieldset className="batch-settings" disabled={locked}><legend>{text.batchSettings}</legend>
      <p className="expert-only">{text.batchSettingsHelp}</p>
      <p id="batch-threshold-help" className="expert-only">{text.thresholdHelp}</p>
      {(['prep', 'work'] as const).map(id => {
        const profile = draft[id], name = nameFor(id, id, text);
        const update = (patch: Partial<BatchProfile>) => setDraft({...draft, [id]: {...profile, ...patch}});
        return <div className="batch-settings-row" key={id}><strong>{name}</strong>
          <label className="expert-only">{text.mode}<select aria-label={`${name}: ${text.mode}`} value={profile.mode} onChange={e => update({mode: e.target.value as BatchProfile['mode']})}><option value="sequential">{text.sequential}</option><option value="simultaneous">{text.simultaneous}</option></select></label>
          <label>{text.repetitions}<select aria-label={`${name}: ${text.repetitions}`} value={profile.repetitions} onChange={e => update({repetitions: Number(e.target.value)})}>{Array.from({length: 10}, (_, i) => i + 1).map(n => <option key={n}>{n}</option>)}</select></label>
          <label>{text.threshold}<select aria-describedby="batch-threshold-help" aria-label={`${name}: ${text.threshold}`} value={profile.transportThreshold} onChange={e => update({transportThreshold: Number(e.target.value)})}>{Array.from({length: 10}, (_, i) => i + 1).map(n => <option key={n}>{n}</option>)}</select></label>
          <span className="simple-only">{text.mode}: {profile.mode === 'sequential' ? text.sequential : text.simultaneous}</span>
        </div>;
      })}
      {error && <p role="alert" className="buffer-error">{error}</p>}
      <button type="button" disabled={!dirty || !!error} onClick={() => onApply(draft)}>{text.applyExperiment}</button>
      {dirty && <p>{text.unappliedSettings}</p>}
      <p className="applied-profile">{text.current}: {(['prep', 'work'] as const).map(id => `${nameFor(id, id, text)}: ${applied[id].mode === 'sequential' ? text.sequential : text.simultaneous}, ${applied[id].repetitions} / ${applied[id].transportThreshold}`).join('; ')}</p>
    </fieldset>
  </details>;
}
export function PlanPanel({run, applied, locked, text, language, mode, onApply}: {
  run: RunConfig; applied: PlanProfile; locked: boolean; text: Labels; language: Language; mode: UiMode; onApply: (profile: PlanProfile) => void;
}) {
  const [draft, setDraft] = useState(() => ({...applied}));
  const disclosure = useModeDisclosure(mode, true);
  const error = validation(withPlanProfile(structuredClone(run.source) as EditorConfig, draft), language);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  return <details className="batch-editor production-editor" {...disclosure}><summary>{text.planSettings}</summary>
    <fieldset className="batch-settings" disabled={locked}><legend>{text.planSettings}</legend><p className="expert-only">{text.planSettingsHelp}</p>
      <div className="batch-settings-row">
        {(['batchesA', 'batchesB'] as const).map(key => <label key={key}>{text[key]}<select aria-label={text[key]} value={draft[key]} onChange={e => setDraft({...draft, [key]: Number(e.target.value)})}>{Array.from({length: 10}, (_, i) => i + 1).map(n => <option key={n}>{n}</option>)}</select></label>)}
        <label>{text.setupMinutes}<select aria-label={text.setupMinutes} value={draft.setupMinutes} onChange={e => setDraft({...draft, setupMinutes: Number(e.target.value)})}>{[0, 2, 7, 15].map(n => <option key={n}>{n}</option>)}</select></label>
        <label className="expert-only">{text.supplyB}<select aria-label={text.supplyB} value={String(draft.supplyB)} onChange={e => setDraft({...draft, supplyB: e.target.value === 'true'})}><option value="true">{text.supplied}</option><option value="false">{text.unavailable}</option></select></label>
      </div>
      <p className="expert-only" id="plan-wait-help">{text.planWaitHelp}</p>
      {error && <p role="alert" className="buffer-error">{error}</p>}
      <button type="button" disabled={!dirty || !!error} onClick={() => onApply(draft)}>{text.applyExperiment}</button>
      {dirty && <p>{text.unappliedSettings}</p>}
      <p>{text.current}: A {applied.batchesA}, B {applied.batchesB}; {text.setupMinutes}: {applied.setupMinutes}; {text.supplyB}: {applied.supplyB ? text.supplied : text.unavailable}.</p>
    </fieldset>
  </details>;
}
