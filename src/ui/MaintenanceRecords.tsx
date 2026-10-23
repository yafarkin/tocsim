import type {DeepReadonly, RunConfig} from '../engine/config';
import type {RunnerView} from '../runner/runner';
import {maintenanceDeferrals, maintenanceTime, maintenanceTriggers} from './maintenance';
import {nameFor} from './i18n';
import type {Labels} from './i18n';
export function MaintenanceRecords({run, view, text}: {run: RunConfig; view: DeepReadonly<RunnerView>; text: Labels}) {
  if (!run.resolved.stations.some(s => s.maintenance.enabled)) return null;
  const records = view.model.stations.filter(s => s.lastMaintenance !== null);
  return <details className="maintenance-records"><summary>{text.maintenanceRecords}</summary>
    {records.length === 0 ? <p>{text.maintenanceNoRecords}</p> : <div className="table-scroll" tabIndex={0} role="region" aria-label={text.maintenanceRecords}><table aria-label={text.maintenanceRecords}>
      <thead><tr><th>{text.maintenanceStation}</th><th>{text.maintenanceDueTime}</th><th>{text.maintenanceStartTime}</th><th>{text.maintenanceEndTime}</th><th>{text.maintenanceDeferral}</th></tr></thead><tbody>
        {records.map(s => {const record = s.lastMaintenance!, config = run.source.stations.find(c => c.id === s.stationId)!; return <tr key={s.stationId}>
          <th>{nameFor(s.stationId, config.name, text)}</th><td>{maintenanceTime(run, record.dueAtMs, text)}</td><td>{maintenanceTime(run, record.startedAtMs, text)}</td><td>{maintenanceTime(run, record.completedAtMs, text)}</td>
          <td>{maintenanceTriggers(record.dueBy, text)}. {record.deferredBy.length ? maintenanceDeferrals(record.deferredBy, text) : text.maintenanceNoDeferral}</td>
        </tr>;})}
      </tbody></table></div>}
  </details>;
}
