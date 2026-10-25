import type {DeepReadonly, RunConfig} from './config';
import {flowReport} from './flow-report';
import type {Snapshot} from './state';
import {stationTimeReport} from './station-time';
import {stockTimeReport} from './stock-time';

/** Existing observations in [0,timeMs], grouped for comparison, never ranked.
 * Queue quantities use micro-units; averages retain exact quantityMs/durationMs.
 * Common queue work time excludes lunch even when a station has replacement.
 * State shares instead use that station's own available time, as before.
 */
export function constraintFactsReport(run: RunConfig, model: DeepReadonly<Snapshot>) {
  const flow = flowReport(run, model), stocks = stockTimeReport(run, model), times = stationTimeReport(model);
  const key = (stationId: string, materialId: string) => JSON.stringify([stationId, materialId]);
  const currentInputs = new Map(flow.places.filter(p => p.location === 'input').map(p => [key(p.ownerId, p.materialId), p.quantity]));
  const historicalInputs = new Map(stocks.places.filter(p => p.location === 'input').map(p => [key(p.ownerId, p.materialId), p]));
  const stationTimes = new Map(times.stations.map(s => [s.stationId, s]));
  const {calendarMs, workMs} = model.observation;
  return {
    fromMs: 0, timeMs: model.timeMs, calendarMs, workMs,
    complete: flow.complete, termination: model.line!.termination,
    // Whole-line good acceptance stays outside station rows.
    products: flow.products.map(({materialId, delivered}) => ({materialId, delivered})),
    stations: run.resolved.stations.map(station => ({
      ...stationTimes.get(station.id)!,
      inputQueues: station.inputBuffers.map(({materialId}) => {
        const address = key(station.id, materialId), history = historicalInputs.get(address);
        return {
          materialId, quantity: currentInputs.get(address) ?? '0',
          calendarQuantityMs: history?.calendarQuantityMs ?? '0', workQuantityMs: history?.workQuantityMs ?? '0',
          calendarAverage: history?.calendarAverage ?? (calendarMs === 0 ? null : {quantityMs: '0', durationMs: calendarMs}),
          workAverage: history?.workAverage ?? (workMs === 0 ? null : {quantityMs: '0', durationMs: workMs}),
        };
      }),
    })),
  };
}
