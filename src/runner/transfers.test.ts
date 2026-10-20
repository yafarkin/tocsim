import { describe, expect, it } from 'vitest';
import { collectTransfers } from './transfers';
import type { TransferSummary } from './transfers';
import { Simulation } from '../engine/simulation';
import { exampleRuns } from '../ui/preview';
const previewRun = exampleRuns.queue;
import { Runner } from './runner';
import type { RunnerHost } from './runner';

it('aggregates complete timestamps including transfers before an event-free tail', () => {
  const collected = new Map<string, TransferSummary>(), simulation = new Simulation(previewRun);
  while ((simulation.nextEventTime() ?? Infinity) <= 60 * 60_000) {
    simulation.step(); collectTransfers(collected, simulation.getSnapshot());
  }
  const sales = [...collected.values()].filter(t => t.kind === 'sale');
  expect(sales.reduce((sum, t) => sum + BigInt(t.quantity), 0n)).toBe(6_000_000n);
  expect(collected.size).toBeLessThanOrEqual(previewRun.resolved.routes.length + previewRun.resolved.stations.length);
  const callbacks: (() => void)[] = []; let time = 0;
  const host: RunnerHost = {now: () => time, request: callback => {callbacks.push(callback); return callback;}, cancel: () => {}};
  const runner = new Runner(previewRun, undefined, host); runner.setSpeed(60); runner.start();
  time = 60_000 + 1; callbacks.shift()!();
  expect(runner.getView().transfers.items.some(t => t.kind === 'route')).toBe(true);
  runner.pause(); const sequence = runner.getView().transfers.sequence;
  runner.resume(); expect(runner.getView().transfers.items).toEqual([]);
  expect(runner.getView().transfers.sequence).toBeGreaterThan(sequence);
  runner.dispose();
});

describe('display accounting is separate from model bounds', () => {
  it('sums micro-unit strings without overflow and leaves snapshots unchanged', () => {
    const original = new Simulation(previewRun).advanceTo(3 * 60_000);
    const copy = {...original, sourceTransfers: [{timeMs: 0, sourceId: 'source', stationId: 'prep', materialId: 'raw', quantity: Number.MAX_SAFE_INTEGER, cost: '0'}]};
    const collected = new Map<string, TransferSummary>();
    collectTransfers(collected, copy); collectTransfers(collected, copy);
    expect([...collected.values()].find(t => t.kind === 'source')!.quantity).toBe('18014398509481982');
    expect(original.sourceTransfers).not.toBe(copy.sourceTransfers);
  });
});
