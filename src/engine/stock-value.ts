import {addMoney, ArithmeticError} from './arithmetic';
import type {StockState} from './state';

/** All disjoint physical lots, including the warehouse. Existing costs are
 * inherited raw-material values: never multiply them by a new material price.
 * Virtual supply has no lot and therefore no inventory value before purchase.
 */
export function stockCost(stocks: readonly Pick<StockState, 'cost'>[]): bigint {
  return stocks.reduce((total, stock) => addMoney(total, stock.cost), 0n);
}

/** Exact cost × calendar milliseconds for the previous state over [from, to).
 * The integral is not a money amount and is not bounded by the money range.
 * A single cumulative scalar is sufficient; no sampled or per-lot history.
 */
export function stockCostIntegral(stocks: readonly Pick<StockState, 'cost'>[], calendarMs: number): bigint {
  if (!Number.isSafeInteger(calendarMs) || calendarMs < 0) throw new ArithmeticError('integer');
  return stockCost(stocks) * BigInt(calendarMs);
}
