/** Counter-based FNV-1a/Murmur finalizer, midpoint uniforms, fixed-series Box–Muller.
 * Versioned arithmetic uses only IEEE-754 basic operations; no host log/exp/trig. */
export const RNG_VERSION = 'counter32-fixed-distributions-2';
export type BoundedDistribution = {kind: 'uniform'; minMs: number; maxMs: number}
  | {kind: 'triangular'; minMs: number; peakMs: number; maxMs: number};
export type DurationDistribution = BoundedDistribution | {kind: 'constant'; timeMs: number} | {kind: 'lognormal'; meanMs: number; cv: number};
export class RandomError extends Error {
  readonly code = 'random';
  constructor(public readonly messages: {ru: string; en: string}) {super(messages.en); this.name = 'RandomError';}
}
const LN2 = 0.6931471805599453, PI = 3.141592653589793;
function log(value: number): number {
  let exponent = 0;
  while (value < 1) {value *= 2; exponent--;}
  while (value >= 2) {value /= 2; exponent++;}
  const z = (value - 1) / (value + 1), square = z * z;
  let term = z, sum = z;
  for (let n = 3; n <= 49; n += 2) {term *= square; sum += term / n;}
  return 2 * sum + exponent * LN2;
}
function log1p(value: number): number {
  if (value >= 0.5) return log(1 + value);
  const z = value / (2 + value), square = z * z;
  let term = z, sum = z;
  for (let n = 3; n <= 49; n += 2) {term *= square; sum += term / n;}
  return 2 * sum;
}
function sqrt(value: number): number {
  if (value === 0) return 0;
  let scale = 1;
  while (value < 1) {value *= 4; scale *= 0.5;}
  while (value >= 4) {value /= 4; scale *= 2;}
  let estimate = value;
  for (let i = 0; i < 10; i++) estimate = (estimate + value / estimate) / 2;
  return estimate * scale;
}
function cos(value: number): number {
  if (value > PI) value -= 2 * PI;
  let term = 1, sum = 1;
  for (let n = 1; n <= 18; n++) {term *= -value * value / ((2 * n - 1) * 2 * n); sum += term;}
  return sum;
}
function exp(value: number): number {
  const exponent = Math.floor(value / LN2), remainder = value - exponent * LN2;
  let term = 1, sum = 1;
  for (let n = 1; n <= 24; n++) {term *= remainder / n; sum += term;}
  for (let n = 0; n < Math.abs(exponent); n++) sum *= exponent < 0 ? 0.5 : 2;
  return sum;
}
export function uniform(seed: number, stationId: string, recipeId: string, ordinal: number, purpose: string, sampleIndex: number): number {
  const key = JSON.stringify([seed, stationId, recipeId, ordinal, purpose, sampleIndex]);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return (hash + 0.5) / 4294967296;
}
/** Exact sixths of a millisecond, used for pre-run buffer calculation. */
export function meanDurationSixths(meanMs: number, distribution?: BoundedDistribution): bigint {
  if (!distribution) return BigInt(meanMs) * 6n;
  return distribution.kind === 'uniform'
    ? (BigInt(distribution.minMs) + BigInt(distribution.maxMs)) * 3n
    : (BigInt(distribution.minMs) + BigInt(distribution.peakMs) + BigInt(distribution.maxMs)) * 2n;
}
export function distributionMoments(distribution: BoundedDistribution): {meanMs: number; cv: number} {
  const {minMs, maxMs} = distribution, range = maxMs - minMs;
  const sixths = meanDurationSixths(0, distribution);
  const meanMs = Number(sixths / 6n) + Number(sixths % 6n) / 6;
  const lower = distribution.kind === 'triangular' ? distribution.peakMs - minMs : 0, upper = range - lower;
  const deviation = distribution.kind === 'uniform' ? range / sqrt(12)
    : sqrt((lower * lower + range * range + upper * upper) / 36);
  return {meanMs, cv: deviation / meanMs};
}
export function processingDuration(meanMs: number, cv: number, seed: number, stationId: string, recipeId: string, ordinal: number, distribution?: BoundedDistribution): number {
  if (!Number.isFinite(meanMs) || (!distribution && !Number.isSafeInteger(meanMs)) || meanMs < 1 || !Number.isFinite(cv) || cv < 0 || cv > 2
    || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new RandomError({ru: 'Некорректные параметры вариативности.', en: 'Invalid variability parameters.'});
  }
  if (distribution) {
    const {minMs, maxMs} = distribution;
    if (!Number.isSafeInteger(minMs) || !Number.isSafeInteger(maxMs) || minMs < 1 || maxMs < minMs
      || (distribution.kind === 'triangular' && (!Number.isSafeInteger(distribution.peakMs) || distribution.peakMs < minMs || distribution.peakMs > maxMs))) {
      throw new RandomError({ru: 'Некорректные границы распределения.', en: 'Invalid distribution bounds.'});
    }
    if (minMs === maxMs) return minMs;
    const u = uniform(seed, stationId, recipeId, ordinal, 'processing', 0), range = maxMs - minMs;
    let value: number;
    if (distribution.kind === 'uniform') value = minMs + range * u;
    else {
      const split = (distribution.peakMs - minMs) / range;
      value = u < split ? minMs + range * sqrt(u * split) : maxMs - range * sqrt((1 - u) * (1 - split));
    }
    const duration = Math.round(value);
    if (!Number.isSafeInteger(duration) || duration < minMs || duration > maxMs) throw new RandomError({ru: 'Случайная длительность превысила безопасный диапазон времени.', en: 'Sampled duration exceeded the safe time range.'});
    return duration;
  }
  if (cv === 0) return meanMs;
  const variance = log1p(cv * cv);
  const u1 = uniform(seed, stationId, recipeId, ordinal, 'processing', 0), u2 = uniform(seed, stationId, recipeId, ordinal, 'processing', 1);
  const normal = sqrt(-2 * log(u1)) * cos(2 * PI * u2);
  const duration = Math.max(1, Math.round(meanMs * exp(sqrt(variance) * normal - variance / 2)));
  if (!Number.isSafeInteger(duration)) throw new RandomError({ru: 'Случайная длительность превысила безопасный диапазон времени.', en: 'Sampled duration exceeded the safe time range.'});
  return duration;
}
