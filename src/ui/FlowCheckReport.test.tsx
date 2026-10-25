import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import type {Snapshot} from '../engine/state';
import {Simulation} from '../engine/simulation';
import type {RunnerView} from '../runner/runner';
import {Runner} from '../runner/runner';
import {line} from '../engine/test-fixtures';
import {FlowCheckReport} from './FlowCheckReport';
import {RunSummary} from './RunSummary';
import {exampleIds,previewConfig} from './preview';
import {labels} from './i18n';
const M=60_000;
function single() {
  const c=line();c.stations=[c.stations[0]!];c.stations[0]!.inputBuffer={kind:'infinite'};c.initialStocks=[];
  c.materials=c.materials.filter(m=>m.id!=='part');
  c.recipes=[{id:'cut',name:'one',kind:'production',inputs:[{materialId:'raw',quantity:'1'}],output:{materialId:'product',quantity:'1'}}];
  c.routes=[c.routes[0]!,{id:'sell',fromId:'s1',toId:'market',materialId:'product'}];return c;
}
function render(c=single(),time=2.5*M,language:'ru'|'en'='en') {
  const run=compileConfig(c),sim=new Simulation(run);sim.advanceTo(time);const runner=new Runner(run);
  const view={...runner.getView(),model:sim.getSnapshot(),flowReport:sim.getFlowReport()};
  const html=renderToStaticMarkup(<FlowCheckReport run={run} view={view} text={labels(language)}/>);runner.dispose();return {html,sim,run,view};
}
describe('visible exact flow check and Little approximation',()=>{
  it.each(['ru','en'] as const)('distinguishes exact equality, approximation, units and window edges in %s',language=>{
    const text=labels(language),{html}=render(single(),2.5*M,language);
    for(const label of [text.flowCheck,text.flowBoundary,text.flowExact,text.flowApproximation,text.flowExactHelp,text.flowApproximationHelp,text.flowNoStationarity,text.flowEdgesHelp,text.flowRounding,text.flowAreaUnit,text.chartCalendar,text.chartWork,text.flowMeanTime,text.flowRate]) expect(html).toContain(label);
    expect(html).toContain('data-flow-exact="true"');expect(html).toContain('data-flow-window-exact="true"');expect(html).toContain('data-flow-corrected="true"');
    expect(html).toContain('data-flow-metric="L" data-flow-scale="calendar" data-numerator="150000000000" data-denominator="150000">1</td>');
    expect(html).toContain('data-flow-metric="lambda" data-flow-scale="calendar" data-numerator="2000000" data-denominator="150000">0.8</td>');
    expect(html).toContain('data-flow-metric="W" data-flow-scale="calendar" data-numerator="120000000000" data-denominator="2000000">0:01:00</td>');
    expect(html).toContain('data-flow-metric="lambdaW" data-flow-scale="calendar" data-numerator="120000000000" data-denominator="150000">0.8</td>');
    expect(html).toContain('data-flow-edge="edgeCorrectionQuantityMs" data-flow-scale="calendar" data-exact-value="30000000000">0.5</td>');
    expect(html).toContain('tabindex="0" role="region"');expect(html).toContain('scope="row"');expect(html).toContain('scope="col"');
    expect(html).not.toMatch(/NaN|Infinity|undefined/);expect(html).not.toContain('role="alert"');
  });
  it('shows whole-run exact equality while the configured warmup has not finished',()=>{
    const c=single();c.warmupMs=M;const {html}=render(c,M/2);
    expect(html).toContain('data-flow-exact="true"');expect(html).toContain('data-flow-warmup-pending="true"');expect(html).toContain(labels('en').flowWarmupPending);
    expect(html).not.toContain('data-flow-metric="W"');
  });
  it('shows the applied warmup, actual window, exact quantities and W from the shared report',()=>{
    const c=single();c.warmupMs=M;const {html}=render(c,2.5*M);
    expect(html).toContain('0:01:00 → 0:02:30');expect(html).toContain('data-flow-period="calendar">0:01:30');
    expect(html).toContain('data-flow-metric="W" data-flow-scale="calendar" data-numerator="60000000000" data-denominator="1000000">0:01:00');
  });
  it.each([0,M/2])('explains missing approximation at %s while retaining the exact check',time=>{
    const {html}=render(single(),time);expect(html).toContain(`data-flow-no-approximation="${time===0?'zeroPeriod':'noCompletions'}"`);
    expect(html).toContain('data-flow-exact="true"');expect(html).toContain(labels('en').notCalculated);
  });
  it('shows unknown completed history without substituting the known subset mean',()=>{
    const c=single();c.initialStocks=[{id:'old',ownerId:'s1',location:'input',materialId:'raw',quantity:'1',cost:'1'}];
    const {html}=render(c,2.5*M);expect(html).toContain('data-flow-no-approximation="unknownHistory"');
    expect(html).toContain(labels('en').flowCorrectionUnknown);expect(html).toContain('data-flow-corrected="null"');expect(html).toContain('data-flow-exact="true"');
  });
  it('shows a negative correction when the window cuts a completed residence',()=>{
    const c=single();c.warmupMs=M/2;const {html}=render(c,M);
    expect(html).toContain('data-flow-edge="edgeCorrectionQuantityMs" data-flow-scale="calendar" data-exact-value="-30000000000">−0.5</td>');
    expect(html).toContain('data-flow-corrected="true"');
  });
  it('explains a zero work-time period inside lunch separately from the calendar period',()=>{
    const c=single();c.warmupMs=4*60*M;const {html}=render(c,4.5*60*M);
    expect(html).toContain('data-flow-no-approximation="zeroPeriod" data-flow-scale="work"');expect(html).not.toContain('data-flow-no-approximation="zeroPeriod" data-flow-scale="calendar"');
  });
  it('shows an exact mismatch as a data problem rather than an approximation error',()=>{
    const {run,view}=render();const damaged=structuredClone(view) as RunnerView;(damaged.model as Snapshot).line!.stockTime[0]!.calendarQuantityMs='1';
    const html=renderToStaticMarkup(<FlowCheckReport run={run} view={damaged} text={labels('en')}/>);
    expect(html).toContain('data-flow-exact="false" role="alert"');expect(html).toContain(labels('en').flowExactMismatch);
  });
  it.each(exampleIds)('renders both languages at zero, live, paused, stopped, repeated and full horizon for %s',example=>{
    const run=compileConfig(previewConfig(example)),runner=new Runner(run);
    const check=()=>{for(const language of ['ru','en'] as const) {
      const view=runner.getView(),copy=structuredClone(view),text=labels(language);
      const html=renderToStaticMarkup(<RunSummary run={run} view={view} text={text} language={language}/>);
      expect(html).toContain(text.flowCheck);expect(html).toContain(text.financialResult);expect(html).toContain(text.productOutput);expect(html).toContain(text.stockReport);
      if(view.flowReport.applicable)expect(html).toContain('data-flow-window-exact="true"');else expect(html).toContain(text.flowUnavailable);
      expect(html).not.toMatch(/NaN|Infinity|undefined/);expect(runner.getView()).toEqual(copy);
    }};
    check();runner.step();check();runner.step();check();runner.stop();check();runner.repeat();runner.pause();check();
    while(runner.getView().status!=='finished')runner.step();check();
    expect(Object.isFrozen(runner.getView().flowReport)).toBe(true);expect(runner.getView().schemaVersion).toBe(4);
    expect(JSON.parse(JSON.stringify(runner.getView())).flowReport).toEqual(runner.getFlowReport());runner.dispose();
  });
  it.each([['assembly','assembly'],['plans','mixedProducts'],['quality','quality']] as const)('explains why %s is inapplicable without a false mismatch', (example,reason)=>{
    const {html}=render(previewConfig(example),0);
    expect(html).toContain(`data-flow-unavailable="${reason}"`);expect(html).toContain(labels('en').flowAvailableReports);
    expect(html).not.toContain('data-flow-exact="false"');expect(html).not.toContain('role="alert"');
  });
  it('explains quantity changes without a false law violation',()=>{
    const {html}=render(line(),0);expect(html).toContain('data-flow-unavailable="quantityChange"');expect(html).toContain(labels('en').cfdQuantityReason);
  });
});
