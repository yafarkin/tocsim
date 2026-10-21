import { addMoney, ArithmeticError, MAX_UNITS, splitCost } from './arithmetic';
import type { DeepReadonly, ResolvedBuffer, RunConfig } from './config';
import type { InventoryState, Provenance, StockState } from './state';

export type StockAddress = Pick<StockState, 'ownerId' | 'location'>;
export interface MaterialAmount { materialId: string; quantity: number }
export interface StockReceipt extends MaterialAmount { cost: bigint; provenance: Provenance; readyAtMs?: number }
type InventoryErrorCode = 'value' | 'range' | 'shortage' | 'capacity' | 'reservation';
export class InventoryError extends Error {
  constructor(
    public readonly code: InventoryErrorCode,
    public readonly objectId: string,
    public readonly messages: {ru: string; en: string},
  ) { super(`${objectId}: ${messages.en}`); this.name = 'InventoryError'; }
}
function fail(code: InventoryErrorCode, id: string, ru: string, en: string): never {
  throw new InventoryError(code, id, {ru, en});
}
function quantity(value: number, id: string, positive = true) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    fail('value', id, 'Количество должно быть целым числом микроединиц в допустимом диапазоне.', 'Quantity must be integer micro-units within range.');
  }
}
function amount(value: bigint, id: string) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_UNITS) {
    fail('range', id, 'Стоимость или приписанное время вне допустимого диапазона.', 'Cost or attributed time is outside the supported range.');
  }
}
function address(value: StockAddress) {
  if (!value.ownerId || !['warehouse', 'input', 'output', 'held', 'reserved'].includes(value.location)
    || (value.location === 'warehouse') !== (value.ownerId === 'warehouse')) {
    fail('value', value.ownerId, 'Некорректный владелец или место хранения.', 'Invalid stock owner or location.');
  }
}
function same(stock: StockAddress, location: StockAddress) {
  return stock.ownerId === location.ownerId && stock.location === location.location;
}
function copyProvenance(value: Provenance): Provenance {
  return {origin: {...value.origin}, defective: value.defective,
    defectSourceIds: [...value.defectSourceIds], processingMs: {...value.processingMs}};
}
function checkProvenance(stock: StockState) {
  const {provenance: p, id} = stock;
  if (!['unreleased', 'known', 'unknown'].includes(p.origin.kind)
    || (p.origin.kind === 'known' && (!Number.isSafeInteger(p.origin.startedAtMs) || p.origin.startedAtMs < 0))
    || (p.origin.kind === 'unreleased' && stock.location !== 'warehouse')
    || typeof p.defective !== 'boolean' || (!p.defective && p.defectSourceIds.length > 0)
    || p.defectSourceIds.some(id => typeof id !== 'string' || !id)
    || new Set(p.defectSourceIds).size !== p.defectSourceIds.length) {
    fail('value', id, 'Некорректные признаки происхождения запаса.', 'Invalid stock provenance.');
  }
  for (const [stationId, time] of Object.entries(p.processingMs)) {
    if (!stationId) fail('value', id, 'У приписанного времени должен быть ID поста.', 'Attributed time requires a station ID.');
    amount(time, id);
  }
}

/** Validate aggregate bounds too: individually valid lots may overflow a buffer total. */
function validate(state: InventoryState) {
  quantity(state.nextStockOrdinal, 'inventory', false);
  const ids = new Set<string>();
  const totals = new Map<string, bigint>();
  const timeTotals = new Map<string, bigint>();
  let cost = 0n;
  for (const stock of state.stocks) {
    if (!stock.id || ids.has(stock.id) || !stock.materialId) fail('value', stock.id, 'ID запаса должен быть уникальным, материал задан.', 'Stock ID must be unique and material must be specified.');
    ids.add(stock.id); address(stock); quantity(stock.quantity, stock.id); quantity(stock.readyAtMs, stock.id, false); amount(stock.cost, stock.id); checkProvenance(stock);
    const key = JSON.stringify([stock.ownerId, stock.location, stock.materialId]);
    const total = (totals.get(key) ?? 0n) + BigInt(stock.quantity);
    if (total > MAX_UNITS) fail('range', stock.ownerId, 'Суммарное количество превышает диапазон.', 'Aggregate quantity exceeds range.');
    totals.set(key, total);
    cost += stock.cost;
    if (cost > MAX_UNITS) fail('range', 'inventory', 'Суммарная стоимость превышает диапазон.', 'Aggregate cost exceeds range.');
    for (const [station, time] of Object.entries(stock.provenance.processingMs)) {
      const totalTime = (timeTotals.get(station) ?? 0n) + time;
      amount(totalTime, station); timeTotals.set(station, totalTime);
    }
  }
}

/** Work on a detached draft. A failed operation never changes stocks or ID counters. */
function transaction<T>(state: InventoryState, work: (draft: InventoryState) => T): T {
  validate(state);
  const draft: InventoryState = {nextStockOrdinal: state.nextStockOrdinal,
    stocks: state.stocks.map(stock => ({...stock, provenance: copyProvenance(stock.provenance)}))};
  try {
    const result = work(draft);
    validate(draft);
    const detached = structuredClone(result);
    state.stocks = draft.stocks;
    state.nextStockOrdinal = draft.nextStockOrdinal;
    // Do not expose mutable references to the committed inventory.
    return detached;
  } catch (error) {
    if (error instanceof ArithmeticError) fail('range', 'inventory', 'Результат учётной операции превышает диапазон.', 'Accounting operation result exceeds range.');
    throw error;
  }
}
function newId(state: InventoryState): string {
  let id: string;
  do {
    if (state.nextStockOrdinal === Number.MAX_SAFE_INTEGER) fail('range', 'inventory', 'Исчерпан диапазон ID запаса.', 'Stock ID range is exhausted.');
    id = `lot:${state.nextStockOrdinal++}`;
  } while (state.stocks.some(stock => stock.id === id));
  return id;
}
function totalAt(state: InventoryState, at: StockAddress, materialId: string): bigint {
  return state.stocks.filter(stock => same(stock, at) && stock.materialId === materialId)
    .reduce((sum, stock) => sum + BigInt(stock.quantity), 0n);
}
function checkCapacity(state: InventoryState, at: StockAddress, materialId: string, incoming: number, capacity: DeepReadonly<ResolvedBuffer>) {
  if (capacity.kind !== 'quantity' && capacity.kind !== 'infinite') fail('value', at.ownerId, 'Неизвестный тип ёмкости.', 'Unknown capacity kind.');
  if (capacity.kind === 'quantity') quantity(capacity.quantity, at.ownerId, false);
  const total = totalAt(state, at, materialId) + BigInt(incoming);
  if (total > MAX_UNITS) fail('range', at.ownerId, 'Суммарное количество превышает диапазон.', 'Aggregate quantity exceeds range.');
  if (capacity.kind === 'quantity' && total > BigInt(capacity.quantity)) fail('capacity', at.ownerId, 'В месте назначения недостаточно свободной ёмкости.', 'Destination does not have enough free capacity.');
}
function takeFIFO(state: InventoryState, at: StockAddress, materialId: string, requested: number): StockState[] {
  quantity(requested, materialId);
  if (totalAt(state, at, materialId) < BigInt(requested)) fail('shortage', at.ownerId, `Недостаточно материала ${materialId}.`, `Not enough material ${materialId}.`);
  const taken: StockState[] = [];
  let remaining = requested;
  for (const stock of [...state.stocks]) {
    if (remaining === 0) break;
    if (!same(stock, at) || stock.materialId !== materialId) continue;
    const count = Math.min(remaining, stock.quantity);
    if (count === stock.quantity) {
      state.stocks.splice(state.stocks.indexOf(stock), 1);
      taken.push(stock);
    } else {
      const portion = {...stock, id: newId(state), quantity: count, provenance: copyProvenance(stock.provenance)};
      const costs = splitCost(stock.cost, stock.quantity, count);
      portion.cost = costs.takenCost; stock.cost = costs.remainingCost;
      for (const [station, time] of Object.entries(stock.provenance.processingMs)) {
        const shares = splitCost(time, stock.quantity, count);
        portion.provenance.processingMs[station] = shares.takenCost;
        stock.provenance.processingMs[station] = shares.remainingCost;
      }
      stock.quantity -= count;
      taken.push(portion);
    }
    remaining -= count;
  }
  return taken;
}

/** Initial buffer WIP has unknown age; raw warehouse stock is not released yet. */
export function createInventory(run: RunConfig): InventoryState {
  const state: InventoryState = {nextStockOrdinal: 0, stocks: run.resolved.initialStocks.map(stock => ({...stock, readyAtMs: 0,
    provenance: {origin: stock.location === 'warehouse' ? {kind: 'unreleased'} : {kind: 'unknown'},
      defective: false, defectSourceIds: [], processingMs: {}}}))};
  validate(state);
  return state;
}

/** Admission of an already valued lot, not purchasing, scheduling or random defect generation. */
export function receiveStock(state: InventoryState, at: StockAddress, receipt: StockReceipt, capacity: DeepReadonly<ResolvedBuffer>): StockState {
  return transaction(state, draft => {
    address(at);
    if (at.location === 'reserved') fail('reservation', at.ownerId, 'Резерв создаётся только из входного запаса.', 'Reservations can only be created from input stock.');
    quantity(receipt.quantity, receipt.materialId);
    if (!receipt.materialId) fail('value', at.ownerId, 'Не задан материал.', 'Material is not specified.');
    checkCapacity(draft, at, receipt.materialId, receipt.quantity, capacity);
    const stock = {id: newId(draft), ...at, ...receipt, readyAtMs: receipt.readyAtMs ?? 0, provenance: copyProvenance(receipt.provenance)};
    draft.stocks.push(stock);
    return stock;
  });
}

/** Arrivals append to the destination FIFO; the origin age is not the arrival order. */
export function transferStock(state: InventoryState, from: StockAddress, to: StockAddress, materialId: string, requested: number,
  capacity: DeepReadonly<ResolvedBuffer>, timeMs: number): StockState[] {
  return transaction(state, draft => {
    address(from); address(to); quantity(requested, materialId); quantity(timeMs, to.ownerId, false);
    if (same(from, to) || from.location === 'reserved' || to.location === 'reserved') fail('reservation', to.ownerId, 'Резервирование и завершение выполняются отдельными операциями; перенос в то же место запрещён.', 'Use reservation and completion operations for reserved stock; a transfer to the same location is not allowed.');
    checkCapacity(draft, to, materialId, requested, capacity);
    const moved = takeFIFO(draft, from, materialId, requested);
    for (const stock of moved) {
      if (!(from.ownerId === to.ownerId && from.location === 'held' && to.location === 'output')) stock.readyAtMs = timeMs;
      stock.ownerId = to.ownerId; stock.location = to.location;
      if (stock.provenance.origin.kind === 'unreleased' && to.location !== 'warehouse') stock.provenance.origin = {kind: 'known', startedAtMs: timeMs};
      if (stock.provenance.origin.kind === 'known' && stock.provenance.origin.startedAtMs > timeMs) fail('value', stock.id, 'Перенос не может предшествовать запуску материала.', 'Transfer cannot precede material release.');
      draft.stocks.push(stock);
    }
    return moved;
  });
}

/** Remove stock once and return detached valued portions to the caller. No financial metrics here. */
export function consumeStock(state: InventoryState, from: StockAddress, materialId: string, requested: number): StockState[] {
  return transaction(state, draft => {
    address(from);
    if (from.location === 'reserved') fail('reservation', from.ownerId, 'Зарезервированные входы потребляются только при выпуске.', 'Reserved inputs are consumed only by production completion.');
    return takeFIFO(draft, from, materialId, requested);
  });
}

/** Atomically reserve a complete batch kit from the input. */
export function reserveInputs(state: InventoryState, stationId: string, inputs: readonly MaterialAmount[]): StockState[] {
  return transaction(state, draft => {
    const at: StockAddress = {ownerId: stationId, location: 'input'}; address(at);
    if (inputs.length === 0 || new Set(inputs.map(input => input.materialId)).size !== inputs.length) fail('value', stationId, 'Нужен непустой комплект с уникальными материалами.', 'A nonempty kit with unique materials is required.');
    if (draft.stocks.some(stock => stock.ownerId === stationId && (stock.location === 'reserved' || stock.location === 'held'))) fail('reservation', stationId, 'На посту уже есть резерв или невыгруженный результат.', 'Station already has reserved inputs or a held result.');
    const reserved: StockState[] = [];
    for (const input of inputs) {
      const parts = takeFIFO(draft, at, input.materialId, input.quantity);
      for (const part of parts) { part.location = 'reserved'; draft.stocks.push(part); reserved.push(part); }
    }
    return reserved;
  });
}

/** Consume a reserved kit (or the entire reservation) and create its output lot. */
export function completeProduction(state: InventoryState, stationId: string, output: MaterialAmount, actualProcessingMs: number, readyAtMs = 0, kit?: readonly MaterialAmount[]): StockState {
  return transaction(state, draft => {
    address({ownerId: stationId, location: 'held'});
    quantity(output.quantity, output.materialId); quantity(actualProcessingMs, stationId); quantity(readyAtMs, stationId, false);
    if (!output.materialId || output.quantity % 1_000_000 !== 0) fail('value', stationId, 'Производственный выход должен быть целым положительным числом изделий.', 'Production output must be a positive whole number of items.');
    if (kit && (kit.length === 0 || new Set(kit.map(input => input.materialId)).size !== kit.length)) fail('value', stationId, 'Нужен уникальный непустой комплект.', 'A unique nonempty kit is required.');
    const inputs = kit ? kit.flatMap(input => takeFIFO(draft, {ownerId: stationId, location: 'reserved'}, input.materialId, input.quantity))
      : draft.stocks.filter(stock => stock.ownerId === stationId && stock.location === 'reserved');
    if (inputs.length === 0 || draft.stocks.some(stock => stock.ownerId === stationId && stock.location === 'held')) fail('reservation', stationId, 'Нет единственного готового к завершению резерва.', 'There is no single reservation ready for completion.');
    let cost = 0n;
    const provenance: Provenance = {origin: {kind: 'unreleased'}, defective: false, defectSourceIds: [], processingMs: {}};
    const times = new Map<string, bigint>();
    const defects = new Set<string>();
    for (const stock of inputs) {
      cost = addMoney(cost, stock.cost);
      const p = stock.provenance;
      if (p.origin.kind === 'unreleased') fail('value', stock.id, 'В производстве не может быть незапущенного сырья.', 'Unreleased raw material cannot be in production.');
      if (p.origin.kind === 'unknown') provenance.origin = {kind: 'unknown'};
      else if (provenance.origin.kind !== 'unknown' && (provenance.origin.kind === 'unreleased' || provenance.origin.startedAtMs > p.origin.startedAtMs)) provenance.origin = {...p.origin};
      provenance.defective ||= p.defective;
      p.defectSourceIds.forEach(id => defects.add(id));
      for (const [station, time] of Object.entries(p.processingMs)) times.set(station, addMoney(times.get(station) ?? 0n, time));
    }
    times.set(stationId, addMoney(times.get(stationId) ?? 0n, BigInt(actualProcessingMs)));
    provenance.processingMs = Object.fromEntries([...times.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    provenance.defectSourceIds = [...defects].sort();
    const result: StockState = {id: newId(draft), ownerId: stationId, location: 'held', materialId: output.materialId, quantity: output.quantity, cost, readyAtMs, provenance};
    draft.stocks = draft.stocks.filter(stock => !inputs.includes(stock));
    draft.stocks.push(result);
    return result;
  });
}
