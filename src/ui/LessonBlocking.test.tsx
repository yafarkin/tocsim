import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {LessonBlockingComparison, LessonBlockingIntro, blockingLabels} from './LessonBlocking';

describe('blocking lesson screen', () => {
  it.each(['ru','en'] as const)('leaves missing results empty and the explanation closed in %s', language => {
    const html = renderToStaticMarkup(<LessonBlockingComparison results={{}} language={language}/>);
    expect(html.match(new RegExp(blockingLabels[language].pending, 'g'))).toHaveLength(2);
    expect(html).not.toContain('data-blocking-output=');
    expect(html).not.toContain('<details class="lesson-explanation" open');
  });
  it.each(['ru','en'] as const)('renders supplied facts including zero values in %s', language => {
    const html = renderToStaticMarkup(<LessonBlockingComparison results={{8:{total:12_000_000, prepared:20_000_000, blockedMs:0, queue:0}}} language={language}/>);
    expect(html).toContain('data-blocking-output="8">12</td><td>20</td><td>0:00:00</td><td>0</td>');
    expect(html.match(new RegExp(blockingLabels[language].pending, 'g'))).toHaveLength(1);
    expect(html).toContain(blockingLabels[language].memory);
  });
  it.each(['ru','en'] as const)('shows only two fixed locked variants and full instructions in %s', language => {
    const html = renderToStaticMarkup(<LessonBlockingIntro buffer={8} locked language={language} onChange={() => {}}/>);
    expect(html).toContain('<select disabled="">');
    expect(html).toContain('<option value="8" selected="">8</option>');
    expect(html.match(/<option /g)).toHaveLength(2);
    expect(html).not.toContain('<input');
    expect(html).toContain(blockingLabels[language].conditions);
    expect(html).toContain(blockingLabels[language].watch);
  });
});
