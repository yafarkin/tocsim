import {calendarForDuration, workedMsUntil} from './calendar';
import {freezeData} from './config';
import type {DeepReadonly, RunConfig} from './config';
import type {Snapshot, StockState} from './state';

/** At most this many plotted points, including the current endpoint. Initial state is separate. */
export const MAX_FLOW_POINTS = 2048;
export const flowStages = ['input', 'reserved', 'held', 'output'] as const;
export interface FlowMaterialValues {
  materialId: string;
  input: string; reserved: string; held: string; output: string; wip: string;
  released: string; produced: string; consumed: string; delivered: string; scrapped: string;
}
export interface FlowPlaceValue {
  ownerId: string; materialId: string; location: Exclude<StockState['location'], 'warehouse'>; quantity: string;
}
export interface FlowValues {materials: FlowMaterialValues[]; places: FlowPlaceValue[]}
export interface FlowPoint {timeMs: number; workMs: number; phase: 'initial' | 'settled'; values: FlowValues}
export interface FlowHistory {
  schemaVersion: 1;
  engineVersion: string; rngVersion: string; calculationHash: string;
  /** Separate materials have separate units; no global mixed-material CFD is implied. */
  scope: 'per-material'; unit: 'micro-unit'; boundary: 'line-excluding-warehouse';
  stages: typeof flowStages;
  sampling: {kind: 'uniform-model-time'; intervalMs: number; maxPoints: number};
  initial: FlowPoint;
  points: FlowPoint[];
  timeMs: number;
  termination: 'running' | 'horizon' | 'stopped' | 'error';
}
function values(run: RunConfig, model: DeepReadonly<Snapshot>): DeepReadonly<FlowValues> {
  const stages = new Map(run.resolved.materials.map(m => [m.id, {input: 0n, reserved: 0n, held: 0n, output: 0n}]));
  const released = new Map(run.resolved.materials.map(m => [m.id, 0n]));
  for (const source of model.sources) {
    const id = run.resolved.sources.find(s => s.id === source.sourceId)!.materialId;
    released.set(id, released.get(id)! + BigInt(source.releasedQuantity));
  }
  const places = model.line!.stockAge.places.map(p => {
    stages.get(p.materialId)![p.location] += BigInt(p.quantity);
    return {ownerId: p.ownerId, materialId: p.materialId, location: p.location, quantity: p.quantity};
  });
  return freezeData({
    materials: model.line!.counters.map(counter => {
      const s = stages.get(counter.materialId)!;
      return {materialId: counter.materialId, input: String(s.input), reserved: String(s.reserved), held: String(s.held), output: String(s.output),
        wip: String(s.input + s.reserved + s.held + s.output), released: String(released.get(counter.materialId)!),
        produced: String(counter.produced), consumed: String(counter.consumed), delivered: String(counter.sold), scrapped: String(counter.scrapped)};
    }), places,
  });
}

/** A bounded derived series, outside transactional engine state and exact metric accumulators.
 * Quantities are constant between settled event timestamps. Fill grid points before an event
 * with the previous values, and an exact grid/event coincidence with the fully settled values.
 * Display-only advances fill the same grid without adding frame-dependent samples.
 */
export class FlowHistoryCollector {
  private readonly calendar;
  private readonly intervalMs: number;
  private readonly initial: DeepReadonly<FlowPoint>;
  private readonly points: DeepReadonly<FlowPoint>[] = [];
  private currentValues: DeepReadonly<FlowValues>;
  private nextIndex = 0;
  private started = false;
  private lastTimeMs = 0;
  private cachedModel: DeepReadonly<Snapshot> | null = null;
  private cached: DeepReadonly<FlowHistory> | null = null;
  constructor(private readonly run: RunConfig, initial: DeepReadonly<Snapshot>) {
    this.calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
    this.intervalMs = Number((BigInt(run.resolved.durationMs) + BigInt(MAX_FLOW_POINTS - 3)) / BigInt(MAX_FLOW_POINTS - 2));
    this.currentValues = values(run, initial);
    this.initial = this.point(0, 'initial');
  }
  private point(timeMs: number, phase: FlowPoint['phase'] = 'settled'): DeepReadonly<FlowPoint> {
    return Object.freeze({timeMs, workMs: workedMsUntil(this.calendar, timeMs), phase, values: this.currentValues});
  }
  private fill(timeMs: number, inclusive: boolean) {
    if (!Number.isSafeInteger(timeMs) || timeMs < this.lastTimeMs || timeMs > this.calendar.endTimeMs) throw new RangeError('History time must be monotonic and within the run horizon.');
    this.lastTimeMs = timeMs;
    const end = BigInt(timeMs);
    while (true) {
      const grid = BigInt(this.nextIndex) * BigInt(this.intervalMs);
      if (grid > end || (!inclusive && grid === end)) break;
      this.points.push(this.point(Number(grid))); this.nextIndex++;
    }
  }
  /** Only after a whole scheduler timestamp has committed successfully. */
  settled(model: DeepReadonly<Snapshot>) {
    this.fill(model.timeMs, false);
    this.currentValues = values(this.run, model); this.started = true;
    this.fill(model.timeMs, true);
  }
  /** No material change occurs in this event-free tail. */
  advanceTime(timeMs: number) {this.fill(timeMs, true);}
  get(model: DeepReadonly<Snapshot>): DeepReadonly<FlowHistory> {
    if (model === this.cachedModel) return this.cached!;
    const points = [...this.points];
    if (points.at(-1)?.timeMs !== model.timeMs) points.push(this.point(model.timeMs, this.started ? 'settled' : 'initial'));
    this.cachedModel = model;
    this.cached = Object.freeze({schemaVersion: 1, engineVersion: this.run.engineVersion, rngVersion: this.run.rngVersion, calculationHash: this.run.calculationHash,
      scope: 'per-material', unit: 'micro-unit', boundary: 'line-excluding-warehouse', stages: flowStages,
      sampling: Object.freeze({kind: 'uniform-model-time', intervalMs: this.intervalMs, maxPoints: MAX_FLOW_POINTS}),
      initial: this.initial, points: Object.freeze(points), timeMs: model.timeMs, termination: model.line!.termination});
    return this.cached;
  }
}
Object.freeze(flowStages);
