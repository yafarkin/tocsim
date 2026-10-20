/** Counter-based FNV-1a/Murmur finalizer, midpoint uniforms, fixed-series Box–Muller.
 * Versioned arithmetic uses only IEEE-754 basic operations; no host log/exp/trig. */
export const RNG_VERSION = 'counter32-fixed-lognormal-1';
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
export function processingDuration(meanMs: number, cv: number, seed: number, stationId: string, recipeId: string, ordinal: number): number {
  if (!Number.isSafeInteger(meanMs) || meanMs < 1 || !Number.isFinite(cv) || cv < 0 || cv > 2
    || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new RandomError({ru: 'Некорректные параметры вариативности.', en: 'Invalid variability parameters.'});
  }
  if (cv === 0) return meanMs;
  const variance = log1p(cv * cv);
  const u1 = uniform(seed, stationId, recipeId, ordinal, 'processing', 0), u2 = uniform(seed, stationId, recipeId, ordinal, 'processing', 1);
  const normal = sqrt(-2 * log(u1)) * cos(2 * PI * u2);
  const duration = Math.max(1, Math.round(meanMs * exp(sqrt(variance) * normal - variance / 2)));
  if (!Number.isSafeInteger(duration)) throw new RandomError({ru: 'Случайная длительность превысила безопасный диапазон времени.', en: 'Sampled duration exceeded the safe time range.'});
  return duration;
}
