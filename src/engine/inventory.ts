import {defectOccurs} from './random';
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
  return {origin: {...value.origin}, firstProcessing: {...value.firstProcessing}, defective: value.defective,
    defectSourceIds: [...value.defectSourceIds], processingMs: {...value.processingMs}};
}
function checkProvenance(stock: StockState) {
  const {provenance: p, id} = stock;
  if (!['unreleased', 'known', 'unknown'].includes(p.origin.kind)
    || (p.origin.kind === 'known' && (!Number.isSafeInteger(p.origin.startedAtMs) || p.origin.startedAtMs < 0))
    || (p.origin.kind === 'unreleased' && stock.location !== 'warehouse')
    || !p.firstProcessing || !['notStarted', 'known', 'unknown'].includes(p.firstProcessing.kind)
    || (p.firstProcessing.kind === 'known' && (!Number.isSafeInteger(p.firstProcessing.startedAtMs) || p.firstProcessing.startedAtMs < 0
      || (p.origin.kind === 'known' && p.firstProcessing.startedAtMs < p.origin.startedAtMs)))
    || (p.origin.kind === 'unreleased' && p.firstProcessing.kind !== 'notStarted')
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
/** Take a prefix share, preserving the same cost/time remainders for starts and completions. */
function splitStock(state: InventoryState, stock: StockState, count: number): StockState {
  const portion = {...stock, id: newId(state), quantity: count, provenance: copyProvenance(stock.provenance)};
  const costs = splitCost(stock.cost, stock.quantity, count);
  portion.cost = costs.takenCost; stock.cost = costs.remainingCost;
  for (const [station, time] of Object.entries(stock.provenance.processingMs)) {
    const shares = splitCost(time, stock.quantity, count);
    portion.provenance.processingMs[station] = shares.takenCost;
    stock.provenance.processingMs[station] = shares.remainingCost;
  }
  stock.quantity -= count;
  return portion;
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
      taken.push(splitStock(state, stock, count));
    }
    remaining -= count;
  }
  return taken;
}

/** Initial buffer WIP has unknown age; raw warehouse stock is not released yet. */
export function createInventory(run: RunConfig): InventoryState {
  const state: InventoryState = {nextStockOrdinal: 0, stocks: run.resolved.initialStocks.map(stock => ({...stock, readyAtMs: 0,
    provenance: {origin: stock.location === 'warehouse' ? {kind: 'unreleased'} : {kind: 'unknown'},
      firstProcessing: stock.location === 'warehouse' ? {kind: 'notStarted'} : {kind: 'unknown'},
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
      if (stock.provenance.firstProcessing.kind === 'known' && stock.provenance.firstProcessing.startedAtMs > timeMs) fail('value', stock.id, 'Перенос не может предшествовать первой обработке.', 'Transfer cannot precede first processing.');
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

/** Mark only the FIFO kit actually starting now, not all future sequential repetitions.
 * Known ancestor starts and unknown pre-run history are retained. Setup/resume do not call this.
 */
export function startProcessingInputs(state: InventoryState, stationId: string, inputs: readonly MaterialAmount[], timeMs: number): void {
  transaction(state, draft => {
    const at: StockAddress = {ownerId: stationId, location: 'reserved'};
    address(at); quantity(timeMs, stationId, false);
    if (inputs.length === 0 || new Set(inputs.map(input => input.materialId)).size !== inputs.length) fail('value', stationId, 'Нужен непустой комплект с уникальными материалами.', 'A nonempty kit with unique materials is required.');
    for (const input of inputs) {
      quantity(input.quantity, input.materialId);
      if (totalAt(draft, at, input.materialId) < BigInt(input.quantity)) fail('shortage', stationId, 'Недостаточно зарезервированного материала для начала обработки.', 'Not enough reserved material to start processing.');
      let remaining = input.quantity;
      for (const stock of [...draft.stocks]) {
        if (remaining === 0) break;
        if (!same(stock, at) || stock.materialId !== input.materialId) continue;
        const count = Math.min(remaining, stock.quantity), p = stock.provenance;
        if (stock.readyAtMs > timeMs || p.origin.kind === 'unreleased' || (p.origin.kind === 'known' && p.origin.startedAtMs > timeMs)
          || (p.firstProcessing.kind === 'known' && p.firstProcessing.startedAtMs > timeMs)) fail('value', stock.id, 'Обработка не может предшествовать происхождению материала.', 'Processing cannot precede material provenance.');
        if (p.firstProcessing.kind === 'notStarted') {
          const active = count === stock.quantity ? stock : splitStock(draft, stock, count);
          active.provenance.firstProcessing = {kind: 'known', startedAtMs: timeMs};
          if (active !== stock) draft.stocks.splice(draft.stocks.indexOf(stock), 0, active);
        }
        remaining -= count;
      }
    }
  });
}

/** Complete one repetition or an explicitly homogeneous aggregate. Caller owns the transaction. */
function produceDraft(state: InventoryState, stationId: string, output: MaterialAmount, actualProcessingMs: number, readyAtMs = 0, kit?: readonly MaterialAmount[]): StockState[] {
  const draft = state;
  address({ownerId: stationId, location: 'held'});
  quantity(output.quantity, output.materialId); quantity(actualProcessingMs, stationId, false); quantity(readyAtMs, stationId, false);
  if (!output.materialId || output.quantity % 1_000_000 !== 0) fail('value', stationId, 'Производственный выход должен быть целым положительным числом изделий.', 'Production output must be a positive whole number of items.');
  if (kit && (kit.length === 0 || new Set(kit.map(input => input.materialId)).size !== kit.length)) fail('value', stationId, 'Нужен уникальный непустой комплект.', 'A unique nonempty kit is required.');
  const inputs = kit ? kit.flatMap(input => takeFIFO(draft, {ownerId: stationId, location: 'reserved'}, input.materialId, input.quantity))
    : draft.stocks.filter(stock => stock.ownerId === stationId && stock.location === 'reserved');
  if (inputs.length === 0 || (!kit && draft.stocks.some(stock => stock.ownerId === stationId && stock.location === 'held'))) fail('reservation', stationId, 'Нет единственного готового к завершению резерва.', 'There is no single reservation ready for completion.');
  let cost = 0n;
  const provenance: Provenance = {origin: {kind: 'unreleased'}, firstProcessing: {kind: 'notStarted'}, defective: false, defectSourceIds: [], processingMs: {}};
  const times = new Map<string, bigint>();
  const defects = new Set<string>();
  for (const stock of inputs) {
    cost = addMoney(cost, stock.cost);
    const p = stock.provenance;
    if (p.origin.kind === 'unreleased') fail('value', stock.id, 'В производстве не может быть незапущенного сырья.', 'Unreleased raw material cannot be in production.');
    if (p.origin.kind === 'unknown') provenance.origin = {kind: 'unknown'};
    else if (provenance.origin.kind !== 'unknown' && (provenance.origin.kind === 'unreleased' || provenance.origin.startedAtMs > p.origin.startedAtMs)) provenance.origin = {...p.origin};
    // Missing history is never inferred from worked duration, which may span calendar pauses.
    if (p.firstProcessing.kind !== 'known') provenance.firstProcessing = {kind: 'unknown'};
    else {
      if (p.firstProcessing.startedAtMs > readyAtMs) fail('value', stock.id, 'Завершение не может предшествовать первой обработке.', 'Completion cannot precede first processing.');
      if (provenance.firstProcessing.kind === 'notStarted' || (provenance.firstProcessing.kind === 'known' && provenance.firstProcessing.startedAtMs > p.firstProcessing.startedAtMs)) provenance.firstProcessing = {...p.firstProcessing};
    }
    provenance.defective ||= p.defective;
    p.defectSourceIds.forEach(id => defects.add(id));
    for (const [station, time] of Object.entries(p.processingMs)) times.set(station, addMoney(times.get(station) ?? 0n, time));
  }
  times.set(stationId, addMoney(times.get(stationId) ?? 0n, BigInt(actualProcessingMs)));
  provenance.processingMs = Object.fromEntries([...times.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  provenance.defectSourceIds = [...defects].sort();
  // Preserve physical FIFO portions for a conserving, single-material recipe.
  // No second clock, mean timestamp, ancestry tree or completed-piece log is needed.
  const conserving = new Set(inputs.map(s => s.materialId)).size === 1
    && inputs.reduce((sum, s) => sum + s.quantity, 0) === output.quantity;
  const portions = conserving ? inputs : [{quantity: output.quantity, provenance}];
  let prior = 0n;
  const total = BigInt(output.quantity);
  const results = portions.map(part => {
    const end = prior + BigInt(part.quantity);
    const share = (value: bigint) => value * end / total - value * prior / total;
    const p = copyProvenance(provenance);
    p.origin = {...part.provenance.origin};
    p.firstProcessing = part.provenance.firstProcessing.kind === 'notStarted' ? {kind: 'unknown'} : {...part.provenance.firstProcessing};
    p.processingMs = Object.fromEntries(Object.entries(provenance.processingMs).map(([id, value]) => [id, share(value)]));
    const result: StockState = {id: newId(draft), ownerId: stationId, location: 'held', materialId: output.materialId,
      quantity: part.quantity, cost: share(cost), readyAtMs, provenance: p};
    prior = end;
    return result;
  });
  draft.stocks = draft.stocks.filter(stock => !inputs.includes(stock));
  draft.stocks.push(...results);
  return results;
}

/** Complete one repetition, returning all physical output portions. */
export function completeProduction(state: InventoryState, stationId: string, output: MaterialAmount, actualProcessingMs: number, readyAtMs = 0, kit?: readonly MaterialAmount[]): StockState[] {
  quantity(actualProcessingMs, stationId);
  return transaction(state, draft => produceDraft(draft, stationId, output, actualProcessingMs, readyAtMs, kit));
}

export interface ProductionQuality {probability: number; seed: number; recipeId: string; operationOrdinal: number}

/** Preserve each simultaneous repetition's kit. Split outputs only where quality differs.
 * FIFO, value and attributed time are committed together, including all repetitions.
 */
export function completeProductionBatch(state: InventoryState, stationId: string, output: MaterialAmount, actualProcessingMs: number,
  readyAtMs: number, kit: readonly MaterialAmount[], repetitions: number, quality?: ProductionQuality): StockState[] {
  return transaction(state, draft => {
    quantity(actualProcessingMs, stationId); quantity(repetitions, stationId);
    quantity(output.quantity, output.materialId);
    if (output.quantity % 1_000_000 !== 0) fail('value', stationId, 'Нужен целый положительный выход повторения.', 'A positive whole output per repetition is required.');
    if (BigInt(output.quantity) * BigInt(repetitions) > MAX_UNITS) fail('range', stationId, 'Полный выход партии превышает диапазон.', 'Full batch output exceeds range.');
    const probability = quality?.probability ?? 0;
    const ownDefect = (sampleIndex: number) => quality ? defectOccurs(probability, quality.seed, stationId, quality.recipeId, quality.operationOrdinal, sampleIndex) : false;
    const firstDefect = quality ? ownDefect(0) : false; // Validate before touching inventory.
    const markOwnDefect = (stock: StockState) => {
      stock.provenance.defective = true;
      stock.provenance.defectSourceIds = [...new Set([...stock.provenance.defectSourceIds, stationId])].sort();
    };
    const results: StockState[] = [], perRepeat = output.quantity / 1_000_000;
    let remainingWork = BigInt(actualProcessingMs);
    for (let repeat = 0; repeat < repetitions; repeat++) {
      const share = remainingWork / BigInt(repetitions - repeat); remainingWork -= share;
      const produced = produceDraft(draft, stationId, output, Number(share), readyAtMs, kit);
      if (probability === 0 || probability === 1) {
        if (probability === 1) produced.forEach(markOwnDefect);
        results.push(...produced); continue;
      }
      const spans: {quantity: number; defective: boolean}[] = [];
      for (let piece = 0; piece < perRepeat; piece++) {
        const sampleIndex = repeat * perRepeat + piece;
        const defective = sampleIndex === 0 ? firstDefect : ownDefect(sampleIndex), last = spans[spans.length - 1];
        if (last && last.defective === defective) last.quantity += 1_000_000;
        else spans.push({quantity: 1_000_000, defective});
      }
      // Intersect quality spans with the existing time portions. Sample indices
      // depend on output pieces, never on the number of provenance portions.
      let spanIndex = 0, spanRemaining = spans[0]!.quantity;
      for (const result of produced) {
        draft.stocks.splice(draft.stocks.indexOf(result), 1);
        let consumed = 0n;
        const total = BigInt(result.quantity);
        const shareBetween = (value: bigint, end: bigint) => value * end / total - value * consumed / total;
        while (consumed < total) {
          const count = Math.min(Number(total - consumed), spanRemaining), end = consumed + BigInt(count);
          const stock: StockState = {...result, id: consumed === 0n ? result.id : newId(draft), quantity: count,
            cost: shareBetween(result.cost, end), provenance: copyProvenance(result.provenance)};
          for (const [id, time] of Object.entries(result.provenance.processingMs)) stock.provenance.processingMs[id] = shareBetween(time, end);
          if (spans[spanIndex]!.defective) markOwnDefect(stock);
          consumed = end;
          draft.stocks.push(stock); results.push(stock);
          spanRemaining -= count;
          if (spanRemaining === 0 && spanIndex + 1 < spans.length) spanRemaining = spans[++spanIndex]!.quantity;
        }
      }
    }
    return results;
  });
}

/** Filter reserved volume without production, merging, or new defect generation.
 * Existing cost/time portions remain individual; inspection time is apportioned
 * by checked volume, including the portions that are scrapped.
 */
export function completeInspection(state: InventoryState, stationId: string, materialId: string, actualProcessingMs: number,
  readyAtMs: number, repetitions = 1): {passed: StockState[]; scrapped: StockState[]} {
  return transaction(state, draft => {
    address({ownerId: stationId, location: 'held'});
    quantity(actualProcessingMs, stationId); quantity(readyAtMs, stationId, false); quantity(repetitions, stationId);
    if (!materialId || BigInt(repetitions) * 1_000_000n > MAX_UNITS) fail('value', stationId, 'Некорректный объём контроля.', 'Invalid inspection volume.');
    const checked = BigInt(repetitions) * 1_000_000n;
    const parts = takeFIFO(draft, {ownerId: stationId, location: 'reserved'}, materialId, Number(checked));
    const passed: StockState[] = [], scrapped: StockState[] = [];
    let priorQuantity = 0n;
    for (const part of parts) {
      if (part.provenance.origin.kind === 'unreleased') fail('value', part.id, 'В контроле не может быть незапущенного сырья.', 'Unreleased raw material cannot be inspected.');
      if (part.provenance.firstProcessing.kind === 'known' && part.provenance.firstProcessing.startedAtMs > readyAtMs) fail('value', part.id, 'Контроль не может завершиться до первой обработки.', 'Inspection cannot complete before first processing.');
      if (part.provenance.firstProcessing.kind === 'notStarted') part.provenance.firstProcessing = {kind: 'unknown'};
      const end = priorQuantity + BigInt(part.quantity);
      const work = BigInt(actualProcessingMs) * end / checked - BigInt(actualProcessingMs) * priorQuantity / checked;
      const times = new Map(Object.entries(part.provenance.processingMs));
      times.set(stationId, addMoney(times.get(stationId) ?? 0n, work));
      part.provenance.processingMs = Object.fromEntries(times);
      priorQuantity = end;
      if (part.provenance.defective) scrapped.push(part);
      else {
        part.location = 'held'; part.readyAtMs = readyAtMs;
        draft.stocks.push(part); passed.push(part);
      }
    }
    return {passed, scrapped};
  });
}
