import {beforeAll, describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {lesson2Config, lesson2Variants} from '../lessons/lesson-2';
import {Lesson2Comparison, Lesson2Intro, lesson2Labels} from './Lesson2';
import type {Lesson2Results} from './Lesson2';

describe('simple lesson 2 screen', () => {
  const results: Lesson2Results = {};
  beforeAll(() => {
    for (const variant of lesson2Variants) {
      const model = new Simulation(compileConfig(lesson2Config(variant))).runToEnd();
      results[variant] = {total: model.line!.counters.find(c => c.materialId === 'product')!.sold,
        shifts: [0, 1, 2].map(day => model.line!.shiftOutput.find(row => row.dayIndex === day && row.materialId === 'product')!.quantity)};
    }
  }, 30_000);
  it.each(['ru', 'en'] as const)('shows missing runs rather than expected output in %s', language => {
    const html = renderToStaticMarkup(<Lesson2Comparison results={{}} language={language}/>);
    expect(html.match(new RegExp(lesson2Labels[language].pending, 'g'))).toHaveLength(3);
    expect(html).not.toContain('data-lesson-total=');
    expect(html).not.toContain('<details class="lesson-2-explanation" open');
  });

  it.each(['ru', 'en'] as const)('renders actual completed shifts and totals in %s', language => {
    const html = renderToStaticMarkup(<Lesson2Comparison results={results} language={language}/>);
    for (const [variant, total] of [['base', 178], ['faster-second', 179], ['faster-third', 238]]) {
      expect(html).toContain(`data-lesson-total="${variant}">${total}</td>`);
    }
    expect(html).toContain('<td>58</td><td>60</td><td>60</td>');
    expect(html).toContain('<td>59</td><td>60</td><td>60</td>');
    expect(html).toContain('<td>78</td><td>80</td><td>80</td>');
    expect(html).not.toContain(lesson2Labels[language].pending);
  });

  it.each(['ru', 'en'] as const)('locks the fixed variant selector while running in %s', language => {
    const html = renderToStaticMarkup(<Lesson2Intro variant="faster-third" locked language={language} onChange={() => {}}/>);
    expect(html).toContain('<select disabled="">');
    expect(html).toContain('<option value="faster-third" selected="">');
    expect(html).not.toContain('<input');
    expect(html).toContain('CV = 0');
  });
});
