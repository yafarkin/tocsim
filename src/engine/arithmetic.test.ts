import { describe, expect, it } from 'vitest';
import {
  ArithmeticError, MAX_UNITS, addMoney, addQuantity, formatMoney, formatQuantity,
  moneyFromJSON, moneyToJSON, multiplyQuantity, parseMoney, parseQuantity,
  purchaseCost, splitCost, subtractMoney, subtractQuantity,
} from './arithmetic';

function expectCode(action: () => unknown, code: string) {
  expect(action).toThrow(ArithmeticError);
  try { action(); } catch (error) { expect(error).toHaveProperty('code', code); }
}

describe('exact decimal quantities', () => {
  it('adds ten 0.3 quantities to exactly 3 and leaves 0.1 after three withdrawals', () => {
    let total = 0;
    let remaining = parseQuantity('1');
    for (let i = 0; i < 10; i++) total = addQuantity(total, parseQuantity('0.3'));
    for (let i = 0; i < 3; i++) remaining = subtractQuantity(remaining, parseQuantity('0.3'));
    expect(total).toBe(parseQuantity('3'));
    expect(formatQuantity(remaining)).toBe('0.1');
    expect(multiplyQuantity(parseQuantity('0.3'), 10)).toBe(total);
  });

  it('round-trips six-digit precision and the exact upper bound', () => {
    for (const decimal of ['0', '0.000001', '12.345678', '9007199254.740991']) {
      expect(formatQuantity(parseQuantity(decimal))).toBe(decimal);
    }
    expect(parseQuantity('0001.200000')).toBe(1_200_000);
  });

  it.each(['0.0000001', '1.0000000'])('rejects excess precision in %s', value => {
    expectCode(() => parseQuantity(value), 'precision');
  });

  it.each(['', ' 1', '1 ', '1\n', '1e3', 'NaN', 'Infinity', '.3', '1.', '1,3', '+1', '1x'])('rejects malformed decimal %s', value => {
    expectCode(() => parseQuantity(value), 'decimal');
  });

  it('rejects negative quantities, unsafe input, overflow and underflow', () => {
    expectCode(() => parseQuantity('-0.1'), 'quantity');
    expectCode(() => parseQuantity('-0'), 'quantity');
    expectCode(() => parseQuantity('9007199254.740992'), 'range');
    expectCode(() => addQuantity(Number.MAX_SAFE_INTEGER, 1), 'range');
    expectCode(() => subtractQuantity(0, 1), 'range');
    expectCode(() => multiplyQuantity(Number.MAX_SAFE_INTEGER, 2), 'range');
    for (const invalid of [0.1, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expectCode(() => addQuantity(invalid, 0), 'quantity');
    }
    expectCode(() => multiplyQuantity(1, 0.5), 'quantity');
  });
});

describe('exact monetary arithmetic', () => {
  it('keeps signed sums and differences exact', () => {
    expect(addMoney(parseMoney('0.1'), parseMoney('0.2'))).toBe(parseMoney('0.3'));
    expect(formatMoney(subtractMoney(parseMoney('1'), parseMoney('1.000001')))).toBe('-0.000001');
    expect(formatMoney(parseMoney('-9007199254.740991'))).toBe('-9007199254.740991');
    expectCode(() => addMoney(MAX_UNITS, 1n), 'range');
    expectCode(() => subtractMoney(-MAX_UNITS, 1n), 'range');
    expectCode(() => parseMoney('1.0000001'), 'precision');
  });

  it('uses exact products beyond the Number safe range before checking final range', () => {
    expect(purchaseCost(MAX_UNITS, parseQuantity('1'))).toBe(MAX_UNITS);
    expect(purchaseCost(3_000_000_000_000_001n, parseQuantity('0.999999'))).toBe(2_999_997_000_000_001n);
    expectCode(() => purchaseCost(MAX_UNITS, parseQuantity('2')), 'range');
    expectCode(() => purchaseCost(-1n, parseQuantity('1')), 'range');
  });

  it('rounds purchase once, with ties up, at one micro monetary unit', () => {
    expect(purchaseCost(1n, parseQuantity('0.499999'))).toBe(0n);
    expect(purchaseCost(1n, parseQuantity('0.5'))).toBe(1n);
    expect(purchaseCost(1n, parseQuantity('0.500001'))).toBe(1n);
    expect(purchaseCost(MAX_UNITS, 0)).toBe(0n);
  });

  it('retains the rounding remainder until the final withdrawal', () => {
    let quantity = parseQuantity('1');
    let cost = 10n;
    const shares: bigint[] = [];
    for (const decimal of ['0.3', '0.3', '0.3', '0.1']) {
      const taken = parseQuantity(decimal);
      const allocation = splitCost(cost, quantity, taken);
      shares.push(allocation.takenCost);
      expect(allocation.takenCost + allocation.remainingCost).toBe(cost);
      cost = allocation.remainingCost;
      quantity = subtractQuantity(quantity, taken);
    }
    expect(shares).toEqual([3n, 3n, 3n, 1n]);
    expect(cost).toBe(0n);
    expect(quantity).toBe(0);
    expect(splitCost(1n, parseQuantity('3'), parseQuantity('1'))).toEqual({takenCost: 0n, remainingCost: 1n});
  });

  it('distributes a 1→10 production cost without duplication and recombines it exactly', () => {
    const inputCost = purchaseCost(parseMoney('0.000013'), parseQuantity('1'));
    let remainingCost = inputCost;
    let remainingQuantity = parseQuantity('10');
    let reunited = 0n;
    for (let i = 0; i < 10; i++) {
      const {takenCost, remainingCost: rest} = splitCost(remainingCost, remainingQuantity, parseQuantity('1'));
      reunited = addMoney(reunited, takenCost);
      remainingCost = rest;
      remainingQuantity = subtractQuantity(remainingQuantity, parseQuantity('1'));
    }
    expect(reunited).toBe(inputCost);
    expect(remainingCost).toBe(0n);
    // Assembly adds the actual input costs, without recomputing their prices.
    expect(addMoney(reunited, parseMoney('2'))).toBe(parseMoney('2.000013'));
  });

  it('conserves cost for many divisions including zero, full and tiny withdrawals', () => {
    for (let total = 1; total <= 25; total++) {
      for (let cost = 0n; cost <= 25n; cost++) {
        let sum = 0n;
        let rest = cost;
        for (let remaining = total; remaining > 0; remaining--) {
          const allocation = splitCost(rest, remaining, 1);
          sum += allocation.takenCost;
          rest = allocation.remainingCost;
          expect(rest).toBeGreaterThanOrEqual(0n);
        }
        expect(sum).toBe(cost);
        expect(rest).toBe(0n);
      }
    }
    expect(splitCost(MAX_UNITS, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1)).toEqual({takenCost: MAX_UNITS - 1n, remainingCost: 1n});
    expect(splitCost(7n, 1, 0)).toEqual({takenCost: 0n, remainingCost: 7n});
    expect(splitCost(0n, 0, 0)).toEqual({takenCost: 0n, remainingCost: 0n});
    expectCode(() => splitCost(1n, 0, 0), 'split');
    expectCode(() => splitCost(1n, 1, 2), 'split');
    expectCode(() => splitCost(-1n, 1, 1), 'split');
  });
});

describe('schema-directed JSON money fields', () => {
  it('round-trips exact signed integer strings without a floating conversion', () => {
    for (const units of [0n, 1n, -1n, MAX_UNITS, -MAX_UNITS]) {
      const json = JSON.stringify({schemaVersion: 1, cost: moneyToJSON(units)});
      const decoded: {schemaVersion: number; cost: unknown} = JSON.parse(json);
      expect(decoded.schemaVersion).toBe(1);
      expect(moneyFromJSON(decoded.cost)).toBe(units);
    }
    expect(moneyToJSON(MAX_UNITS)).toBe('9007199254740991');
  });

  it.each([1, null, {}, [], '1.0', '1e6', '01', '-0', '+1', ' 1', '1\n', '1n', ''])('rejects noncanonical JSON field %j', value => {
    expectCode(() => moneyFromJSON(value), 'integer');
  });

  it('checks the range in both directions', () => {
    expectCode(() => moneyFromJSON('9007199254740992'), 'range');
    expectCode(() => moneyFromJSON('-9007199254740992'), 'range');
    expectCode(() => moneyToJSON(MAX_UNITS + 1n), 'range');
  });
});
