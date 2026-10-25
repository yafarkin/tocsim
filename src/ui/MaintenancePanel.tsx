import {memo, useState} from 'react';
import {compileConfig, ConfigError} from '../engine/config';
import type {EditorConfig, MaintenanceConfig, RunConfig} from '../engine/config';
import {maintenanceFromDraft, withMaintenance, workMinutes} from './maintenance';
import type {MaintenanceDraft} from './maintenance';
import type {Labels, Language} from './i18n';
function settingsText(m: MaintenanceConfig, text: Labels): string {
  return m.enabled ? `${text.maintenanceDuration}: ${workMinutes(m.durationMs)}; ${text.maintenanceHours}: ${Number(((m.processingThresholdMs ?? 0) / 3_600_000).toFixed(6))}; ${text.maintenanceRepeatLimit}: ${m.repetitionsThreshold ?? 0}.` : text.maintenanceOff;
}
export const MaintenancePanel = memo(function MaintenancePanel({run, locked, text, language, onApply}: {run: RunConfig; locked: boolean; text: Labels; language: Language; onApply: (m: MaintenanceConfig) => void}) {
  const applied = run.source.stations.find(s => s.id === 'prep')!.maintenance;
  const [draft, setDraft] = useState<MaintenanceDraft>(() => ({enabled: applied.enabled, duration: applied.enabled ? workMinutes(applied.durationMs) : '15', hours: applied.enabled ? String((applied.processingThresholdMs ?? 0) / 3_600_000) : '4', repetitions: applied.enabled ? String(applied.repetitionsThreshold ?? 0) : '10'}));
  let candidate: MaintenanceConfig | undefined, error: ConfigError | undefined;
  try {candidate = maintenanceFromDraft(draft, 'prep'); compileConfig(withMaintenance(structuredClone(run.source) as EditorConfig, 'prep', candidate));}
  catch (cause) {if (!(cause instanceof ConfigError)) throw cause; error = cause;}
  const field = (key: 'duration' | 'hours' | 'repetitions', label: string) => <label>{label}<input aria-label={label} inputMode={key === 'repetitions' ? 'numeric' : 'decimal'} value={draft[key]} onChange={e => setDraft({...draft, [key]: e.target.value})}/></label>;
  return <><details className="batch-editor maintenance-editor expert-only" open><summary>{text.maintenanceSettings}: {text.prep}</summary><fieldset className="batch-settings" disabled={locked}>
    <legend>{text.maintenanceSettings}: {text.prep}</legend><div className="settings-layout"><div className="settings-help"><p>{text.maintenanceHelp}</p></div><div className="settings-fields">
    <label className="maintenance-enable"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({...draft, enabled: e.target.checked})}/>{text.enableMaintenance}</label>
    <fieldset disabled={!draft.enabled}><legend>{text.maintenanceThresholds}</legend><div className="batch-settings-row">
      {field('duration', text.maintenanceDuration)}{field('hours', text.maintenanceHours)}{field('repetitions', text.maintenanceRepeatLimit)}
    </div></fieldset>
    {error ? <p role="alert" className="maintenance-error">{error.messages[language]} <span>{error.path}</span></p> : candidate && <p aria-live="polite">{text.bufferPreview}: {settingsText(candidate, text)}</p>}
    <button type="button" disabled={!!error} onClick={() => candidate && onApply(candidate)}>{text.applyMaintenance}</button>
    <p className="maintenance-applied">{text.current}: {settingsText(applied as MaintenanceConfig, text)}</p>
  </div></div></fieldset></details>{error && <p className="simple-only settings-errors" role="alert">{error.messages[language]} {text.hiddenErrorHelp}</p>}</>;
});
