import type {DeepReadonly, RunConfig} from '../engine/config';
import {constraintFactsReport} from '../engine/constraint-facts';
import type {Snapshot} from '../engine/state';
import {quantityText} from './diagram';
import {nameFor} from './i18n';
import type {Labels} from './i18n';
import {averageText} from './metric-format';

export function ConstraintReport({run, model, text}: {run: RunConfig; model: DeepReadonly<Snapshot>; text: Labels}) {
  const report = constraintFactsReport(run, model);
  const materialName = (id: string) => nameFor(id, run.source.materials.find(m => m.id === id)!.name, text);
  const stationName = (id: string) => nameFor(id, run.source.stations.find(s => s.id === id)!.name, text);
  return <section className="constraint-report" data-testid="constraint-report" data-constraint-complete={report.complete}>
    <h3>{text.constraintQueues}</h3><p>{text.constraintQueueHelp}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.constraintQueues}><table className="metric-table"><caption>{text.constraintQueues}, {text.unit}</caption><thead><tr><th scope="col">{text.stationColumn}</th><th scope="col">{text.material}</th><th scope="col">{text.current}</th><th scope="col">{text.calendarAverage}</th><th scope="col">{text.workAverage}</th></tr></thead><tbody>
      {report.stations.flatMap(station => station.inputQueues.map(queue => <tr key={JSON.stringify([station.stationId, queue.materialId])} data-constraint-station={station.stationId} data-constraint-material={queue.materialId}><th scope="row">{stationName(station.stationId)}</th><td>{materialName(queue.materialId)}</td><td data-constraint-quantity={queue.quantity}>{quantityText(queue.quantity)}</td><td data-constraint-average="calendar">{averageText(queue.calendarAverage, text.notCalculated)}</td><td data-constraint-average="work">{averageText(queue.workAverage, text.notCalculated)}</td></tr>))}
    </tbody></table></div>
    <p className="summary-help">{text.constraintTrend} {text.metricRoundingHelp} {text.flowTimeScrollHelp}</p>
    <p><a href="#output-summary-toggle" onClick={event => {
      const output = event.currentTarget.closest('.run-summary')?.querySelector<HTMLDetailsElement>('#output-summary');
      if (output) {output.open = true; output.querySelector<HTMLElement>('summary')?.focus();}
    }}>{text.showOutput}</a></p>
    <section className="metric-section" aria-labelledby="constraint-experiment-title"><h3 id="constraint-experiment-title">{text.constraintExperiment}</h3>
      <ol><li>{text.constraintStep1}</li><li>{text.constraintStep2}</li><li>{text.constraintStep3}</li></ol>
      <p>{text.constraintExperimentHelp}</p>
    </section>
  </section>;
}
