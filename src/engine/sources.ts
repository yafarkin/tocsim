import { addMoney, addQuantity, MAX_UNITS, purchaseCost, splitCost } from './arithmetic';
import { calendarForDuration, sourceAttemptTime } from './calendar';
import { inputCapacity } from './config';
import type { RunConfig } from './config';
import { EventError, EventScheduler } from './events';
import type { EventContext, EventHandlers } from './events';
import { createInventory, receiveStock, transferStock } from './inventory';
import type { EngineState } from './state';

const BATCH_ID = '@sources';
type Source = RunConfig['resolved']['sources'][number];
type Station = RunConfig['resolved']['stations'][number];
function fail(id: string, ru: string, en: string): never { throw new EventError('value', id, {ru, en}); }
function inputQuantity(state: EngineState, station: string, material: string): bigint {
  return state.stocks.filter(s => s.ownerId === station && s.location === 'input' && s.materialId === material)
    .reduce((sum, s) => sum + BigInt(s.quantity), 0n);
}
function freeSpace(state: EngineState, station: Station, material: string): number {
  const capacity = inputCapacity(station, material);
  const limit = capacity.kind === 'infinite' ? MAX_UNITS : BigInt(capacity.quantity);
  return Number(limit - inputQuantity(state, station.id, material));
}
function warehouseQuantity(state: EngineState, material: string): number {
  return Number(state.stocks.filter(s => s.location === 'warehouse' && s.materialId === material)
    .reduce((sum, s) => sum + BigInt(s.quantity), 0n));
}

export function createPushState(run: RunConfig): EngineState {
  return {...createInventory(run), timeMs: 0,
    stations: run.resolved.stations.map(station => ({stationId: station.id, planIndex: 0, completedBatches: 0, operationVersion: 0, operationOrdinal: 0, operationDurationMs: null, transferReady: false,
      status: 'idle', reason: 'notStarted', remainingProcessingMs: null})),
    sources: run.resolved.sources.map(source => ({sourceId: source.id, nextOrdinal: 0, pendingQuantity: 0,
      attempts: 0, releasedQuantity: 0, purchasedCost: 0n, lastAttempt: null})), sourceTransfers: [], line: null};
}

/** Fixed source/transfer phases, reusable by the full station cycle in task 16. */
export function createPushHandlers(run: RunConfig): Required<Pick<EventHandlers, 'source' | 'transfer' | 'integrate'>> {
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  function recipients(source: Source): Station[] {
    return run.resolved.routes.filter(r => r.fromId === source.id).map(route => run.resolved.stations.find(s => s.id === route.toId)!);
  }
  function release(ctx: EventContext) {
    const {state} = ctx;
    const due = run.resolved.sources.filter(source => state.sources.find(s => s.sourceId === source.id)!.pendingQuantity > 0);
    const candidates = due.flatMap(source => recipients(source).map(station => ({source, station})));
    // Across simultaneous attempts, receiver priority precedes source ID.
    candidates.sort((a, b) => b.station.priority - a.station.priority
      || (a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0)
      || (a.station.id < b.station.id ? -1 : a.station.id > b.station.id ? 1 : 0));
    // Plan all simultaneous admissions before valuing purchases. One source attempt
    // creates one rounded purchase, then distributes that value with remainder.
    const budgets = new Map(due.map(s => [s.id, s.quantity]));
    const spaces = new Map<string, number>();
    const warehouses = new Map<string, number>();
    const allocations: {source: Source; station: Station; quantity: number}[] = [];
    for (const {source, station} of candidates) {
      const key = JSON.stringify([station.id, source.materialId]);
      const free = spaces.get(key) ?? freeSpace(state, station, source.materialId);
      const stock = source.availability === 'warehouse' ? (warehouses.get(source.materialId) ?? warehouseQuantity(state, source.materialId)) : budgets.get(source.id)!;
      const quantity = Math.min(budgets.get(source.id)!, stock, free);
      if (quantity <= 0) continue;
      allocations.push({source, station, quantity});
      budgets.set(source.id, budgets.get(source.id)! - quantity);
      spaces.set(key, free - quantity);
      if (source.availability === 'warehouse') warehouses.set(source.materialId, stock - quantity);
    }
    const purchaseRemainders = new Map<string, {quantity: number; cost: bigint}>();
    for (const source of due.filter(s => s.availability === 'virtual')) {
      const quantity = source.quantity - budgets.get(source.id)!;
      const material = run.resolved.materials.find(m => m.id === source.materialId)!;
      purchaseRemainders.set(source.id, {quantity, cost: purchaseCost(material.purchasePrice!, quantity)});
    }
    for (const {source, station, quantity} of allocations) {
      const runtime = state.sources.find(s => s.sourceId === source.id)!;
      const target = {ownerId: station.id, location: 'input'} as const;
      let cost: bigint;
      if (source.availability === 'warehouse') {
        const portions = transferStock(state, {ownerId: 'warehouse', location: 'warehouse'}, target,
          source.materialId, quantity, inputCapacity(station, source.materialId), ctx.timeMs);
        cost = portions.reduce((sum, stock) => addMoney(sum, stock.cost), 0n);
      } else {
        const remainder = purchaseRemainders.get(source.id)!;
        const split = splitCost(remainder.cost, remainder.quantity, quantity);
        cost = split.takenCost; remainder.cost = split.remainingCost; remainder.quantity -= quantity;
        receiveStock(state, target, {materialId: source.materialId, quantity, cost, readyAtMs: ctx.timeMs,
          provenance: {origin: {kind: 'known', startedAtMs: ctx.timeMs}, defective: false, defectSourceIds: [], processingMs: {}}}, inputCapacity(station, source.materialId));
        runtime.purchasedCost = addMoney(runtime.purchasedCost, cost);
      }
      runtime.pendingQuantity -= quantity;
      runtime.releasedQuantity = addQuantity(runtime.releasedQuantity, quantity);
      runtime.lastAttempt!.releasedQuantity = addQuantity(runtime.lastAttempt!.releasedQuantity, quantity);
      state.sourceTransfers.push({timeMs: ctx.timeMs, sourceId: source.id, stationId: station.id,
        materialId: source.materialId, quantity, cost});
    }
    for (const source of due) {
      const runtime = state.sources.find(s => s.sourceId === source.id)!;
      if (runtime.pendingQuantity > 0) {
        if (source.availability === 'warehouse' && warehouseQuantity(state, source.materialId) === 0) runtime.lastAttempt!.blockedBy.push('stock');
        if (recipients(source).every(station => freeSpace(state, station, source.materialId) === 0)) runtime.lastAttempt!.blockedBy.push('capacity');
      }
      // Push attempts have no debt. Only the next scheduled attempt can release again.
      runtime.pendingQuantity = 0;
    }
  }
  return {
    integrate: state => {state.sourceTransfers = [];},
    source: (ctx, event) => {
      const source = run.resolved.sources.find(source => source.id === event.sourceId);
      const runtime = ctx.state.sources.find(source => source.sourceId === event.sourceId);
      if (!source || !runtime) fail(event.sourceId, 'Источник события не найден.', 'Event source was not found.');
      if (sourceAttemptTime(calendar, runtime.nextOrdinal, source.intervalMs) !== ctx.timeMs || runtime.pendingQuantity !== 0) fail(source.id, 'Попытка источника не соответствует рабочему расписанию.', 'Source attempt does not match its work-time schedule.');
      const pending = ctx.state.sources.some(s => s.pendingQuantity > 0);
      runtime.pendingQuantity = source.quantity;
      runtime.attempts = addQuantity(runtime.attempts, 1);
      runtime.lastAttempt = {timeMs: ctx.timeMs, requestedQuantity: source.quantity, releasedQuantity: 0, blockedBy: []};
      runtime.nextOrdinal = addQuantity(runtime.nextOrdinal, 1);
      const next = sourceAttemptTime(calendar, runtime.nextOrdinal, source.intervalMs);
      if (next !== null && (source.availability === 'virtual' || warehouseQuantity(ctx.state, source.materialId) > 0)) ctx.schedule({kind: 'source', sourceId: source.id, id: `source:${source.id}:${runtime.nextOrdinal}`, timeMs: next});
      if (!pending) ctx.schedule({kind: 'transfer', producerId: BATCH_ID, id: BATCH_ID, timeMs: ctx.timeMs});
    },
    transfer: (ctx, event) => {
      if (event.producerId !== BATCH_ID) fail(event.producerId, 'Обработчик push принимает только допуск сырья.', 'Push handler accepts only raw material admission.');
      release(ctx);
    },
  };
}
export function scheduleInitialSources(scheduler: EventScheduler, run: RunConfig): void {
  for (const source of run.resolved.sources) scheduler.schedule({kind: 'source', sourceId: source.id, id: `source:${source.id}:0`, timeMs: 0});
}
/** Source-only integration; station processing is deliberately not simulated yet. */
export function createPushScheduler(run: RunConfig): EventScheduler {
  const scheduler = new EventScheduler(run, createPushState(run), createPushHandlers(run));
  scheduleInitialSources(scheduler, run);
  return scheduler;
}
