import { freezeData } from '../engine/config';
import type { DeepReadonly, RunConfig } from '../engine/config';
import { Simulation } from '../engine/simulation';
import type {FlowHistory} from '../engine/flow-history';
import type { Snapshot } from '../engine/state';
import { collectTransfers } from './transfers';
import type { TransferBatch, TransferSummary } from './transfers';
import { ArithmeticError } from '../engine/arithmetic';

export type PlaybackSpeed = number | 'max';
export type PlaybackStatus = 'ready' | 'running' | 'paused' | 'finished' | 'stopped' | 'error' | 'disposed';
export interface RunnerFailure { code: string; messages: {ru: string; en: string} }
export interface RunnerView {
  schemaVersion: 3;
  history: DeepReadonly<FlowHistory>;
  status: PlaybackStatus;
  speed: PlaybackSpeed;
  model: DeepReadonly<Snapshot>;
  error: RunnerFailure | null;
  transfers: DeepReadonly<TransferBatch>;
}
/** request must defer execution and yield to the main event loop, never call inline. */
export interface RunnerHost {
  now(): number;
  request(callback: () => void): unknown;
  cancel(handle: unknown): void;
}
export const MAX_TIMESTAMPS_PER_TURN = 64;
export const TURN_BUDGET_MS = 8;
const defaultHost: RunnerHost = {
  now: () => performance.now(),
  request: callback => setTimeout(callback, 0),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export class RunnerError extends Error {
  constructor(public readonly code: 'speed' | 'clock' | 'state', public readonly messages: {ru: string; en: string}) {
    super(messages.en); this.name = 'RunnerError';
  }
}
function validateSpeed(speed: PlaybackSpeed) {
  if (speed !== 'max' && (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0)) {
    throw new RunnerError('speed', {ru: 'Скорость должна быть положительным конечным множителем или max.', en: 'Speed must be a positive finite multiplier or max.'});
  }
}
function failureData(error: unknown): RunnerFailure {
  if (error instanceof ArithmeticError) {
    return {code: error.code, messages: error.code === 'range'
      ? {ru: 'Превышен допустимый числовой диапазон.', en: 'Supported numeric range was exceeded.'}
      : {ru: 'Некорректные данные точной арифметики.', en: 'Invalid exact arithmetic data.'}};
  }
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && 'messages' in error && error.messages && typeof error.messages === 'object'
    && 'ru' in error.messages && typeof error.messages.ru === 'string'
    && 'en' in error.messages && typeof error.messages.en === 'string') {
    return {code: error.code, messages: {ru: error.messages.ru, en: error.messages.en}};
  }
  return {code: 'run', messages: {ru: 'Не удалось продолжить прогон.', en: 'Unable to continue the run.'}};
}

/** Playback state and real time live here, never inside the deterministic engine. */
export class Runner {
  private simulation: Simulation;
  private status: PlaybackStatus = 'ready';
  private speed: PlaybackSpeed = 1;
  private view: DeepReadonly<RunnerView>;
  private failure: {error: unknown} | null = null;
  private pending: {handle: unknown} | null = null;
  private anchorMs: number | null = null;
  private observedClockMs: number | null = null;
  private targetMs = 0;
  private transferSequence = 0;
  private transfers: TransferBatch = {sequence: 0, fromTimeMs: 0, toTimeMs: 0, items: []};
  private clearTransfers() {
    const time = this.simulation.getSnapshot().timeMs;
    this.transfers = {sequence: ++this.transferSequence, fromTimeMs: time, toTimeMs: time, items: []};
  }
  private finishTransfers(items: Map<string, TransferSummary>, fromTimeMs: number, force = false) {
    if (items.size || force) this.transfers = {sequence: ++this.transferSequence, fromTimeMs,
      toTimeMs: this.simulation.getSnapshot().timeMs, items: [...items.values()]};
  }
  constructor(public readonly runConfig: RunConfig,
    private readonly onUpdate?: (view: DeepReadonly<RunnerView>) => void,
    private readonly host: RunnerHost = defaultHost) {
    this.simulation = new Simulation(runConfig);
    this.view = this.makeView();
  }
  getView(): DeepReadonly<RunnerView> { return this.view; }
  getFlowReport() {return this.simulation.getFlowReport();}
  getFailure(): unknown { return this.failure?.error ?? null; }
  private ensureAlive() {
    if (this.status === 'disposed') throw new RunnerError('state', {ru: 'Runner уже освобождён.', en: 'Runner has been disposed.'});
  }
  private now(): number {
    const now = this.host.now();
    if (!Number.isFinite(now) || now < 0 || (this.observedClockMs !== null && now < this.observedClockMs)) {
      throw new RunnerError('clock', {ru: 'Часы просмотра должны быть конечными и монотонными.', en: 'Playback clock must be finite and monotonic.'});
    }
    this.observedClockMs = now;
    return now;
  }
  private makeView(): DeepReadonly<RunnerView> {
    return Object.freeze({schemaVersion: 3, transfers: freezeData(this.transfers), status: this.status, speed: this.speed,
      model: this.simulation.getSnapshot(), history: this.simulation.getHistory(), error: freezeData(this.failure ? failureData(this.failure.error) : null)});
  }
  private publish(): DeepReadonly<RunnerView> {
    this.view = this.makeView();
    this.onUpdate?.(this.view);
    return this.view;
  }
  private cancelTurn() {
    const pending = this.pending;
    this.pending = null;
    if (pending) this.host.cancel(pending.handle);
  }
  private requestTurn() {
    if (this.status !== 'running' || this.pending) return;
    const token = {handle: null as unknown};
    this.pending = token;
    token.handle = this.host.request(() => {
      // Cancellation/repeat/disposal may leave an already queued callback behind.
      if (this.pending !== token) return;
      this.pending = null;
      this.turn();
    });
  }
  private accumulate(now: number) {
    if (this.speed === 'max') this.targetMs = this.runConfig.resolved.durationMs;
    else if (this.anchorMs !== null) this.targetMs = Math.min(this.runConfig.resolved.durationMs, this.targetMs + (now - this.anchorMs) * this.speed);
    this.anchorMs = now;
  }
  private updateTermination() {
    const termination = this.simulation.getSnapshot().line!.termination;
    if (termination === 'horizon') this.status = 'finished';
    else if (termination === 'stopped') this.status = 'stopped';
    else if (termination === 'error') this.status = 'error';
  }
  private turn() {
    if (this.status !== 'running') return;
    const transfers = new Map<string, TransferSummary>();
    const fromTimeMs = this.simulation.getSnapshot().timeMs;
    try {
      const started = this.now();
      this.accumulate(started);
      const target = Math.floor(this.targetMs);
      let timestamps = 0;
      while (this.status === 'running') {
        // A whole timestamp is atomic; the time budget is checked between them.
        if (timestamps >= MAX_TIMESTAMPS_PER_TURN || (timestamps > 0 && this.now() - started >= TURN_BUDGET_MS)) break;
        const next = this.simulation.nextEventTime();
        if (next !== null && next <= target) {
          this.simulation.step(); timestamps++;
          collectTransfers(transfers, this.simulation.getSnapshot());
          this.updateTermination();
        } else {
          if (this.simulation.getSnapshot().timeMs < target) this.simulation.advanceTo(target);
          this.updateTermination();
          break;
        }
      }
    } catch (error) {
      this.failure = {error}; this.status = 'error';
    }
    this.finishTransfers(transfers, fromTimeMs);
    // Queue before notifying: a pause in onUpdate can cancel it immediately.
    this.requestTurn();
    this.publish();
  }
  start(): DeepReadonly<RunnerView> {
    this.ensureAlive();
    if (this.status !== 'ready') return this.view;
    const now = this.now();
    this.anchorMs = now; this.targetMs = this.simulation.getSnapshot().timeMs;
    this.status = 'running'; this.requestTurn();
    return this.publish();
  }
  pause(): DeepReadonly<RunnerView> {
    this.ensureAlive();
    if (this.status !== 'running') return this.view;
    this.cancelTurn(); this.status = 'paused'; this.anchorMs = null;
    this.targetMs = this.simulation.getSnapshot().timeMs;
    return this.publish();
  }
  resume(): DeepReadonly<RunnerView> {
    this.ensureAlive();
    if (this.status !== 'paused') return this.view;
    this.anchorMs = this.now(); this.clearTransfers(); this.status = 'running'; this.requestTurn();
    return this.publish();
  }
  step(): DeepReadonly<RunnerView> {
    this.ensureAlive();
    if (['finished', 'stopped', 'error'].includes(this.status)) return this.view;
    this.cancelTurn(); this.status = 'paused'; this.anchorMs = null;
    const transfers = new Map<string, TransferSummary>(), fromTimeMs = this.simulation.getSnapshot().timeMs;
    try {
      if (this.simulation.step() !== null) collectTransfers(transfers, this.simulation.getSnapshot());
      this.updateTermination();
    }
    catch (error) {this.failure = {error}; this.status = 'error';}
    this.targetMs = this.simulation.getSnapshot().timeMs;
    this.finishTransfers(transfers, fromTimeMs, true);
    return this.publish();
  }
  setSpeed(speed: PlaybackSpeed): DeepReadonly<RunnerView> {
    this.ensureAlive(); validateSpeed(speed);
    if (this.speed === speed) return this.view;
    if (this.status === 'running') {
      const now = this.now(); this.accumulate(now);
      if (speed === 'max' || this.speed === 'max') this.targetMs = this.simulation.getSnapshot().timeMs;
    }
    this.speed = speed;
    if (this.status === 'running') this.clearTransfers();
    return this.publish();
  }
  stop(): DeepReadonly<RunnerView> {
    this.ensureAlive();
    if (['finished', 'stopped', 'error'].includes(this.status)) return this.view;
    this.cancelTurn(); this.simulation.stop(); this.status = 'stopped'; this.anchorMs = null;
    return this.publish();
  }
  /** Repeat starts a fresh run immediately, keeping only the selected playback speed. */
  repeat(): DeepReadonly<RunnerView> {
    this.ensureAlive(); this.cancelTurn();
    const now = this.now();
    this.simulation = new Simulation(this.runConfig); this.failure = null; this.clearTransfers();
    this.anchorMs = now; this.targetMs = 0; this.status = 'running'; this.requestTurn();
    return this.publish();
  }
  /** Release the timer on UI unmount without notifying an already removed consumer. */
  dispose(): void {
    if (this.status === 'disposed') return;
    this.cancelTurn(); this.status = 'disposed'; this.anchorMs = null;
    this.view = this.makeView();
  }
}
