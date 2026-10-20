import { describe, expect, it } from 'vitest';
import { compileConfig } from './config';
import { activeWorkMs, advanceWork, calendarForDuration } from './calendar';
import { completeProduction, createInventory, reserveInputs } from './inventory';
import { EventError, EventScheduler, MAX_TRANSITIONS_PER_TIMESTAMP } from './events';
import type { EventContext, EventHandlers, ModelEvent } from './events';
import type { EngineState } from './state';
import { line } from './test-fixtures';

function initial(): EngineState {
  const run = compileConfig(line());
  return {...createInventory(run), timeMs: 0, stations: run.resolved.stations.map(s => ({stationId: s.id, operationVersion: 0, status: 'idle', reason: 'notStarted', remainingProcessingMs: null}))};
}
const run = () => compileConfig(line());
function scheduler(handlers: EventHandlers = {}) { return new EventScheduler(run(), initial(), handlers); }
const transfer = (id: string, timeMs: number): ModelEvent => ({kind: 'transfer', producerId: 's1', id, timeMs});
function errorCode(action: () => unknown, code: string) {
  expect(action).toThrow(EventError);
  try { action(); } catch (error) { expect(error).toHaveProperty('code', code); }
}

describe('timestamp ordering and stable snapshots', () => {
  it('sorts time, phase and stable ID independently of insertion order', () => {
    const events: ModelEvent[] = [
      {kind: 'dispatch', stationId: 's1', id: 'z', timeMs: 10},
      {kind: 'source', sourceId: 'source', id: 'a', timeMs: 10},
      transfer('z', 10), transfer('a', 10), transfer('later', 11),
      {kind: 'calendar', stationId: null, boundary: 'close', id: 'a', timeMs: 10},
      {kind: 'completion', stationId: 's1', operationVersion: 0, id: 'a', timeMs: 10},
    ];
    const execute = (input: ModelEvent[]) => {
      const order: string[] = [];
      const loop = scheduler({
        integrate: (_state, from, to) => {order.push(`integrate:${from}:${to}`);},
        completion: (_ctx, e) => {order.push(`completion:${e.id}`);},
        calendar: (_ctx, e) => {order.push(`calendar:${e.id}`);},
        source: (_ctx, e) => {order.push(`source:${e.id}`);},
        transfer: (_ctx, e) => {order.push(`transfer:${e.id}`);},
        dispatch: (_ctx, e) => {order.push(`dispatch:${e.id}`);},
      });
      input.forEach(e => loop.schedule(e));
      expect(loop.step()?.processedEvents).toBe(6);
      return order;
    };
    const expected = ['integrate:0:10', 'completion:a', 'calendar:a', 'source:a', 'transfer:a', 'transfer:z', 'dispatch:z'];
    expect(execute(events)).toEqual(expected);
    expect(execute([...events].reverse())).toEqual(expected);
  });

  it('settles transfers created by dispatch before publishing one snapshot', () => {
    let loop: EventScheduler;
    let retained: EventContext | null = null;
    const observations: number[] = [];
    loop = scheduler({
      dispatch: ctx => {
        retained = ctx;
        ctx.state.stations[0]!.remainingProcessingMs = 1;
        observations.push(loop.getSnapshot().timeMs);
        ctx.schedule(transfer('after-dispatch', ctx.timeMs));
      },
      transfer: ctx => {
        expect(ctx.state.stations[0]!.remainingProcessingMs).toBe(1);
        ctx.state.stations[0]!.remainingProcessingMs = 2;
        observations.push(loop.getSnapshot().timeMs);
      },
    });
    loop.schedule({kind: 'dispatch', stationId: 's1', id: 'start', timeMs: 10});
    expect(loop.step()?.processedEvents).toBe(2);
    expect(observations).toEqual([0, 0]);
    expect(loop.getSnapshot().timeMs).toBe(10);
    expect(loop.getSnapshot().stations[0]!.remainingProcessingMs).toBe(2);
    const context = retained as unknown as EventContext;
    context.state.stations[0]!.remainingProcessingMs = 999;
    expect(loop.getSnapshot().stations[0]!.remainingProcessingMs).toBe(2);
    errorCode(() => context.schedule(transfer('late-context', 11)), 'order');
  });

  it('matches repeated steps and advanceTo on the same event sequence', () => {
    const build = () => {
      const loop = scheduler({
        integrate: (state, from, to) => {state.stations[0]!.remainingProcessingMs = (state.stations[0]!.remainingProcessingMs ?? 0) + to - from;},
        transfer: ctx => {ctx.state.stations[1]!.remainingProcessingMs = (ctx.state.stations[1]!.remainingProcessingMs ?? 0) + 1;},
      });
      [3, 20, 20, 99].forEach((time, i) => loop.schedule(transfer(`event${i}`, time)));
      return loop;
    };
    const stepped = build(), advanced = build();
    while (stepped.getSnapshot().timeMs < 99) stepped.step();
    advanced.advanceTo(10); advanced.advanceTo(50); advanced.advanceTo(99);
    expect(advanced.getSnapshot()).toEqual(stepped.getSnapshot());
    const full = build();
    while (full.step() !== null) { /* through automatic horizon */ }
    advanced.advanceTo(run().resolved.durationMs);
    expect(advanced.getSnapshot()).toEqual(full.getSnapshot());
  });

  it('keeps two instances and their operation versions independent', () => {
    const a = scheduler({completion: () => {}}), b = scheduler({completion: () => {}});
    a.invalidateOperation('s1');
    const event: ModelEvent = {kind: 'completion', id: 'finish', stationId: 's1', operationVersion: 0, timeMs: 10};
    a.schedule(event); b.schedule(event);
    expect(a.step()?.staleCompletions).toBe(1);
    expect(b.step()?.staleCompletions).toBe(0);
  });

  it('detaches initial state, scheduled events and published snapshots', () => {
    const state = initial(); const times: number[] = [];
    const loop = new EventScheduler(run(), state, {transfer: (_ctx, event) => {times.push(event.timeMs);}});
    state.stations[0]!.remainingProcessingMs = 99;
    const event = transfer('a', 10); loop.schedule(event); event.timeMs = 20;
    loop.step();
    expect(times).toEqual([10]);
    expect(loop.getSnapshot().stations[0]!.remainingProcessingMs).toBeNull();
    expect(() => { (loop.getSnapshot() as unknown as EngineState).stocks.pop(); }).toThrow(TypeError);
  });
});

describe('completion tokens and calendar boundaries', () => {
  it('does not issue output twice for two completions with the same operation version', () => {
    const state = initial(); const config = run();
    reserveInputs(state, 's1', [config.resolved.recipes.find(r => r.id === 'cut')!.input]);
    const loop = new EventScheduler(config, state, {completion: ctx => {
      completeProduction(ctx.state, 's1', config.resolved.recipes.find(r => r.id === 'cut')!.output, 10);
    }});
    for (const id of ['a', 'b']) loop.schedule({kind: 'completion', stationId: 's1', operationVersion: 0, id, timeMs: 10});
    expect(loop.step()).toMatchObject({processedEvents: 2, staleCompletions: 1});
    const output = loop.getSnapshot().stocks.filter(s => s.location === 'held');
    expect(output).toHaveLength(1); expect(output[0]!.quantity).toBe(10_000_000);
  });

  it('invalidates a paused completion and resumes with the remaining work', () => {
    const config = run(); const state = initial();
    const calendar = calendarForDuration(config.resolved.calendar, config.resolved.durationMs);
    const minute = 60_000, start = 230 * minute, close = 240 * minute, open = 300 * minute;
    state.timeMs = start;
    state.stations[0]!.remainingProcessingMs = 20 * minute;
    reserveInputs(state, 's1', [config.resolved.recipes.find(r => r.id === 'cut')!.input]);
    const loop = new EventScheduler(config, state, {
      integrate: (draft, from, to) => {
        const station = draft.stations[0]!;
        if (station.remainingProcessingMs !== null) station.remainingProcessingMs -= activeWorkMs(calendar, from, to);
      },
      calendar: (ctx, event) => {
        if (event.boundary === 'close') ctx.invalidateOperation('s1');
        else {
          const station = ctx.state.stations[0]!;
          ctx.schedule({kind: 'completion', stationId: 's1', operationVersion: station.operationVersion, id: 'resumed', timeMs: advanceWork(calendar, ctx.timeMs, station.remainingProcessingMs!).timeMs});
        }
      },
      completion: ctx => {
        expect(ctx.state.stations[0]!.remainingProcessingMs).toBe(0);
        completeProduction(ctx.state, 's1', config.resolved.recipes.find(r => r.id === 'cut')!.output, 20 * minute);
        ctx.state.stations[0]!.remainingProcessingMs = null;
      },
    });
    loop.schedule({kind: 'completion', stationId: 's1', operationVersion: 0, id: 'obsolete', timeMs: start + 20 * minute});
    loop.schedule({kind: 'calendar', stationId: null, boundary: 'close', id: 'lunch', timeMs: close});
    loop.schedule({kind: 'calendar', stationId: null, boundary: 'open', id: 'resume', timeMs: open});
    loop.step();
    expect(loop.step()?.staleCompletions).toBe(1);
    loop.step(); loop.step();
    expect(loop.getSnapshot().timeMs).toBe(310 * minute);
    expect(loop.getSnapshot().stocks.filter(s => s.location === 'held')).toHaveLength(1);
  });

  it('accepts completion before closing at the same time, suppressing new horizon starts', () => {
    const order: string[] = []; const end = run().resolved.durationMs;
    const loop = scheduler({
      completion: () => {order.push('completion');},
      calendar: () => {order.push('calendar');},
      source: () => {order.push('source');},
      transfer: () => {order.push('transfer');},
      dispatch: () => {order.push('dispatch');},
    });
    loop.schedule({kind: 'completion', id: 'a', stationId: 's1', operationVersion: 0, timeMs: end});
    loop.schedule({kind: 'calendar', id: 'b', stationId: null, boundary: 'close', timeMs: end});
    loop.schedule({kind: 'source', id: 'c', sourceId: 'source', timeMs: end});
    loop.schedule(transfer('d', end));
    loop.schedule({kind: 'dispatch', id: 'e', stationId: 's1', timeMs: end});
    expect(loop.step()?.finished).toBe(true);
    expect(order).toEqual(['completion', 'calendar', 'transfer']);
    expect(loop.step()).toBeNull();
    errorCode(() => loop.schedule(transfer('after-end', end)), 'order');
  });

  it('advances to the exact horizon even with no production events', () => {
    const intervals: [number, number][] = [];
    const loop = scheduler({integrate: (_state, from, to) => {intervals.push([from, to]);}});
    loop.advanceTo(10);
    expect(loop.step()).toMatchObject({timeMs: run().resolved.durationMs, finished: true});
    expect(intervals).toEqual([[0, 10], [10, run().resolved.durationMs]]);
    expect(loop.step()).toBeNull();
  });
});

describe('diagnostics and atomic timestamp failures', () => {
  it('rolls back a failed timestamp, including valid output before a later error', () => {
    const state = initial(), config = run();
    reserveInputs(state, 's1', [config.resolved.recipes.find(r => r.id === 'cut')!.input]);
    const problem = new Error('test failure');
    const loop = new EventScheduler(config, state, {
      completion: ctx => {completeProduction(ctx.state, 's1', config.resolved.recipes.find(r => r.id === 'cut')!.output, 10);},
      transfer: () => {throw problem;},
    });
    const previous = loop.getSnapshot();
    loop.schedule({kind: 'completion', id: 'a', stationId: 's1', operationVersion: 0, timeMs: 10});
    loop.schedule(transfer('b', 10));
    expect(() => loop.step()).toThrow(problem);
    expect(loop.getSnapshot()).toBe(previous);
    expect(loop.getFailure()).toBe(problem);
    expect(() => loop.advanceTo(20)).toThrow(problem);
  });

  it('limits an infinite immediate chain without publishing its partial state', () => {
    let count = 0;
    const loop = scheduler({transfer: ctx => {
      count++;
      ctx.state.stations[0]!.remainingProcessingMs = count;
      ctx.schedule(transfer('again', ctx.timeMs));
    }});
    loop.schedule(transfer('again', 10));
    errorCode(() => loop.step(), 'limit');
    expect(count).toBe(MAX_TRANSITIONS_PER_TIMESTAMP);
    expect(loop.getSnapshot().timeMs).toBe(0);
    expect(loop.getSnapshot().stations[0]!.remainingProcessingMs).toBeNull();
  });

  it('rejects return to early phases and calls through a scheduler during a handler', () => {
    const loop = scheduler({dispatch: ctx => {
      ctx.schedule({kind: 'calendar', boundary: 'open', stationId: null, id: 'too-late', timeMs: ctx.timeMs});
    }});
    loop.schedule({kind: 'dispatch', stationId: 's1', id: 'a', timeMs: 10});
    errorCode(() => loop.step(), 'order');
    let nested: EventScheduler;
    nested = scheduler({transfer: () => {nested.step();}});
    nested.schedule(transfer('a', 10));
    errorCode(() => nested.step(), 'order');
  });

  it('rejects duplicate keys, invalid times, versions and unknown stations', () => {
    const loop = scheduler();
    loop.schedule(transfer('a', 10));
    errorCode(() => loop.schedule(transfer('a', 10)), 'duplicate');
    for (const time of [-1, 0.5, NaN, run().resolved.durationMs + 1]) errorCode(() => loop.schedule(transfer('invalid', time)), 'value');
    errorCode(() => loop.schedule({kind: 'completion', stationId: 's1', operationVersion: -1, id: 'b', timeMs: 10}), 'value');
    errorCode(() => loop.invalidateOperation('missing'), 'value');
    errorCode(() => loop.advanceTo(-1), 'value');
  });

  it('reports missing handlers and operation version overflow', () => {
    const missing = scheduler(); missing.schedule(transfer('a', 10));
    errorCode(() => missing.step(), 'handler');
    const state = initial(); state.stations[0]!.operationVersion = Number.MAX_SAFE_INTEGER;
    const loop = new EventScheduler(run(), state, {});
    errorCode(() => loop.invalidateOperation('s1'), 'version');
  });

  it('does not reopen a published timestamp with a late external event', () => {
    const loop = scheduler({transfer: () => {}});
    loop.schedule(transfer('a', 0)); loop.step();
    errorCode(() => loop.schedule(transfer('b', 0)), 'order');
    loop.advanceTo(10);
    errorCode(() => loop.schedule(transfer('c', 10)), 'order');
    errorCode(() => loop.advanceTo(9), 'value');
  });
});
