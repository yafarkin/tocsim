import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {Simulation} from '../engine/simulation';
import {line} from '../engine/test-fixtures';
import {exampleIds,previewConfig} from './preview';
import {labels} from './i18n';
import {FlowCharts,FlowChartsContent} from './FlowCharts';
const M=60_000;
describe('flow charts and accessible values',()=>{
  it('keeps closed charts out of rendering work until explicitly expanded',()=>{
    const run=compileConfig(previewConfig('queue')),sim=new Simulation(run);sim.runToEnd();
    const html=renderToStaticMarkup(<FlowCharts run={run} history={sim.getHistory()} text={labels('en')} language="en"/>);
    expect(html).toContain('CFD and flow charts');expect(html).not.toContain('<svg');expect(html).not.toContain('<table');
    const ready = new Simulation(run); const initial=renderToStaticMarkup(<FlowChartsContent run={run} history={ready.getHistory()} text={labels('en')} language="en"/>);
    expect(initial).toContain(labels('en').chartInitial);expect(initial).not.toMatch(/NaN|Infinity|undefined/);
  });
  it.each(['ru','en'] as const)('provides labels, keyboard controls, exact table and sampling limits in %s',language=>{
    const run=compileConfig(previewConfig('queue')),sim=new Simulation(run);sim.advanceTo(14*M);const text=labels(language);
    const html=renderToStaticMarkup(<FlowChartsContent run={run} history={sim.getHistory()} text={text} language={language}/>);
    for(const label of [text.cfdTitle,text.wipChartTitle,text.outputChartTitle,text.chartDataTable,text.chartSettled,text.chartSamplingHelp,text.cfdStageHelp,text.chartInspectHelp,text.cfdStationDefinition,text.cfdScrapDefinition])expect(html).toContain(label);
    expect(html).toContain('type="range"');expect(html).toContain('aria-valuetext="0:14:00 / 0:14:00"');
    expect(html).toContain('data-chart-value="station-work">3');expect(html).toContain('data-chart-quantity="3000000">3');
    expect(html).toContain('scope="col"');expect(html).toContain('scope="row"');expect(html).toContain('tabindex="0" role="region"');
    expect((html.match(/<svg/g)??[])).toHaveLength(3);expect(html).not.toMatch(/NaN|Infinity|undefined/);
    expect(html).not.toContain('data-global-cfd="unavailable"');
  });
  it('bounds table DOM while allowing all samples through pagination',()=>{
    const run=compileConfig(previewConfig('queue')),sim=new Simulation(run);sim.runToEnd();
    const html=renderToStaticMarkup(<FlowChartsContent run={run} history={sim.getHistory()} text={labels('en')} language="en"/>);
    expect((html.match(/data-chart-row=/g)??[]).length).toBeLessThanOrEqual(40);expect(html).toContain('2048 / 2048');
    expect(html).toContain('9:00:00');expect(html).toContain('8:00:00');
  });
  it('explains a 1:10 conversion and selects a single material instead of a mixed total',()=>{
    const run=compileConfig(line()),sim=new Simulation(run);sim.advanceTo(5*M);const text=labels('en');
    const html=renderToStaticMarkup(<FlowChartsContent run={run} history={sim.getHistory()} text={text} language="en"/>);
    expect(html).toContain(text.cfdQuantityReason);expect(html).toContain('data-cfd-scope="part"');
    expect(html).toContain(text.chartConsumed);expect(html).not.toContain('data-cfd-scope="@line"');
  });
  it.each(exampleIds)('renders the correct comparable boundary and both languages in %s',example=>{
    const run=compileConfig(previewConfig(example)),sim=new Simulation(run);sim.runToEnd();
    for(const language of ['ru','en'] as const){
      const text=labels(language),html=renderToStaticMarkup(<FlowChartsContent run={run} history={sim.getHistory()} text={text} language={language}/>);
      expect(html).not.toMatch(/NaN|Infinity|undefined/);expect(html).toContain(text.chartAccessibleHelp);
      if(example==='assembly'||example==='plans'){expect(html).toContain(text.globalCfdUnavailable);expect(html).not.toContain('data-cfd-scope="@line"');}
      else expect(html).toContain('data-cfd-scope="@line"');
    }
  });
});
