import {calendarForDuration, workedMsUntil} from './calendar';
import type {DeepReadonly, RunConfig} from './config';
import {flowIdentityReport, flowIdentityReason} from './flow-identity';
import type {Snapshot} from './state';

/** Exact ratios. Quantity uses micro-units, time uses milliseconds. */
export interface FlowRatio {numerator: string; denominator: string}
const ratio = (numerator: bigint, denominator: bigint): FlowRatio | null => denominator === 0n ? null
  : {numerator: String(numerator), denominator: String(denominator)};
const sumTime = (model: DeepReadonly<Snapshot>, scale: 'calendar' | 'work') => model.line!.flowTime.reduce((sum, row) =>
  sum + BigInt(scale === 'calendar' ? row.admission.calendarQuantityMs : row.admission.workQuantityMs), 0n);
const unknownTime = (model: DeepReadonly<Snapshot>) => model.line!.flowTime.reduce((sum, row) => sum + BigInt(row.admission.unknownQuantity), 0n);

/** The start snapshot must come from this run's configured warmup boundary.
 * At warmup=0 it precedes events at zero; otherwise it follows all events at warmup.
 * Production snapshots are immutable. No interpolation or CFD samples are used.
 */
export function littleLawReport(run: RunConfig, model: DeepReadonly<Snapshot>, start: DeepReadonly<Snapshot> | null) {
  const reason = flowIdentityReason(run);
  if (reason !== null) return {applicable: false as const, reason};
  if (!start) return {applicable: false as const, reason: 'warmupNotReached' as const};
  if (start.calculationHash !== run.calculationHash || model.calculationHash !== run.calculationHash
    || start.engineVersion !== run.engineVersion || model.engineVersion !== run.engineVersion
    || !start.line || !model.line || start.timeMs !== run.resolved.warmupMs || model.timeMs < start.timeMs) {
    throw new Error('Flow window snapshots must belong to the same run and configured warmup boundary.');
  }
  const before = flowIdentityReport(run, start), after = flowIdentityReport(run, model);
  if (!before.applicable || !after.applicable) throw new Error('Incompatible flow window.');
  const initial = BigInt(before.remainingQuantity), remaining = BigInt(after.remainingQuantity);
  const admitted = BigInt(after.admittedQuantity) - BigInt(before.admittedQuantity);
  const exited = BigInt(after.exitedQuantity) - BigInt(before.exitedQuantity);
  const unknown = unknownTime(model) - unknownTime(start);
  const knownCount = (s: DeepReadonly<Snapshot>) => s.line!.flowTime.reduce((sum, row) => sum + BigInt(row.admission.knownQuantity), 0n);
  const known = knownCount(model) - knownCount(start);
  const completedQuantityDifference = known + unknown - exited;
  const quantityDifference = initial + admitted - exited - remaining;
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const measure = (scale: 'calendar' | 'work') => {
    const fromMs = scale === 'calendar' ? start.observation.calendarMs : start.observation.workMs;
    const toMs = scale === 'calendar' ? model.observation.calendarMs : model.observation.workMs;
    const durationMs = toMs - fromMs, duration = BigInt(durationMs), from = BigInt(fromMs);
    const integral = BigInt(after[scale].integralQuantityMs) - BigInt(before[scale].integralQuantityMs);
    const admissionMoment = BigInt(after[scale].admissionMomentQuantityMs) - BigInt(before[scale].admissionMomentQuantityMs) - admitted * from;
    const exitMoment = BigInt(after[scale].exitMomentQuantityMs) - BigInt(before[scale].exitMomentQuantityMs) - exited * from;
    const clipped = exitMoment + remaining * duration - admissionMoment;
    const moment = (time: number) => BigInt(scale === 'calendar' ? time : workedMsUntil(calendar, time));
    // Physical portions retain the common origin used by flowTime and stockAge.
    const remainingClipped = model.stocks.filter(s => s.location !== 'warehouse').reduce((sum, s) => {
      const origin = s.provenance.origin;
      const entry = origin.kind === 'known' ? moment(origin.startedAtMs) : from;
      return sum + BigInt(s.quantity) * (BigInt(toMs) - (entry > from ? entry : from));
    }, 0n);
    const priorAge = (snapshot: DeepReadonly<Snapshot>) => snapshot.stocks.filter(s => s.location !== 'warehouse').reduce((sum, s) => {
      const origin = s.provenance.origin;
      if (origin.kind !== 'known') return sum;
      const entry = moment(origin.startedAtMs);
      return sum + BigInt(s.quantity) * (entry < from ? from - entry : 0n);
    }, 0n);
    const completed = unknown === 0n ? sumTime(model, scale) - sumTime(start, scale) : null;
    const completedBefore = completed === null ? null : priorAge(start) - priorAge(model);
    const correction = completedBefore === null ? null : remainingClipped - completedBefore;
    const corrected = completed === null || correction === null ? null : completed + correction;
    const unavailable = duration === 0n ? 'zeroPeriod' as const : exited === 0n ? 'noCompletions' as const : unknown !== 0n ? 'unknownHistory' as const : null;
    return {fromMs, toMs, durationMs, L: ratio(integral, duration), lambda: ratio(exited, duration),
      W: unavailable === null ? ratio(completed!, exited) : null,
      lambdaW: unavailable === null ? ratio(completed!, duration) : null, approximationUnavailable: unavailable,
      integralQuantityMs: String(integral), clippedResidenceQuantityMs: String(clipped),
      exactDifferenceQuantityMs: String(integral - clipped), exactMatches: integral === clipped,
      completedResidenceQuantityMs: completed === null ? null : String(completed),
      remainingClippedQuantityMs: String(remainingClipped),
      completedBeforeWindowQuantityMs: completedBefore === null ? null : String(completedBefore),
      edgeCorrectionQuantityMs: correction === null ? null : String(correction),
      correctedResidenceQuantityMs: corrected === null ? null : String(corrected),
      correctedMatches: corrected === null ? null : integral === corrected,
      approximationDifference: unavailable === null ? ratio(integral - completed!, duration) : null};
  };
  const calendarMeasure = measure('calendar'), work = measure('work');
  return {applicable: true as const, reason: null, boundary: 'admissionToAcceptance' as const, quantityUnit: 'microQuantity' as const,
    fromMs: start.timeMs, toMs: model.timeMs, warmupMs: run.resolved.warmupMs, complete: after.complete,
    initialQuantity: String(initial), admittedQuantity: String(admitted), exitedQuantity: String(exited), remainingQuantity: String(remaining),
    knownCompletedQuantity: String(known), unknownCompletedQuantity: String(unknown), completedQuantityDifference: String(completedQuantityDifference), quantityDifference: String(quantityDifference),
    emptyStart: initial === 0n, hasRemaining: remaining !== 0n,
    calendar: calendarMeasure, work,
    consistent: before.consistent && after.consistent && quantityDifference === 0n && completedQuantityDifference === 0n && calendarMeasure.exactMatches && work.exactMatches
      && calendarMeasure.correctedMatches !== false && work.correctedMatches !== false};
}
