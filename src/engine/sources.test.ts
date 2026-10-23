import { describe, expect, it } from 'vitest';
import { compileConfig, ConfigError } from './config';
import { createCalendar, DAY_MS } from './calendar';
import { EventScheduler } from './events';
import { consumeStock } from './inventory';
import { createPushHandlers, createPushScheduler, createPushState, scheduleInitialSources } from './sources';
import { line } from './test-fixtures';
import type { DeepReadonly, EditorConfig } from './config';
import type { Snapshot } from './state';

const minute = 60_000, q = (amount: number) => amount * 1_000_000;
function dual(): EditorConfig {
  const config = line(); config.initialStocks = [];
  config.sources[0]!.availability = 'warehouse'; config.sources[0]!.quantity = '3';
  config.sources.push({...config.sources[0]!, id: 'source2'});
  config.routes.push({id: 'rawRoute2', fromId: 'source2', toId: 's1', materialId: 'raw'});
  config.stations[0]!.inputBuffer = {kind: 'infinite'};
  config.initialStocks.push({id: 'warehouseRaw', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '5', cost: '0.000007'});
  return config;
}
function parallel(): EditorConfig {
  const config = dual();
  config.recipes = [config.recipes[0]!]; config.recipes[0]!.output.materialId = 'product';
  config.materials = config.materials.filter(m => m.id !== 'part');
  config.stations[1]!.plan[0]!.recipeId = 'cut';
  config.stations.forEach(s => {s.inputBuffer = {kind: 'quantity', quantity: '10'};});
  config.routes = [
    {id: 'r1', fromId: 'source', toId: 's1', materialId: 'raw'},
    {id: 'r2', fromId: 'source2', toId: 's2', materialId: 'raw'},
    {id: 'r3', fromId: 's1', toId: 'market', materialId: 'product'},
    {id: 'r4', fromId: 's2', toId: 'market', materialId: 'product'},
  ];
  return config;
}
const quantityAt = (snapshot: DeepReadonly<Pick<Snapshot, 'stocks'>>, owner: string, material = 'raw') => snapshot.stocks.filter(s => s.ownerId === owner && s.materialId === material).reduce((sum, s) => sum + s.quantity, 0);

describe('shared finite warehouse and simultaneous attempts', () => {
  it('does not duplicate stock or re-purchase its actual cost (V23)', () => {
    const loop = createPushScheduler(compileConfig(dual()));
    loop.step(); const snapshot = loop.getSnapshot();
    expect(quantityAt(snapshot, 'warehouse')).toBe(0);
    expect(quantityAt(snapshot, 's1')).toBe(q(5));
    expect(snapshot.stocks.reduce((sum, s) => sum + BigInt(s.cost), 0n)).toBe(7n);
    expect(snapshot.sources.map(s => s.releasedQuantity)).toEqual([q(3), q(2)]);
    expect(snapshot.sources.map(s => s.purchasedCost)).toEqual(['0', '0']);
    expect(snapshot.sources[1]!.lastAttempt!.blockedBy).toEqual(['stock']);
    loop.step();
    expect(quantityAt(loop.getSnapshot(), 's1')).toBe(q(5));
    expect(loop.getSnapshot().sourceTransfers).toEqual([]);
  });

  it('gives priority to the receiver before source ID in shared-stock competition', () => {
    const config = parallel(); config.stations[1]!.priority = 10;
    const loop = createPushScheduler(compileConfig(config)); loop.step();
    expect(loop.getSnapshot().sourceTransfers.map(t => [t.sourceId, t.quantity])).toEqual([['source2', q(3)], ['source', q(2)]]);
    expect(quantityAt(loop.getSnapshot(), 's2')).toBe(q(3));
  });

  it('uses source ID on equal receiver priority, independent of input array order', () => {
    const config = parallel(), reordered = structuredClone(config);
    reordered.sources.reverse(); reordered.stations.reverse(); reordered.routes.reverse();
    const a = createPushScheduler(compileConfig(config)), b = createPushScheduler(compileConfig(reordered));
    a.step(); b.step();
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    expect(a.getSnapshot().sourceTransfers[0]!.sourceId).toBe('source');
  });

  it('does not let a full receiver suppress another source attempt', () => {
    const config = parallel();
    config.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    config.initialStocks.push({id: 'prefill', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '1', cost: '1'});
    const loop = createPushScheduler(compileConfig(config)); loop.step();
    expect(loop.getSnapshot().sources[0]!.lastAttempt!.blockedBy).toEqual(['capacity']);
    expect(quantityAt(loop.getSnapshot(), 's2')).toBe(q(3));
    expect(quantityAt(loop.getSnapshot(), 'warehouse')).toBe(q(2));
  });

  it('preserves known release time and finite-stock provenance', () => {
    const config = dual(), run = compileConfig(config), state = createPushState(run);
    state.stocks[0]!.provenance.defective = true; state.stocks[0]!.provenance.defectSourceIds = ['initialDefect'];
    state.stocks[0]!.provenance.processingMs = {prior: 13n};
    const loop = new EventScheduler(run, state, createPushHandlers(run)); scheduleInitialSources(loop, run); loop.step();
    expect(loop.getSnapshot().stocks.every(s => s.provenance.origin.kind === 'known')).toBe(true);
    expect(loop.getSnapshot().stocks.every(s => s.provenance.defective)).toBe(true);
    expect(loop.getSnapshot().stocks.reduce((sum, s) => sum + BigInt(s.provenance.processingMs.prior!), 0n)).toBe(13n);
  });
});

describe('virtual purchases, capacity and push schedule', () => {
  it('purchases only admitted fractional quantity and records transfer data', () => {
    const config = line();
    config.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    config.initialStocks[0]!.quantity = '0.4'; config.initialStocks[0]!.cost = '4';
    const loop = createPushScheduler(compileConfig(config)); loop.step();
    const snapshot = loop.getSnapshot();
    expect(snapshot.sources[0]!.releasedQuantity).toBe(q(0.6));
    expect(snapshot.sources[0]!.purchasedCost).toBe('6000000');
    expect(snapshot.sourceTransfers[0]).toMatchObject({sourceId: 'source', stationId: 's1', quantity: q(0.6), cost: '6000000', timeMs: 0});
    expect(snapshot.sources[0]!.lastAttempt!.blockedBy).toEqual(['capacity']);
    loop.step(); expect(loop.getSnapshot().sources[0]!.purchasedCost).toBe('6000000');
  });

  it('rounds one purchase per attempt, then splits its cost between receivers', () => {
    const config = parallel(); config.sources = [config.sources[0]!]; config.sources[0]!.availability = 'virtual'; config.sources[0]!.quantity = '1';
    config.materials.find(m => m.id === 'raw')!.purchasePrice = '0.000001';
    config.initialStocks = []; config.stations.forEach(s => {s.inputBuffer = {kind: 'quantity', quantity: '0.5'};});
    config.routes.find(r => r.fromId === 'source2')!.fromId = 'source';
    const loop = createPushScheduler(compileConfig(config)); loop.step();
    expect(loop.getSnapshot().sourceTransfers.map(t => t.cost)).toEqual(['0', '1']);
    expect(loop.getSnapshot().sources[0]!.purchasedCost).toBe('1');
  });

  it('does not accumulate debt for attempts missed while input was full', () => {
    const config = line(); config.initialStocks = []; config.stations[0]!.inputBuffer = {kind: 'quantity', quantity: '1'};
    const run = compileConfig(config), handlers = createPushHandlers(run);
    const loop = new EventScheduler(run, createPushState(run), {...handlers,
      calendar: ctx => {consumeStock(ctx.state, {ownerId: 's1', location: 'input'}, 'raw', q(1));},
    });
    scheduleInitialSources(loop, run);
    loop.schedule({kind: 'calendar', boundary: 'open', stationId: null, id: 'test-drain', timeMs: 3 * minute - 1});
    loop.advanceTo(3 * minute);
    expect(quantityAt(loop.getSnapshot(), 's1')).toBe(q(1));
    expect(loop.getSnapshot().sources[0]!.attempts).toBe(4);
    expect(loop.getSnapshot().sources[0]!.releasedQuantity).toBe(q(2));
  });

  it('keeps V34 across lunch/night and excludes the final horizon', () => {
    const config = line(); config.initialStocks = []; config.sources[0]!.intervalMs = 7 * minute;
    config.stations[0]!.inputBuffer = {kind: 'infinite'};
    config.durationMs = createCalendar(config.calendar, 2).endTimeMs;
    const loop = createPushScheduler(compileConfig(config));
    loop.advanceTo(238 * minute); expect(loop.getSnapshot().sources[0]!.lastAttempt!.timeMs).toBe(238 * minute);
    expect(loop.step()!.timeMs).toBe(305 * minute);
    loop.advanceTo(536 * minute); expect(loop.getSnapshot().sources[0]!.lastAttempt!.timeMs).toBe(536 * minute);
    expect(loop.step()!.timeMs).toBe(DAY_MS + 3 * minute);
    loop.advanceTo(config.durationMs);
    expect(loop.getSnapshot().sources[0]!.attempts).toBe(138);
    expect(loop.getSnapshot().sources[0]!.lastAttempt!.timeMs).toBeLessThan(config.durationMs);
    expect(loop.step()).toBeNull();
  });

  it('has one finite admission at each timestamp even with infinite input capacity', () => {
    const config = line(); config.initialStocks = []; config.stations[0]!.inputBuffer = {kind: 'infinite'};
    const loop = createPushScheduler(compileConfig(config));
    expect(loop.step()!.timeMs).toBe(0); expect(quantityAt(loop.getSnapshot(), 's1')).toBe(q(1));
    expect(loop.step()!.timeMs).toBe(minute); expect(quantityAt(loop.getSnapshot(), 's1')).toBe(q(2));
  });

  it('produces identical state by step and advanceTo and independent instances', () => {
    const run = compileConfig(dual()), a = createPushScheduler(run), b = createPushScheduler(run);
    a.step(); a.step(); a.step(); b.advanceTo(a.getSnapshot().timeMs);
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
    expect(Object.isFrozen(a.getSnapshot().sources[0]!.lastAttempt!.blockedBy)).toBe(true);
    expect(a.getSnapshot().schemaVersion).toBe(16);
  });
});

describe('source boundary validation', () => {
  it('rejects mixed availability for the same shared raw material', () => {
    const config = dual(); config.sources[1]!.availability = 'virtual';
    expect(() => compileConfig(config)).toThrow(ConfigError);
  });

  it('rejects a source event outside its work-time schedule without committing', () => {
    const run = compileConfig(line()); const loop = new EventScheduler(run, createPushState(run), createPushHandlers(run));
    loop.schedule({kind: 'source', sourceId: 'source', id: 'bad-time', timeMs: 1});
    expect(() => loop.step()).toThrow('work-time schedule');
    expect(loop.getSnapshot().timeMs).toBe(0);
    expect(loop.getSnapshot().sources[0]!.attempts).toBe(0);
  });
});
