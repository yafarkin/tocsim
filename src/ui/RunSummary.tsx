import { calendarForDuration, clockAt } from '../engine/calendar';
import type { DeepReadonly, RunConfig } from '../engine/config';
import type { RunnerView } from '../runner/runner';
import { quantityText } from './diagram';
import { nameFor } from './i18n';
import type { Labels, Language } from './i18n';

interface Props {run: RunConfig; view: DeepReadonly<RunnerView>; text: Labels; language: Language}
export function RunSummary({run, view, text, language}: Props) {
  if (!['finished', 'stopped', 'error'].includes(view.status)) return null;
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const at = (timeMs: number) => {
    const clock = clockAt(calendar, timeMs), time = clock.timeOfDayMs;
    const parts = [Math.floor(time / 3_600_000), Math.floor(time / 60_000) % 60, Math.floor(time / 1000) % 60];
    const fraction = time % 1000 ? `.${String(time % 1000).padStart(3, '0')}` : '';
    return `${text.day} ${clock.dayIndex + 1} ${parts.map(n => String(n).padStart(2, '0')).join(':')}${fraction}`;
  };
  const reason = view.status === 'finished' ? text.endedHorizon : view.status === 'stopped' ? text.endedStopped : text.endedError;
  return <section className="run-summary" aria-labelledby="run-summary-title" data-testid="run-summary">
    <h2 id="run-summary-title">{text.runSummary}</h2>
    <p><strong>{text.endReason}:</strong> {reason}</p>
    {view.error && <p className="run-error" role="alert">{view.error.messages[language]}</p>}
    <p><strong>{text.actualInterval}:</strong> {at(0)} → {at(view.model.timeMs)}</p>
    <div className="table-scroll"><table><thead><tr><th>{text.material}</th><th>{text.produced}, {text.unit}</th><th>{text.delivered}, {text.unit}</th></tr></thead><tbody>
      {run.source.materials.filter(material => material.role === 'finished').map(material => {
        const counter = view.model.line!.counters.find(counter => counter.materialId === material.id)!;
        return <tr key={material.id} data-product={material.id}><th scope="row">{nameFor(material.id, material.name, text)}</th><td>{quantityText(counter.produced)}</td><td>{quantityText(counter.sold)}</td></tr>;
      })}
    </tbody></table></div>
    <p className="summary-help">{text.summaryHelp}</p>
  </section>;
}
