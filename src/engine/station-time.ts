import type {DeepReadonly} from './config';
import type {Snapshot, StationState, StationTime} from './state';

export function emptyStationTime(): StationTime {
  return {processingMs: 0, setupMs: 0, maintenanceMs: 0, starvedMs: 0, blockedMs: 0, idleMs: 0, lunchMs: 0, offShiftMs: 0};
}

/** Account the previous state before endpoint events or operation remainders change.
 * Retained operations may be paused; only available work is charged to them.
 * Every counter is bounded by the same safe integer observation horizon.
 */
export function integrateStationTime(station: StationState, interval: {workMs: number; lunchMs: number; offShiftMs: number}): void {
  const times = station.timeByState;
  const workingState = station.remainingMaintenanceMs !== null ? 'maintenanceMs'
    : station.remainingSetupMs !== null ? 'setupMs'
      : station.remainingProcessingMs !== null ? 'processingMs'
        : station.status === 'blocked' ? 'blockedMs'
          : station.status === 'starved' ? 'starvedMs' : 'idleMs';
  times[workingState] += interval.workMs;
  times.lunchMs += interval.lunchMs;
  times.offShiftMs += interval.offShiftMs;
}

/** Exact share of available station work time; percentages are a display concern. */
function share(timeMs: number, availableWorkMs: number) {
  return availableWorkMs === 0 ? null : {timeMs, availableWorkMs};
}
export function stationTimeReport(model: DeepReadonly<Snapshot>) {
  return {
    calendarMs: model.observation.calendarMs,
    complete: model.line?.termination === 'horizon',
    stations: model.stations.map(station => {
      const {processingMs, setupMs, maintenanceMs, starvedMs, blockedMs} = station.timeByState;
      const busyMs = processingMs + setupMs + maintenanceMs;
      return {
        stationId: station.stationId, availableWorkMs: station.availableWorkMs, timeByState: {...station.timeByState}, busyMs,
        processingShare: share(processingMs, station.availableWorkMs),
        busyShare: share(busyMs, station.availableWorkMs),
        starvedShare: share(starvedMs, station.availableWorkMs),
        blockedShare: share(blockedMs, station.availableWorkMs),
      };
    }),
  };
}
