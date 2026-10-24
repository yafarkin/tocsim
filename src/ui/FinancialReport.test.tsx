import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {FinancialReport, moneyText} from './FinancialReport';
import {labels} from './i18n';
import {exampleRuns} from './preview';
import {Simulation} from '../engine/simulation';
import {compileConfig} from '../engine/config';
import {line} from '../engine/test-fixtures';

describe('financial report UI', () => {
  it.each(['ru', 'en'] as const)('renders amounts, formulas, scope and incomplete status in %s', language => {
    const run = exampleRuns.queue, sim = new Simulation(run), text = labels(language);
    const live = renderToStaticMarkup(<FinancialReport run={run} model={sim.getSnapshot()} text={text}/>);
    expect(live).toContain(text.incompleteResult);expect(live).toContain('data-money="netProfit">0.00');
    const done = renderToStaticMarkup(<FinancialReport run={run} model={sim.runToEnd()} text={text}/>);
    expect(done).not.toContain(text.incompleteResult);
    for (const key of ['financialResult','financialHelp','financialLimits','revenue','tvcSold','throughput','scrapExpense','fixedExpense','lunchExpense','operatingExpense','netProfit'] as const) expect(done).toContain(text[key]);
    expect(done).toContain('scope="row"'); expect(done).toContain('tabindex="0"');
  });
  it('contains a range error without losing the surrounding report', () => {
    const c = line(); c.stations.forEach(s => s.costs.perShift = '9007199254');
    const run = compileConfig(c), model = new Simulation(run).runToEnd();
    expect(renderToStaticMarkup(<FinancialReport run={run} model={model} text={labels('ru')}/>)).toContain(labels('ru').financialRange);
  });
  it('formats signed amounts without floating point or negative zero', () => {
    expect(moneyText('-5000000')).toBe('−5.00');expect(moneyText('-1')).toBe('0.00');
    expect(moneyText('1005000')).toBe('1.01');expect(moneyText('9007199254740991')).toBe('9007199254.74');
  });
});
