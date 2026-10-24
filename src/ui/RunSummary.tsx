import { calendarForDuration, clockAt } from '../engine/calendar';
import type { DeepReadonly, RunConfig } from '../engine/config';
import {flowReport, productionLocations} from '../engine/flow-report';
import type { RunnerView } from '../runner/runner';
import { quantityText } from './diagram';
import { nameFor } from './i18n';
import type { Labels, Language } from './i18n';
import {FlowCharts} from './FlowCharts';
import {FlowTimeReport} from './FlowTimeReport';
import {RunMetrics} from './RunMetrics';

interface Props {run: RunConfig; view: DeepReadonly<RunnerView>; text: Labels; language: Language}
export function RunSummary({run, view, text, language}: Props) {
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const report = flowReport(run, view.model);
  const at = (timeMs: number) => {
    const clock = clockAt(calendar, timeMs), time = clock.timeOfDayMs;
    const parts = [Math.floor(time / 3_600_000), Math.floor(time / 60_000) % 60, Math.floor(time / 1000) % 60];
    const fraction = time % 1000 ? `.${String(time % 1000).padStart(3, '0')}` : '';
    return `${text.day} ${clock.dayIndex + 1} ${parts.map(n => String(n).padStart(2, '0')).join(':')}${fraction}`;
  };
  const terminal = ['finished','stopped','error'].includes(view.status);
  const reason = view.status === 'finished' ? text.endedHorizon : view.status === 'stopped' ? text.endedStopped : view.status === 'error' ? text.endedError : text.currentResult;
  const materialName = (id: string) => {const material = run.source.materials.find(m => m.id === id)!;return nameFor(id, material.name, text);};
  const ownerName = (id: string) => id === 'warehouse' ? text.rawWarehouse : nameFor(id, run.source.stations.find(s => s.id === id)?.name ?? id, text);
  const locationName = {input: text.inputQueue, reserved: text.reservedStock, held: text.heldStock, output: text.outputStock, warehouse: text.rawWarehouse};
  return <section className="run-summary" aria-labelledby="run-summary-title" data-testid="run-summary" data-report-complete={report.complete}>
    <h2 id="run-summary-title">{text.runSummary}</h2>
    <p><strong>{terminal ? text.endReason : text.reportStatus}:</strong> {reason}{!report.complete && ` ${text.incompleteResult}`}</p>
    {view.error && <p className="run-error" role="alert">{view.error.messages[language]}</p>}
    <p><strong>{text.actualInterval}:</strong> {at(0)} → {at(report.timeMs)}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={text.productOutput}><table><caption>{text.productOutput}</caption><thead><tr><th>{text.material}</th><th>{text.produced}, {text.unit}</th><th>{text.delivered}, {text.unit}</th><th>{text.awaitingAcceptance}, {text.unit}</th></tr></thead><tbody>
      {report.products.map(product => <tr key={product.materialId} data-product={product.materialId}><th scope="row">{materialName(product.materialId)}</th><td>{quantityText(product.produced)}</td><td data-delivered={product.materialId}>{quantityText(product.delivered)}</td><td>{quantityText(product.awaitingAcceptance)}</td></tr>)}
    </tbody></table></div>
    <p className="summary-help">{text.summaryHelp}</p>
    <details className="shift-output"><summary>{text.outputByShift}</summary><p>{text.shiftOutputHelp}</p>
      {report.shifts.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={text.outputByShift}><table><thead><tr><th>{text.day}</th><th>{text.material}</th><th>{text.goodOutput}, {text.unit}</th></tr></thead><tbody>
        {report.shifts.map(row => <tr key={`${row.dayIndex}-${row.materialId}`} data-output-day={row.dayIndex + 1} data-output-material={row.materialId}><th scope="row">{row.dayIndex + 1}</th><td>{materialName(row.materialId)}</td><td>{quantityText(row.quantity)}</td></tr>)}
      </tbody></table></div> : <p>{text.noGoodOutput}</p>}
    </details>
    <details className="stock-report"><summary>{text.stockReport}</summary><p>{text.stockBoundaryHelp}</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={text.insideLine}><table><caption>{text.insideLine}, {text.unit}</caption><thead><tr><th>{text.material}</th>{productionLocations.map(location => <th key={location}>{locationName[location]}</th>)}<th>{text.materialTotal}</th></tr></thead><tbody>
        {report.materials.map(row => <tr key={row.materialId} data-line-stock={row.materialId}><th scope="row">{materialName(row.materialId)}</th>{productionLocations.map(location => <td key={location} data-stock-location={location}>{quantityText(row[location])}</td>)}<td data-stock-total={row.materialId}>{quantityText(row.total)}</td></tr>)}
      </tbody></table></div><p className="summary-help">{text.reservedStockHelp}</p>
      <h3>{text.rawWarehouse}</h3><p>{text.warehouseHelp}</p>
      {report.warehouse.length ? <ul className="warehouse-stock">{report.warehouse.map(row => <li key={row.materialId} data-warehouse-stock={row.materialId}>{materialName(row.materialId)}: {quantityText(row.quantity)} {text.unit}</li>)}</ul> : <p>{text.noWarehouseStock}</p>}
      <details className="stock-places"><summary>{text.stockByPlace}</summary>
        {report.places.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={text.stockByPlace}><table><thead><tr><th>{text.stationOrWarehouse}</th><th>{text.material}</th><th>{text.stockLocation}</th><th>{text.quantity}, {text.unit}</th></tr></thead><tbody>
          {report.places.map(row => <tr key={JSON.stringify([row.ownerId,row.materialId,row.location])}><th scope="row">{ownerName(row.ownerId)}</th><td>{materialName(row.materialId)}</td><td>{locationName[row.location]}</td><td>{quantityText(row.quantity)}</td></tr>)}
        </tbody></table></div> : <p>{text.noPhysicalStock}</p>}
      </details>
    </details>
    <RunMetrics run={run} model={view.model} text={text}/>
    <FlowTimeReport run={run} model={view.model} text={text}/>
    <FlowCharts run={run} history={view.history} text={text} language={language}/>
  </section>;
}
