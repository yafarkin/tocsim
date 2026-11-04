import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {ConfigError} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {compileLinearProcess, createLinearProcess, moveLinearStation} from './linear-process';
import {configFromDraft, processDraft} from './process-form';
import {ProcessEditor} from './ProcessEditor';

describe('linear process form', () => {
  it('round trips existing conditions without changing IDs or the source', () => {
    const config = createLinearProcess('editable'), before = structuredClone(config);
    expect(configFromDraft(config, processDraft(config))).toEqual(config);
    expect(config).toEqual(before);
  });
  it('keeps implicit buffer defaults and millisecond processing times intact', () => {
    const config = createLinearProcess('editable');
    delete config.bufferDefaults;
    config.stations[0]!.plan[0]!.processing.timeMs = 1;
    const draft = processDraft(config);
    expect(draft.input).toEqual({kind: 'shift', value: '0.5'});
    expect(draft.output).toEqual({kind: 'quantity', value: '0'});
    expect(configFromDraft(config, draft)).toEqual(config);
  });
  it('edits conditions, accepts comma decimals and applies global/inherited buffers', () => {
    const config = createLinearProcess('editable'), draft = processDraft(config);
    draft.name = 'Изменённый'; draft.seed = '123'; draft.shifts = '2';
    draft.input = {kind: 'quantity', value: '8'};
    draft.output = {kind: 'quantity', value: '2'};
    draft.stations[0]!.minutes = '2,5'; draft.stations[0]!.cv = '0,25';
    draft.stations[1]!.input = {kind: 'shift', value: '0,5'};
    draft.stations[2]!.output = {kind: 'infinite', value: ''};
    const edited = configFromDraft(config, draft), run = compileLinearProcess(edited);
    expect(edited).toMatchObject({name: draft.name, seed: 123, durationMs: 118_800_000});
    expect(edited.stations[0]!.plan[0]!.processing).toMatchObject({timeMs: 150_000, cv: 0.25});
    expect(run.resolved.stations[0]!.inputBuffers[0]!.capacity).toEqual({kind: 'quantity', quantity: 8_000_000});
    expect(edited.stations[1]!.inputBuffer).toEqual({kind: 'shift', shifts: '0.5'});
    expect(edited.stations[2]!.outputBuffer).toEqual({kind: 'infinite'});
    expect(config).toEqual(createLinearProcess('editable'));
  });
  it.each(['', '-', '2.', '2e3', 'Infinity', '-1'])('keeps incomplete or invalid time %s out of a saved config', minutes => {
    const config = createLinearProcess('editable'), draft = processDraft(config);
    draft.stations[0]!.minutes = minutes;
    expect(() => configFromDraft(config, draft)).toThrow(ConfigError);
    expect(draft.stations[0]!.minutes).toBe(minutes);
    expect(config).toEqual(createLinearProcess('editable'));
  });
  it('converts fractional minutes exactly and rejects fractions of a millisecond', () => {
    const config = createLinearProcess('editable'), draft = processDraft(config);
    draft.stations[0]!.minutes = '0.00005';
    expect(configFromDraft(config, draft).stations[0]!.plan[0]!.processing.timeMs).toBe(3);
    draft.stations[0]!.minutes = '0.00001';
    expect(() => configFromDraft(config, draft)).toThrow(ConfigError);
  });
  it.each(['seed', 'shifts', 'name', 'cv', 'input', 'output'] as const)('validates %s before saving or restructuring', field => {
    const config = createLinearProcess('editable'), draft = processDraft(config);
    if (field === 'seed') draft.seed = '4294967296';
    if (field === 'shifts') draft.shifts = '0';
    if (field === 'name') draft.name = '';
    if (field === 'cv') draft.stations[1]!.cv = '-1';
    if (field === 'input') draft.input.value = 'bad';
    if (field === 'output') draft.stations[0]!.output = {kind: 'quantity', value: '-1'};
    expect(() => configFromDraft(config, draft)).toThrow(ConfigError);
  });
  it('uses graph order and keeps edits on the correct IDs when moving stations', () => {
    const config = createLinearProcess('editable'); config.stations.reverse();
    const draft = processDraft(config);
    expect(draft.stations.map(item => item.id)).toEqual(['s1', 's2', 's3']);
    draft.stations[0]!.name = 'First'; draft.stations[0]!.minutes = '4';
    const moved = moveLinearStation(configFromDraft(config, draft), 's1', 1);
    expect(processDraft(moved).stations.map(item => item.id)).toEqual(['s2', 's1', 's3']);
    expect(moved.stations.find(item => item.id === 's1')).toMatchObject({name: 'First', plan: [{processing: {timeMs: 240_000}}]});
  });
  it('leaves the result unchanged when a form is opened and saved without edits', () => {
    const config = createLinearProcess('editable'), edited = configFromDraft(config, processDraft(config));
    expect(new Simulation(compileLinearProcess(edited)).runToEnd()).toEqual(new Simulation(compileLinearProcess(config)).runToEnd());
  });
  it.each(['ru', 'en'] as const)('renders a separate library and a safe empty state in %s', language => {
    const html = renderToStaticMarkup(createElement(ProcessEditor, {language, onBack: () => {}}));
    expect(html).toContain(language === 'ru' ? 'Мои процессы' : 'My processes');
    expect(html).toContain('type="file"'); expect(html).toContain('accept=".json,application/json"');
    expect(html).toContain('<dialog'); expect(html).not.toContain('class="play-button"');
  });
});
