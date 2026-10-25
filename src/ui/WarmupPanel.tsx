import {memo, useState} from 'react';
import {parseQuantity} from '../engine/arithmetic';
import {ConfigError} from '../engine/config';
import type {RunConfig} from '../engine/config';
import {durationText} from './metric-format';
import type {Labels, Language} from './i18n';

export function warmupFromMinutes(value: string, horizonMs: number): number {
  try {
    const units = BigInt(parseQuantity(value.trim().replace(',', '.').replace(/^\./, '0.'))) * 60_000n;
    if (units % 1_000_000n !== 0n || units / 1_000_000n > BigInt(horizonMs)) throw new Error('range');
    return Number(units / 1_000_000n);
  } catch {
    throw new ConfigError('value', 'config.warmupMs', null, {ru: 'Недопустимый период разогрева.', en: 'Invalid warmup period.'});
  }
}
export const WarmupPanel = memo(function WarmupPanel({run, locked, text, language, onApply}: {
  run: RunConfig; locked: boolean; text: Labels; language: Language; onApply: (ms: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(run.resolved.warmupMs / 60_000));
  let value: number | undefined;
  try {value = warmupFromMinutes(draft, run.resolved.durationMs);} catch (error) {if (!(error instanceof ConfigError)) throw error;}
  return <details className="batch-editor warmup-editor" data-testid="warmup-settings"><summary>{text.warmupSettings}</summary>
    <fieldset className="batch-settings" disabled={locked}><legend>{text.warmupSettings}</legend>
      <div className="settings-layout"><div className="settings-help"><p id="warmup-help">{text.warmupHelp}</p>
        <p>{text.warmupLimit}: {String(run.resolved.durationMs / 60_000).replace('.', language === 'ru' ? ',' : '.')}</p></div>
      <div className="settings-fields"><div className="batch-settings-row"><label>{text.warmupMinutes}<input inputMode="decimal" aria-label={text.warmupMinutes} aria-describedby="warmup-help" aria-invalid={value === undefined} value={draft} onChange={event => setDraft(event.target.value)}/></label></div>
        {value === undefined && <p className="buffer-error" role="alert">{text.warmupError}</p>}
        <button type="button" disabled={value === undefined || value === run.resolved.warmupMs} onClick={() => value !== undefined && onApply(value)}>{text.warmupApply}</button>
        <p data-applied-warmup={run.resolved.warmupMs}>{text.current}: {durationText(run.resolved.warmupMs)}</p>
      </div></div>
    </fieldset>
  </details>;
});
