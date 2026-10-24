import type {InvestmentAverage, InvestmentRoi} from '../engine/investment-report';
import type {StockAverage} from '../engine/stock-time';

function decimal(value: bigint, places: number): string {
  const scale = 10n ** BigInt(places);
  const fraction = (value % scale).toString().padStart(places, '0').replace(/0+$/, '');
  return `${value / scale}${fraction ? `.${fraction}` : ''}`;
}
/** Round once for display. Preserve tiny positive values and mark inexact output. */
function fractionText(numerator: bigint, denominator: bigint, places: number): string {
  const scaled = numerator * 10n ** BigInt(places);
  if (numerator > 0n && scaled < denominator) return `< ${decimal(1n, places)}`;
  const rounded = (2n * scaled + denominator) / (2n * denominator);
  return `${scaled % denominator ? '≈ ' : ''}${decimal(rounded, places)}`;
}
export function averageText(average: StockAverage | null, unavailable: string): string {
  return average === null ? unavailable : fractionText(BigInt(average.quantityMs), BigInt(average.durationMs) * 1_000_000n, 6);
}
export function percentText(share: {timeMs: number; availableWorkMs: number} | null, unavailable: string): string {
  return share === null ? unavailable : `${fractionText(BigInt(share.timeMs) * 100n, BigInt(share.availableWorkMs), 1)}%`;
}
/** Exact elapsed hours:minutes:seconds, retaining milliseconds when present. */
export function durationText(timeMs: number): string {
  const ms = BigInt(timeMs);
  return `${ms / 3_600_000n}:${String(ms / 60_000n % 60n).padStart(2, '0')}:${String(ms / 1000n % 60n).padStart(2, '0')}${ms % 1000n ? `.${String(ms % 1000n).padStart(3, '0')}` : ''}`;
}

/** Weighted mean duration rounded once to milliseconds, using the exact ratio. */
export function meanDurationText(quantityMs: string, quantity: string | number, unavailable: string): string {
  const n = BigInt(quantityMs), d = BigInt(quantity);
  if (d === 0n) return unavailable;
  if (n > 0n && n < d) return '< 0:00:00.001';
  const rounded = (2n * n + d) / (2n * d);
  // The ratio is a model duration, bounded by the safe-integer run horizon.
  return `${n % d ? '≈ ' : ''}${durationText(Number(rounded))}`;
}
export function quantityShareText(quantity: string | number, total: string | number): string | null {
  return BigInt(total) === 0n ? null : `${fractionText(BigInt(quantity) * 100n, BigInt(total), 1)}%`;
}

/** Round signed exact ratios to two decimal places only for display. */
function fixedMoneyRatio(n: bigint, d: bigint): string {
  const absolute = n < 0n ? -n : n;
  const cents = (2n * absolute * 100n + d) / (2n * d);
  return `${absolute * 100n % d ? '≈ ' : ''}${n < 0n && cents !== 0n ? '−' : ''}${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
function investmentAmountRatio(n: bigint, d: bigint): string {
  return n > 0n && n * 100n < d ? '< 0.01' : fixedMoneyRatio(n, d);
}
export function investmentMoneyText(value: string): string {
  return investmentAmountRatio(BigInt(value), 1_000_000n);
}
export function investmentAverageText(average: InvestmentAverage | null, unavailable: string): string {
  return average === null ? unavailable : investmentAmountRatio(BigInt(average.costMs), BigInt(average.durationMs) * 1_000_000n);
}
export function investmentRoiText(roi: InvestmentRoi | null, unavailable: string): string {
  if (roi === null) return unavailable;
  const n = BigInt(roi.numerator) * 100n, d = BigInt(roi.denominator), absolute = n < 0n ? -n : n;
  if (absolute > 0n && absolute * 100n < d) return n < 0n ? '−0.01% < ROI < 0%' : '0% < ROI < 0.01%';
  return `${fixedMoneyRatio(n, d)}%`;
}
