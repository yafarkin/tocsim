import { createSnapshot } from './state';
import type { EngineState, Snapshot, StationState } from './state';
import { freezeData } from './config';
import type { DeepReadonly, RunConfig } from './config';

export const MAX_TRANSITIONS_PER_TIMESTAMP = 10_000;
type EventBase = { id: string; timeMs: number };
export type CompletionEvent = EventBase & {kind: 'completion'; stationId: string; operationVersion: number};
export type CalendarEvent = EventBase & {kind: 'calendar'; boundary: 'open' | 'close'; stationId: string | null};
export type SourceEvent = EventBase & {kind: 'source'; sourceId: string};
export type TransferEvent = EventBase & {kind: 'transfer'; producerId: string};
export type DispatchEvent = EventBase & {kind: 'dispatch'; stationId: string};
export type ModelEvent = CompletionEvent | CalendarEvent | SourceEvent | TransferEvent | DispatchEvent;
type HorizonEvent = EventBase & {kind: 'horizon'};
type QueuedEvent = ModelEvent | HorizonEvent;
const phase = {completion: 0, calendar: 1, horizon: 1, source: 2, transfer: 3, dispatch: 4} as const;
const compare = (a: QueuedEvent, b: QueuedEvent) => a.timeMs - b.timeMs || phase[a.kind] - phase[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export interface EventContext {
  /** A private draft, valid only inside this timestamp's handlers. */
  readonly state: EngineState;
  readonly timeMs: number;
  schedule(event: ModelEvent): void;
  invalidateOperation(stationId: string): number;
}
/** Fixed production phases. No subscriptions, arbitrary event payloads or plugins. */
export interface EventHandlers {
  integrate?(state: EngineState, fromMs: number, toMs: number): void;
  completion?(context: EventContext, event: DeepReadonly<CompletionEvent>): void;
  calendar?(context: EventContext, event: DeepReadonly<CalendarEvent>): void;
  source?(context: EventContext, event: DeepReadonly<SourceEvent>): void;
  transfer?(context: EventContext, event: DeepReadonly<TransferEvent>): void;
  dispatch?(context: EventContext, event: DeepReadonly<DispatchEvent>): void;
}
export interface StepResult { timeMs: number; processedEvents: number; staleCompletions: number; finished: boolean }
type ErrorCode = 'value' | 'order' | 'duplicate' | 'handler' | 'limit' | 'version';
export class EventError extends Error {
  constructor(public readonly code: ErrorCode, public readonly objectId: string, public readonly messages: {ru: string; en: string}) {
    super(`${objectId}: ${messages.en}`); this.name = 'EventError';
  }
}
function fail(code: ErrorCode, id: string, ru: string, en: string): never {
  throw new EventError(code, id, {ru, en});
}
function integer(value: number, id: string) {
  if (!Number.isSafeInteger(value) || value < 0) fail('value', id, 'Ожидается неотрицательное безопасное целое число.', 'Expected a nonnegative safe integer.');
}
function station(state: EngineState, id: string): StationState {
  const found = state.stations.find(station => station.stationId === id);
  if (!found) return fail('value', id, 'Пост события не найден.', 'Event station was not found.');
  integer(found.operationVersion, id);
  return found;
}
function invalidate(state: EngineState, id: string): number {
  const current = station(state, id);
  if (current.operationVersion === Number.MAX_SAFE_INTEGER) fail('version', id, 'Исчерпан диапазон версий операции.', 'Operation version range is exhausted.');
  return ++current.operationVersion;
}

/** One scheduler owns one detached engine state. Full station behavior comes later. */
export class EventScheduler {
  private state: EngineState;
  private queue: QueuedEvent[];
  private snapshot: DeepReadonly<Snapshot>;
  private failure: {error: unknown} | null = null;
  private busy = false;
  private lastProcessedTimeMs: number | null = null;
  private finished: boolean;
  constructor(private readonly run: RunConfig, initial: EngineState, private readonly handlers: EventHandlers) {
    integer(initial.timeMs, 'state');
    if (initial.timeMs > run.resolved.durationMs) fail('value', 'state', 'Начальное время превышает горизонт.', 'Initial time exceeds horizon.');
    if (new Set(initial.stations.map(station => station.stationId)).size !== initial.stations.length) fail('value', 'state', 'ID постов состояния должны быть уникальными.', 'State station IDs must be unique.');
    initial.stations.forEach(s => station(initial, s.stationId));
    this.state = structuredClone(initial);
    this.finished = initial.timeMs === run.resolved.durationMs;
    this.queue = initial.timeMs < run.resolved.durationMs ? [{kind: 'horizon', id: '@horizon', timeMs: run.resolved.durationMs}] : [];
    this.snapshot = createSnapshot(run, this.state);
  }
  getSnapshot(): DeepReadonly<Snapshot> { return this.snapshot; }
  getFailure(): unknown { return this.failure?.error ?? null; }

  private ensureAvailable() {
    if (this.busy) fail('order', 'scheduler', 'Внутри шага используйте только контекст обработчика.', 'Use only handler context during a step.');
    if (this.failure !== null) throw this.failure.error;
  }
  private enqueue(queue: QueuedEvent[], state: EngineState, event: ModelEvent, active: QueuedEvent | null) {
    integer(event.timeMs, event.id);
    if (!event.id || event.id === '@horizon' || !Object.hasOwn(phase, event.kind)) fail('value', event.id, 'Некорректный ID или вид события.', 'Invalid event ID or kind.');
    if (event.timeMs < state.timeMs || event.timeMs > this.run.resolved.durationMs) fail('value', event.id, 'Время события должно быть между текущим временем и горизонтом.', 'Event time must be between current time and horizon.');
    if (event.kind === 'completion') { station(state, event.stationId); integer(event.operationVersion, event.id); }
    if (event.kind === 'dispatch') station(state, event.stationId);
    if (event.kind === 'calendar' && event.stationId !== null) station(state, event.stationId);
    if (active && event.timeMs === state.timeMs && phase[event.kind] < phase[active.kind]
      && !(phase[event.kind] >= phase.transfer && phase[active.kind] >= phase.transfer)) {
      fail('order', event.id, 'Нельзя возвращаться к уже пройденной ранней фазе этой отметки.', 'Cannot return to an earlier completed phase of this timestamp.');
    }
    // Duplicate keys would make insertion order a hidden tie breaker.
    if (queue.some(item => compare(item, event) === 0)) fail('duplicate', event.id, 'Событие с этим временем, фазой и ID уже есть.', 'An event with this time, phase and ID already exists.');
    queue.push(structuredClone(event));
    queue.sort(compare);
  }
  schedule(event: ModelEvent): void {
    this.ensureAvailable();
    if (this.finished || (this.lastProcessedTimeMs !== null && event.timeMs <= this.lastProcessedTimeMs)) fail('order', event.id, 'Нельзя добавлять событие в уже завершённую отметку.', 'Cannot add an event to an already completed timestamp.');
    this.enqueue(this.queue, this.state, event, null);
  }
  invalidateOperation(stationId: string): number {
    this.ensureAvailable();
    if (this.finished) fail('order', stationId, 'Прогон уже завершён.', 'Run is already finished.');
    return invalidate(this.state, stationId);
  }
  /** Complete one timestamp; a handler failure rolls back state, queue and versions. */
  step(): StepResult | null {
    this.ensureAvailable();
    if (this.queue.length === 0) return null;
    return this.processTimestamp(this.queue[0]!.timeMs);
  }
  /** Process full timestamps up to target, then integrate an event-free tail. */
  advanceTo(targetMs: number): DeepReadonly<Snapshot> {
    this.ensureAvailable(); integer(targetMs, 'target');
    if (targetMs < this.state.timeMs || targetMs > this.run.resolved.durationMs) fail('value', 'target', 'Цель должна быть между текущим временем и горизонтом.', 'Target must be between current time and horizon.');
    while (this.queue.length > 0 && this.queue[0]!.timeMs <= targetMs) this.step();
    if (this.state.timeMs < targetMs) this.processTimestamp(targetMs);
    return this.snapshot;
  }
  private processTimestamp(timeMs: number): StepResult {
    this.busy = true;
    const draft = structuredClone(this.state);
    const queue = structuredClone(this.queue);
    const fromMs = draft.timeMs;
    let active: QueuedEvent | null = null;
    let contextOpen = true;
    const checkContext = () => {
      if (!contextOpen) fail('order', 'context', 'Контекст обработчика уже закрыт.', 'Handler context is closed.');
    };
    const context: EventContext = {
      state: draft, timeMs,
      schedule: event => { checkContext(); this.enqueue(queue, draft, event, active); },
      invalidateOperation: id => { checkContext(); return invalidate(draft, id); },
    };
    let processedEvents = 0, staleCompletions = 0;
    try {
      // Integrals use the previous state before applying any events at timeMs.
      this.handlers.integrate?.(draft, fromMs, timeMs);
      draft.timeMs = timeMs;
      while (queue[0]?.timeMs === timeMs) {
        if (processedEvents >= MAX_TRANSITIONS_PER_TIMESTAMP) fail('limit', 'timestamp', 'Превышен лимит переходов одной временной отметки.', 'Transition limit for one timestamp was exceeded.');
        active = queue.shift()!;
        processedEvents++;
        if (active.kind === 'horizon') continue;
        if (timeMs === this.run.resolved.durationMs && (active.kind === 'source' || active.kind === 'dispatch')) continue;
        if (active.kind === 'completion') {
          if (station(draft, active.stationId).operationVersion !== active.operationVersion) { staleCompletions++; continue; }
          // Consume the token before calling the handler, invalidating duplicate completions.
          invalidate(draft, active.stationId);
        }
        const handler = this.handlers[active.kind];
        if (!handler) fail('handler', active.id, 'Не задан обработчик предметного события.', 'No handler is defined for this production event.');
        // Discriminated dispatch preserves the handler's event type.
        switch (active.kind) {
          case 'completion': this.handlers.completion!(context, freezeData(active)); break;
          case 'calendar': this.handlers.calendar!(context, freezeData(active)); break;
          case 'source': this.handlers.source!(context, freezeData(active)); break;
          case 'transfer': this.handlers.transfer!(context, freezeData(active)); break;
          case 'dispatch': this.handlers.dispatch!(context, freezeData(active)); break;
        }
      }
      if (draft.timeMs !== timeMs) fail('value', 'state', 'Обработчик не должен менять модельное время напрямую.', 'A handler must not change model time directly.');
      // Detach committed state from references retained by trusted handlers.
      const committed = structuredClone(draft);
      const snapshot = createSnapshot(this.run, committed);
      this.state = committed; this.queue = queue; this.snapshot = snapshot;
      this.lastProcessedTimeMs = timeMs;
      this.finished = timeMs === this.run.resolved.durationMs;
      return {timeMs, processedEvents, staleCompletions, finished: timeMs === this.run.resolved.durationMs};
    } catch (error) {
      this.failure = {error};
      throw error;
    } finally { contextOpen = false; this.busy = false; }
  }
}
