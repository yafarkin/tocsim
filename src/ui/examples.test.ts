import { describe, expect, it } from 'vitest';
import { Simulation } from '../engine/simulation';
import { compileConfig } from '../engine/config';
import { Runner } from '../runner/runner';
import type { RunnerHost } from '../runner/runner';
import { defaultBatchProfiles, exampleIds, exampleRuns, previewConfig } from './preview';

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
    expect(balanced.stations.every(s => s.inputs[0]!.quantity === 0 && s.output.heldQuantity === 0)).toBe(true);
    expect(queue.stations.find(s => s.stationId === 'work')!.inputs[0]!.quantity).toBeGreaterThan(at('queue', 20).stations.find(s => s.stationId === 'work')!.inputs[0]!.quantity);
    expect(queue.stations.find(s => s.stationId === 'prep')!.status).toBe('processing');
    expect(blocked.stations.find(s => s.stationId === 'prep')).toMatchObject({status: 'blocked', reason: 'output', blockedBy: [{stationId: 'work', location: 'input'}]});
    expect(blocked.stations.find(s => s.stationId === 'work')!.inputs[0]!.quantity).toBe(1_000_000);
  });
});

describe('batch playback acceptance', () => {
  it.each(['sequential', 'simultaneous'] as const)('%s batches with CV survive pause, speed changes and replay', mode => {
    const c = previewConfig('batches', 0.5, 0);
    c.stations[0]!.plan[0]!.processing.mode = mode;
    const run = compileConfig(c), expected = new Simulation(run).runToEnd();
    for (const speed of [60, 300, 1800, 'max'] as const) {
      const host = new Host(), runner = new Runner(run, undefined, host);
      runner.setSpeed(speed); runner.step(); runner.step();
      const paused = runner.getView().model;
      host.time += 60_000; runner.setSpeed(300);
      expect(runner.getView().model).toBe(paused);
      runner.setSpeed(speed); runner.resume(); host.drain();
      expect(runner.getView().model).toEqual(expected);
      runner.repeat(); host.drain(); expect(runner.getView().model).toEqual(expected); runner.dispose();
    }
  });
});


describe('batch example configuration', () => {
  it('keeps profiles independent and capacities sufficient throughout the UI range', () => {
    const profiles = structuredClone(defaultBatchProfiles);
    for (const repetitions of [1, 5, 10]) for (const mode of ['sequential', 'simultaneous'] as const) {
      profiles.prep = {mode, repetitions, transportThreshold: repetitions};
      profiles.work = {mode, repetitions, transportThreshold: 1};
      const run = compileConfig(previewConfig('batches', 0.25, 0, profiles));
      expect(run.resolved.stations.find(s => s.id === 'prep')).toMatchObject({mode, repetitions, transportThreshold: repetitions * 1_000_000, cv: 0.25});
      expect(new Simulation(run).runToEnd().line!.counters.find(c => c.materialId === 'product')!.sold).toBeGreaterThan(0);
    }
    expect(defaultBatchProfiles.prep).toEqual({mode: 'sequential', repetitions: 6, transportThreshold: 3});
    expect(compileConfig(previewConfig('queue', 0, 42, profiles)).calculationHash).toBe(exampleRuns.queue.calculationHash);
  });
});
