import {describe, expect, it} from 'vitest';
import {averageText, durationText, percentText} from './metric-format';

describe('exact metric display rounding', () => {
  it('keeps unavailable averages and shares distinct from observed zero', () => {
    expect(averageText(null, 'Not calculated')).toBe('Not calculated');
    expect(percentText(null, 'Не рассчитано')).toBe('Не рассчитано');
    expect(averageText({quantityMs: '0', durationMs: 1}, 'n/a')).toBe('0');
    expect(percentText({timeMs: 0, availableWorkMs: 1}, 'n/a')).toBe('0%');
  });
  it('formats hand-checked quantities and rounds a repeating fraction only for display', () => {
    expect(averageText({quantityMs: '330000000000', durationMs: 150000}, 'n/a')).toBe('2.2');
    expect(averageText({quantityMs: '1000000', durationMs: 3}, 'n/a')).toBe('≈ 0.333333');
    expect(averageText({quantityMs: '12345675', durationMs: 10}, 'n/a')).toBe('≈ 1.234568');
  });
  it('does not silently turn tiny positive quantities or shares into zero', () => {
    expect(averageText({quantityMs: '1', durationMs: 3}, 'n/a')).toBe('< 0.000001');
    expect(percentText({timeMs: 1, availableWorkMs: Number.MAX_SAFE_INTEGER}, 'n/a')).toBe('< 0.1%');
  });
  it('keeps large aggregate averages beyond the safe integer range exact', () => {
    const quantityMs = String(2n * BigInt(Number.MAX_SAFE_INTEGER) * 3n);
    expect(averageText({quantityMs, durationMs: 3}, 'n/a')).toBe('18014398509.481982');
  });
  it('shows exact and rounded percentages with their rounding status', () => {
    expect(percentText({timeMs: 4, availableWorkMs: 20}, 'n/a')).toBe('20%');
    expect(percentText({timeMs: 20, availableWorkMs: 20}, 'n/a')).toBe('100%');
    expect(percentText({timeMs: 1, availableWorkMs: 3}, 'n/a')).toBe('≈ 33.3%');
    expect(percentText({timeMs: 1, availableWorkMs: 16}, 'n/a')).toBe('≈ 6.3%');
  });
  it('shows exact elapsed time without a 24-hour wrap or lost milliseconds', () => {
    expect(durationText(0)).toBe('0:00:00');
    expect(durationText(1)).toBe('0:00:00.001');
    expect(durationText(60_001)).toBe('0:01:00.001');
    expect(durationText(172_812_345)).toBe('48:00:12.345');
    expect(durationText(2_501_999_792 * 3_600_000 - 1)).toBe('2501999791:59:59.999');
  });
});
