import { addMoney, addQuantity, MAX_UNITS } from './arithmetic';
import { activeWorkMs, calendarForDuration, canStart, DAY_MS } from './calendar';
import { freezeData, inputCapacity } from './config';
import type { DeepReadonly, RunConfig } from './config';
import { EventError, EventScheduler } from './events';
import type { EventContext, EventHandlers, StepResult } from './events';
import { processingDuration, RandomError } from './random';
import { completeProduction, consumeStock, reserveInputs, transferStock } from './inventory';
import { createPushHandlers, createPushState, scheduleInitialSources } from './sources';
import type { EngineState, Snapshot, StockState } from './state';

const WAKE = '@line';
type Station = RunConfig['resolved']['stations'][number];
function count(state: EngineState, owner: string, location: StockState['location'], materialId: string): number {
  return state.stocks.filter(s => s.ownerId === owner && s.location === location && s.materialId === materialId).reduce((sum, s) => sum + s.quantity, 0);
}
function free(capacity: Station['outputBuffer'], occupied: number): number {
  return Number((capacity.kind === 'infinite' ? MAX_UNITS : BigInt(capacity.quantity)) - BigInt(occupied));
}
function createLineHandlers(run: RunConfig): EventHandlers {
  const push = createPushHandlers(run), calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const firstId = run.resolved.stations[0]!.id;
  const stations = [...run.resolved.stations].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const recipeOf = (s: Station) => run.resolved.recipes.find(r => r.id === s.recipeId)!;
  function wakeTransfer(ctx: EventContext) {
    if (!ctx.state.line!.transferPending) {
      ctx.state.line!.transferPending = true;
      ctx.schedule({kind: 'transfer', producerId: WAKE, id: WAKE, timeMs: ctx.timeMs});
    }
  }
  function wakeDispatch(ctx: EventContext) {
    if (canStart(calendar, ctx.timeMs) && !ctx.state.line!.dispatchPending) {
      ctx.state.line!.dispatchPending = true;
      ctx.schedule({kind: 'dispatch', stationId: firstId, id: WAKE, timeMs: ctx.timeMs});
    }
  }
  function calendarReason(timeMs: number): 'horizon' | 'lunch' | 'offShift' {
    if (timeMs === calendar.endTimeMs) return 'horizon';
    const phase = timeMs % DAY_MS;
    return phase >= calendar.schedule.lunchStartMs - calendar.schedule.shiftStartMs && phase < calendar.schedule.lunchEndMs - calendar.schedule.shiftStartMs ? 'lunch' : 'offShift';
  }
  function refresh(ctx: EventContext) {
    for (const config of stations) {
      const station = ctx.state.stations.find(s => s.stationId === config.id)!;
      if (!canStart(calendar, ctx.timeMs)) {station.status = 'paused'; station.reason = calendarReason(ctx.timeMs);}
      else if (station.remainingProcessingMs === null) {
        const recipe = recipeOf(config);
        if (count(ctx.state, config.id, 'held', recipe.output.materialId) > 0) {station.status = 'blocked'; station.reason = 'output';}
        else if (recipe.inputs.some(input => count(ctx.state, config.id, 'input', input.materialId) < input.quantity)) {station.status = 'starved'; station.reason = 'input';}
        else {station.status = 'idle'; station.reason = null;}
      }
    }
  }
  function nextBoundary(afterMs: number) {
    const phase = afterMs % DAY_MS, base = afterMs - phase;
    const offsets = [calendar.schedule.lunchStartMs - calendar.schedule.shiftStartMs,
      calendar.schedule.lunchEndMs - calendar.schedule.shiftStartMs,
      calendar.schedule.shiftEndMs - calendar.schedule.shiftStartMs];
    const found = offsets.find(offset => offset > phase);
    const next = BigInt(base) + BigInt(found ?? DAY_MS);
    if (next > BigInt(calendar.endTimeMs)) return null;
    return {timeMs: Number(next), boundary: found === offsets[0] || found === offsets[2] ? 'close' as const : 'open' as const};
  }
  function scheduleBoundary(ctx: EventContext) {
    const next = nextBoundary(ctx.timeMs);
    if (next) ctx.schedule({kind: 'calendar', stationId: null, id: '@calendar', ...next});
  }
  function planCompletion(ctx: EventContext, id: string) {
    const station = ctx.state.stations.find(s => s.stationId === id)!;
    const due = BigInt(ctx.timeMs) + BigInt(station.remainingProcessingMs!);
    // A calendar close invalidates this provisional completion. No work beyond horizon.
    if (due <= BigInt(calendar.endTimeMs)) ctx.schedule({kind: 'completion', stationId: id,
      operationVersion: station.operationVersion, id: `completion:${id}:${station.operationVersion}`, timeMs: Number(due)});
  }
  function deliver(ctx: EventContext, config: Station, location: 'held' | 'output', limit: number): boolean {
    const recipe = recipeOf(config);
    let available = Math.min(limit, count(ctx.state, config.id, location, recipe.output.materialId));
    if (available === 0) return false;
    const routes = run.resolved.routes.filter(r => r.fromId === config.id);
    const from = {ownerId: config.id, location};
    if (routes.some(route => route.toId === 'market')) {
      const portions = consumeStock(ctx.state, from, recipe.output.materialId, available);
      const counter = ctx.state.line!.counters.find(c => c.materialId === recipe.output.materialId)!;
      for (const part of portions) {
        if (part.provenance.defective) {counter.scrapped = addQuantity(counter.scrapped, part.quantity); counter.scrapCost = addMoney(counter.scrapCost, part.cost);}
        else {counter.sold = addQuantity(counter.sold, part.quantity); counter.soldCost = addMoney(counter.soldCost, part.cost);}
        ctx.state.line!.transfers.push({fromId: config.id, toId: 'market', fromLocation: location,
          materialId: part.materialId, quantity: part.quantity, cost: part.cost, kind: part.provenance.defective ? 'scrap' : 'sale'});
      }
      return true;
    }
    let movedAny = false;
    for (const target of stations.filter(station => routes.some(route => route.toId === station.id))) {
      const quantity = Math.min(available, free(inputCapacity(target, recipe.output.materialId), count(ctx.state, target.id, 'input', recipe.output.materialId)));
      if (quantity <= 0) continue;
      const moved = transferStock(ctx.state, from, {ownerId: target.id, location: 'input'}, recipe.output.materialId, quantity, inputCapacity(target, recipe.output.materialId), ctx.timeMs);
      ctx.state.line!.transfers.push({fromId: config.id, toId: target.id, fromLocation: location, materialId: recipe.output.materialId,
        quantity, cost: moved.reduce((sum, s) => addMoney(sum, s.cost), 0n), kind: 'route'});
      available -= quantity; movedAny = true;
      if (available === 0) break;
    }
    return movedAny;
  }
  // Only each buffer's FIFO head competes. Rebuild heads after each move so
  // no producer can drain newer lots ahead of older output from another.
  function distribute(ctx: EventContext): boolean {
    let movedAny = false;
    while (true) {
      const heads = new Map<string, StockState>();
      for (const stock of ctx.state.stocks) {
        const config = stations.find(s => s.id === stock.ownerId);
        if (!config || !(stock.location === 'output' || (stock.location === 'held' && config.outputBuffer.kind === 'quantity' && config.outputBuffer.quantity === 0))) continue;
        const key = JSON.stringify([stock.ownerId, stock.location]);
        if (!heads.has(key)) heads.set(key, stock);
      }
      const candidates = [...heads.values()].sort((a, b) => a.readyAtMs - b.readyAtMs
        || (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const moved = candidates.some(stock => deliver(ctx, stations.find(s => s.id === stock.ownerId)!, stock.location as 'held' | 'output', stock.quantity));
      if (!moved) break;
      movedAny = true;
    }
    return movedAny;
  }
  return {
    integrate: (state, from, to) => {
      push.integrate(state, from, to);
      state.line!.transfers = [];
      const elapsed = activeWorkMs(calendar, from, to);
      for (const station of state.stations) {
        if (station.remainingProcessingMs !== null) {
          station.remainingProcessingMs -= elapsed;
          if (station.remainingProcessingMs < 0) throw new EventError('value', station.stationId, {ru: 'Пропущено завершение обработки.', en: 'Processing completion was skipped.'});
        }
      }
    },
    source: push.source,
    calendar: (ctx, event) => {
      if (event.boundary === 'close') {
        for (const station of ctx.state.stations) if (station.remainingProcessingMs !== null) {
          ctx.invalidateOperation(station.stationId);
          // A 24:00 close may coincide with the next 00:00 opening. Mark the
          // operation paused explicitly so dispatch still replaces its token.
          station.status = 'paused'; station.reason = calendarReason(ctx.timeMs);
        }
      }
      refresh(ctx); scheduleBoundary(ctx); wakeTransfer(ctx);
    },
    completion: (ctx, event) => {
      const station = ctx.state.stations.find(s => s.stationId === event.stationId)!;
      if (station.remainingProcessingMs !== 0) throw new EventError('value', event.stationId, {ru: 'Операция ещё не завершена.', en: 'Operation is not complete yet.'});
      const config = stations.find(s => s.id === event.stationId)!, recipe = recipeOf(config);
      completeProduction(ctx.state, config.id, recipe.output, station.operationDurationMs!, ctx.timeMs);
      for (const input of recipe.inputs) {
        const inputCounter = ctx.state.line!.counters.find(c => c.materialId === input.materialId)!;
        inputCounter.consumed = addQuantity(inputCounter.consumed, input.quantity);
      }
      const outputCounter = ctx.state.line!.counters.find(c => c.materialId === recipe.output.materialId)!;
      outputCounter.produced = addQuantity(outputCounter.produced, recipe.output.quantity);
      station.remainingProcessingMs = null; station.operationDurationMs = null;
      wakeTransfer(ctx);
    },
    transfer: (ctx, event) => {
      if (event.producerId === '@sources') {push.transfer(ctx, event); wakeTransfer(ctx); return;}
      if (event.producerId !== WAKE) throw new EventError('value', event.id, {ru: 'Неизвестная передача линии.', en: 'Unknown line transfer.'});
      ctx.state.line!.transferPending = false;
      let moved = distribute(ctx);
      for (const config of stations) {
        const material = recipeOf(config).output.materialId;
        if (!(config.outputBuffer.kind === 'quantity' && config.outputBuffer.quantity === 0)) {
          const quantity = Math.min(count(ctx.state, config.id, 'held', material), free(config.outputBuffer, count(ctx.state, config.id, 'output', material)));
          if (quantity > 0) {
            const parts = transferStock(ctx.state, {ownerId: config.id, location: 'held'}, {ownerId: config.id, location: 'output'}, material, quantity, config.outputBuffer, ctx.timeMs);
            ctx.state.line!.transfers.push({fromId: config.id, toId: config.id, fromLocation: 'held', materialId: material, quantity,
              cost: parts.reduce((sum, part) => addMoney(sum, part.cost), 0n), kind: 'buffer'});
            moved = true;
          }
        }
      }
      refresh(ctx);
      if (moved) wakeTransfer(ctx);
      wakeDispatch(ctx);
    },
    dispatch: ctx => {
      ctx.state.line!.dispatchPending = false;
      if (!canStart(calendar, ctx.timeMs)) {refresh(ctx); return;}
      let started = false;
      for (const config of stations) {
        const station = ctx.state.stations.find(s => s.stationId === config.id)!, recipe = recipeOf(config);
        if (station.remainingProcessingMs !== null) {
          if (station.status !== 'processing') {station.status = 'processing'; station.reason = null; planCompletion(ctx, config.id);}
          continue;
        }
        if (count(ctx.state, config.id, 'held', recipe.output.materialId) > 0) continue;
        if (recipe.inputs.some(input => count(ctx.state, config.id, 'input', input.materialId) < input.quantity)) continue;
        reserveInputs(ctx.state, config.id, recipe.inputs);
        if (station.operationOrdinal === Number.MAX_SAFE_INTEGER) throw new RandomError({ru: 'Исчерпан счётчик операций.', en: 'Operation counter is exhausted.'});
        station.operationDurationMs = processingDuration(config.timeMs, config.cv, run.resolved.seed, config.id, config.recipeId, station.operationOrdinal++);
        station.remainingProcessingMs = station.operationDurationMs; station.status = 'processing'; station.reason = null;
        ctx.invalidateOperation(config.id); planCompletion(ctx, config.id); started = true;
      }
      refresh(ctx);
      if (started) wakeTransfer(ctx);
    },
  };
}

/** One deterministic production model; a future runner controls only how it advances. */
export class Simulation {
  private readonly scheduler: EventScheduler;
  private terminal: DeepReadonly<Snapshot> | null = null;
  private failure: {error: unknown} | null = null;
  constructor(private readonly run: RunConfig) {
    const state = createPushState(run);
    state.line = {transferPending: true, dispatchPending: false,
      counters: run.resolved.materials.map(material => ({materialId: material.id, produced: 0, consumed: 0, sold: 0, soldCost: 0n, scrapped: 0, scrapCost: 0n})), transfers: []};
    const handlers = createLineHandlers(run);
    this.scheduler = new EventScheduler(run, state, handlers);
    scheduleInitialSources(this.scheduler, run);
    this.scheduler.schedule({kind: 'transfer', id: WAKE, producerId: WAKE, timeMs: 0});
    const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
    const boundary = calendar.intervals[0]![1];
    this.scheduler.schedule({kind: 'calendar', boundary: 'close', stationId: null, id: '@calendar', timeMs: boundary});
  }
  getSnapshot(): DeepReadonly<Snapshot> { return this.terminal ?? this.scheduler.getSnapshot(); }
  nextEventTime(): number | null { return this.terminal ? null : this.scheduler.nextEventTime(); }
  private markTerminal(termination: 'stopped' | 'error'): DeepReadonly<Snapshot> {
    const snapshot = this.scheduler.getSnapshot();
    this.terminal = freezeData({...snapshot, line: {...snapshot.line!, termination}});
    return this.terminal;
  }
  step(): StepResult | null {
    if (this.terminal) return null;
    try {return this.scheduler.step();} catch (error) {this.failure = {error}; this.markTerminal('error'); throw error;}
  }
  advanceTo(timeMs: number): DeepReadonly<Snapshot> {
    if (this.terminal) return this.terminal;
    try {return this.scheduler.advanceTo(timeMs);} catch (error) {this.failure = {error}; this.markTerminal('error'); throw error;}
  }
  runToEnd(): DeepReadonly<Snapshot> { return this.advanceTo(this.run.resolved.durationMs); }
  stop(): DeepReadonly<Snapshot> {
    if (this.getSnapshot().line!.termination === 'horizon') return this.getSnapshot();
    return this.terminal ?? this.markTerminal('stopped');
  }
  getFailure(): unknown { return this.failure?.error ?? this.scheduler.getFailure(); }
}
