/** Quantities are safe integer micro-units; money uses bigint micro-units.
 * Both are bounded by MAX_UNITS in magnitude. Intermediate products use bigint.
 * Decimal input is deliberately textual: no binary floating-point conversion.
 */
export const SCALE = 1_000_000n;
export const MAX_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

export type ArithmeticErrorCode = 'decimal' | 'precision' | 'range' | 'quantity' | 'split' | 'integer';

/** Stable codes let a future UI provide RU/EN messages without coupling to DOM. */
export class ArithmeticError extends Error {
  constructor(public readonly code: ArithmeticErrorCode) {
    super(code);
    this.name = 'ArithmeticError';
  }
}

function checkedMoney(value: bigint): bigint {
  if (value < -MAX_UNITS || value > MAX_UNITS) throw new ArithmeticError('range');
  return value;
}

function checkedQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ArithmeticError('quantity');
  return value;
}

function quantityFromBigInt(value: bigint): number {
  if (value < 0n || value > MAX_UNITS) throw new ArithmeticError('range');
  return Number(value);
}

function parseDecimal(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || match[0] !== value) throw new ArithmeticError('decimal');
  const fraction = match[3] ?? '';
  if (fraction.length > 6) throw new ArithmeticError('precision');
  const absolute = BigInt(match[2]!) * SCALE + BigInt(fraction.padEnd(6, '0'));
  return checkedMoney(match[1] === '-' ? -absolute : absolute);
}

export function parseQuantity(value: string): number {
  const units = parseDecimal(value);
  if (value.startsWith('-')) throw new ArithmeticError('quantity');
  return quantityFromBigInt(units);
}

export function parseMoney(value: string): bigint {
  return parseDecimal(value);
}

function formatDecimal(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const fraction = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${value < 0n ? '-' : ''}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}

export function formatQuantity(units: number): string {
  return formatDecimal(BigInt(checkedQuantity(units)));
}

export function formatMoney(units: bigint): string {
  return formatDecimal(checkedMoney(units));
}

export function addQuantity(left: number, right: number): number {
  return quantityFromBigInt(BigInt(checkedQuantity(left)) + BigInt(checkedQuantity(right)));
}

export function subtractQuantity(left: number, right: number): number {
  return quantityFromBigInt(BigInt(checkedQuantity(left)) - BigInt(checkedQuantity(right)));
}

/** Repeat a recipe quantity an integer number of times, without rounding. */
export function multiplyQuantity(units: number, repetitions: number): number {
  checkedQuantity(repetitions);
  return quantityFromBigInt(BigInt(checkedQuantity(units)) * BigInt(repetitions));
}

export function addMoney(left: bigint, right: bigint): bigint {
  return checkedMoney(checkedMoney(left) + checkedMoney(right));
}

export function subtractMoney(left: bigint, right: bigint): bigint {
  return checkedMoney(checkedMoney(left) - checkedMoney(right));
}

/** Nonnegative purchase price × quantity, rounded once to nearest micro-unit.
 * An exact half micro-unit rounds up. Never use this to revalue an existing lot.
 */
export function purchaseCost(unitPrice: bigint, quantity: number): bigint {
  checkedMoney(unitPrice);
  if (unitPrice < 0n) throw new ArithmeticError('range');
  const product = unitPrice * BigInt(checkedQuantity(quantity));
  return checkedMoney((product + SCALE / 2n) / SCALE);
}

/** Allocate from the current remainder, flooring the taken share.
 * Taking the last quantity gets the entire remaining cost. Inputs are unchanged.
 */
export function splitCost(cost: bigint, quantity: number, taken: number): {
  takenCost: bigint;
  remainingCost: bigint;
} {
  checkedMoney(cost);
  checkedQuantity(quantity);
  checkedQuantity(taken);
  if (cost < 0n || taken > quantity || (quantity === 0 && cost !== 0n)) {
    throw new ArithmeticError('split');
  }
  const takenCost = taken === quantity ? cost : cost * BigInt(taken) / BigInt(quantity);
  return { takenCost, remainingCost: cost - takenCost };
}

/** JSON field helpers: micro-unit integers, not display decimals.
 * No global bigint replacer/reviver: only the schema's known money fields use these.
 */
export function moneyToJSON(units: bigint): string {
  return checkedMoney(units).toString();
}

export function moneyFromJSON(value: unknown): bigint {
  if (typeof value !== 'string' || /^(?:0|-?[1-9]\d*)$/.exec(value)?.[0] !== value) {
    throw new ArithmeticError('integer');
  }
  return checkedMoney(BigInt(value));
}

/** Charge cumulative occupied lunch time once, nearest micro-unit, ties up.
 * Computing from the cumulative integer duration avoids frame-dependent rounding.
 */
export function lunchCost(hourlyRate: bigint, occupiedMs: number): bigint {
  checkedMoney(hourlyRate); checkedQuantity(occupiedMs);
  if (hourlyRate < 0n) throw new ArithmeticError('range');
  return checkedMoney((hourlyRate * BigInt(occupiedMs) + 1_800_000n) / 3_600_000n);
}

/** Cumulative fixed charge per station, nearest micro-unit, ties up. */
export function fixedCost(perShift: bigint, workMs: number, dailyWorkMs: number): bigint {
  checkedMoney(perShift); checkedQuantity(workMs); checkedQuantity(dailyWorkMs);
  if (perShift < 0n || dailyWorkMs === 0) throw new ArithmeticError('range');
  const denominator = BigInt(dailyWorkMs);
  return checkedMoney((2n * perShift * BigInt(workMs) + denominator) / (2n * denominator));
}
