import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {flowReport} from '../engine/flow-report';
import {Runner} from '../runner/runner';
import {advancedSettingKeys} from './ExperimentContext';
import {ExperimentResult} from './ExperimentResult';
import {exampleIds, previewConfig, defaultBatchProfiles, defaultPlanProfile} from './preview';
import {simpleInputRule, bufferSettings, withBuffers} from './buffers';
import {withBatchProfiles, withPlanProfile} from './ProductionPanels';
import {withDuration, durationCvPreset} from './DurationPanel';
import type {DurationDraft} from './DurationPanel';
import {labels} from './i18n';
import {quantityText} from './diagram';

describe('short experiment forms preserve full settings', () => {
  it('recognizes decimal spellings of the same CV without replacing expert distributions', () => {
    const draft: DurationDraft = {kind: 'lognormal', time: '8', cv: '0,10', min: '2', peak: '3', max: '6'};
    expect(durationCvPreset(draft)).toBe('0.1');
    expect(durationCvPreset({...draft, cv: ' 0.50 '})).toBe('0.5');
    for (const cv of ['0.37', '', 'bad', '1e0']) expect(durationCvPreset({...draft, cv})).toBe('custom');
    expect(durationCvPreset({...draft, kind: 'triangular', cv: '0'})).toBe('custom');
    expect(durationCvPreset({...draft, kind: 'uniform', cv: '0'})).toBe('custom');
  });
  it.each(exampleIds)('does not warn about ordinary settings in %s', example => {
    expect(advancedSettingKeys(compileConfig(previewConfig(example)), example)).toEqual([]);
  });
  it('changes one assembly component while retaining other components, outputs and defaults', () => {
    const config = previewConfig('assembly'), before = JSON.stringify(config);
    const settings = bufferSettings(config);
    const input = settings.stations.assembly!.input;
    settings.stations.assembly!.input = simpleInputRule(input, 'prepared', '8', 2);
    const after = withBuffers(config, settings), run = compileConfig(after);
    expect(after.stations.find(s => s.id === 'assembly')!.inputBuffer).toEqual({kind: 'materials', materials: [
      {materialId: 'prepared', capacity: {kind: 'quantity', quantity: '8'}},
      {materialId: 'processed', capacity: {kind: 'quantity', quantity: '4'}},
    ]});
    expect(after.stations.filter(s => s.id !== 'assembly')).toEqual(config.stations.filter(s => s.id !== 'assembly'));
    expect(after.stations.find(s => s.id === 'assembly')!.outputBuffer).toEqual(config.stations.find(s => s.id === 'assembly')!.outputBuffer);
    expect(JSON.stringify(config)).toBe(before);
    expect(advancedSettingKeys(run, 'assembly')).toEqual([]);
  });
  it('keeps a shared inherited rule until an explicit single-material replacement', () => {
    const inherited = {kind: 'inherit'} as const;
    expect(() => simpleInputRule(inherited, 'prepared', '8', 2)).toThrow('shared multi-material');
    expect(inherited).toEqual({kind: 'inherit'});
    expect(simpleInputRule({kind: 'infinite'}, 'prepared', '8', 1)).toEqual({kind: 'quantity', quantity: '8'});
  });
  it('does not clamp the transfer threshold when reducing a batch', () => {
    const config = previewConfig('batches'), profiles = structuredClone(defaultBatchProfiles);
    profiles.prep.repetitions = 2;
    const next = withBatchProfiles(config, profiles);
    expect(next.stations.find(s => s.id === 'prep')!.transportThreshold).toBe('3');
    expect(() => compileConfig(next)).toThrow();
    profiles.prep.transportThreshold = 1;
    expect(() => compileConfig(withBatchProfiles(config, profiles))).not.toThrow();
    expect(config.stations.find(s => s.id === 'prep')!.transportThreshold).toBe('3');
  });
  it('changing plan series retains variability, replacement and unrelated buffer values', () => {
    const config = previewConfig('plans', 0.5, 456);
    config.stations[0]!.lunchReplacement = true;
    const before = JSON.stringify(config);
    const next = withPlanProfile(config, {...defaultPlanProfile, batchesA: 4, batchesB: 2});
    expect(next.stations[0]!.plan.map(p => p.batches)).toEqual([4, 2]);
    expect(next.stations[0]!.plan.map(p => p.processing)).toEqual(config.stations[0]!.plan.map(p => p.processing));
    expect(next.stations[0]!.lunchReplacement).toBe(true);
    expect(next.stations[0]!.inputBuffer).toEqual(config.stations[0]!.inputBuffer);
    expect(next.seed).toBe(456); expect(JSON.stringify(config)).toBe(before);
  });
  it('shows hidden custom settings while ordinary short changes do not produce warnings', () => {
    const config = previewConfig('blocking');
    config.stations.find(s => s.id === 'work')!.inputBuffer = {kind: 'quantity', quantity: '8'};
    expect(advancedSettingKeys(compileConfig(config), 'blocking')).toEqual([]);
    config.seed = 99; config.warmupMs = 60_000;
    config.stations[0]!.lunchReplacement = true;
    config.stations[0]!.outputBuffer = {kind: 'infinite'};
    expect(advancedSettingKeys(compileConfig(config), 'blocking')).toEqual(['seed', 'hiddenBuffers', 'hiddenLunch', 'hiddenWarmup']);
    for (const distribution of [{kind: 'uniform', minMs: 60_000, maxMs: 180_000}, {kind: 'lognormal', meanMs: 480_000, cv: 0.37}] as const) {
      expect(advancedSettingKeys(compileConfig(withDuration(previewConfig('queue'), distribution)), 'queue')).toContain('hiddenVariability');
    }
  });
});

describe('short result uses existing physical facts', () => {
  it.each(exampleIds)('keeps products and materials separate in %s, including partial results', example => {
    const run = compileConfig(previewConfig(example)), runner = new Runner(run);
    for (const time of [0, 150_000, run.resolved.durationMs]) {
      const sim = new Simulation(run); sim.advanceTo(time);
      const model = sim.getSnapshot(), report = flowReport(run, model), before = JSON.stringify(model);
      for (const language of ['ru', 'en'] as const) {
        const text = labels(language);
        const html = renderToStaticMarkup(<ExperimentResult run={run} example={example} view={{...runner.getView(), model, status: report.complete ? 'finished' : 'paused'}} text={text} language={language}/>);
        for (const product of report.products) expect(html).toContain(`data-simple-output="${product.materialId}">${quantityText(product.delivered)}`);
        for (const row of report.materials) expect(html).toContain(`data-simple-wip="${row.materialId}">${quantityText(row.total)}`);
        expect(html.includes(text.incompleteResult)).toBe(!report.complete);
        expect(html).not.toMatch(/NaN|Infinity|undefined/);
      }
      expect(JSON.stringify(model)).toBe(before);
    }
    runner.dispose();
  });
});
