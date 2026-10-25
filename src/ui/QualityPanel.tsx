import {memo, useState} from 'react';
import {compileConfig, ConfigError} from '../engine/config';
import type {EditorConfig, RunConfig} from '../engine/config';
import {withQuality} from './quality';
import type {QualitySettings} from './quality';
import type {Labels, Language} from './i18n';

export const QualityPanel = memo(function QualityPanel({run, settings, locked, text, language, onApply}: {run: RunConfig; settings: QualitySettings; locked: boolean; text: Labels; language: Language; onApply: (settings: QualitySettings) => void}) {
  const [draft, setDraft] = useState(settings), [percent, setPercent] = useState(String(Number((settings.probability * 100).toFixed(6))));
  const normalized = percent.trim().replace(',', '.');
  const probability = /^\d+(?:\.\d{1,6})?$/.test(normalized) ? Number(normalized) / 100 : NaN;
  let error = '', candidate: QualitySettings | undefined;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) error = text.qualityProbabilityError;
  else {
    candidate = {...draft, probability};
    try {compileConfig(withQuality(structuredClone(run.source) as EditorConfig, candidate));}
    catch (cause) {if (!(cause instanceof ConfigError)) throw cause; error = cause.messages[language];}
  }
  return <details className="batch-editor quality-editor" open><summary>{text.qualitySettings}</summary>
    <fieldset className="batch-settings" disabled={locked}><legend>{text.qualitySettings}</legend>
      <div className="settings-layout"><div className="settings-help"><p>{text.qualityHelp}</p><p>{text.qualityRngHelp}</p></div><div className="settings-fields">
        <div className="batch-settings-row">
          <label>{text.qualityProbability}<input aria-label={text.qualityProbability} inputMode="decimal" value={percent} aria-invalid={!!error} onChange={e => setPercent(e.target.value)}/></label>
          <label>{text.qualitySource}<select aria-label={text.qualitySource} value={draft.source} onChange={e => setDraft({...draft, source: e.target.value as QualitySettings['source']})}><option value="prep">{text.prep}</option><option value="work">{text.work}</option></select></label>
          <label>{text.qualityPosition}<select aria-label={text.qualityPosition} value={draft.position} onChange={e => setDraft({...draft, position: e.target.value as QualitySettings['position']})}><option value="early">{text.qualityEarly}</option><option value="late">{text.qualityLate}</option></select></label>
        </div>
        {error && <p role="alert" className="buffer-error">{error}</p>}
        <button type="button" disabled={!!error} onClick={() => candidate && onApply(candidate)}>{text.qualityApply}</button>
        <p>{text.current}: {Number((settings.probability * 100).toFixed(6))}%; {text.qualitySource}: {text[settings.source]}; {settings.position === 'early' ? text.qualityEarly : text.qualityLate}.</p>
      </div></div>
    </fieldset>
  </details>;
});
