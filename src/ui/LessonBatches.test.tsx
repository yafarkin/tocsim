import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {LessonBatchesComparison, LessonBatchesIntro, batchesLabels} from './LessonBatches';

describe('batches lesson screen', () => {
  it.each(['ru','en'] as const)('leaves unperformed variants empty with a closed explanation in %s', language => {
    const html = renderToStaticMarkup(<LessonBatchesComparison results={{}} language={language}/>);
    expect(html.match(new RegExp(batchesLabels[language].pending,'g'))).toHaveLength(2);
    expect(html).not.toContain('data-batches-output=');
    expect(html).not.toContain('<details class="lesson-explanation" open');
  });
  it.each(['ru','en'] as const)('renders supplied event times and output in %s', language => {
    const html = renderToStaticMarkup(<LessonBatchesComparison results={{1:{firstStartMs:1_020_000,firstOutputMs:1_200_000,total:12_000_000}}} language={language}/>);
    expect(html).toContain('<td>0:17:00</td><td>0:20:00</td><td data-batches-output="1">12</td>');
    expect(html.match(new RegExp(batchesLabels[language].pending,'g'))).toHaveLength(1);
    expect(html).toContain(batchesLabels[language].memory);
  });
  it('distinguishes missing events from zero time', () => {
    const html = renderToStaticMarkup(<LessonBatchesComparison results={{3:{firstStartMs:0,firstOutputMs:null,total:0}}} language="en"/>);
    expect(html).toContain('<td>0:00:00</td><td>Did not occur</td><td data-batches-output="3">0</td>');
  });
  it.each(['ru','en'] as const)('locks the two fixed thresholds and explains the kit in %s', language => {
    const html = renderToStaticMarkup(<LessonBatchesIntro threshold={1} locked language={language} onChange={()=>{}}/>);
    expect(html).toContain('<select disabled="">');
    expect(html).toContain('<option value="1" selected="">1</option>');
    expect(html.match(/<option /g)).toHaveLength(2);
    expect(html).not.toContain('<input');
    expect(html).toContain(batchesLabels[language].conditions);
    expect(html).toContain(batchesLabels[language].watch);
  });
});
