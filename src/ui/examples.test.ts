import { describe, expect, it } from 'vitest';
import { Simulation } from '../engine/simulation';
import { Runner } from '../runner/runner';
import type { RunnerHost } from '../runner/runner';
import { exampleIds, exampleRuns } from './preview';

class Host implements RunnerHost {
  time = 0;
  callback: (() => void) | null = null;
  now() {return this.time;}
  request(callback: () => void) {this.callback = callback; return callback;}
  cancel() {this.callback = null;}
  drain() {
    let turns = 0;
    while (this.callback) {
      if (++turns > 2000) throw new Error('Run did not finish');
      const callback = this.callback; this.callback = null;
      this.time += 60_000; callback();
    }
  }
}
describe('technical examples', () => {
  it.each(exampleIds)('%s matches the engine at every playback mode and on repeat', id => {
    const run = exampleRuns[id], expected = new Simulation(run).runToEnd();
    for (const speed of [1, 60, 300, 1800, 'max'] as const) {
      const host = new Host(), runner = new Runner(run, undefined, host);
      runner.setSpeed(speed); runner.start(); host.drain();
      expect(runner.getView().status).toBe('finished');
      expect(runner.getView().model).toEqual(expected);
      runner.repeat(); host.drain(); expect(runner.getView().model).toEqual(expected);
      runner.dispose();
    }
    const runner = new Runner(run);
    let steps = 0;
    while (!['finished', 'error'].includes(runner.getView().status)) {
      runner.step(); if (++steps > 2000) throw new Error('Step run did not finish');
    }
    expect(runner.getView().model).toEqual(expected); runner.dispose();
  });
  it('distinguishes balanced flow, growing queues and blocked output with real snapshots', () => {
    const at = (id: typeof exampleIds[number], minutes: number) => new Simulation(exampleRuns[id]).advanceTo(minutes * 60_000);
    const balanced = at('balanced', 46), queue = at('queue', 46), blocked = at('blocking', 46);
    expect(balanced.stations.every(s => s.input.quantity === 0 && s.output.heldQuantity === 0)).toBe(true);
    expect(queue.stations.find(s => s.stationId === 'work')!.input.quantity).toBeGreaterThan(at('queue', 20).stations.find(s => s.stationId === 'work')!.input.quantity);
    expect(queue.stations.find(s => s.stationId === 'prep')!.status).toBe('processing');
    expect(blocked.stations.find(s => s.stationId === 'prep')).toMatchObject({status: 'blocked', reason: 'output', blockedBy: [{stationId: 'work', location: 'input'}]});
    expect(blocked.stations.find(s => s.stationId === 'work')!.input.quantity).toBe(1_000_000);
  });
});
