import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Lesson1Comparison, Lesson1Intro, lesson1Labels} from './Lesson1';

describe('simple lesson 1 screen', () => {
  it.each(['ru', 'en'] as const)('leaves unperformed variants empty in %s', language => {
    const html = renderToStaticMarkup(<Lesson1Comparison results={{}} language={language}/>);
    expect(html.match(new RegExp(lesson1Labels[language].pending, 'g'))).toHaveLength(3);
    expect(html).not.toContain('data-lesson-1-output=');
    expect(html).not.toContain('<details class="lesson-explanation" open');
  });

  it.each(['ru', 'en'] as const)('renders the supplied facts, including zero blocking, in %s', language => {
    const html = renderToStaticMarkup(<Lesson1Comparison language={language} results={{variable: {
      total: 12_000_000, starvedMs: 3_723_004, blockedMs: 0,
    }}}/>);
    expect(html).toContain('data-lesson-1-output="variable">12</td><td>1:02:03.004</td><td>0:00:00</td>');
    expect(html.match(new RegExp(lesson1Labels[language].pending, 'g'))).toHaveLength(2);
    expect(html).toContain(lesson1Labels[language].memory);
  });

  it.each(['ru', 'en'] as const)('locks the three fixed variants during a run in %s', language => {
    const html = renderToStaticMarkup(<Lesson1Intro variant="variable" locked language={language} onChange={() => {}}/>);
    expect(html).toContain('<select disabled="">');
    expect(html).toContain(`<option value="variable" selected="">${lesson1Labels[language].variants.variable}</option>`);
    expect(html).not.toContain('<input');
    expect(html).toContain('42');
  });
});
