import {workedMsUntil} from './calendar';
import type {WorkCalendar} from './calendar';
import type {DeepReadonly, RunConfig} from './config';
import {comparableFlowReason} from './flow-scope';
import type {Snapshot} from './state';

/** Four cumulative scalar sums, not a log. Units are micro-quantity × milliseconds. */
export interface FlowBoundaryMoments {
  admissionCalendarQuantityMs: bigint; admissionWorkQuantityMs: bigint;
  exitCalendarQuantityMs: bigint; exitWorkQuantityMs: bigint;
}
export function flowIdentityReason(run: RunConfig) {
  return comparableFlowReason(run) ?? (run.resolved.stations.some(s => s.plan.some(r => (r.defectProbability ?? 0) > 0)) ? 'quality' as const : null);
}
export const emptyFlowBoundaryMoments = (): FlowBoundaryMoments => ({
  admissionCalendarQuantityMs: 0n, admissionWorkQuantityMs: 0n, exitCalendarQuantityMs: 0n, exitWorkQuantityMs: 0n,
});
/** Only actual boundary crossings count. Internal transfers/recipe completions do not. */
export function recordFlowBoundary(total: FlowBoundaryMoments, side: 'admission' | 'exit', quantity: number, timeMs: number, calendar: WorkCalendar): void {
  const q = BigInt(quantity);
  total[side === 'admission' ? 'admissionCalendarQuantityMs' : 'exitCalendarQuantityMs'] += q * BigInt(timeMs);
  total[side === 'admission' ? 'admissionWorkQuantityMs' : 'exitWorkQuantityMs'] += q * BigInt(workedMsUntil(calendar, timeMs));
}

/** Independently compare rectangle integration with clipped lifetimes in [0,T].
 * Σ lifetime = Σ(exit q×time) + remaining q×T − Σ(admission q×time).
 * Initial physical stock starts at the window boundary, so its entry moment is 0.
 * This identity survives merged lots; earliest-ancestor lead time is not used.
 */
export function flowIdentityReport(run: RunConfig, model: DeepReadonly<Snapshot>) {
  const reason = flowIdentityReason(run);
  if (reason !== null) return {applicable: false as const, reason};
  const line = model.line!, boundary = line.flowBoundary!;
  const {calendarMs, workMs} = model.observation;
  const initial = run.resolved.initialStocks.filter(s => s.location !== 'warehouse').reduce((sum,s) => sum + BigInt(s.quantity),0n);
  const admitted = model.sources.reduce((sum,s) => sum + BigInt(s.releasedQuantity),0n);
  const exited = line.counters.reduce((sum,c) => sum + BigInt(c.sold),0n);
  const remaining = model.stocks.filter(s => s.location !== 'warehouse').reduce((sum,s) => sum + BigInt(s.quantity),0n);
  const quantityDifference = initial + admitted - exited - remaining;
  const measure = (scale: 'calendar' | 'work', durationMs: number) => {
    const admissionMoment = BigInt(scale === 'calendar' ? boundary.admissionCalendarQuantityMs : boundary.admissionWorkQuantityMs);
    const exitMoment = BigInt(scale === 'calendar' ? boundary.exitCalendarQuantityMs : boundary.exitWorkQuantityMs);
    const integral = line.stockTime.reduce((sum,row) => sum + BigInt(scale === 'calendar' ? row.calendarQuantityMs : row.workQuantityMs),0n);
    const remainingEndMoment = remaining * BigInt(durationMs);
    const clippedResidence = exitMoment + remainingEndMoment - admissionMoment;
    const difference = integral - clippedResidence;
    return {integralQuantityMs: String(integral), clippedResidenceQuantityMs: String(clippedResidence),
      admissionMomentQuantityMs: String(admissionMoment), exitMomentQuantityMs: String(exitMoment),
      remainingEndMomentQuantityMs: String(remainingEndMoment), differenceQuantityMs: String(difference), matches: difference === 0n};
  };
  const calendar = measure('calendar', calendarMs), work = measure('work', workMs);
  return {applicable: true as const, reason: null, calendarMs, workMs, complete: line.termination === 'horizon',
    initialQuantity: String(initial), admittedQuantity: String(admitted), exitedQuantity: String(exited), remainingQuantity: String(remaining),
    quantityDifference: String(quantityDifference), calendar, work, consistent: quantityDifference === 0n && calendar.matches && work.matches};
}
