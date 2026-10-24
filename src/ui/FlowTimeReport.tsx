import type {DeepReadonly, RunConfig} from '../engine/config';
import type {FlowTimeSnapshot, Snapshot} from '../engine/state';
import type {AgeSummary, MaterialAge} from '../engine/stock-age';
import {nameFor} from './i18n';
import type {Labels} from './i18n';
import {quantityText} from './diagram';
import {durationText, meanDurationText, quantityShareText} from './metric-format';

type Start = 'admission' | 'firstProcessing';
type Summary = DeepReadonly<FlowTimeSnapshot | AgeSummary>;
export function FlowTimeReport({run, model, text}: {run: RunConfig; model: DeepReadonly<Snapshot>; text: Labels}) {
  const line = model.line!;
  const materialName = (id: string) => nameFor(id, run.source.materials.find(m => m.id === id)!.name, text);
  const stationName = (id: string) => nameFor(id, run.source.stations.find(s => s.id === id)!.name, text);
  const locationName = {input: text.inputQueue, reserved: text.reservedStock, held: text.heldStock, output: text.outputStock};
  const starts: [Start, string][] = [['admission', text.fromAdmission], ['firstProcessing', text.fromFirstProcessing]];
  const count = (quantity: string | number, total: string | number) => {
    const share = quantityShareText(quantity, total);
    return <>{quantityText(quantity)}{share !== null && <small className="quantity-share"> ({share})</small>}</>;
  };
  const times = (row: Summary) => <>
    <td data-time-scale="calendar" data-quantity-ms={row.calendarQuantityMs} data-known-quantity={row.knownQuantity}>{meanDurationText(row.calendarQuantityMs, row.knownQuantity, text.notCalculated)}</td>
    <td data-time-scale="work" data-quantity-ms={row.workQuantityMs} data-known-quantity={row.knownQuantity}>{meanDurationText(row.workQuantityMs, row.knownQuantity, text.notCalculated)}</td>
  </>;
  const ageCells = (row: DeepReadonly<MaterialAge>, start: Start) => <>
    <td data-age-quantity={row.quantity}>{quantityText(row.quantity)}</td>{times(row[start])}
    <td data-count="known">{count(row[start].knownQuantity, row.quantity)}</td>
    <td data-count="notStarted">{count(row[start].notStartedQuantity, row.quantity)}</td>
    <td data-count="unknown">{count(row[start].unknownQuantity, row.quantity)}</td>
  </>;
  const ageHeaders = <><th scope="col">{text.quantity}, {text.unit}</th><th scope="col">{text.meanCalendarTime}</th><th scope="col">{text.meanCommonWorkTime}</th><th scope="col">{text.knownAgeCount}, {text.unit}</th><th scope="col">{text.unstartedAgeCount}, {text.unit}</th><th scope="col">{text.unknownStartCount}, {text.unit}</th></>;
  return <details className="flow-time-report" data-testid="flow-time-report">
    <summary>{text.flowTimeReport}</summary>
    <p>{text.flowTimeScalesHelp}</p>
    <p className="summary-help">{text.flowTimeScrollHelp}</p>
    <dl className="metric-periods">
      <div><dt>{text.calendarPeriod}</dt><dd>{durationText(model.observation.calendarMs)}</dd></div>
      <div><dt>{text.commonWorkPeriod}</dt><dd>{durationText(model.observation.workMs)}</dd></div>
    </dl>
    <section className="metric-section" aria-labelledby="completed-flow-time-title">
      <h3 id="completed-flow-time-title">{text.completedFlowTime}</h3><p>{text.completedFlowTimeHelp}</p>
      {line.flowTime.every(row => row.admission.knownQuantity + row.admission.unknownQuantity === 0) && <p className="summary-help">{text.noGoodOutput}</p>}
      {starts.map(([start, title]) => <div key={start} className="flow-time-start">
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`${text.completedFlowTime}: ${title}`}><table className="metric-table"><caption>{title}, {text.timeFormat}</caption><thead><tr><th scope="col">{text.material}</th><th scope="col">{text.meanCalendarTime}</th><th scope="col">{text.meanCommonWorkTime}</th><th scope="col">{text.includedOutputCount}, {text.unit}</th><th scope="col">{text.unknownStartCount}, {text.unit}</th></tr></thead><tbody>
          {line.flowTime.map(row => <tr key={row.materialId} data-flow-product={row.materialId} data-flow-start={start}><th scope="row">{materialName(row.materialId)}</th>{times(row[start])}
            <td data-count="known">{count(row[start].knownQuantity, row[start].knownQuantity + row[start].unknownQuantity)}</td>
            <td data-count="unknown">{count(row[start].unknownQuantity, row[start].knownQuantity + row[start].unknownQuantity)}</td>
          </tr>)}
        </tbody></table></div>
      </div>)}
    </section>
    <section className="metric-section" aria-labelledby="stock-age-title">
      <h3 id="stock-age-title">{text.currentStockAge}</h3><p>{text.currentStockAgeHelp}</p>
      {line.stockAge.places.length === 0 && <p className="summary-help">{text.noPhysicalStock}</p>}
      {starts.map(([start, title]) => <div key={start} className="flow-time-start">
        <div className="table-scroll" tabIndex={0} role="region" aria-label={`${text.ageByMaterial}: ${title}`}><table className="metric-table"><caption>{title}, {text.timeFormat}</caption><thead><tr><th scope="col">{text.material}</th>{ageHeaders}</tr></thead><tbody>
          {line.stockAge.materials.map(row => <tr key={row.materialId} data-age-material={row.materialId} data-age-start={start}><th scope="row">{materialName(row.materialId)}</th>{ageCells(row, start)}</tr>)}
        </tbody></table></div>
      </div>)}
      <p className="summary-help">{text.ageCategoriesHelp}</p>
      <details className="stock-age-places"><summary>{text.ageByPlace}</summary><p>{text.agePlacesHelp}</p>
        {line.stockAge.places.length ? starts.map(([start, title]) => <div key={start} className="flow-time-start">
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`${text.ageByPlace}: ${title}`}><table className="metric-table"><caption>{title}, {text.timeFormat}</caption><thead><tr><th scope="col">{text.stationColumn}</th><th scope="col">{text.material}</th><th scope="col">{text.stockLocation}</th>{ageHeaders}</tr></thead><tbody>
            {line.stockAge.places.map(row => <tr key={JSON.stringify([row.ownerId,row.materialId,row.location])} data-age-owner={row.ownerId} data-age-place-material={row.materialId} data-age-location={row.location} data-age-start={start}><th scope="row">{stationName(row.ownerId)}</th><td>{materialName(row.materialId)}</td><td>{locationName[row.location]}</td>{ageCells(row, start)}</tr>)}
          </tbody></table></div>
        </div>) : <p>{text.noPhysicalStock}</p>}
      </details>
    </section>
    <p className="summary-help">{text.flowTimeRoundingHelp}</p>
  </details>;
}
