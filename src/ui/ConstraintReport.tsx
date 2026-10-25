import type {DeepReadonly, RunConfig} from '../engine/config';
import {constraintFactsReport} from '../engine/constraint-facts';
import type {Snapshot, StationTime} from '../engine/state';
import {quantityText} from './diagram';
import {nameFor} from './i18n';
import type {Labels} from './i18n';
import {averageText, durationText, percentText} from './metric-format';

export function ConstraintReport({run, model, text}: {run: RunConfig; model: DeepReadonly<Snapshot>; text: Labels}) {
  const report = constraintFactsReport(run, model);
  const materialName = (id: string) => nameFor(id, run.source.materials.find(m => m.id === id)!.name, text);
  const stationName = (id: string) => nameFor(id, run.source.stations.find(s => s.id === id)!.name, text);
  const states: [keyof StationTime, string][] = [
    ['processingMs', text.processingTime], ['setupMs', text.setup], ['maintenanceMs', text.maintenance],
    ['starvedMs', text.starved], ['blockedMs', text.blocked], ['idleMs', text.idle],
    ['lunchMs', text.lunch], ['offShiftMs', text.offShift],
  ];
  return <details className="constraint-report" data-testid="constraint-report" data-constraint-complete={report.complete}>
    <summary>{text.constraintFacts}</summary>
    <p>{text.constraintHelp}</p><p>{text.constraintPeriod}</p>
    {!report.complete && <p className="summary-help">{text.incompleteResult}</p>}
    <p>{text.actualInterval}: {durationText(0)} → {durationText(report.timeMs)}</p>
    <dl className="metric-periods">
      <div><dt>{text.calendarPeriod}</dt><dd>{durationText(report.calendarMs)}</dd></div>
      <div><dt>{text.commonWorkPeriod}</dt><dd>{durationText(report.workMs)}</dd></div>
    </dl>
    {report.calendarMs === 0 && <p>{text.zeroObservationHelp}</p>}
    <p>{text.stationTimeHelp}</p><p>{text.constraintQueueHelp}</p>
    {report.stations.map(station => <section className="metric-section" key={station.stationId} aria-labelledby={`constraint-${station.stationId}`} data-constraint-station={station.stationId}>
      <h3 id={`constraint-${station.stationId}`}>{stationName(station.stationId)}</h3>
      <p>{text.stationAvailableTime}: <span data-constraint-available={station.availableWorkMs}>{durationText(station.availableWorkMs)}</span></p>
      <dl className="metric-periods">{([
        ['processingShare', text.processingShare], ['busyShare', text.busyShare],
        ['starvedShare', text.starvedShare], ['blockedShare', text.blockedShare],
      ] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd data-constraint-share={key}>{percentText(station[key], text.notCalculated)}</dd></div>)}</dl>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={`${stationName(station.stationId)}: ${text.constraintQueues}`}><table className="metric-table"><caption>{text.constraintQueues}, {text.unit}</caption><thead><tr><th scope="col">{text.material}</th><th scope="col">{text.current}</th><th scope="col">{text.calendarAverage}</th><th scope="col">{text.workAverage}</th></tr></thead><tbody>
        {station.inputQueues.map(queue => <tr key={queue.materialId} data-constraint-material={queue.materialId}><th scope="row">{materialName(queue.materialId)}</th><td data-constraint-quantity={queue.quantity}>{quantityText(queue.quantity)}</td><td data-constraint-average="calendar">{averageText(queue.calendarAverage, text.notCalculated)}</td><td data-constraint-average="work">{averageText(queue.workAverage, text.notCalculated)}</td></tr>)}
      </tbody></table></div>
      <details><summary>{text.timeByState}</summary><p>{text.stateTimeHelp}</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`${stationName(station.stationId)}: ${text.timeByState}`}><table className="metric-table"><caption>{text.timeByState}, {text.timeFormat}</caption><thead><tr><th scope="col">{text.state}</th><th scope="col">{text.timeFormat}</th></tr></thead><tbody>
          {states.map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td data-constraint-state={key} data-time-ms={station.timeByState[key]}>{durationText(station.timeByState[key])}</td></tr>)}
        </tbody></table></div>
      </details>
    </section>)}
    <p className="summary-help">{text.constraintTrend} {text.metricRoundingHelp} {text.timeFormatHelp} {text.flowTimeScrollHelp}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.constraintOutput}><table className="metric-table"><caption>{text.constraintOutput}</caption><thead><tr><th scope="col">{text.material}</th><th scope="col">{text.goodOutput}, {text.unit}</th></tr></thead><tbody>
      {report.products.map(product => <tr key={product.materialId}><th scope="row">{materialName(product.materialId)}</th><td data-constraint-product={product.materialId}>{quantityText(product.delivered)}</td></tr>)}
    </tbody></table></div>
    <section className="metric-section" aria-labelledby="constraint-experiment-title"><h3 id="constraint-experiment-title">{text.constraintExperiment}</h3>
      <ol><li>{text.constraintStep1}</li><li>{text.constraintStep2}</li><li>{text.constraintStep3}</li></ol>
      <p>{text.constraintExperimentHelp}</p>
    </section>
  </details>;
}
