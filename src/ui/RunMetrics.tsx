import type {DeepReadonly, RunConfig} from '../engine/config';
import type {Snapshot, StationTime} from '../engine/state';
import {stockTimeReport} from '../engine/stock-time';
import {stationTimeReport} from '../engine/station-time';
import {nameFor} from './i18n';
import type {Labels} from './i18n';
import {averageText, durationText, percentText} from './metric-format';

export function RunMetrics({run, model, text}: {run: RunConfig; model: DeepReadonly<Snapshot>; text: Labels}) {
  const stocks = stockTimeReport(run, model), times = stationTimeReport(model);
  const materialName = (id: string) => nameFor(id, run.source.materials.find(m => m.id === id)!.name, text);
  const stationName = (id: string) => nameFor(id, run.source.stations.find(s => s.id === id)!.name, text);
  const locationName = {input: text.inputQueue, reserved: text.reservedStock, held: text.heldStock, output: text.outputStock};
  const states: [keyof StationTime, string][] = [
    ['processingMs', text.processingTime], ['setupMs', text.setup], ['maintenanceMs', text.maintenance],
    ['starvedMs', text.starved], ['blockedMs', text.blocked], ['idleMs', text.idle],
    ['lunchMs', text.lunch], ['offShiftMs', text.offShift],
  ];
  const meanCells = (row: typeof stocks.materials[number]) => <>
    <td data-average-scale="calendar" data-quantity-ms={row.calendarQuantityMs} data-duration-ms={stocks.calendarMs}>{averageText(row.calendarAverage, text.notCalculated)}</td>
    <td data-average-scale="work" data-quantity-ms={row.workQuantityMs} data-duration-ms={stocks.workMs}>{averageText(row.workAverage, text.notCalculated)}</td>
  </>;
  return <details className="run-metrics" data-testid="run-metrics" data-calendar-ms={stocks.calendarMs} data-work-ms={stocks.workMs}>
    <summary>{text.flowMetrics}</summary>
    <section className="metric-section" aria-labelledby="average-stock-title">
      <h3 id="average-stock-title">{text.averageStocks}</h3>
      <p>{text.averageStockHelp}</p>
      <dl className="metric-periods">
        <div><dt>{text.calendarPeriod}</dt><dd data-period="calendar">{durationText(stocks.calendarMs)}</dd></div>
        <div><dt>{text.commonWorkPeriod}</dt><dd data-period="work">{durationText(stocks.workMs)}</dd></div>
      </dl>
      {stocks.calendarMs === 0 && <p className="summary-help">{text.zeroObservationHelp}</p>}
      <div className="table-scroll" tabIndex={0} role="region" aria-label={text.averageStocks}><table className="metric-table"><caption>{text.averageByMaterial}, {text.unit}</caption><thead><tr><th scope="col">{text.material}</th><th scope="col">{text.calendarAverage}</th><th scope="col">{text.workAverage}</th></tr></thead><tbody>
        {stocks.materials.map(row => <tr key={row.materialId} data-average-material={row.materialId}><th scope="row">{materialName(row.materialId)}</th>{meanCells(row)}</tr>)}
      </tbody></table></div>
      <p className="summary-help">{text.metricRoundingHelp}</p>
      <details className="average-stock-places"><summary>{text.averageByPlace}</summary><p>{text.averagePlacesHelp}</p>
        {stocks.places.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={text.averageByPlace}><table className="metric-table"><caption>{text.averageByPlace}, {text.unit}</caption><thead><tr><th scope="col">{text.stationColumn}</th><th scope="col">{text.material}</th><th scope="col">{text.stockLocation}</th><th scope="col">{text.calendarAverage}</th><th scope="col">{text.workAverage}</th></tr></thead><tbody>
          {stocks.places.map(row => <tr key={JSON.stringify([row.ownerId, row.materialId, row.location])} data-average-owner={row.ownerId} data-average-place-material={row.materialId} data-average-location={row.location}><th scope="row">{stationName(row.ownerId)}</th><td>{materialName(row.materialId)}</td><td>{locationName[row.location]}</td>{meanCells(row)}</tr>)}
        </tbody></table></div> : <p>{text.noAveragePlaces}</p>}
      </details>
    </section>
    <section className="metric-section" aria-labelledby="station-time-title">
      <h3 id="station-time-title">{text.stationTimeTitle}</h3><p>{text.stationTimeHelp}</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={text.stationShares}><table className="metric-table"><caption>{text.stationShares}</caption><thead><tr><th scope="col">{text.stationColumn}</th><th scope="col">{text.stationAvailableTime}</th><th scope="col">{text.processingShare}</th><th scope="col">{text.busyShare}</th><th scope="col">{text.starvedShare}</th><th scope="col">{text.blockedShare}</th></tr></thead><tbody>
        {times.stations.map(row => <tr key={row.stationId} data-time-station={row.stationId} data-available-work-ms={row.availableWorkMs}><th scope="row">{stationName(row.stationId)}</th><td>{durationText(row.availableWorkMs)}</td><td data-share="processing">{percentText(row.processingShare, text.notCalculated)}</td><td data-share="busy">{percentText(row.busyShare, text.notCalculated)}</td><td data-share="starved">{percentText(row.starvedShare, text.notCalculated)}</td><td data-share="blocked">{percentText(row.blockedShare, text.notCalculated)}</td></tr>)}
      </tbody></table></div>
      <details className="station-time-detail"><summary>{text.timeByState}</summary><p>{text.stateTimeHelp}</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={text.timeByState}><table className="metric-table"><caption>{text.timeByState}, {text.timeFormat}</caption><thead><tr><th scope="col">{text.state}</th>{times.stations.map(row => <th scope="col" key={row.stationId}>{stationName(row.stationId)}</th>)}</tr></thead><tbody>
          {states.map(([key, label]) => <tr key={key} data-time-state={key}><th scope="row">{label}</th>{times.stations.map(row => <td key={row.stationId} data-time-owner={row.stationId} data-time-ms={row.timeByState[key]}>{durationText(row.timeByState[key])}</td>)}</tr>)}
          <tr data-time-state="total"><th scope="row">{text.totalObservedTime}</th>{times.stations.map(row => <td key={row.stationId} data-time-owner={row.stationId} data-time-ms={times.calendarMs}>{durationText(times.calendarMs)}</td>)}</tr>
        </tbody></table></div>
      </details>
      <p className="summary-help">{text.timeFormatHelp}</p>
    </section>
  </details>;
}
