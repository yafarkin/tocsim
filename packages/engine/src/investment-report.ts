import {addMoney, ArithmeticError, MAX_UNITS, moneyFromJSON, moneyToJSON} from './arithmetic.js';
import type {DeepReadonly, RunConfig} from './config.js';
import {financialReport} from './financial-report.js';
import type {Snapshot} from './state.js';
import type {InvestmentAverage, InvestmentReport, InvestmentRoi} from './contract/output/reports/index.js';
export type {InvestmentAverage, InvestmentReport, InvestmentRoi} from './contract/output/reports/index.js';

/** Read-only observation of the same actual calendar period as the financial result.
 * Warehouse and WIP are already included in stockValue. Capital is constant from
 * time zero, adds to investments and never changes inventory cost or OE.
 */
export function investmentReport(run: RunConfig, model: DeepReadonly<Snapshot>): InvestmentReport {
  const {calendarMs} = model.observation;
  const {currentCost, calendarCostMs} = model.line!.stockValue;
  const capital = run.resolved.stations.reduce((sum, station) => addMoney(sum, station.costs.capital), 0n);
  const stockCost = moneyFromJSON(currentCost);
  const totalCost = addMoney(stockCost, capital);
  const stockIntegral = BigInt(calendarCostMs), duration = BigInt(calendarMs);
  const totalIntegral = stockIntegral + capital * duration;
  // Integrals themselves are unbounded. The monetary mean still obeys the range,
  // even when the current total has fallen back below it after earlier sales.
  if (totalIntegral > MAX_UNITS * duration) throw new ArithmeticError('range');
  const stockAverage: InvestmentAverage | null = calendarMs === 0 ? null : {costMs: calendarCostMs, durationMs: calendarMs};
  const totalAverage: InvestmentAverage | null = calendarMs === 0 ? null : {costMs: String(totalIntegral), durationMs: calendarMs};
  const {netProfit, complete} = financialReport(run, model);
  const roi: InvestmentRoi | null = calendarMs === 0 || totalIntegral === 0n ? null
    : {numerator: String(moneyFromJSON(netProfit) * duration), denominator: String(totalIntegral)};
  return {calendarMs, complete, capital: moneyToJSON(capital), stockCost: moneyToJSON(stockCost),
    totalCost: moneyToJSON(totalCost), stockAverage, totalAverage, netProfit, roi};
}
