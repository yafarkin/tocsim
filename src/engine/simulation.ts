import { addMoney, addQuantity, lunchCost, MAX_UNITS } from './arithmetic';
import { elapsedTime, calendarForDuration, canStart, DAY_MS } from './calendar';
import { freezeData, inputCapacity, outputCapacity } from './config';
import type { DeepReadonly, RunConfig, ResolvedBuffer } from './config';
import { EventError, EventScheduler } from './events';
import type { EventContext, EventHandlers, StepResult } from './events';
import { setupDurationMs } from './setup';
import { processingDuration, RandomError } from './random';
import { completeInspection, completeProductionBatch, consumeStock, reserveInputs, transferStock } from './inventory';
import { createPushHandlers, createPushState, scheduleInitialSources } from './sources';
import { integrateStockTime } from './stock-time';
import type { EngineState, Snapshot, StockState, StationState } from './state';

const WAKE = '@line';
type Station = RunConfig['resolved']['stations'][number];
function count(state: EngineState, owner: string, location: StockState['location'], materialId: string): number {
  return state.stocks.filter(s => s.ownerId === owner && s.location === location && s.materialId === materialId).reduce((sum, s) => sum + s.quantity, 0);
}
function free(capacity: DeepReadonly<ResolvedBuffer>, occupied: number): number {
  return Number((capacity.kind === 'infinite' ? MAX_UNITS : BigInt(capacity.quantity)) - BigInt(occupied));
}
function createLineHandlers(run: RunConfig): EventHandlers {
  const push = createPushHandlers(run), calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const calendars = new Map(run.resolved.stations.map(s => [s.id, calendarForDuration(run.resolved.calendar, run.resolved.durationMs, s.lunchReplacement)]));
  const stationCalendar = (id: string) => calendars.get(id)!;
  const firstId = run.resolved.stations[0]!.id;
  const stations = [...run.resolved.stations].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rowOf = (state: EngineState, config: Station) => config.plan[state.stations.find(s => s.stationId === config.id)!.planIndex]!;
  const recipeOf = (state: EngineState, config: Station) => run.resolved.recipes.find(r => r.id === rowOf(state, config).recipeId)!;
  const hasStock = (state: EngineState, id: string, location: StockState['location']) => state.stocks.some(stock => stock.ownerId === id && stock.location === location);
  function wakeTransfer(ctx: EventContext) {
    if (!ctx.state.line!.transferPending) {
      ctx.state.line!.transferPending = true;
      ctx.schedule({kind: 'transfer', producerId: WAKE, id: WAKE, timeMs: ctx.timeMs});
    }
  }
  function wakeDispatch(ctx: EventContext) {
    if (stations.some(s => canStart(stationCalendar(s.id), ctx.timeMs)) && !ctx.state.line!.dispatchPending) {
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
      if (!canStart(stationCalendar(config.id), ctx.timeMs)) {station.status = 'paused'; station.reason = calendarReason(ctx.timeMs);}
      else if (station.remainingSetupMs !== null || station.remainingMaintenanceMs !== null) continue;
      else if (station.remainingProcessingMs === null) {
        const recipe = recipeOf(ctx.state, config);
        if (station.transferReady && hasStock(ctx.state, config.id, 'held')) {station.status = 'blocked'; station.reason = 'output';}
        else if (!ctx.state.stocks.some(stock => stock.ownerId === config.id && stock.location === 'reserved') && recipe.inputs.some(input => count(ctx.state, config.id, 'input', input.materialId) < input.quantity * rowOf(ctx.state, config).repetitions)) {station.status = 'starved'; station.reason = 'input';}
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
    const due = BigInt(ctx.timeMs) + BigInt(station.remainingMaintenanceMs ?? station.remainingSetupMs ?? station.remainingProcessingMs!);
    // A calendar close invalidates this provisional completion. No work beyond horizon.
    if (due <= BigInt(calendar.endTimeMs)) ctx.schedule({kind: 'completion', stationId: id,
      operationVersion: station.operationVersion, id: `completion:${id}:${station.operationVersion}`, timeMs: Number(due)});
    const config = stations.find(s => s.id === id)!;
    if (station.remainingProcessingMs !== null && station.maintenanceDueAtMs === null && config.maintenance.enabled && config.maintenance.processingThresholdMs !== null) {
      const remaining = config.maintenance.processingThresholdMs - station.maintenanceProcessingMs;
      const thresholdAt = BigInt(ctx.timeMs) + BigInt(remaining);
      // Equality is handled by processing completion, including both thresholds.
      if (remaining > 0 && remaining < station.remainingProcessingMs && thresholdAt <= BigInt(calendar.endTimeMs)) {
        ctx.schedule({kind: 'maintenanceDue', stationId: id, operationVersion: station.operationVersion,
          id: `maintenance-due:${id}:${station.operationVersion}`, timeMs: Number(thresholdAt)});
      }
    }
  }
  function markMaintenanceDue(ctx: EventContext, station: StationState, config: Station) {
    if (!config.maintenance.enabled) return;
    if (station.maintenanceDueAtMs !== null && station.maintenanceDueAtMs !== ctx.timeMs) return;
    const triggers: StationState['maintenanceDueBy'] = [];
    if (config.maintenance.processingThresholdMs !== null && station.maintenanceProcessingMs >= config.maintenance.processingThresholdMs) triggers.push('processingTime');
    if (config.maintenance.repetitionsThreshold !== null && station.maintenanceRepetitions >= config.maintenance.repetitionsThreshold) triggers.push('repetitions');
    if (triggers.length) {station.maintenanceDueAtMs = ctx.timeMs; station.maintenanceDueBy = triggers;}
  }
  function addMaintenanceCounter(value: number, increment: number, stationId: string): number {
    const total = BigInt(value) + BigInt(increment);
    if (total > MAX_UNITS) throw new EventError('value', stationId, {ru: 'Счётчик обслуживания превысил безопасный диапазон.', en: 'Maintenance counter exceeded the safe range.'});
    return Number(total);
  }
  function recordScrap(state: EngineState, detectedAtId: string, part: StockState) {
    const counter = state.line!.counters.find(c => c.materialId === part.materialId)!;
    counter.scrapped = addQuantity(counter.scrapped, part.quantity); counter.scrapCost = addMoney(counter.scrapCost, part.cost);
    const ids = [...part.provenance.defectSourceIds].sort();
    let summary = state.line!.scraps.find(s => s.detectedAtId === detectedAtId && s.materialId === part.materialId && JSON.stringify(s.defectSourceIds) === JSON.stringify(ids));
    if (!summary) {
      summary = {detectedAtId, materialId: part.materialId, defectSourceIds: ids, quantity: 0, cost: 0n, processingMs: {}};
      state.line!.scraps.push(summary);
    }
    summary.quantity = addQuantity(summary.quantity, part.quantity); summary.cost = addMoney(summary.cost, part.cost);
    const times = new Map(Object.entries(summary.processingMs));
    for (const [id, time] of Object.entries(part.provenance.processingMs)) times.set(id, addMoney(times.get(id) ?? 0n, time));
    summary.processingMs = Object.fromEntries(times);
  }
  function deliver(ctx: EventContext, config: Station, location: 'held' | 'output', materialId: string, limit: number): boolean {
    let available = Math.min(limit, count(ctx.state, config.id, location, materialId));
    if (available === 0) return false;
    const routes = run.resolved.routes.filter(r => r.fromId === config.id && r.materialId === materialId);
    const from = {ownerId: config.id, location};
    if (routes.some(route => route.toId === 'market')) {
      const portions = consumeStock(ctx.state, from, materialId, available);
      const counter = ctx.state.line!.counters.find(c => c.materialId === materialId)!;
      for (const part of portions) {
        if (part.provenance.defective) recordScrap(ctx.state, 'market', part);
        else {
          counter.sold = addQuantity(counter.sold, part.quantity); counter.soldCost = addMoney(counter.soldCost, part.cost);
          // Include the closing boundary in its shift, even when it is exactly 24:00.
          const span = run.resolved.calendar.shiftEndMs - run.resolved.calendar.shiftStartMs;
          const dayIndex = ctx.timeMs <= span ? 0 : Number((BigInt(ctx.timeMs) - BigInt(span) + BigInt(DAY_MS) - 1n) / BigInt(DAY_MS));
          let daily = ctx.state.line!.shiftOutput.find(row => row.dayIndex === dayIndex && row.materialId === materialId);
          if (!daily) {daily = {dayIndex, materialId, quantity: 0}; ctx.state.line!.shiftOutput.push(daily);}
          daily.quantity = addQuantity(daily.quantity, part.quantity);
        }
        ctx.state.line!.transfers.push({fromId: config.id, toId: 'market', fromLocation: location,
          materialId: part.materialId, quantity: part.quantity, cost: part.cost, kind: part.provenance.defective ? 'scrap' : 'sale'});
      }
      return true;
    }
    let movedAny = false;
    for (const target of stations.filter(station => routes.some(route => route.toId === station.id))) {
      const quantity = Math.min(available, free(inputCapacity(target, materialId), count(ctx.state, target.id, 'input', materialId)));
      if (quantity <= 0) continue;
      const moved = transferStock(ctx.state, from, {ownerId: target.id, location: 'input'}, materialId, quantity, inputCapacity(target, materialId), ctx.timeMs);
      ctx.state.line!.transfers.push({fromId: config.id, toId: target.id, fromLocation: location, materialId,
        quantity, cost: moved.reduce((sum, s) => addMoney(sum, s.cost), 0n), kind: 'route'});
      available -= quantity; movedAny = true;
      if (available === 0) break;
    }
    return movedAny;
  }
  // Only each material buffer's FIFO head competes. Rebuild heads after each move so
  // no producer can drain newer lots ahead of older output from another.
  function distribute(ctx: EventContext): boolean {
    let movedAny = false;
    while (true) {
      const heads = new Map<string, StockState>();
      for (const stock of ctx.state.stocks) {
        const config = stations.find(s => s.id === stock.ownerId);
        if (!config || (stock.location !== 'output' && stock.location !== 'held')) continue;
        const capacity = outputCapacity(config, stock.materialId);
        if (stock.location === 'held' && !(ctx.state.stations.find(s => s.stationId === config.id)!.transferReady && capacity.kind === 'quantity' && capacity.quantity === 0)) continue;
        const key = JSON.stringify([stock.ownerId, stock.location, stock.materialId]);
        if (!heads.has(key)) heads.set(key, stock);
      }
      const candidates = [...heads.values()].sort((a, b) => a.readyAtMs - b.readyAtMs
        || (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const moved = candidates.some(stock => deliver(ctx, stations.find(s => s.id === stock.ownerId)!, stock.location as 'held' | 'output', stock.materialId, stock.quantity));
      if (!moved) break;
      movedAny = true;
    }
    return movedAny;
  }
  return {
    integrate: (state, from, to) => {
      push.integrate(state, from, to);
      state.line!.transfers = [];
      const interval = elapsedTime(calendar, from, to);
      integrateStockTime(state.stocks, state.line!.stockTime, interval);
      const commonElapsed = interval.workMs;
      for (const station of state.stations) {
        const config = stations.find(s => s.id === station.stationId)!;
        const elapsed = elapsedTime(stationCalendar(station.stationId), from, to).workMs;
        if (station.remainingProcessingMs !== null || station.remainingSetupMs !== null || station.remainingMaintenanceMs !== null) {
          station.lunchBusyMs = addMaintenanceCounter(station.lunchBusyMs, elapsed - commonElapsed, station.stationId);
          // Validate the accumulated charge within this atomic transition.
          lunchCost(config.costs.perLunchHour, station.lunchBusyMs);
        }
        if (station.maintenanceDueAtMs !== null && station.remainingMaintenanceMs === null && to > from) {
          const reasons = station.maintenanceDeferredBy;
          const addReason = (reason: typeof reasons[number]) => {if (!reasons.includes(reason)) reasons.push(reason);};
          if (elapsed > 0) {
            if (station.transferReady && hasStock(state, station.stationId, 'held')) addReason('output');
            else if (station.remainingProcessingMs !== null || hasStock(state, station.stationId, 'reserved')) addReason('batch');
          }
          if (to - from > elapsed) addReason('calendar');
        }
        if (station.remainingMaintenanceMs !== null) {
          station.remainingMaintenanceMs -= elapsed;
          if (station.remainingMaintenanceMs < 0) throw new EventError('value', station.stationId, {ru: 'Пропущено завершение обслуживания.', en: 'Maintenance completion was skipped.'});
        }
        if (station.remainingSetupMs !== null) {
          station.remainingSetupMs -= elapsed;
          if (station.remainingSetupMs < 0) throw new EventError('value', station.stationId, {ru: 'Пропущено завершение переналадки.', en: 'Setup completion was skipped.'});
        }
        if (station.remainingProcessingMs !== null) {
          if (stations.find(s => s.id === station.stationId)!.maintenance.enabled) station.maintenanceProcessingMs = addMaintenanceCounter(station.maintenanceProcessingMs, elapsed, station.stationId);
          station.remainingProcessingMs -= elapsed;
          if (station.remainingProcessingMs < 0) throw new EventError('value', station.stationId, {ru: 'Пропущено завершение обработки.', en: 'Processing completion was skipped.'});
        }
      }
    },
    source: push.source,
    maintenanceDue: (ctx, event) => {
      const station = ctx.state.stations.find(s => s.stationId === event.stationId)!;
      if (station.remainingProcessingMs !== null) markMaintenanceDue(ctx, station, stations.find(s => s.id === event.stationId)!);
    },
    calendar: (ctx, event) => {
      if (event.boundary === 'close') {
        const lunchClose = ctx.timeMs % DAY_MS === calendar.schedule.lunchStartMs - calendar.schedule.shiftStartMs;
        for (const station of ctx.state.stations) {
          if (lunchClose && stationCalendar(station.stationId).workDuringLunch) continue;
          if (station.remainingProcessingMs === null && station.remainingSetupMs === null && station.remainingMaintenanceMs === null) continue;
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
      if (station.remainingMaintenanceMs !== null) {
        if (station.remainingMaintenanceMs !== 0) throw new EventError('value', event.stationId, {ru: 'Обслуживание ещё не завершено.', en: 'Maintenance is not complete yet.'});
        station.lastMaintenance = {dueAtMs: station.maintenanceDueAtMs!, dueBy: [...station.maintenanceDueBy], deferredBy: [...station.maintenanceDeferredBy],
          startedAtMs: station.maintenanceStartedAtMs!, completedAtMs: ctx.timeMs,
          processingMs: station.maintenanceProcessingMs, repetitions: station.maintenanceRepetitions};
        station.maintenanceProcessingMs = 0; station.maintenanceRepetitions = 0;
        station.maintenanceDueAtMs = null; station.maintenanceDueBy = []; station.maintenanceDeferredBy = []; station.maintenanceStartedAtMs = null;
        station.remainingMaintenanceMs = null; station.operationDurationMs = null; station.status = 'idle'; station.reason = null;
        wakeTransfer(ctx); return;
      }
      if (station.remainingSetupMs !== null) {
        if (station.remainingSetupMs !== 0) throw new EventError('value', event.stationId, {ru: 'Переналадка ещё не завершена.', en: 'Setup is not complete yet.'});
        station.configuredRecipeId = station.targetRecipeId!;
        station.targetRecipeId = null; station.remainingSetupMs = null; station.operationDurationMs = null;
        station.status = 'idle'; station.reason = null;
        wakeTransfer(ctx);
        return;
      }
      if (station.remainingProcessingMs !== 0) throw new EventError('value', event.stationId, {ru: 'Операция ещё не завершена.', en: 'Operation is not complete yet.'});
      const config = stations.find(s => s.id === event.stationId)!, recipe = recipeOf(ctx.state, config);
      const row = rowOf(ctx.state, config);
      const multiplier = row.mode === 'simultaneous' ? row.repetitions : 1;
      if (config.maintenance.enabled) {
        station.maintenanceRepetitions = addMaintenanceCounter(station.maintenanceRepetitions, multiplier, station.stationId);
        markMaintenanceDue(ctx, station, config);
      }
      if (recipe.kind === 'inspection') {
        const result = completeInspection(ctx.state, config.id, recipe.output.materialId, station.operationDurationMs!, ctx.timeMs, multiplier);
        let counter = ctx.state.line!.inspections.find(c => c.stationId === config.id && c.materialId === recipe.output.materialId);
        if (!counter) {
          counter = {stationId: config.id, materialId: recipe.output.materialId, completedRepetitions: 0, checkedQuantity: 0, passedQuantity: 0, scrappedQuantity: 0, processingMs: 0n};
          ctx.state.line!.inspections.push(counter);
        }
        counter.completedRepetitions = addQuantity(counter.completedRepetitions, multiplier);
        counter.checkedQuantity = addQuantity(counter.checkedQuantity, multiplier * recipe.output.quantity);
        counter.processingMs = addMoney(counter.processingMs, BigInt(station.operationDurationMs!));
        counter.passedQuantity = addQuantity(counter.passedQuantity, result.passed.reduce((sum, part) => addQuantity(sum, part.quantity), 0));
        counter.scrappedQuantity = addQuantity(counter.scrappedQuantity, result.scrapped.reduce((sum, part) => addQuantity(sum, part.quantity), 0));
        for (const part of result.scrapped) {
          recordScrap(ctx.state, config.id, part);
          ctx.state.line!.transfers.push({fromId: config.id, toId: config.id, fromLocation: 'reserved', materialId: part.materialId, quantity: part.quantity, cost: part.cost, kind: 'scrap'});
        }
      } else {
        completeProductionBatch(ctx.state, config.id, recipe.output, station.operationDurationMs!, ctx.timeMs, recipe.inputs, multiplier, {probability: row.defectProbability ?? 0, seed: run.resolved.seed, recipeId: recipe.id, operationOrdinal: station.operationOrdinal - 1});
        for (const input of recipe.inputs) {
          const inputCounter = ctx.state.line!.counters.find(c => c.materialId === input.materialId)!;
          inputCounter.consumed = addQuantity(inputCounter.consumed, input.quantity * multiplier);
        }
        const outputCounter = ctx.state.line!.counters.find(c => c.materialId === recipe.output.materialId)!;
        outputCounter.produced = addQuantity(outputCounter.produced, recipe.output.quantity * multiplier);
      }
      const batchComplete = !hasStock(ctx.state, config.id, 'reserved');
      station.transferReady = count(ctx.state, config.id, 'held', recipe.output.materialId) >= config.transportThreshold
        || batchComplete;
      if (batchComplete) {
        station.completedBatches++;
        if (station.completedBatches === row.batches) {
          station.completedBatches = 0;
          station.planIndex = (station.planIndex + 1) % config.plan.length;
        }
      }
      station.remainingProcessingMs = null; station.operationDurationMs = null;
      wakeTransfer(ctx);
    },
    transfer: (ctx, event) => {
      if (event.producerId === '@sources') {push.transfer(ctx, event); wakeTransfer(ctx); return;}
      if (event.producerId !== WAKE) throw new EventError('value', event.id, {ru: 'Неизвестная передача линии.', en: 'Unknown line transfer.'});
      ctx.state.line!.transferPending = false;
      let moved = distribute(ctx);
      for (const config of stations) {
        for (const material of new Set(ctx.state.stocks.filter(stock => stock.ownerId === config.id && stock.location === 'held').map(stock => stock.materialId))) {
          const capacity = outputCapacity(config, material);
          if (ctx.state.stations.find(s => s.stationId === config.id)!.transferReady && !(capacity.kind === 'quantity' && capacity.quantity === 0)) {
            const quantity = Math.min(count(ctx.state, config.id, 'held', material), free(capacity, count(ctx.state, config.id, 'output', material)));
            if (quantity > 0) {
              const parts = transferStock(ctx.state, {ownerId: config.id, location: 'held'}, {ownerId: config.id, location: 'output'}, material, quantity, capacity, ctx.timeMs);
              ctx.state.line!.transfers.push({fromId: config.id, toId: config.id, fromLocation: 'held', materialId: material, quantity,
                cost: parts.reduce((sum, part) => addMoney(sum, part.cost), 0n), kind: 'buffer'});
              moved = true;
            }
          }
        }
      }
      for (const station of ctx.state.stations) {
        if (!ctx.state.stocks.some(stock => stock.ownerId === station.stationId && stock.location === 'held')) station.transferReady = false;
      }
      refresh(ctx);
      if (moved) wakeTransfer(ctx);
      wakeDispatch(ctx);
    },
    dispatch: ctx => {
      ctx.state.line!.dispatchPending = false;
      let started = false;
      for (const config of stations) {
        if (!canStart(stationCalendar(config.id), ctx.timeMs)) continue;
        const station = ctx.state.stations.find(s => s.stationId === config.id)!, recipe = recipeOf(ctx.state, config);
        if (station.remainingMaintenanceMs !== null) {
          if (station.status !== 'maintenance') {station.status = 'maintenance'; station.reason = null; planCompletion(ctx, config.id);}
          continue;
        }
        if (station.remainingSetupMs !== null) {
          if (station.status !== 'setup') {station.status = 'setup'; station.reason = null; planCompletion(ctx, config.id);}
          continue;
        }
        if (station.remainingProcessingMs !== null) {
          if (station.status !== 'processing') {station.status = 'processing'; station.reason = null; planCompletion(ctx, config.id);}
          continue;
        }
        if (station.transferReady && hasStock(ctx.state, config.id, 'held')) continue;
        const reserved = ctx.state.stocks.some(stock => stock.ownerId === config.id && stock.location === 'reserved');
        if (!reserved) {
          if (station.maintenanceDueAtMs !== null && config.maintenance.enabled) {
            if (hasStock(ctx.state, config.id, 'held')) continue;
            station.remainingMaintenanceMs = config.maintenance.durationMs;
            station.maintenanceStartedAtMs = ctx.timeMs; station.operationDurationMs = config.maintenance.durationMs;
            station.status = 'maintenance'; station.reason = null;
            ctx.invalidateOperation(config.id); planCompletion(ctx, config.id); started = true;
            continue;
          }
          const kit = recipe.inputs.map(input => ({...input, quantity: input.quantity * rowOf(ctx.state, config).repetitions}));
          if (kit.some(input => count(ctx.state, config.id, 'input', input.materialId) < input.quantity)) continue;
          const setupMs = setupDurationMs(config.setupMs, station.configuredRecipeId, recipe.id);
          if (setupMs > 0) {
            station.targetRecipeId = recipe.id; station.remainingSetupMs = setupMs; station.operationDurationMs = setupMs;
            station.status = 'setup'; station.reason = null;
            ctx.invalidateOperation(config.id); planCompletion(ctx, config.id);
            started = true;
            continue;
          }
          station.configuredRecipeId = recipe.id;
          reserveInputs(ctx.state, config.id, kit);
        }
        if (station.operationOrdinal === Number.MAX_SAFE_INTEGER) throw new RandomError({ru: 'Исчерпан счётчик операций.', en: 'Operation counter is exhausted.'});
        const row = rowOf(ctx.state, config);
        station.operationDurationMs = processingDuration(row.timeMs, row.cv, run.resolved.seed, config.id, row.recipeId, station.operationOrdinal++, row.distribution);
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
    state.line = {transferPending: true, dispatchPending: false, inspections: [], scraps: [], shiftOutput: [], stockTime: [],
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
