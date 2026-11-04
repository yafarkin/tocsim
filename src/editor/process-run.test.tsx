import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Simulation} from '../engine/simulation';
import {Runner} from '../runner/runner';
import type {RunnerHost} from '../runner/runner';
import {searchBottleneck} from '../runner/bottleneck-search';
import {FlowDiagram} from '../ui/FlowDiagram';
import {RunSummary} from '../ui/RunSummary';
import {labels, nameFor} from '../ui/i18n';
import {blockingLessonConfig} from '../lessons/lesson-blocking';
import {compileConfig, ConfigError} from '../engine/config';
import {appendLinearStation, compileLinearProcess, createLinearProcess, removeLinearStation} from './linear-process';
import {configFromDraft, processDraft} from './process-form';
import {copyImportedProcess} from './process-json';
import {processLabels} from './process-run';

class Host implements RunnerHost {
  time = 0;
  index = 0;
  callbacks = new Map<number, () => void>();
  now() {return this.time;}
  request(callback: () => void) {const id = ++this.index; this.callbacks.set(id, callback); return id;}
  cancel(id: unknown) {this.callbacks.delete(id as number);}
  next(delta = 60_000) {
    this.time += delta;
    const item = this.callbacks.entries().next().value;
    if (!item) throw new Error('No callback');
    this.callbacks.delete(item[0]); item[1]();
  }
  finish() {
    let turns = 0;
    while (this.callbacks.size) {if (++turns > 30_000) throw new Error('Did not finish'); this.next();}
  }
}

describe('custom process launch and existing playback', () => {
  it('captures the unsaved form and keeps the active conditions fixed while a copy is edited', () => {
    const config = createLinearProcess('unsaved'), draft = processDraft(config);
    draft.name = 'My experiment'; draft.seed = '123'; draft.stations[1]!.minutes = '6';
    const run = compileLinearProcess(configFromDraft(config, draft)), host = new Host(), runner = new Runner(run, undefined, host);
    runner.start(); host.next(); runner.pause();
    const paused = runner.getView();
    draft.seed = '5'; draft.stations[1]!.minutes = '2'; config.name = 'Changed';
    const copy = copyImportedProcess(configFromDraft(config, draft), 'independent-copy');
    copy.stations[0]!.name = 'Different name';
    expect(run.source.name).toBe('My experiment'); expect(run.source.seed).toBe(123);
    expect(run.source.stations[1]!.plan[0]!.processing.timeMs).toBe(360_000);
    expect(runner.getView()).toBe(paused); expect(Object.isFrozen(run.source.stations)).toBe(true);
    runner.setSpeed('max'); runner.resume(); host.finish();
    expect(runner.getView().model).toEqual(new Simulation(run).runToEnd());
    expect(runner.runConfig).toBe(run);
  });

  it.each([1, 3, 30])('runs %i stations at several speeds and by steps with the exact engine result', count => {
    let config = createLinearProcess(`chain-${count}`);
    while (config.stations.length < count) config = appendLinearStation(config, 'Extra', 180_000);
    while (config.stations.length > count) config = removeLinearStation(config, config.stations.at(-1)!.id);
    const draft = processDraft(config); draft.stations[0]!.cv = '0.25'; draft.seed = '7';
    const run = compileLinearProcess(configFromDraft(config, draft)), expected = new Simulation(run).runToEnd();
    for (const speed of [60, 1800, 'max'] as const) {
      const host = new Host(), runner = new Runner(run, undefined, host);
      runner.setSpeed(speed); runner.start(); host.finish();
      expect(runner.getView().status).toBe('finished'); expect(runner.getView().model).toEqual(expected);
    }
    const host = new Host(), stepped = new Runner(run, undefined, host);
    let steps = 0;
    do {stepped.step(); if (++steps > 30_000) throw new Error('Too many steps');}
    while (stepped.getView().status === 'paused');
    expect(stepped.getView().model).toEqual(expected); expect(host.callbacks.size).toBe(0);
  }, 15_000);

  it('pauses, steps, stops and creates a fresh playback of the same conditions', () => {
    const run = compileLinearProcess(createLinearProcess('lifecycle')), host = new Host(), runner = new Runner(run, undefined, host);
    runner.start(); host.next(1000); runner.pause();
    expect(host.callbacks.size).toBe(0);
    const before = runner.getView().model.timeMs; runner.step();
    expect(runner.getView().status).toBe('paused'); expect(runner.getView().model.timeMs).toBeGreaterThan(before);
    runner.resume(); host.next(1000); runner.stop();
    expect(runner.getView().status).toBe('stopped'); expect(host.callbacks.size).toBe(0);
    runner.dispose();
    const fresh = new Runner(run, undefined, host);
    expect(fresh.getView().status).toBe('ready'); expect(fresh.getView().model.timeMs).toBe(0);
    fresh.setSpeed('max'); fresh.start(); host.finish();
    expect(fresh.getView().model).toEqual(new Simulation(run).runToEnd());
  });

  it('does not replace the current result when the edited form is invalid', () => {
    const config = createLinearProcess('editable'), run = compileLinearProcess(config), runner = new Runner(run);
    const previous = runner.getView(), draft = processDraft(config);
    draft.stations[0]!.minutes = '';
    expect(() => compileLinearProcess(configFromDraft(config, draft))).toThrow(ConfigError);
    expect(runner.getView()).toBe(previous); expect(runner.runConfig).toBe(run);
  });

  it('keeps a lesson Runner and its result independent of a custom experiment', () => {
    const lessonRun = compileConfig(blockingLessonConfig()), lesson = new Runner(lessonRun);
    lesson.step(); const original = lesson.getView();
    const config = createLinearProcess('custom'), draft = processDraft(config);
    draft.stations[1]!.minutes = '4';
    const customRun = compileLinearProcess(configFromDraft(config, draft)), host = new Host(), custom = new Runner(customRun, undefined, host);
    custom.setSpeed('max'); custom.start(); host.finish();
    expect(custom.getView().model).toEqual(new Simulation(customRun).runToEnd());
    expect(lesson.getView()).toBe(original); expect(lesson.runConfig).toBe(lessonRun);
    lesson.dispose(); custom.dispose();
  });

  it('searches the captured user conditions without changing paused playback', async () => {
    const config = createLinearProcess('search'), draft = processDraft(config); draft.stations[1]!.minutes = '6';
    const run = compileLinearProcess(configFromDraft(config, draft)), runner = new Runner(run);
    runner.step(); const before = runner.getView();
    const result = await searchBottleneck(run, {cancelled: () => false, onProgress: () => {}});
    expect(result!.stationIds).toEqual(['s2']);
    const final = new Simulation(run).runToEnd();
    expect(result!.samples[0]!.baseline).toEqual(result!.productIds.map(id => String(final.line!.counters.find(row => row.materialId === id)!.sold)));
    expect(runner.getView()).toBe(before); expect(runner.runConfig).toBe(run); runner.dispose();
  });

  it.each(['ru', 'en'] as const)('renders custom names and generic reports in %s without lesson-specific assumptions', language => {
    const config = createLinearProcess('custom');
    config.stations[0]!.id = 'prep'; config.stations[0]!.name = 'My named station';
    for (const route of config.routes) {
      if (route.fromId === 's1') route.fromId = 'prep'; if (route.toId === 's1') route.toId = 'prep';
    }
    config.materials[0]!.name = 'My raw material';
    const run = compileLinearProcess(config), text = processLabels(run, language), runner = new Runner(run);
    runner.step(); const view = runner.getView();
    const html = renderToStaticMarkup(<><FlowDiagram run={run} view={view} text={text} reduced/>
      <RunSummary run={run} view={view} text={text} language={language} example="custom"/></>);
    expect(html).toContain('My named station'); expect(html).toContain('My raw material');
    expect(html).not.toContain(text.blockedAtPreparation); expect(html).not.toContain(text.planSetupTime);
    expect(nameFor('prep', 'fallback', text)).toBe('My named station');
    expect(nameFor('prep', 'fallback', labels(language))).toBe(labels(language).prep);
    expect(run.source.stations[0]!.id).toBe('prep');
    runner.dispose();
  });
});
