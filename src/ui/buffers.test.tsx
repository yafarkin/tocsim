import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig, ConfigError} from '../engine/config';
import {bufferSettings, routeCapacities, withBuffers} from './buffers';
import {previewConfig} from './preview';
import {Simulation} from '../engine/simulation';
import {Runner} from '../runner/runner';
import {BufferPanel} from './BufferPanel';
import {labels} from './i18n';

describe('buffer panel transactions', () => {
  it('previews 10→15, preserves own 30, and explicitly resets both directions', () => {
    const c = previewConfig(); c.bufferDefaults = {input: {kind: 'quantity', quantity: '10'}};
    c.stations[0]!.inputBuffer = {kind: 'inherit'};
    c.stations[1]!.inputBuffer = {kind: 'quantity', quantity: '30'};
    const settings = bufferSettings(compileConfig(c).source); settings.defaults.input = {kind: 'quantity', quantity: '15'};
    const update = compileConfig(withBuffers(c, settings)), reset = compileConfig(withBuffers(c, settings, true));
    expect(update.resolved.stations.find(s => s.id === 'prep')!.inputBuffers[0]!.capacity).toEqual({kind: 'quantity', quantity: 15_000_000});
    expect(update.resolved.stations.find(s => s.id === 'work')!.inputBuffers[0]!.capacity).toEqual({kind: 'quantity', quantity: 30_000_000});
    expect(reset.resolved.stations.every(s => s.inputBuffers[0]!.capacity.kind === 'quantity' && s.inputBuffers[0]!.capacity.quantity === 15_000_000)).toBe(true);
    expect(c.stations[0]!.inputBuffer).toEqual({kind: 'inherit'});
    expect(c.bufferDefaults.input).toEqual({kind: 'quantity', quantity: '10'});
    expect(reset.source.stations.every(s => s.inputBuffer.kind === 'inherit' && s.outputBuffer.kind === 'inherit')).toBe(true);
  });
  it('rejects a too-small explicit kit, accepts calculated kit and recalculates the plan', () => {
    const c = previewConfig('batches'), settings = bufferSettings(compileConfig(c).source);
    settings.defaults.input = {kind: 'quantity', quantity: '1'};
    expect(() => compileConfig(withBuffers(c, settings, true))).toThrow(ConfigError);
    settings.defaults.input = {kind: 'shift', shifts: '0.001'};
    expect(compileConfig(withBuffers(c, settings, true)).bufferCalculations.some(x => x.raisedToKit)).toBe(true);
    const p = previewConfig('plans'), ps = bufferSettings(compileConfig(p).source);
    ps.stations.planner!.input = {kind: 'inherit'};
    const before = compileConfig(withBuffers(p, ps)); p.stations[0]!.plan[0]!.batches = 4;
    expect(compileConfig(withBuffers(p, ps)).bufferCalculations).not.toEqual(before.bufferCalculations);
  });
  it('adds only capacities of the same material and handles zero, infinity and endpoints', () => {
    const c = previewConfig('assembly'), run = compileConfig(c), route = run.resolved.routes.find(r => r.id === 'prep-assembly')!;
    expect(routeCapacities(run, route)).toEqual({output: '0', input: '2', total: '2'});
    const settings = bufferSettings(run.source); settings.stations.prep!.output = {kind: 'infinite'};
    expect(routeCapacities(compileConfig(withBuffers(c, settings)), route).total).toBe('∞');
    expect(routeCapacities(run, run.resolved.routes.find(r => r.fromId === 'source')!).total).toBe('—');
  });
  it.each(['ru', 'en'] as const)('renders both previews, inheritance and a locked fieldset in %s', language => {
    const run = compileConfig(previewConfig('assembly')), text = labels(language);
    const html = renderToStaticMarkup(<BufferPanel run={run} text={text} language={language} locked onApply={() => {}}/>);
    expect(html).toContain(text.updateInherited); expect(html).toContain(text.resetBuffers);
    expect(html).toContain(text.afterReset); expect(html).toContain(text.afterUpdate);
    expect(html).toContain(text.calculationHelp); expect(html).toContain('disabled=""');
    expect(html).toContain(text.byMaterial);
  });
});

// This acceptance case runs four configurations across five speeds and repeats.
it('preserves calculated mixed networks across speeds, pause, step and replay', () => {
  for (const example of ['assembly', 'split', 'batches', 'plans'] as const) {
    const c = previewConfig(example, 0.5); c.sources.forEach(s => {s.intervalMs = 15 * 60_000;});
    const settings = bufferSettings(compileConfig(c).source);
    settings.defaults.input = {kind: 'shift', shifts: '0.1'};
    settings.defaults.output = {kind: 'quantity', quantity: '0.5'};
    const run = compileConfig(withBuffers(c, settings, true)), expected = new Simulation(run).runToEnd();
    for (const speed of [1, 60, 300, 1800, 'max'] as const) {
      let now = 0, callback: (() => void) | null = null;
      const runner = new Runner(run, undefined, {now: () => now, request: cb => {callback = cb; return cb;}, cancel: () => {callback = null;}});
      const drain = () => {let n = 0; while (callback) {if (++n > 2000) throw new Error('Run did not finish'); const cb = callback; callback = null; now += 60_000; cb();}};
      runner.setSpeed(speed); runner.step(); runner.resume(); runner.pause();
      const paused = runner.getView(); now += 100_000; expect(runner.getView()).toBe(paused);
      runner.resume(); drain(); expect(runner.getView().model).toEqual(expected);
      runner.repeat(); drain(); expect(runner.getView().model).toEqual(expected); runner.dispose();
    }
  }
}, 15_000);
