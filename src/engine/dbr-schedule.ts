import type {RunConfig} from './config';
import {activeWorkMs, advanceWork, calendarForDuration, nextOpening} from './calendar';
import {validateDbrSelection} from './dbr-validation';
import type {DbrSelection} from './dbr-validation';
import {meanDurationSixths} from './random';
import {setupDurationMs} from './setup';

/** A 1 ms operation over one normal shift would otherwise allocate millions of slots. */
export const MAX_DRUM_SLOTS = 100_000;
export class DrumScheduleError extends Error {
  readonly code = 'limit';
  readonly messages = {
    ru: 'Номинальный план превышает 100000 слотов. Уменьшите горизонт или увеличьте длительность партии.',
    en: 'The nominal plan exceeds 100000 slots. Reduce the horizon or increase batch duration.',
  };
  constructor() {super('Nominal drum slot limit exceeded.'); this.name = 'DrumScheduleError';}
}
export interface NominalInterval {
  startMs: number;
  /** Null means work was not completed within the horizon. */
  endMs: number | null;
  throughMs: number;
  /** Integer strings keep oversized full batches and remaining work exact. */
  workMs: string;
  remainingMs: string;
}
export interface DrumSlot extends NominalInterval {
  slotId: string;
  ordinal: number;
  drumCycleIndex: number;
  productCycleIndex: number;
  planRowId: string;
  recipeId: string;
  batchIndex: number;
  mode: 'sequential' | 'simultaneous';
  repetitions: number;
}
export type DrumPreparation = NominalInterval & (
  {kind: 'setup'; fromRecipeId: string; toRecipeId: string}
  | {kind: 'maintenance'}
);
export interface DrumSchedule {
  stationId: string;
  horizonMs: number;
  slots: DrumSlot[];
  preparations: DrumPreparation[];
  completedDrumCycles: number;
  /** Complete groups of drum cycles, not downstream finished-product output. */
  completedProductCycles: number;
  lastDrumCycle: {index: number; complete: boolean} | null;
  lastProductCycle: {index: number; complete: boolean} | null;
}

/** A nominal, fully supplied, freely unloading drum. No physical state, RNG,
 * source permissions, buffer protection or execution policy is created here.
 * Structural failure yields no schedule; a resource limit throws, never truncates.
 */
export function planDrumSchedule(run: RunConfig, selection: unknown) {
  const validation = validateDbrSelection(run, selection);
  if (!validation.structurallyValid) return {...validation, schedule: null};
  const settings = selection as DbrSelection;
  const station = run.resolved.stations.find(s => s.id === settings.drumStationId)!;
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs, station.lunchReplacement);
  const slots: DrumSlot[] = [], preparations: DrumPreparation[] = [];
  const maintenance = station.maintenance;
  let cursor = 0, rowIndex = 0, batchIndex = 0, cycleIndex = 0;
  let configuredRecipeId = station.initialRecipeId;
  let processingSinceService = 0n, repetitionsSinceService = 0n;
  // Shared calendar primitives preserve an operation across lunch and night.
  const perform = (work: bigint): NominalInterval | null => {
    const startMs = nextOpening(calendar,cursor);
    if (startMs === null) return null;
    const available = BigInt(activeWorkMs(calendar,startMs,calendar.endTimeMs));
    const done = work > available ? available : work;
    const end = advanceWork(calendar,startMs,Number(done)).timeMs;
    const remaining = work - done;
    cursor = remaining > 0n ? calendar.endTimeMs : end;
    return {startMs, endMs: remaining === 0n ? end : null, throughMs: cursor, workMs: work.toString(), remainingMs: remaining.toString()};
  };
  while (nextOpening(calendar,cursor) !== null) {
    const dueBy: ('processingTime' | 'repetitions')[] = [];
    if (maintenance.enabled) {
      if (maintenance.processingThresholdMs !== null && processingSinceService >= BigInt(maintenance.processingThresholdMs)) dueBy.push('processingTime');
      if (maintenance.repetitionsThreshold !== null && repetitionsSinceService >= BigInt(maintenance.repetitionsThreshold)) dueBy.push('repetitions');
      if (dueBy.length) {
        const interval = perform(BigInt(maintenance.durationMs))!;
        preparations.push({...interval,kind:'maintenance'});
        if (interval.endMs === null) break;
        processingSinceService = 0n; repetitionsSinceService = 0n;
      }
    }
    const row = station.plan[rowIndex]!;
    const setup = setupDurationMs(station.setupMs,configuredRecipeId,row.recipeId);
    if (setup > 0) {
      const interval = perform(BigInt(setup));
      if (interval === null) break;
      preparations.push({...interval,kind:'setup',fromRecipeId:configuredRecipeId,toRecipeId:row.recipeId});
      if (interval.endMs === null) break;
    }
    configuredRecipeId = row.recipeId;
    if (nextOpening(calendar,cursor) === null) break;
    if (slots.length >= MAX_DRUM_SLOTS) throw new DrumScheduleError();
    // Round one nominal operation, then repeat, matching sequential operation units.
    const operationMs = (meanDurationSixths(row.timeMs,row.distribution) + 3n) / 6n;
    const work = operationMs * BigInt(row.mode === 'sequential' ? row.repetitions : 1);
    const interval = perform(work)!;
    slots.push({...interval,slotId:JSON.stringify([station.id,cycleIndex,row.id,batchIndex]),ordinal:slots.length,
      drumCycleIndex:cycleIndex,productCycleIndex:Math.floor(cycleIndex/settings.drumCycles),
      planRowId:row.id,recipeId:row.recipeId,batchIndex,mode:row.mode,repetitions:row.repetitions});
    if (interval.endMs === null) break;
    processingSinceService += work;
    repetitionsSinceService += BigInt(row.repetitions);
    batchIndex++;
    if (batchIndex === row.batches) {
      batchIndex = 0; rowIndex++;
      if (rowIndex === station.plan.length) {rowIndex = 0; cycleIndex++;}
    }
  }
  const last = slots.at(-1);
  const lastDrumComplete = last !== undefined && cycleIndex > last.drumCycleIndex;
  const schedule: DrumSchedule = {
    stationId:station.id,horizonMs:calendar.endTimeMs,slots,preparations,
    completedDrumCycles:cycleIndex,completedProductCycles:Math.floor(cycleIndex/settings.drumCycles),
    lastDrumCycle:last ? {index:last.drumCycleIndex,complete:lastDrumComplete} : null,
    lastProductCycle:last ? {index:last.productCycleIndex,complete:lastDrumComplete && cycleIndex % settings.drumCycles === 0} : null,
  };
  return {...validation,pendingChecks:validation.pendingChecks.filter(check=>check !== 'drumSchedule'),schedule};
}
