import {describe, expect, it} from 'vitest';
import {ArithmeticError, MAX_UNITS} from './arithmetic';
import {DAY_MS} from './calendar';
import {compileConfig} from './config';
import type {EditorConfig} from './config';
import {financialReport} from './financial-report';
import {investmentReport} from './investment-report';
import {Runner} from '../runner/runner';
import {Simulation} from './simulation';
import {line} from './test-fixtures';
import {exampleIds, previewConfig} from '../ui/preview';

const M=60_000, H=60*M, C=1_000_000n;
function finite(): EditorConfig {
  const c=line();c.stations=[c.stations[0]!];c.materials=c.materials.filter(m=>m.id!=='part');
  c.recipes=[{id:'cut',name:'one',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'product',quantity:'1'}}];
  c.routes=[c.routes[0]!,{id:'sell',fromId:'s1',toId:'market',materialId:'product'}];
  c.stations[0]!.inputBuffer={kind:'infinite'};c.stations[0]!.costs={capital:'100',perShift:'0',perLunchHour:'0'};
  c.sources[0]!.availability='warehouse';
  c.initialStocks=[{id:'kit',ownerId:'s1',location:'input',materialId:'raw',quantity:'3',cost:'30'}];return c;
}
function roiEquals(report: ReturnType<typeof investmentReport>, numerator: bigint, denominator: bigint) {
  expect(report.roi).not.toBeNull();
  expect(BigInt(report.roi!.denominator)>0n).toBe(true);
  expect(BigInt(report.roi!.numerator)*denominator).toBe(numerator*BigInt(report.roi!.denominator));
}

describe('exact investments and return over the actual period',()=>{
  it('has current investments but no invented average or ROI at time zero',()=>{
    const run=compileConfig(finite()), sim=new Simulation(run);
    for(const model of [sim.getSnapshot(),sim.advanceTo(0)]){
      expect(investmentReport(run,model)).toEqual({calendarMs:0,complete:false,capital:'100000000',stockCost:'30000000',totalCost:'130000000',stockAverage:null,totalAverage:null,netProfit:'0',roi:null});
    }
  });
  it('uses the exact time-weighted mean, rather than initial, final or event-sample values',()=>{
    const run=compileConfig(finite()), sim=new Simulation(run), model=sim.advanceTo(2.5*M), r=investmentReport(run,model);
    expect(r).toMatchObject({calendarMs:2.5*M,complete:false,stockCost:'10000000',totalCost:'110000000',netProfit:'40000000',stockAverage:{costMs:String(55n*C*BigInt(M)),durationMs:2.5*M},totalAverage:{costMs:String(305n*C*BigInt(M)),durationMs:2.5*M}});
    // Average stock 22 + capital 100 = 122. Profit 40 => ROI 20/61.
    roiEquals(r,20n,61n);
    expect(investmentReport(run,model)).toEqual(r); // No accumulation on repeated observation.
  });
  it('uses the full horizon after stock is sold, with positive historical mean and zero final stock',()=>{
    const c=finite();c.stations[0]!.costs.capital='0';const run=compileConfig(c), model=new Simulation(run).runToEnd(), r=investmentReport(run,model);
    expect(r).toMatchObject({calendarMs:c.durationMs,complete:true,stockCost:'0',totalCost:'0',netProfit:'60000000',stockAverage:{costMs:String(60n*C*BigInt(M)),durationMs:c.durationMs}});
    roiEquals(r,BigInt(c.durationMs),BigInt(M)); // Profit 60 / average (60 money-minutes / horizon).
  });
  it('handles constant stock and capital, including idle costs and negative profit',()=>{
    const c=finite();c.initialStocks[0]!.quantity='0.5';c.initialStocks[0]!.cost='10';c.stations[0]!.costs={capital:'20',perShift:'5',perLunchHour:'999'};
    const run=compileConfig(c), r=investmentReport(run,new Simulation(run).runToEnd());
    expect(r).toMatchObject({stockCost:'10000000',totalCost:'30000000',netProfit:'-5000000',stockAverage:{costMs:String(10n*C*BigInt(c.durationMs)),durationMs:c.durationMs},totalAverage:{costMs:String(30n*C*BigInt(c.durationMs)),durationMs:c.durationMs}});
    roiEquals(r,-1n,6n);
  });
  it('counts the capital of every station even when all stations are idle',()=>{
    const c=line();c.initialStocks=[];c.sources[0]!.availability='warehouse';c.stations[0]!.costs.capital='100';c.stations[1]!.costs.capital='200';
    const run=compileConfig(c), r=investmentReport(run,new Simulation(run).runToEnd());
    expect(r).toMatchObject({capital:'300000000',stockCost:'0',totalCost:'300000000',netProfit:'-10000000'});roiEquals(r,-1n,30n);
  });
  it.each(['0','200'])('changes investments with capital=%s without changing inventory or profit',capital=>{
    const c=finite(), baselineRun=compileConfig(c), baseline=investmentReport(baselineRun,new Simulation(baselineRun).runToEnd());
    c.stations[0]!.costs.capital=capital;const run=compileConfig(c), r=investmentReport(run,new Simulation(run).runToEnd());
    expect(r.netProfit).toBe(baseline.netProfit);expect(r.stockAverage).toEqual(baseline.stockAverage);expect(r.stockCost).toBe(baseline.stockCost);
    expect(r.totalCost).toBe(String(BigInt(capital)*C));expect(r.roi).not.toEqual(baseline.roi);
  });
  it('preserves a nonzero mean smaller than one micro-money unit when dividing ROI',()=>{
    const c=finite();c.stations[0]!.costs.capital='0';c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='0.000001';
    c.materials.find(m=>m.id==='product')!.salePrice='0.000003';c.stations[0]!.plan[0]!.processing.timeMs=1;
    const run=compileConfig(c), model=new Simulation(run).advanceTo(3), r=investmentReport(run,model);
    expect(r).toMatchObject({stockCost:'0',totalCost:'0',netProfit:'2',stockAverage:{costMs:'1',durationMs:3},totalAverage:{costMs:'1',durationMs:3},roi:{numerator:'6',denominator:'1'}});
  });
  it('returns zero ROI, rather than absence, when profit is zero and investment is positive',()=>{
    const c=finite();c.initialStocks[0]!.quantity='0.5';c.stations[0]!.costs.capital='0';
    const run=compileConfig(c), r=investmentReport(run,new Simulation(run).runToEnd());expect(r.netProfit).toBe('0');roiEquals(r,0n,1n);
  });
  it.each(['0','5'])('has no ROI for zero mean investments with per-shift expense %s',expense=>{
    const c=finite();c.initialStocks=[];c.stations[0]!.costs={capital:'0',perShift:expense,perLunchHour:'0'};
    const run=compileConfig(c), r=investmentReport(run,new Simulation(run).runToEnd());
    expect(r).toMatchObject({stockCost:'0',totalCost:'0',stockAverage:{costMs:'0',durationMs:c.durationMs},totalAverage:{costMs:'0',durationMs:c.durationMs},roi:null});
    expect(r.netProfit).toBe(String(-BigInt(expense)*C));
  });
  it('has no mean at time-zero acceptance and no ROI for zero-residence stock without capital',()=>{
    const c=finite();c.stations[0]!.outputBuffer={kind:'infinite'};c.stations[0]!.costs.capital='0';
    c.initialStocks=[{id:'goods',ownerId:'s1',location:'output',materialId:'product',quantity:'1',cost:'7'}];
    const run=compileConfig(c), sim=new Simulation(run), zero=investmentReport(run,sim.advanceTo(0));
    expect(zero).toMatchObject({stockCost:'0',netProfit:'23000000',stockAverage:null,totalAverage:null,roi:null});
    expect(investmentReport(run,sim.advanceTo(1))).toMatchObject({netProfit:'23000000',totalAverage:{costMs:'0',durationMs:1},roi:null});
  });
  it('uses the actual stopped interval for both profit and the investment mean',()=>{
    const run=compileConfig(finite()), sim=new Simulation(run);sim.advanceTo(2.5*M);const r=investmentReport(run,sim.stop());
    roiEquals(r,20n,61n);expect(r.calendarMs).toBe(2.5*M);expect(r.complete).toBe(false);
    expect(investmentReport(run,sim.runToEnd())).toEqual(r);
    const full=investmentReport(run,new Simulation(run).runToEnd());expect(full.complete).toBe(true);expect(full.roi).not.toEqual(r.roi);
  });
  it('uses calendar residence including lunch and nights, with capital throughout the same period',()=>{
    const c=finite();c.durationMs+=DAY_MS;const run=compileConfig(c), sim=new Simulation(run), time=DAY_MS+4.5*H;
    const r=investmentReport(run,sim.advanceTo(time));
    expect(r.calendarMs).toBe(time);expect(r.stockAverage).toEqual({costMs:String(60n*C*BigInt(M)),durationMs:time});
    expect(r.totalAverage).toEqual({costMs:String(60n*C*BigInt(M)+100n*C*BigInt(time)),durationMs:time});
    expect(sim.getSnapshot().observation.workMs).toBeLessThan(time);
  });
  it('keeps a warehouse included before release and excludes unpurchased virtual supply',()=>{
    const c=finite();c.initialStocks=[{id:'warehouse-lot',ownerId:'warehouse',location:'warehouse',materialId:'raw',quantity:'10',cost:'100'}];c.sources[0]!.intervalMs=10*M;
    const run=compileConfig(c), r=investmentReport(run,new Simulation(run).advanceTo(2*M));
    expect(r.stockCost).toBe('90000000');expect(r.stockAverage).toEqual({costMs:String(190n*C*BigInt(M)),durationMs:2*M});
    expect(r.totalAverage).toEqual({costMs:String(390n*C*BigInt(M)),durationMs:2*M});roiEquals(r,4n,39n);
    c.initialStocks=[];c.sources[0]!.availability='virtual';const virtual=compileConfig(c);
    expect(investmentReport(virtual,new Simulation(virtual).getSnapshot()).stockCost).toBe('0');
  });
  it('passes through financial losses from scrap without adding scrap back to investments',()=>{
    const c=finite();c.stations[0]!.costs.perShift='5';c.stations[0]!.plan[0]!.processing.defectProbability=1;
    const run=compileConfig(c), model=new Simulation(run).runToEnd(), r=investmentReport(run,model);
    expect(r).toMatchObject({stockCost:'0',netProfit:'-35000000',stockAverage:{costMs:String(60n*C*BigInt(M)),durationMs:c.durationMs}});
    expect(r.netProfit).toBe(financialReport(run,model).netProfit);expect(BigInt(r.roi!.numerator)<0n).toBe(true);
  });
  it('keeps unbounded integral terms exact over 100 days while the mean remains in range',()=>{
    const c=finite();c.durationMs+=99*DAY_MS;c.initialStocks[0]!.quantity='0.5';c.initialStocks[0]!.cost='9007199254.740990';c.stations[0]!.costs.capital='0.000001';
    const run=compileConfig(c), model=new Simulation(run).runToEnd(), r=investmentReport(run,model);
    expect(r.totalCost).toBe(String(MAX_UNITS));expect(r.totalAverage).toEqual({costMs:String(MAX_UNITS*BigInt(c.durationMs)),durationMs:c.durationMs});
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);roiEquals(r,0n,1n);
  });
  it('does not cap a dimensionless ROI at the monetary range',()=>{
    const c=finite();c.stations[0]!.costs.capital='0.000001';c.stations[0]!.outputBuffer={kind:'infinite'};
    c.materials.find(m=>m.id==='product')!.salePrice='9007199254.740991';
    c.initialStocks=[{id:'goods',ownerId:'s1',location:'output',materialId:'product',quantity:'1',cost:'0'}];
    const run=compileConfig(c), r=investmentReport(run,new Simulation(run).advanceTo(2));
    expect(BigInt(r.roi!.numerator)>MAX_UNITS).toBe(true);roiEquals(r,MAX_UNITS,1n);
  });
  it('checks summed capital and current total investment against the monetary range',()=>{
    const c=line();c.initialStocks=[];c.sources[0]!.availability='warehouse';c.stations.forEach(s=>s.costs.capital='9007199254');
    const run=compileConfig(c);expect(()=>investmentReport(run,new Simulation(run).getSnapshot())).toThrow(ArithmeticError);
    const single=finite();single.stations[0]!.costs.capital='9007199254.740991';
    const next=compileConfig(single);expect(()=>investmentReport(next,new Simulation(next).getSnapshot())).toThrow(ArithmeticError);
  });
  it('checks a historical monetary mean without rounding when current investment is already back in range',()=>{
    const c=finite();c.initialStocks[0]!.quantity='1';c.initialStocks[0]!.cost='9007199254.740991';c.stations[0]!.costs.capital='0.000001';
    c.materials.find(m=>m.id==='product')!.salePrice='0';const run=compileConfig(c), model=new Simulation(run).advanceTo(M);
    expect(model.line!.stockValue.currentCost).toBe('0');expect(()=>investmentReport(run,model)).toThrow(ArithmeticError);
  });
  it('observes immutable inputs without changing simulation, financial results or sampled history',()=>{
    const run=compileConfig(finite()), sim=new Simulation(run), model=sim.advanceTo(2.5*M), history=sim.getHistory();
    const before=structuredClone({run,model,history});const financial=financialReport(run,model);
    investmentReport(run,model);investmentReport(run,model);
    expect({run,model,history}).toEqual(before);expect(financialReport(run,model)).toEqual(financial);
  });
  it.each(exampleIds)('matches direct, event-step and irregular observation periods in %s',example=>{
    const run=compileConfig(previewConfig(example)), sim=new Simulation(run);
    while(sim.step()!==null){const model=sim.getSnapshot(), r=investmentReport(run,model);expect(r.netProfit).toBe(financialReport(run,model).netProfit);
      expect(r.stockCost).toBe(String(model.stocks.reduce((sum,stock)=>sum+BigInt(stock.cost),0n)));}
    const expected=investmentReport(run,new Simulation(run).runToEnd());expect(investmentReport(run,sim.getSnapshot())).toEqual(expected);
    const split=new Simulation(run);for(let t=13;t<run.resolved.durationMs;t+=1_371_119)split.advanceTo(t);
    expect(investmentReport(run,split.runToEnd())).toEqual(expected);
  });
  it.each([60,300,1800,'max'] as const)('preserves ROI during speed %s, pause, step, continuation and replay',speed=>{
    const run=compileConfig(finite());let time=0;const scheduled={callback:null as (()=>void)|null};
    const host={now:()=>time,request:(callback:()=>void)=>{scheduled.callback=callback;return 1;},cancel:()=>{scheduled.callback=null;}};
    const runner=new Runner(run,undefined,host);runner.setSpeed(speed);runner.start();runner.pause();runner.step();runner.resume();
    let turns=0;while(runner.getView().status==='running'){if(++turns>1000)throw new Error('Runner did not finish');time+=60_000;const callback=scheduled.callback;scheduled.callback=null;callback!();}
    expect(runner.getView().status).toBe('finished');const expected=investmentReport(run,new Simulation(run).runToEnd());expect(investmentReport(run,runner.getView().model)).toEqual(expected);runner.dispose();
    const replay=new Runner(run);while(replay.getView().status!=='finished')replay.step();expect(investmentReport(run,replay.getView().model)).toEqual(expected);replay.dispose();
  });
});
