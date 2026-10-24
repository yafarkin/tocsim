import type {DeepReadonly, RunConfig} from './config';
import type {Snapshot, StockState, StockTime} from './state';

const keyOf = (row: Pick<StockState, 'ownerId' | 'materialId' | 'location'>) => JSON.stringify([row.ownerId, row.materialId, row.location]);

/** Integrate the previous physical state over [from, to), before endpoint events.
 * Only place/material totals survive; storage is bounded by the configured line.
 * No money bound applies: products and sums use arbitrary-precision integers.
 */
export function integrateStockTime(stocks: readonly StockState[], totals: StockTime[], interval: {calendarMs: number; workMs: number}): void {
  if (interval.calendarMs === 0) return;
  const calendar = BigInt(interval.calendarMs), work = BigInt(interval.workMs);
  const rows = new Map(totals.map(row => [keyOf(row), row]));
  for (const stock of stocks) {
    if (stock.location === 'warehouse' || stock.quantity === 0) continue;
    const key = keyOf(stock);
    let row = rows.get(key);
    if (!row) {
      row = {ownerId: stock.ownerId, materialId: stock.materialId, location: stock.location, calendarQuantityMs: 0n, workQuantityMs: 0n};
      totals.push(row); rows.set(key, row);
    }
    row.calendarQuantityMs += BigInt(stock.quantity) * calendar;
    row.workQuantityMs += BigInt(stock.quantity) * work;
  }
}

/** An exact average in micro-units: quantityMs / durationMs. UI rounds only for display. */
export interface StockAverage {quantityMs: string; durationMs: number}
function averages(calendarQuantityMs: string, workQuantityMs: string, calendarMs: number, workMs: number) {
  return {
    calendarAverage: calendarMs === 0 ? null : {quantityMs: calendarQuantityMs, durationMs: calendarMs} satisfies StockAverage,
    workAverage: workMs === 0 ? null : {quantityMs: workQuantityMs, durationMs: workMs} satisfies StockAverage,
  };
}

/** Separate compatible quantities only by material; never a global sum across materials.
 * Sparse places include historical residence even after a place becomes empty.
 */
export function stockTimeReport(run: RunConfig, model: DeepReadonly<Snapshot>) {
  const {calendarMs, workMs} = model.observation;
  const totals = new Map(run.resolved.materials.map(m => [m.id, {calendar: 0n, work: 0n}]));
  const places = (model.line?.stockTime ?? []).map(row => {
    const total = totals.get(row.materialId)!;
    total.calendar += BigInt(row.calendarQuantityMs); total.work += BigInt(row.workQuantityMs);
    return {...row, ...averages(row.calendarQuantityMs, row.workQuantityMs, calendarMs, workMs)};
  });
  return {
    calendarMs, workMs, complete: model.line?.termination === 'horizon',
    materials: run.resolved.materials.map(m => {
      const total = totals.get(m.id)!;
      const calendarQuantityMs = String(total.calendar), workQuantityMs = String(total.work);
      return {materialId: m.id, calendarQuantityMs, workQuantityMs, ...averages(calendarQuantityMs, workQuantityMs, calendarMs, workMs)};
    }),
    places,
  };
}
