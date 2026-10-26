import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Lesson3Comparison, Lesson3Intro, lesson3Labels} from './Lesson3';

describe('simple lesson 3 screen', () => {
  it.each(['ru', 'en'] as const)('leaves unperformed variants empty in %s', language => {
    const html = renderToStaticMarkup(<Lesson3Comparison results={{}} language={language}/>);
    expect(html.match(new RegExp(lesson3Labels[language].pending, 'g'))).toHaveLength(3);
    expect(html).not.toContain('data-lesson-3-output=');
    expect(html).not.toContain('<details class="lesson-explanation" open');
  });

  it.each(['ru', 'en'] as const)('renders the supplied facts, including a zero queue, in %s', language => {
    const html = renderToStaticMarkup(<Lesson3Comparison language={language} results={{8: {
      total: 12_000_000, starvedMs: 3_723_004, queue: {quantityMs: '0', durationMs: 10_000},
    }}}/>);
    expect(html).toContain('data-lesson-3-output="8">12</td><td>1:02:03.004</td><td>0</td>');
    expect(html.match(new RegExp(lesson3Labels[language].pending, 'g'))).toHaveLength(2);
    expect(html).toContain(lesson3Labels[language].averageHelp);
    expect(html).toContain(lesson3Labels[language].memory);
  });

  it.each(['ru', 'en'] as const)('locks the three fixed capacities during a run in %s', language => {
    const html = renderToStaticMarkup(<Lesson3Intro buffer={8} locked language={language} onChange={() => {}}/>);
    expect(html).toContain('<select disabled="">');
    expect(html).toContain('<option value="8" selected="">8</option>');
    expect(html).not.toContain('<input');
    expect(html).toContain('42');
  });
});
