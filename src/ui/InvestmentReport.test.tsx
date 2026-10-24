import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {investmentReport} from '../engine/investment-report';
import {Simulation} from '../engine/simulation';
import {line} from '../engine/test-fixtures';
import {Runner} from '../runner/runner';
import {exampleIds, previewConfig} from './preview';
import {labels} from './i18n';
import {InvestmentReport} from './InvestmentReport';
import {RunSummary} from './RunSummary';
import {investmentAverageText, investmentMoneyText, investmentRoiText} from './metric-format';

const M=60_000;
function finite() {
  const c=line();c.stations=[c.stations[0]!];c.materials=c.materials.filter(m=>m.id!=='part');
  c.recipes=[{id:'cut',name:'one',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'product',quantity:'1'}}];
  c.routes=[c.routes[0]!,{id:'sell',fromId:'s1',toId:'market',materialId:'product'}];
  c.stations[0]!.inputBuffer={kind:'infinite'};c.stations[0]!.costs={capital:'100',perShift:'0',perLunchHour:'0'};
  c.sources[0]!.availability='warehouse';c.initialStocks=[{id:'kit',ownerId:'s1',location:'input',materialId:'raw',quantity:'3',cost:'30'}];return c;
}

describe('investment display precision',()=>{
  it.each([
    ['0','0.00'], ['100000000','100.00'], ['1005000','≈ 1.01'], ['1000001','≈ 1.00'],
    ['1','< 0.01'], ['9999','< 0.01'], ['10000','0.01'], ['9007199254740991','≈ 9007199254.74'],
  ])('formats money %s as %s without floating point', (value,expected)=>expect(investmentMoneyText(value)).toBe(expected));
  it('keeps exact means, missing means and sub-cent positive means distinct',()=>{
    expect(investmentAverageText(null,'missing')).toBe('missing');
    expect(investmentAverageText({costMs:'0',durationMs:3},'missing')).toBe('0.00');
    expect(investmentAverageText({costMs:'1',durationMs:3},'missing')).toBe('< 0.01');
    expect(investmentAverageText({costMs:'55000000',durationMs:2},'missing')).toBe('27.50');
    expect(investmentAverageText({costMs:'1000000',durationMs:3},'missing')).toBe('≈ 0.33');
  });
  it.each([
    ['0','1','0.00%'], ['1','4','25.00%'], ['20','61','≈ 32.79%'], ['-1','6','≈ −16.67%'],
    ['1','1000000000','0% < ROI < 0.01%'], ['-1','1000000000','−0.01% < ROI < 0%'],
    ['1','10000','0.01%'], ['-1','10000','−0.01%'], ['3','20000','≈ 0.02%'],
    ['9007199254740991','1','900719925474099100.00%'],
  ])('formats ROI %s/%s as %s', (numerator,denominator,expected)=>expect(investmentRoiText({numerator,denominator},'missing')).toBe(expected));
  it('keeps missing ROI distinct from a zero or negative value',()=>{
    expect(investmentRoiText(null,'missing')).toBe('missing');
  });
});

describe('investment report in the live summary',()=>{
  it.each(['ru','en'] as const)('shows the hand-checked 2.5 minute case and scope in %s',language=>{
    const run=compileConfig(finite()), sim=new Simulation(run), text=labels(language), model=sim.advanceTo(2.5*M);
    const markup=renderToStaticMarkup(<InvestmentReport run={run} model={model} text={text}/>);
    for(const [key,value] of [['currentStockValue','10.00'],['stationCapital','100.00'],['currentInvestment','110.00'],['meanStockValue','22.00'],['meanInvestment','122.00'],['roi','≈ 32.79%']])expect(markup).toContain(`data-investment="${key}">${value}`);
    for(const key of ['investments','investmentAmounts','moneyUnit','investmentPeriod','incompleteResult','investmentBoundary','investmentRoiHelp','investmentRounding'] as const)expect(markup).toContain(text[key]);
    expect(markup).not.toContain(text.investmentZeroPeriod);expect(markup).not.toContain(text.investmentZeroMean);
    expect(markup).toContain('<summary>');expect(markup).toContain('scope="row"');expect(markup).toContain('scope="col"');expect(markup).toContain('tabindex="0"');
  });
  it.each(['ru','en'] as const)('distinguishes zero period and zero mean investment in %s',language=>{
    const c=finite();c.initialStocks=[];c.stations[0]!.costs.capital='0';const run=compileConfig(c), sim=new Simulation(run), text=labels(language);
    const initial=renderToStaticMarkup(<InvestmentReport run={run} model={sim.getSnapshot()} text={text}/>);
    expect(initial).toContain(text.investmentZeroPeriod);expect(initial).not.toContain(text.investmentZeroMean);
    expect(initial).toContain(`data-investment="meanInvestment">${text.investmentNoValue}`);
    const full=renderToStaticMarkup(<InvestmentReport run={run} model={sim.runToEnd()} text={text}/>);
    expect(full).toContain(text.investmentZeroMean);expect(full).not.toContain(text.investmentZeroPeriod);expect(full).not.toContain(text.incompleteResult);
    expect(full).toContain('data-investment="meanInvestment">0.00');expect(full).toContain(`data-investment="roi">${text.investmentNoValue}`);
  });
  it('shows a negative return and a real zero return with positive capital',()=>{
    const c=finite();c.initialStocks=[];c.stations[0]!.costs.perShift='5';const run=compileConfig(c), text=labels('en');
    expect(renderToStaticMarkup(<InvestmentReport run={run} model={new Simulation(run).runToEnd()} text={text}/>)).toContain('data-investment="roi">−5.00%');
    c.stations[0]!.costs.perShift='0';const zero=compileConfig(c);
    expect(renderToStaticMarkup(<InvestmentReport run={zero} model={new Simulation(zero).runToEnd()} text={text}/>)).toContain('data-investment="roi">0.00%');
  });
  it('does not replace a tiny positive denominator with a displayed zero or suppress its ROI',()=>{
    const c=finite();c.stations[0]!.costs.capital='0';c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='0.000001';c.stations[0]!.plan[0]!.processing.timeMs=1;c.materials.find(m=>m.id==='product')!.salePrice='0.000003';
    const run=compileConfig(c), markup=renderToStaticMarkup(<InvestmentReport run={run} model={new Simulation(run).advanceTo(3)} text={labels('ru')}/>);
    expect(markup).toContain('data-investment="meanInvestment">&lt; 0.01');expect(markup).toContain('data-investment="roi">600.00%');
    expect(markup).not.toContain(labels('ru').investmentZeroMean);
  });
  it.each(['ru','en'] as const)('contains overflow in the investment section in %s',language=>{
    const c=finite();c.stations[0]!.costs.capital='9007199254.740991';const run=compileConfig(c), model=new Simulation(run).getSnapshot(), text=labels(language);
    const markup=renderToStaticMarkup(<InvestmentReport run={run} model={model} text={text}/>);
    expect(markup).toContain(text.investments);expect(markup).toContain('role="alert"');expect(markup).toContain(text.financialRange);
    expect(markup).not.toContain('NaN');expect(markup).not.toContain('Infinity');
  });
  it('keeps the actual stopped interval and the rest of the report available',()=>{
    const run=compileConfig(finite()), runner=new Runner(run), sim=new Simulation(run);sim.advanceTo(2.5*M);const model=sim.stop(), text=labels('en');
    const markup=renderToStaticMarkup(<RunSummary run={run} view={{...runner.getView(),model,status:'stopped'}} text={text} language="en"/>);
    expect(markup).toContain(text.endedStopped);expect(markup).toContain('Day 1 08:02:30');expect(markup).toContain('data-investment="roi">≈ 32.79%');expect(markup).toContain('data-money="netProfit">40.00');
    expect(markup).toContain(text.incompleteResult);runner.dispose();
  });
  it.each(exampleIds)('renders RU/EN from the same exact end result for %s',example=>{
    const run=compileConfig(previewConfig(example)), model=new Simulation(run).runToEnd(), report=investmentReport(run,model);
    for(const language of ['ru','en'] as const){const text=labels(language), markup=renderToStaticMarkup(<InvestmentReport run={run} model={model} text={text}/>);
      expect(markup).toContain(`data-investment="currentStockValue">${investmentMoneyText(report.stockCost).replace('<','&lt;')}`);
      expect(markup).toContain(`data-investment="roi">${investmentRoiText(report.roi,text.investmentNoValue).replaceAll('<','&lt;')}`);
      expect(markup).not.toContain(text.incompleteResult);expect(markup).not.toContain('NaN');expect(markup).not.toContain('Infinity');}
  });
});
