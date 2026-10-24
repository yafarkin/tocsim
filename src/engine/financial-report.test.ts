import {describe, expect, it} from 'vitest';
import {fixedCost, MAX_UNITS, ArithmeticError} from './arithmetic';
import {compileConfig} from './config';
import {financialReport} from './financial-report';
import type {Snapshot} from './state';
import {Simulation} from './simulation';
import {line} from './test-fixtures';
import {exampleRuns} from '../ui/preview';

const M = 60_000;
function finite() {
  const c = line();
  c.sources[0]!.availability = 'warehouse';
  c.initialStocks = [{id: 'kit', ownerId: 's1', location: 'input', materialId: 'raw', quantity: '3', cost: '30'}];
  c.recipes[0]!.inputs[0]!.quantity = '1'; c.recipes[0]!.output.quantity = '1';
  c.stations.forEach(s => {s.inputBuffer = {kind: 'infinite'}; s.costs.perShift = '0';});
  c.stations[0]!.costs.perShift = '5';
  return c;
}
function balance(run: ReturnType<typeof compileConfig>, model: ReturnType<Simulation['getSnapshot']>) {
  const report = financialReport(run, model);
  const initial = run.resolved.initialStocks.reduce((n, s) => n + s.cost, 0n);
  const purchases = model.sources.reduce((n, s) => n + BigInt(s.purchasedCost), 0n);
  const remaining = model.stocks.reduce((n, s) => n + BigInt(s.cost), 0n);
  expect(initial + purchases).toBe(remaining + BigInt(report.tvcSold) + BigInt(report.scrapExpense));
  expect(BigInt(report.netProfit)).toBe(BigInt(report.revenue) - BigInt(report.tvcSold) - BigInt(report.fixedExpense) - BigInt(report.lunchExpense) - BigInt(report.scrapExpense));
  return report;
}

describe('financial result', () => {
  it('matches the concept examples with one scrap or one remaining lot', () => {
    const c = finite(), run = compileConfig(c), base = new Simulation(run).runToEnd();
    // Explicit accounting fixtures isolate the specified financial examples.
    for (const scrap of [true, false]) {
      const model = structuredClone(base) as Snapshot, counter = model.line!.counters.find(c => c.materialId === 'product')!;
      counter.sold = 2_000_000; counter.soldCost = '20000000';
      counter.scrapped = scrap ? 1_000_000 : 0; counter.scrapCost = scrap ? '10000000' : '0';
      model.stocks = scrap ? [] : [{readyAtMs: 0, provenance: {origin: {kind: 'unknown'}, firstProcessing: {kind: 'unknown'}, defective: false, defectSourceIds: [], processingMs: {}}, id: 'remaining', ownerId: 's2', location: 'held', materialId: 'product', quantity: 1_000_000, cost: '10000000'}];
      const r = balance(run, model);
      expect(r).toMatchObject({revenue: '60000000', tvcSold: '20000000', throughput: '40000000', fixedExpense: '5000000', operatingExpense: scrap ? '15000000' : '5000000', netProfit: scrap ? '25000000' : '35000000'});
    }
  });
  it('matches the WIP example through actual production', () => {
    const c = finite(); c.stations[1]!.plan[0]!.processing.timeMs = 180 * M;
    const run = compileConfig(c), model = new Simulation(run).runToEnd();
    expect(balance(run, model)).toMatchObject({revenue:'60000000', tvcSold:'20000000', scrapExpense:'0', operatingExpense:'5000000', netProfit:'35000000'});
    expect(model.stocks.reduce((n, s) => n + BigInt(s.cost), 0n)).toBe(10_000_000n);
  });
  it('charges a full shift after exhaustion and only elapsed common work when stopped', () => {
    const run = compileConfig(finite()), sim = new Simulation(run);
    sim.advanceTo(4 * 60 * M); sim.stop();
    expect(financialReport(run, sim.getSnapshot())).toMatchObject({fixedExpense: '2500000', complete: false});
    expect(financialReport(run, new Simulation(run).runToEnd())).toMatchObject({fixedExpense: '5000000', complete: true});
  });
  it('does not accrue fixed costs at lunch or overnight, including with replacement', () => {
    const c = finite(); c.durationMs += 86_400_000; c.stations[0]!.lunchReplacement = true;
    const run = compileConfig(c), sim = new Simulation(run);
    const charge = (t: number) => {sim.advanceTo(t);return financialReport(run, sim.getSnapshot()).fixedExpense;};
    expect(charge(4 * 60 * M)).toBe('2500000'); expect(charge(5 * 60 * M)).toBe('2500000');
    expect(charge(9 * 60 * M)).toBe('5000000'); expect(charge(86_400_000)).toBe('5000000');
    expect(financialReport(run, sim.runToEnd()).fixedExpense).toBe('10000000');
  });
  it('shows a negative result with no production and no capital charge', () => {
    const c = finite(); c.initialStocks = [];
    const run = compileConfig(c), sim = new Simulation(run);
    expect(financialReport(run, sim.getSnapshot())).toMatchObject({revenue: '0', netProfit: '0', fixedExpense: '0', complete: false});
    expect(balance(run, sim.runToEnd())).toMatchObject({revenue: '0', netProfit: '-5000000'});
  });
  it('includes initial finished stock in sales using its inherited cost', () => {
    const c = finite(); c.initialStocks = [{id:'goods', ownerId:'s2', location:'output', materialId:'product', quantity:'1', cost:'7'}];
    const run = compileConfig(c), model = new Simulation(run).runToEnd();
    expect(model.line!.counters.find(c => c.materialId === 'product')!.produced).toBe(0);
    expect(balance(run, model)).toMatchObject({revenue:'30000000', tvcSold:'7000000', netProfit:'18000000'});
  });
  it('includes paid processing at lunch once', () => {
    const c = finite(); c.stations[0]!.lunchReplacement = true; c.stations[0]!.costs.perLunchHour = '12';
    c.stations[0]!.plan[0]!.processing.timeMs = 5 * 60 * M;
    const run = compileConfig(c), model = new Simulation(run).runToEnd();
    expect(balance(run, model).lunchExpense).toBe('12000000');
  });
  it('uses final quality acceptance without charging rejected raw cost twice', () => {
    const c = finite(); c.stations[0]!.plan[0]!.processing.defectProbability = 1;
    const run = compileConfig(c), model = new Simulation(run).runToEnd();
    expect(balance(run, model)).toMatchObject({revenue:'0', tvcSold:'0', scrapExpense:'30000000', operatingExpense:'35000000', netProfit:'-35000000'});
  });
  it.each(Object.keys(exampleRuns) as (keyof typeof exampleRuns)[])('preserves the balance and step reproducibility for %s', key => {
    const run = exampleRuns[key], direct = new Simulation(run).runToEnd(), sim = new Simulation(run);
    for (let t = 0; t < run.resolved.durationMs; t += 1_234_567) {sim.advanceTo(t);balance(run, sim.getSnapshot());}
    expect(financialReport(run, sim.runToEnd())).toEqual(balance(run, direct));
  });
  it('rounds cumulative station charges once and checks ranges', () => {
    expect(fixedCost(1n, 1, 2)).toBe(1n); expect(fixedCost(1n, 1, 3)).toBe(0n);
    expect(fixedCost(5_000_000n, 28_800_000, 28_800_000)).toBe(5_000_000n);
    expect(() => fixedCost(MAX_UNITS, 2, 1)).toThrow(ArithmeticError);
  });
  it('rounds fractional revenue per product without revaluing raw cost', () => {
    const run = compileConfig(line()), model = structuredClone(new Simulation(run).runToEnd()) as Snapshot;
    const c = model.line!.counters.find(c => c.materialId === 'product')!;
    c.sold = 1; c.soldCost = '1';
    expect(financialReport(run, model)).toMatchObject({revenue:'30', tvcSold:'1', throughput:'29'});
  });
});
