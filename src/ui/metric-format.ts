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
