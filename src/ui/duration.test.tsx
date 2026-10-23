import {expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig, ConfigError} from '../engine/config';
import {DurationPanel, durationFromDraft, withDuration} from './DurationPanel';
import {previewConfig} from './preview';
import {labels} from './i18n';
const draft = {kind: 'triangular' as const, min: '2', peak: '3', max: '8', time: '8', cv: '0.5'};
it('converts UI minutes exactly, accepts a decimal comma and leaves the source unchanged', () => {
  expect(durationFromDraft({...draft, min: '0,00005'})).toEqual({kind: 'triangular', minMs: 3, peakMs: 180_000, maxMs: 480_000});
  expect(durationFromDraft({...draft, kind: 'lognormal', cv: '0,25'})).toEqual({kind: 'lognormal', meanMs: 480_000, cv: 0.25});
  const c = previewConfig(), next = withDuration(c, durationFromDraft(draft));
  expect(c.stations[1]!.plan[0]!.processing).toMatchObject({timeMs: 480_000, cv: 0});
  expect(next.stations[1]!.plan[0]!.processing).toEqual({mode: 'sequential', repetitions: 1, distribution: {kind: 'triangular', minMs: 120_000, peakMs: 180_000, maxMs: 480_000}});
  expect(compileConfig(next).resolved.stations.find(s => s.id === 'work')!.timeMs).toBeCloseTo(260_000);
});
it.each(['', '-1', 'Infinity', '0', '0.000001', '9007199254740991', '2 minutes'])('rejects invalid minutes %j before applying', min => {
  expect(() => durationFromDraft({...draft, min})).toThrow(ConfigError);
});
it.each(['ru', 'en'] as const)('renders only the bounded fields and derived moments, locked in %s', language => {
  const text = labels(language), run = compileConfig(withDuration(previewConfig(), durationFromDraft(draft)));
  const html = renderToStaticMarkup(<DurationPanel run={run} locked text={text} language={language} onApply={() => {}}/>);
  expect(html).toContain(text.minMinutes); expect(html).toContain(text.peakMinutes); expect(html).toContain(text.maxMinutes);
  expect(html).not.toContain(`aria-label="${text.meanMinutes}"`);
  expect(html).not.toContain('aria-label="CV"'); expect(html).toContain('CV ');
  expect(html).toContain(text.durationHelp); expect(html).toContain('disabled=""'); expect(html).toContain(text.applyProcessingTime);
});
