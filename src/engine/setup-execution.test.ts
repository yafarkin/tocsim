import { describe, expect, it } from 'vitest';
import { compileConfig } from './config';
import { Simulation } from './simulation';
import { cyclicLine, blockedCyclicLine } from './test-fixtures';
import { processingDuration } from './random';
const M = 60_000, Q = 1_000_000, DAY = 86_400_000;
function setupLine() {
  const c = cyclicLine(); c.stations[0]!.setupMs = 7 * M;
  return c;
}
describe('timed recipe setup', () => {
  it('executes V14 A,A,B with no A→A setup and seven minutes in both directions', () => {
    const sim = new Simulation(compileConfig(setupLine()));
    expect(sim.advanceTo(M).stations[0]).toMatchObject({status: 'processing', configuredRecipeId: 'recipeA', remainingSetupMs: null, completedBatches: 1});
    const before = sim.advanceTo(2 * M);
    expect(before.stations[0]).toMatchObject({status: 'setup', configuredRecipeId: 'recipeA', targetRecipeId: 'recipeB', remainingSetupMs: 7 * M, remainingProcessingMs: null, progress: null});
    expect(before.stocks.filter(s => s.location === 'reserved')).toHaveLength(0);
    expect(before.stations[0]!.inputs.find(i => i.materialId === 'rawB')).toMatchObject({quantity: 12 * Q, reservedQuantity: 0});
    expect(sim.advanceTo(9 * M).stations[0]).toMatchObject({status: 'processing', configuredRecipeId: 'recipeB', targetRecipeId: null, remainingSetupMs: null, remainingProcessingMs: 2 * M});
    const returning = sim.advanceTo(11 * M);
    expect(returning.stations[0]).toMatchObject({status: 'setup', configuredRecipeId: 'recipeB', targetRecipeId: 'recipeA', remainingSetupMs: 7 * M});
    expect(returning.line!.counters.find(c => c.materialId === 'rawB')!.consumed).toBe(Q);
    expect(sim.advanceTo(18 * M).stations[0]).toMatchObject({status: 'processing', configuredRecipeId: 'recipeA', remainingProcessingMs: M});
  });

  it('preserves ten remaining setup minutes over lunch and ignores the old completion', () => {
    const c = setupLine(); c.stations[0]!.plan[0]!.processing.timeMs = 117.5 * M; c.stations[0]!.setupMs = 15 * M;
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(240 * M).stations[0]).toMatchObject({status: 'paused', reason: 'lunch', remainingSetupMs: 10 * M, remainingProcessingMs: null});
    expect(sim.advanceTo(250 * M).stations[0]!.remainingSetupMs).toBe(10 * M);
    expect(sim.advanceTo(300 * M).stations[0]).toMatchObject({status: 'setup', remainingSetupMs: 10 * M});
    expect(sim.advanceTo(310 * M).stations[0]).toMatchObject({status: 'processing', configuredRecipeId: 'recipeB', remainingProcessingMs: 2 * M});
    expect(sim.advanceTo(312 * M).line!.counters.find(c => c.materialId === 'b')!.produced).toBe(Q);
  });

  it('preserves setup over night, including a provisional completion before opening', () => {
    const c = setupLine(); c.durationMs += DAY; c.stations[0]!.plan[0]!.processing.timeMs = 237.5 * M; c.stations[0]!.setupMs = 15 * M;
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(540 * M).stations[0]).toMatchObject({reason: 'offShift', remainingSetupMs: 10 * M});
    expect(sim.advanceTo(DAY).stations[0]).toMatchObject({status: 'setup', remainingSetupMs: 10 * M});
    expect(sim.advanceTo(DAY + 10 * M).stations[0]).toMatchObject({status: 'processing', configuredRecipeId: 'recipeB'});
  });

  it.each([500 * M, Number.MAX_SAFE_INTEGER])('retains unfinished initial setup at the horizon, duration %s', setupMs => {
    const c = setupLine(); c.stations[0]!.initialRecipeId = 'recipeB'; c.stations[0]!.setupMs = setupMs;
    const s = new Simulation(compileConfig(c)).runToEnd();
    expect(s.stations[0]).toMatchObject({status: 'paused', reason: 'horizon', configuredRecipeId: 'recipeB', targetRecipeId: 'recipeA', remainingSetupMs: setupMs - 480 * M});
    expect(s.stocks.some(s => s.location === 'reserved')).toBe(false);
    expect(s.line!.counters.every(c => c.consumed === 0 && c.produced === 0)).toBe(true);
  });

  it('completes setup exactly at horizon without reserving inputs or starting processing', () => {
    const c = setupLine(); c.stations[0]!.setupMs = 480 * M; c.stations[0]!.initialRecipeId = 'recipeB';
    const s = new Simulation(compileConfig(c)).runToEnd();
    expect(s.stations[0]).toMatchObject({configuredRecipeId: 'recipeA', targetRecipeId: null, remainingSetupMs: null, remainingProcessingMs: null, reason: 'horizon'});
    expect(s.stocks.some(s => s.location === 'reserved')).toBe(false);
  });

  it('takes a multi-material batch atomically after setup and preserves material cost', () => {
    const c = setupLine(); const station = c.stations[0]!;
    c.recipes[1]!.inputs.push({materialId: 'raw', quantity: '1'});
    station.plan[1]!.processing.repetitions = 2;
    const sim = new Simulation(compileConfig(c));
    const before = sim.advanceTo(8 * M);
    expect(before.stations[0]!.inputs.map(i => i.reservedQuantity)).toEqual([0, 0]);
    const after = sim.advanceTo(9 * M);
    expect(after.stations[0]!.inputs.map(i => i.reservedQuantity)).toEqual([2 * Q, 2 * Q]);
    const done = sim.advanceTo(11 * M);
    expect(done.line!.counters.find(c => c.materialId === 'rawB')!.consumed).toBe(2 * Q);
    expect(done.line!.counters.find(c => c.materialId === 'raw')!.consumed).toBe(4 * Q);
    expect(done.line!.counters.find(c => c.materialId === 'b')!.soldCost).toBe('24000000');
  });

  it('waits for the complete kit before setting up', () => {
    const c = setupLine(); c.initialStocks = c.initialStocks.filter(s => s.materialId !== 'rawB');
    const s = new Simulation(compileConfig(c)).advanceTo(10 * M);
    expect(s.stations[0]).toMatchObject({status: 'starved', configuredRecipeId: 'recipeA', remainingSetupMs: null});
  });

  it('waits for held output before changing recipe', () => {
    const c = blockedCyclicLine(false); c.stations[0]!.setupMs = 7 * M;
    const s = new Simulation(compileConfig(c)).advanceTo(3 * M);
    expect(s.stations[0]).toMatchObject({status: 'blocked', configuredRecipeId: 'recipeA', remainingSetupMs: null});
  });

  it('finishes setup at lunch close and waits until opening before taking the kit', () => {
    const c = setupLine(); c.stations[0]!.initialRecipeId = 'recipeB'; c.stations[0]!.setupMs = 240 * M;
    const sim = new Simulation(compileConfig(c));
    const s = sim.advanceTo(240 * M);
    expect(s.stations[0]).toMatchObject({configuredRecipeId: 'recipeA', remainingSetupMs: null, remainingProcessingMs: null, reason: 'lunch'});
    expect(s.stocks.some(s => s.location === 'reserved')).toBe(false);
    expect(sim.advanceTo(300 * M).stations[0]).toMatchObject({status: 'processing', remainingProcessingMs: M});
  });

  it('resumes setup across a 24:00 close coincident with the next opening', () => {
    const c = setupLine();
    c.calendar = {shiftStartMs: 0, lunchStartMs: 12 * 60 * M, lunchEndMs: 13 * 60 * M, shiftEndMs: DAY};
    c.durationMs = 2 * DAY;
    c.stations[0]!.initialRecipeId = 'recipeB'; c.stations[0]!.setupMs = DAY;
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(DAY).stations[0]).toMatchObject({status: 'setup', remainingSetupMs: 60 * M});
    const s = sim.advanceTo(DAY + 60 * M);
    expect(s.stations[0]).toMatchObject({status: 'processing', remainingSetupMs: null, remainingProcessingMs: M});
    expect(sim.advanceTo(DAY + 61 * M).line!.counters.find(c => c.materialId === 'a')!.produced).toBe(Q);
  });

  it('counts stale setup completions without duplicate production after multiple pauses', () => {
    const c = setupLine(); c.durationMs += DAY;
    c.stations[0]!.initialRecipeId = 'recipeB'; c.stations[0]!.setupMs = 500 * M;
    const sim = new Simulation(compileConfig(c));
    let stale = 0;
    while (sim.nextEventTime() !== null && sim.nextEventTime()! <= DAY + 20 * M) stale += sim.step()!.staleCompletions;
    expect(stale).toBeGreaterThan(0);
    expect(sim.getSnapshot().stations[0]).toMatchObject({status: 'processing', configuredRecipeId: 'recipeA', remainingProcessingMs: M});
    const s = sim.advanceTo(DAY + 21 * M);
    expect(s.line!.counters.find(c => c.materialId === 'a')!.produced).toBe(Q);
    expect(s.line!.counters.find(c => c.materialId === 'raw')!.consumed).toBe(Q);
    // Setup contributes no useful processing provenance.
    const sale = s.line!.transfers.find(t => t.materialId === 'a');
    expect(sale?.quantity).toBe(Q);
  });

  it('samples processing once with the original ordinal after an initial setup crosses lunch', () => {
    const c = setupLine(); const station = c.stations[0]!;
    station.initialRecipeId = 'recipeB'; station.setupMs = 250 * M; station.plan[0]!.processing.cv = 0.5;
    const sim = new Simulation(compileConfig(c));
    expect(sim.advanceTo(300 * M).stations[0]).toMatchObject({status: 'setup', remainingSetupMs: 10 * M});
    const s = sim.advanceTo(310 * M);
    expect(s.stations[0]).toMatchObject({status: 'processing', operationDurationMs: processingDuration(M, 0.5, c.seed, 's1', 'recipeA', 0)});
    expect(s.stations[0]!.inputs.find(i => i.materialId === 'raw')!.reservedQuantity).toBe(Q);
  });
});
