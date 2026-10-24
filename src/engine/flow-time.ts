import {addQuantity} from './arithmetic';
import {elapsedTime} from './calendar';
import type {WorkCalendar} from './calendar';
import type {FlowTimeTotal, ProductFlowTime, StockState} from './state';

export const emptyFlowTime = (): FlowTimeTotal => ({knownQuantity: 0, unknownQuantity: 0, calendarQuantityMs: 0n, workQuantityMs: 0n});

/** Called only for accepted good portions, inside the scheduler's atomic draft. */
export function recordFlowTime(row: ProductFlowTime, part: StockState, calendar: WorkCalendar, timeMs: number): void {
  for (const [total, start] of [[row.admission, part.provenance.origin], [row.firstProcessing, part.provenance.firstProcessing]] as const) {
    if (start.kind !== 'known') {
      total.unknownQuantity = addQuantity(total.unknownQuantity, part.quantity);
      continue;
    }
    const duration = elapsedTime(calendar, start.startedAtMs, timeMs);
    total.knownQuantity = addQuantity(total.knownQuantity, part.quantity);
    total.calendarQuantityMs += BigInt(part.quantity) * BigInt(duration.calendarMs);
    total.workQuantityMs += BigInt(part.quantity) * BigInt(duration.workMs);
  }
}
