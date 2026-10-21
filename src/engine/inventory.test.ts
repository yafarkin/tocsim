import { describe, expect, it } from 'vitest';
import { MAX_UNITS, parseQuantity as q } from './arithmetic';
import { compileConfig } from './config';
import { completeProduction, consumeStock, createInventory, InventoryError, receiveStock, reserveInputs, transferStock } from './inventory';
import type { StockAddress } from './inventory';
import type { InventoryState, Provenance, StockState } from './state';
import { createSnapshot } from './state';
import { line } from './test-fixtures';

const infinite = {kind: 'infinite'} as const;
const input: StockAddress = {ownerId: 's1', location: 'input'};
const held: StockAddress = {ownerId: 's1', location: 'held'};
const downstream: StockAddress = {ownerId: 's2', location: 'input'};
const origin = (startedAtMs = 0): Provenance => ({origin: {kind: 'known', startedAtMs}, defective: false, defectSourceIds: [], processingMs: {}});
const empty = (): InventoryState => ({stocks: [], nextStockOrdinal: 0});
function receive(state: InventoryState, quantity = q('1'), cost = 10n, provenance = origin(), materialId = 'A', at = input) {
  return receiveStock(state, at, {materialId, quantity, cost, provenance}, infinite);
}
const totalCost = (stocks: StockState[]) => stocks.reduce((sum, stock) => sum + stock.cost, 0n);
const totalQuantity = (stocks: StockState[]) => stocks.reduce((sum, stock) => sum + stock.quantity, 0);
const totalTime = (stocks: StockState[], station: string) => stocks.reduce((sum, stock) => sum + (stock.provenance.processingMs[station] ?? 0n), 0n);
function failsWithoutChange(state: InventoryState, action: () => unknown, code: string) {
  const before = structuredClone(state);
  expect(action).toThrow(InventoryError);
  try { action(); } catch (error) { expect(error).toHaveProperty('code', code); }
  expect(state).toEqual(before);
}

describe('initial stock, FIFO and fractional transfers', () => {
  it('initializes independent stocks with unknown WIP age and unreleased warehouse stock', () => {
    const config = line(); config.sources[0]!.availability = 'warehouse';
    config.initialStocks.push({id: 'rawStock', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '5', cost: '50'});
    const run = compileConfig(config);
    const state = createInventory(run);
    expect(state.stocks.find(s => s.id === 'initial')!.provenance.origin).toEqual({kind: 'unknown'});
    const warehouse = state.stocks.find(s => s.id === 'rawStock')!;
    expect(warehouse.provenance.origin).toEqual({kind: 'unreleased'});
    transferStock(state, {ownerId: 'warehouse', location: 'warehouse'}, input, 'raw', q('1'), infinite, 123);
    expect(state.stocks.find(s => s.location === 'input' && s.id !== 'initial')!.provenance.origin).toEqual({kind: 'known', startedAtMs: 123});
    expect(state.stocks.find(s => s.id === 'rawStock')!.provenance.origin).toEqual({kind: 'unreleased'});
    state.stocks[0]!.cost = 0n;
    expect(run.resolved.initialStocks[0]!.cost).not.toBe(0n);
  });

  it('uses FIFO arrival order, not origin age, ID or cost', () => {
    const state = empty();
    receive(state, q('1'), 100n, origin(100));
    receive(state, q('1'), 200n, origin(0));
    const consumed = consumeStock(state, input, 'A', q('1.5'));
    expect(consumed.map(s => s.cost)).toEqual([100n, 100n]);
    expect(consumed.map(s => s.provenance.origin)).toEqual([{kind: 'known', startedAtMs: 100}, {kind: 'known', startedAtMs: 0}]);
    expect(state.stocks[0]!.quantity).toBe(q('0.5'));
    expect(totalCost(state.stocks)).toBe(100n);
  });

  it('preserves cost, defect and time across three 0.3 withdrawals and the last 0.1', () => {
    const state = empty();
    const provenance = {...origin(50), defective: true, defectSourceIds: ['upstream'], processingMs: {upstream: 101n}};
    receive(state, q('1'), 13n, provenance);
    let consumedCost = 0n, consumedTime = 0n;
    for (let i = 0; i < 3; i++) {
      const parts = consumeStock(state, input, 'A', q('0.3'));
      expect(parts[0]!.provenance.defective).toBe(true);
      expect(parts[0]!.provenance.defectSourceIds).toEqual(['upstream']);
      expect(parts[0]!.provenance.origin).toEqual({kind: 'known', startedAtMs: 50});
      consumedCost += totalCost(parts); consumedTime += totalTime(parts, 'upstream');
      expect(consumedCost + totalCost(state.stocks)).toBe(13n);
      expect(consumedTime + totalTime(state.stocks, 'upstream')).toBe(101n);
    }
    expect(totalQuantity(state.stocks)).toBe(q('0.1'));
    const last = consumeStock(state, input, 'A', q('0.1'));
    expect(consumedCost + totalCost(last)).toBe(13n);
    expect(consumedTime + totalTime(last, 'upstream')).toBe(101n);
    expect(state.stocks).toEqual([]);
  });

  it('allows replenishment of fractional free space without merging attributes', () => {
    const state = empty();
    receive(state, q('1'), 10n, {...origin(), defective: true, defectSourceIds: ['defect']});
    consumeStock(state, input, 'A', q('0.6'));
    receiveStock(state, input, {materialId: 'A', quantity: q('0.6'), cost: 20n, provenance: origin(10)}, {kind: 'quantity', quantity: q('1')});
    expect(state.stocks.map(s => s.quantity)).toEqual([q('0.4'), q('0.6')]);
    const portions = consumeStock(state, input, 'A', q('1'));
    expect(portions.map(s => s.provenance.defective)).toEqual([true, false]);
    expect(totalCost(portions)).toBe(24n);
  });

  it('moves 6 of 10 held items, then 4, without duplicating cost or station time', () => {
    const state = empty();
    receive(state, q('10'), 17n, {...origin(10), processingMs: {s1: 101n}}, 'B', held);
    const moved = transferStock(state, held, downstream, 'B', q('6'), {kind: 'quantity', quantity: q('6')}, 20);
    expect(totalQuantity(state.stocks.filter(s => s.location === 'held'))).toBe(q('4'));
    expect(totalQuantity(state.stocks.filter(s => s.ownerId === 's2'))).toBe(q('6'));
    expect(moved[0]!.cost).toBe(10n);
    expect(totalCost(state.stocks)).toBe(17n); expect(totalTime(state.stocks, 's1')).toBe(101n);
    const first = consumeStock(state, downstream, 'B', q('6'));
    const second = transferStock(state, held, downstream, 'B', q('4'), infinite, 21);
    expect(second[0]!.cost).toBe(7n);
    expect(totalCost(first) + totalCost(state.stocks)).toBe(17n);
    expect(totalTime(first, 's1') + totalTime(state.stocks, 's1')).toBe(101n);
    expect(state.stocks.every(s => s.location !== 'held')).toBe(true);
  });

  it('appends arrivals to the destination queue and detaches returned data', () => {
    const state = empty();
    receive(state, q('1'), 1n, origin(10), 'A', downstream);
    const stock = receive(state, q('1'), 2n, {...origin(0), processingMs: {s1: 3n}});
    stock.provenance.processingMs.s1 = 999n;
    const moved = transferStock(state, input, downstream, 'A', q('1'), infinite, 20);
    moved[0]!.provenance.origin = {kind: 'unknown'};
    expect(state.stocks[1]!.provenance.origin).toEqual({kind: 'known', startedAtMs: 0});
    expect(state.stocks[1]!.provenance.processingMs.s1).toBe(3n);
    expect(consumeStock(state, downstream, 'A', q('1'))[0]!.cost).toBe(1n);
  });
});

describe('atomic reservation and production', () => {
  it.each([['0.3', '1'], ['10', '1'], ['1', '10'], ['10', '10']])('consumes %s and produces %s with exact value conservation', (inputAmount, outputAmount) => {
    const state = empty();
    receive(state, q(inputAmount), 123n, {...origin(12), processingMs: {prior: 77n}});
    reserveInputs(state, 's1', [{materialId: 'A', quantity: q(inputAmount)}]);
    expect(state.stocks.every(s => s.location === 'reserved')).toBe(true);
    const result = completeProduction(state, 's1', {materialId: 'B', quantity: q(outputAmount)}, 100);
    expect(state.stocks).toHaveLength(1);
    expect(result).toMatchObject({location: 'held', materialId: 'B', quantity: q(outputAmount), cost: 123n});
    expect(result.provenance.processingMs).toEqual({prior: 77n, s1: 100n});
    expect(result.provenance.origin).toEqual({kind: 'known', startedAtMs: 12});
    failsWithoutChange(state, () => completeProduction(state, 's1', {materialId: 'B', quantity: q(outputAmount)}, 100), 'reservation');
  });

  it('takes only one kit out of input exactly once, preserving total WIP until completion', () => {
    const state = empty(); receive(state, q('2'), 20n);
    reserveInputs(state, 's1', [{materialId: 'A', quantity: q('1')}]);
    expect(totalQuantity(state.stocks)).toBe(q('2'));
    expect(state.stocks.filter(s => s.location === 'input')[0]!.quantity).toBe(q('1'));
    expect(state.stocks.filter(s => s.location === 'reserved')[0]!.quantity).toBe(q('1'));
    failsWithoutChange(state, () => reserveInputs(state, 's1', [{materialId: 'A', quantity: q('1')}]), 'reservation');
    failsWithoutChange(state, () => consumeStock(state, {ownerId: 's1', location: 'reserved'}, 'A', q('1')), 'reservation');
    completeProduction(state, 's1', {materialId: 'B', quantity: q('10')}, 100);
    expect(state.stocks.map(s => [s.materialId, s.quantity])).toEqual([['A', q('1')], ['B', q('10')]]);
    expect(totalCost(state.stocks)).toBe(20n);
    failsWithoutChange(state, () => reserveInputs(state, 's1', [{materialId: 'A', quantity: q('1')}]), 'reservation');
  });

  it('restores all materials and counters if a later component of a kit is missing', () => {
    const state = empty(); receive(state, q('2'), 20n);
    failsWithoutChange(state, () => reserveInputs(state, 's1', [{materialId: 'A', quantity: q('0.3')}, {materialId: 'missing', quantity: q('1')}]), 'shortage');
    expect(state.stocks[0]!.quantity).toBe(q('2'));
  });

  it('combines actual costs, earliest age, defects and time without storing an ancestry tree', () => {
    const state = empty();
    receive(state, q('1'), 7n, {...origin(20), processingMs: {upstream: 31n}}, 'A');
    receive(state, q('2'), 11n, {...origin(10), defective: true, defectSourceIds: ['badStation'], processingMs: {upstream: 41n, other: 5n}}, 'C');
    reserveInputs(state, 's1', [{materialId: 'A', quantity: q('1')}, {materialId: 'C', quantity: q('2')}]);
    const result = completeProduction(state, 's1', {materialId: 'B', quantity: q('10')}, 17);
    expect(result.cost).toBe(18n);
    expect(result.provenance).toEqual({origin: {kind: 'known', startedAtMs: 10}, defective: true, defectSourceIds: ['badStation'], processingMs: {upstream: 72n, other: 5n, s1: 17n}});
    const two = consumeStock(state, held, 'B', q('2'));
    expect(totalTime(two, 's1')).toBe(3n);
    expect(totalTime(two, 's1') + totalTime(state.stocks, 's1')).toBe(17n);
    expect(two[0]!.provenance.defective).toBe(true);
  });

  it('preserves unknown initial age through assembly and later splitting', () => {
    const state = empty();
    receive(state, q('1'), 1n, {...origin(), origin: {kind: 'unknown'}}, 'A');
    receive(state, q('1'), 2n, origin(10), 'C');
    reserveInputs(state, 's1', [{materialId: 'A', quantity: q('1')}, {materialId: 'C', quantity: q('1')}]);
    completeProduction(state, 's1', {materialId: 'B', quantity: q('10')}, 10);
    expect(consumeStock(state, held, 'B', q('0.3'))[0]!.provenance.origin).toEqual({kind: 'unknown'});
    expect(state.stocks[0]!.provenance.origin).toEqual({kind: 'unknown'});
  });

  it('does not contaminate a later independent kit with a prior defect', () => {
    const state = empty();
    receive(state, q('1'), 1n, {...origin(), defective: true, defectSourceIds: ['bad']});
    receive(state, q('1'), 1n);
    const flags: boolean[] = [];
    for (let i = 0; i < 2; i++) {
      reserveInputs(state, 's1', [{materialId: 'A', quantity: q('1')}]);
      flags.push(completeProduction(state, 's1', {materialId: 'B', quantity: q('1')}, 1).provenance.defective);
      consumeStock(state, held, 'B', q('1'));
    }
    expect(flags).toEqual([true, false]);
  });
});

describe('range, capacity and transactional failures', () => {
  it('checks capacity and leaves source unchanged on failure', () => {
    const state = empty(); receive(state, q('10'), 10n, origin(), 'A', held);
    failsWithoutChange(state, () => transferStock(state, held, downstream, 'A', q('1'), {kind: 'quantity', quantity: 0}, 1), 'capacity');
    failsWithoutChange(state, () => transferStock(state, held, downstream, 'A', q('11'), infinite, 1), 'shortage');
    failsWithoutChange(state, () => transferStock(state, held, held, 'A', q('1'), infinite, 1), 'reservation');
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid withdrawal %s', value => {
    const state = empty(); receive(state);
    failsWithoutChange(state, () => consumeStock(state, input, 'A', value), 'value');
  });

  it('rejects aggregate quantity, cost and processing-time overflow atomically', () => {
    const quantityState = empty(); receive(quantityState, Number.MAX_SAFE_INTEGER, 0n);
    failsWithoutChange(quantityState, () => receive(quantityState, 1, 0n), 'range');
    const costState = empty(); receive(costState, 1, MAX_UNITS);
    failsWithoutChange(costState, () => receive(costState, 1, 1n), 'range');
    const timeState = empty(); receive(timeState, q('1'), 1n, {...origin(), processingMs: {s1: MAX_UNITS}});
    reserveInputs(timeState, 's1', [{materialId: 'A', quantity: q('1')}]);
    failsWithoutChange(timeState, () => completeProduction(timeState, 's1', {materialId: 'B', quantity: q('1')}, 1), 'range');
  });

  it('does not consume reservations when output or processing duration is invalid', () => {
    const state = empty(); receive(state);
    reserveInputs(state, 's1', [{materialId: 'A', quantity: q('1')}]);
    failsWithoutChange(state, () => completeProduction(state, 's1', {materialId: 'B', quantity: q('0.3')}, 1), 'value');
    failsWithoutChange(state, () => completeProduction(state, 's1', {materialId: 'B', quantity: q('1')}, 0), 'value');
  });

  it('validates provenance without generating new defects', () => {
    const state = empty();
    failsWithoutChange(state, () => receive(state, q('1'), 1n, {...origin(), origin: {kind: 'unreleased'}}), 'value');
    failsWithoutChange(state, () => receive(state, q('1'), 1n, {...origin(), processingMs: {s1: -1n}}), 'range');
    failsWithoutChange(state, () => receive(state, q('1'), 1n, {...origin(), defectSourceIds: ['bad']}), 'value');
    receive(state, q('1'), 1n, origin(100));
    failsWithoutChange(state, () => transferStock(state, input, downstream, 'A', q('1'), infinite, 99), 'value');
  });

  it('conserves allocated value and time across many tiny portions', () => {
    for (let size = 1; size <= 30; size++) {
      const state = empty(); receive(state, size, BigInt(size + 7), {...origin(), processingMs: {prior: BigInt(size * 3 + 1)}});
      let cost = 0n, time = 0n;
      for (let i = 0; i < size; i++) {
        const consumed = consumeStock(state, input, 'A', 1);
        cost += totalCost(consumed); time += totalTime(consumed, 'prior');
        expect(cost + totalCost(state.stocks)).toBe(BigInt(size + 7));
        expect(time + totalTime(state.stocks, 'prior')).toBe(BigInt(size * 3 + 1));
      }
      expect(state.stocks).toEqual([]);
    }
  });

  it('serializes and detaches nested provenance in snapshot schema 4', () => {
    const run = compileConfig(line()); const inventory = empty();
    receive(inventory, q('1'), 7n, {...origin(), defective: true, defectSourceIds: ['bad'], processingMs: {s1: 13n}});
    const snapshot = createSnapshot(run, {...inventory, timeMs: 10, stations: [], sources: [], sourceTransfers: [], line: null});
    inventory.stocks[0]!.provenance.processingMs.s1 = 99n;
    inventory.stocks[0]!.provenance.defectSourceIds.push('another');
    const decoded = JSON.parse(JSON.stringify(snapshot));
    expect(decoded.schemaVersion).toBe(10);
    expect(decoded.stocks[0].provenance.processingMs.s1).toBe('13');
    expect(decoded.stocks[0].provenance.defectSourceIds).toEqual(['bad']);
    expect(Object.isFrozen(snapshot.stocks[0]!.provenance.processingMs)).toBe(true);
  });
});
