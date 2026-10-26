import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {compileConfig} from '../engine/config';
import {flowThroughStation} from './diagram';
import {exampleRuns,previewConfig} from './preview';
import {FlowDiagram} from './FlowDiagram';
import {Runner} from '../runner/runner';
import {labels} from './i18n';
const sorted=(ids:Iterable<string>)=>[...ids].sort();

describe('structural flow through the identified bottleneck',()=>{
  it('highlights the complete linear route',()=>{
    const run=exampleRuns.queue;
    expect(sorted(flowThroughStation(run,'work'))).toEqual(sorted(run.resolved.routes.map(r=>r.id)));
  });
  it('includes all downstream split branches without choosing one',()=>{
    const run=exampleRuns.split;
    expect(sorted(flowThroughStation(run,'prep'))).toEqual(sorted(run.resolved.routes.map(r=>r.id)));
  });
  it('excludes the parallel bypass that does not pass through the identified station',()=>{
    expect(sorted(flowThroughStation(exampleRuns.split,'work'))).toEqual(['prep-work','source-prep','work-market']);
    expect(sorted(flowThroughStation(exampleRuns.split,'finish'))).toEqual(['finish-market','prep-finish','source-prep']);
  });
  it('includes every supplying branch when the assembly itself is the candidate',()=>{
    const run=exampleRuns.assembly;
    expect(sorted(flowThroughStation(run,'assembly'))).toEqual(sorted(run.resolved.routes.map(r=>r.id)));
  });
  it('does not mark the other assembly input as passing through an upstream candidate',()=>{
    expect(sorted(flowThroughStation(exampleRuns.assembly,'work'))).toEqual(['assembly-market','source-work','work-assembly']);
  });
  it('covers multiple products and sources through a shared cyclic station',()=>{
    const run=exampleRuns.plans;
    expect(run.resolved.materials.filter(m=>m.role==='finished')).toHaveLength(2);
    expect(sorted(flowThroughStation(run,'planner'))).toEqual(sorted(run.resolved.routes.map(r=>r.id)));
  });
  it('has no highlighted route without a single valid candidate',()=>{
    for(const id of [null,'missing','source','market']) expect(flowThroughStation(exampleRuns.split,id).size).toBe(0);
  });
  it('does not depend on entity order and does not mutate the run',()=>{
    const config=previewConfig('assembly'),run=compileConfig(config),before=JSON.stringify(config);
    const expected=sorted(flowThroughStation(run,'work'));
    config.routes.reverse();config.stations.reverse();config.sources.reverse();
    expect(sorted(flowThroughStation(compileConfig(config),'work'))).toEqual(expected);
    expect(JSON.stringify(run.source)).toBe(before);
  });
  it.each(['ru','en'] as const)('renders matching routes, arrowheads and text labels in %s',language=>{
    const run=exampleRuns.split,runner=new Runner(run),view=runner.getView(),text=labels(language);
    const html=renderToStaticMarkup(<FlowDiagram run={run} view={view} text={text} reduced bottleneckStationIds={["work"]}/>);
    const paths=[...html.matchAll(/<path[^>]*data-route="([^"]+)"[^>]*data-bottleneck-flow="true"/g)].map(match=>match[1]!);
    expect(sorted(paths)).toEqual(['prep-work','source-prep','work-market']);
    expect(html.match(/marker-end="url\(#bottleneck-flow-arrow\)"/g)).toHaveLength(3);
    expect(html.match(/data-bottleneck-flow-text="true"/g)).toHaveLength(3);
    expect(html).toContain(text.bottleneckFlow);expect(html).toContain(text.bottleneckFlowHelp);
    expect(html.match(/data-bottleneck="true"/g)).toHaveLength(1);
    expect(html).toContain('station-body state-idle');expect(html).not.toContain('data-route-critical');
    const plain=renderToStaticMarkup(<FlowDiagram run={run} view={view} text={text} reduced/>);
    expect(plain).not.toContain('data-bottleneck-flow');expect(plain).not.toContain(text.bottleneckFlowHelp);
    expect(runner.getView()).toEqual(view);runner.dispose();
  });
});
