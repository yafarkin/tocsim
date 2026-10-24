import {addMoney, subtractMoney, fixedCost, purchaseCost, moneyFromJSON, moneyToJSON} from './arithmetic';
import {calendarForDuration, workedMsUntil} from './calendar';
import type {DeepReadonly, RunConfig} from './config';
import type {Snapshot} from './state';

/** Exact cumulative financial result. Independent of rendering and sampled history.
 * Fixed charges round once per station; revenue rounds once per product total.
 * Existing lot costs are never revalued. All returned amounts are micro-unit strings.
 */
export function financialReport(run: RunConfig, model: DeepReadonly<Snapshot>) {
  const sum = (values: bigint[]) => values.reduce(addMoney, 0n);
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const workMs = workedMsUntil(calendar, model.timeMs);
  const counters = model.line!.counters;
  const revenue = sum(run.resolved.materials.filter(m => m.role === 'finished').map(m =>
    purchaseCost(m.salePrice!, counters.find(c => c.materialId === m.id)!.sold)));
  const tvcSold = sum(counters.map(c => moneyFromJSON(c.soldCost)));
  const scrapExpense = sum(counters.map(c => moneyFromJSON(c.scrapCost)));
  const fixedExpense = sum(run.resolved.stations.map(s => fixedCost(s.costs.perShift, workMs, calendar.dailyWorkMs)));
  const lunchExpense = sum(model.stations.map(s => moneyFromJSON(s.lunchCost)));
  const throughput = subtractMoney(revenue, tvcSold);
  const operatingExpense = sum([fixedExpense, lunchExpense, scrapExpense]);
  const netProfit = subtractMoney(throughput, operatingExpense);
  return {timeMs: model.timeMs, complete: model.line!.termination === 'horizon',
    revenue: moneyToJSON(revenue), tvcSold: moneyToJSON(tvcSold), throughput: moneyToJSON(throughput),
    scrapExpense: moneyToJSON(scrapExpense), fixedExpense: moneyToJSON(fixedExpense),
    lunchExpense: moneyToJSON(lunchExpense), operatingExpense: moneyToJSON(operatingExpense), netProfit: moneyToJSON(netProfit)};
}
