import { describe, expect, it } from 'vitest';
import { compileConfig } from '../engine/config';
import type { DeepReadonly } from '../engine/config';
import { Simulation } from '../engine/simulation';
import { cyclicLine, line } from '../engine/test-fixtures';
import { Runner, RunnerError, TURN_BUDGET_MS } from './runner';
import type { RunnerHost, RunnerView } from './runner';

class FakeHost implements RunnerHost {
  time = 0;
  readCost = 0;
  private ordinal = 0;
  readonly callbacks = new Map<number, () => void>();
  now(): number {this.time += this.readCost; return this.time;}
  request(callback: () => void): number {const id = ++this.ordinal; this.callbacks.set(id, callback); return id;}
  cancel(handle: unknown) {this.callbacks.delete(handle as number);}
  next(delta = 1) {
    this.time += delta;
    const entry = this.callbacks.entries().next().value;
    if (!entry) throw new Error('No pending turn');
    this.callbacks.delete(entry[0]); entry[1]();
  }
  drain(delta = 1) {
    let turns = 0;
    while (this.callbacks.size) {
      if (++turns > 10_000) throw new Error('Runner failed to finish');
      this.next(delta);
    }
    return turns;
  }
}
function config() {
  const source = line(); source.initialStocks = [];
  source.sources[0]!.availability = 'warehouse';
  source.initialStocks.push({id: 'warehouseStock', ownerId: 'warehouse', location: 'warehouse', materialId: 'raw', quantity: '5', cost: '50'});
  return compileConfig(source);
}

describe('playback modes preserve deterministic results', () => {
  it('normal, accelerated, maximum and full-timestamp steps match the engine', () => {
    const run = config(), expected = new Simulation(run).runToEnd();
    for (const speed of [1, 120, 'max'] as const) {
      const host = new FakeHost(), runner = new Runner(run, undefined, host);
      runner.setSpeed(speed); runner.start(); host.drain(60_000);
      expect(runner.getView().status).toBe('finished');
      expect(runner.getView().model).toEqual(expected);
      expect(runner.runConfig).toBe(run);
    }
    const host = new FakeHost(), stepped = new Runner(run, undefined, host);
    let steps = 0;
    do {stepped.step(); if (++steps > 2000) throw new Error('Too many steps');}
    while (stepped.getView().status === 'paused');
    expect(stepped.getView().status).toBe('finished');
    expect(stepped.getView().model).toEqual(expected);
    expect(host.callbacks.size).toBe(0);
  });

  it('retains fractional real-time progress and applies a speed change at its real-time boundary', () => {
    const host = new FakeHost(), runner = new Runner(config(), undefined, host);
    runner.setSpeed(0.5); runner.start();
    host.next(1); expect(runner.getView().model.timeMs).toBe(0);
    host.next(1); expect(runner.getView().model.timeMs).toBe(1);
    host.time += 1000; runner.setSpeed(2);
    host.next(1000);
    expect(runner.getView().model.timeMs).toBe(2501);
    runner.dispose();
  });

  it('switches maximum mode back to real-time from the achieved model time', () => {
    const host = new FakeHost(), runner = new Runner(config(), undefined, host);
    runner.setSpeed('max'); runner.start(); host.next();
    expect(runner.getView().status).toBe('running');
    const before = runner.getView().model.timeMs;
    runner.setSpeed(1); host.next(100);
    expect(runner.getView().model.timeMs).toBe(before + 100);
    runner.dispose();
  });
});

describe('pause, step, stop and repeat', () => {
  it('does no model work while paused and discards old real-time backlog on resume', () => {
    const host = new FakeHost(), runner = new Runner(config(), undefined, host);
    runner.setSpeed('max'); runner.start(); host.next();
    const stale = [...host.callbacks.values()][0]!;
    runner.pause(); const paused = runner.getView();
    host.time += 3_600_000;
    stale();
    expect(runner.getView()).toBe(paused);
    expect(host.callbacks.size).toBe(0);
    runner.setSpeed(1); runner.resume(); host.next(100);
    expect(runner.getView().model.timeMs).toBe(paused.model.timeMs + 100);
    runner.dispose();
  });

  it('step processes one whole timestamp and remains paused with no timer', () => {
    const run = config(), host = new FakeHost(), runner = new Runner(run, undefined, host), reference = new Simulation(run);
    reference.step(); runner.step();
    expect(runner.getView().status).toBe('paused');
    expect(runner.getView().model).toEqual(reference.getSnapshot());
    runner.resume(); const stale = [...host.callbacks.values()][0]!;
    reference.step(); runner.step(); stale();
    expect(runner.getView().model).toEqual(reference.getSnapshot());
    expect(runner.getView().status).toBe('paused'); expect(host.callbacks.size).toBe(0);
  });

  it('stops at the achieved time and does not confuse stop with pause or horizon', () => {
    const host = new FakeHost(), runner = new Runner(config(), undefined, host);
    runner.start(); host.next(120_000);
    const achieved = runner.getView().model.timeMs;
    runner.stop(); const stopped = runner.getView();
    expect(stopped.status).toBe('stopped');
    expect(stopped.model.line!.termination).toBe('stopped');
    expect(stopped.model.timeMs).toBe(achieved);
    runner.resume(); runner.start(); runner.step();
    expect(runner.getView()).toBe(stopped); expect(host.callbacks.size).toBe(0);
    runner.repeat(); runner.setSpeed('max'); host.drain();
    runner.stop(); expect(runner.getView().status).toBe('finished');
    expect(runner.getView().model.line!.termination).toBe('horizon');
  });

  it('repeat starts the same config anew, keeps speed and fences an old callback', () => {
    const host = new FakeHost(), run = config(), runner = new Runner(run, undefined, host);
    runner.setSpeed('max'); runner.start(); host.next();
    const stale = [...host.callbacks.values()][0]!;
    runner.repeat();
    expect(runner.getView().model.timeMs).toBe(0);
    expect(runner.getView().model.sources.every(s => s.attempts === 0)).toBe(true);
    expect(runner.getView().status).toBe('running'); expect(runner.getView().speed).toBe('max');
    stale(); expect(runner.getView().model.sources[0]!.attempts).toBe(0);
    expect(host.callbacks.size).toBe(1);
    host.drain();
    expect(runner.getView().model).toEqual(new Simulation(run).runToEnd());
    expect(runner.runConfig).toBe(run);
  });

  it('supports immediate pause and stop before the first deferred turn', () => {
    const host = new FakeHost(), runner = new Runner(config(), undefined, host);
    runner.start(); runner.pause();
    expect(runner.getView().model.sources[0]!.attempts).toBe(0);
    expect(host.callbacks.size).toBe(0);
    runner.stop(); expect(runner.getView().model.timeMs).toBe(0);
    expect(runner.getView().status).toBe('stopped');
  });
});

describe('bounded turns and safe publication', () => {
  it('yields between portions at maximum speed so pause can interrupt before the horizon', () => {
    const host = new FakeHost(), updates: DeepReadonly<RunnerView>[] = [];
    const runner = new Runner(config(), view => {updates.push(view);}, host);
    runner.setSpeed('max'); runner.start();
    expect(runner.getView().model.sources[0]!.attempts).toBe(0);
    host.next();
    expect(runner.getView().status).toBe('running');
    expect(runner.getView().model.timeMs).toBeLessThan(runner.runConfig.resolved.durationMs);
    expect(host.callbacks.size).toBe(1);
    const current = runner.getView(); runner.pause();
    expect(runner.getView().model).toBe(current.model);
    expect(host.callbacks.size).toBe(0);
    expect(updates.filter(view => view.status === 'running')).toHaveLength(2);
  });

  it('also yields on the elapsed turn budget between atomic timestamps', () => {
    const host = new FakeHost(); host.readCost = TURN_BUDGET_MS;
    const runner = new Runner(config(), undefined, host);
    runner.setSpeed('max'); runner.start(); host.next(0);
    expect(runner.getView().status).toBe('running');
    expect(runner.getView().model.timeMs).toBe(0);
    expect(runner.getView().model.sources[0]!.attempts).toBe(1);
    expect(host.callbacks.size).toBe(1); runner.dispose();
  });

  it('a pause from the update consumer cancels the next turn', () => {
    const host = new FakeHost(); let runner: Runner;
    runner = new Runner(config(), view => {
      if (view.status === 'running' && view.model.sources[0]!.attempts > 0) runner.pause();
    }, host);
    runner.setSpeed('max'); runner.start(); host.next();
    expect(runner.getView().status).toBe('paused'); expect(host.callbacks.size).toBe(0);
  });

  it('publishes only immutable JSON data and leaves all run parameters unchanged', () => {
    const host = new FakeHost(), run = config(), hash = run.calculationHash;
    const runner = new Runner(run, undefined, host); runner.step();
    const view = runner.getView();
    expect(() => (view.model.stocks as unknown as unknown[]).pop()).toThrow(TypeError);
    expect(() => (view as unknown as {speed: number}).speed = 100).toThrow(TypeError);
    expect(() => JSON.stringify(view)).not.toThrow();
    runner.setSpeed(100);
    expect(run.calculationHash).toBe(hash); expect(run.resolved.stations[0]!.timeMs).toBe(60_000);
    expect(runner.runConfig).toBe(run);
  });

  it('disposal cancels timers, ignores stale callbacks and never notifies a removed UI', () => {
    const host = new FakeHost(); let notifications = 0;
    const runner = new Runner(config(), () => {notifications++;}, host);
    runner.start(); const stale = [...host.callbacks.values()][0]!;
    runner.dispose(); const before = notifications; stale(); runner.dispose();
    expect(host.callbacks.size).toBe(0); expect(notifications).toBe(before);
    expect(runner.getView().status).toBe('disposed');
    expect(() => runner.start()).toThrow(RunnerError);
  });

  it('default main-thread timer host finishes asynchronously', async () => {
    const run = config();
    const view = await new Promise<DeepReadonly<RunnerView>>((resolve, reject) => {
      const runner = new Runner(run, view => {
        if (view.status === 'error') {runner.dispose(); reject(new Error('Default host failed'));}
        if (view.status === 'finished') {runner.dispose(); resolve(view);}
      });
      runner.setSpeed('max'); runner.start();
      expect(runner.getView().model.sources[0]!.attempts).toBe(0);
    });
    expect(view.model).toEqual(new Simulation(run).runToEnd());
  });
});

describe('runner diagnostics', () => {
  it.each([0, -1, NaN, Infinity])('rejects invalid speed %s without changing playback', speed => {
    const runner = new Runner(config(), undefined, new FakeHost()), before = runner.getView();
    expect(() => runner.setSpeed(speed)).toThrow(RunnerError);
    expect(runner.getView()).toBe(before);
  });

  it('reports a nonmonotonic host clock on the last consistent model interval', () => {
    const host = new FakeHost(), runner = new Runner(config(), undefined, host);
    runner.start(); host.next(1000); const achieved = runner.getView().model;
    host.time = -100; host.next(0);
    expect(runner.getView()).toMatchObject({status: 'error', error: {code: 'clock'}});
    expect(runner.getView().model).toBe(achieved); expect(host.callbacks.size).toBe(0);
    expect(runner.getFailure()).toBeInstanceOf(RunnerError);
  });

  it('reports engine failure as data with no partial timestamp or pending timer', () => {
    const source = line(); source.initialStocks = []; source.stations[0]!.inputBuffer = {kind: 'infinite'};
    source.sources[0]!.quantity = '9007199254.740991';
    const host = new FakeHost(), runner = new Runner(compileConfig(source), undefined, host);
    runner.start(); host.next(0);
    expect(runner.getView()).toMatchObject({status: 'error', error: {code: 'range'}});
    expect(runner.getView().error!.messages.en).toContain('range');
    expect(runner.getView().model.line!.termination).toBe('error');
    expect(runner.getView().model.timeMs).toBe(0);
    expect(runner.getView().model.sources[0]!.attempts).toBe(0);
    expect(runner.getFailure()).not.toBeNull(); expect(host.callbacks.size).toBe(0);
  });
});


describe('cyclic plans under playback controls', () => {
  it('preserves CV results through pause, speed change, repeat and full-timestamp steps', () => {
    const config = cyclicLine();
    config.stations[0]!.plan.forEach(row => {row.processing.cv = 0.5;});
    const run = compileConfig(config), expected = new Simulation(run).runToEnd();
    const host = new FakeHost(), runner = new Runner(run, undefined, host);
    runner.setSpeed(60); runner.start(); host.next(5000);
    runner.pause(); const paused = runner.getView().model;
    host.time += 1_000_000;
    expect(runner.getView().model).toBe(paused);
    runner.setSpeed('max'); runner.resume(); host.drain(1000);
    expect(runner.getView().model).toEqual(expected);
    runner.repeat(); host.drain(1000);
    expect(runner.getView().model).toEqual(expected);
    const stepped = new Runner(run, undefined, new FakeHost());
    do {stepped.step();} while (stepped.getView().status === 'paused');
    expect(stepped.getView().model).toEqual(expected);
    runner.dispose(); stepped.dispose();
  });
});
