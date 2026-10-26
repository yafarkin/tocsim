import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {BottleneckResultView,BottleneckSearch,bottleneckLabels} from './BottleneckSearch';
import {summarizeBottleneck} from '../runner/bottleneck-search';
import {labels} from './i18n';
import {exampleRuns} from './preview';
import {FlowDiagram} from './FlowDiagram';
import {Runner} from '../runner/runner';

describe('bottleneck search control and diagram',()=>{
  it.each(['ru','en'] as const)('renders an available search, a locked search and translated details in %s',language=>{
    const run=exampleRuns.queue,text=labels(language),t=bottleneckLabels[language];
    const available=renderToStaticMarkup(<BottleneckSearch run={run} text={text} language={language} allowed onResult={()=>{}}/>);
    expect(available).toContain(t.button);expect(available).not.toContain('disabled=""');expect(available).toContain(t.help);
    const locked=renderToStaticMarkup(<BottleneckSearch run={run} text={text} language={language} allowed={false} onResult={()=>{}}/>);
    expect(locked).toContain('disabled=""');
    const result=summarizeBottleneck(['product'],[{seed:42,baseline:['10000000'],outputs:[{stationId:'work',quantities:['11000000']},{stationId:'prep',quantities:['9999999']}]}]);
    const html=renderToStaticMarkup(<BottleneckResultView run={run} result={result} text={text} language={language}/>);
    expect(html).toContain(t.candidate);expect(html).toContain('11 (+1)');expect(html).toContain('9.999999 (−0.000001)');
    expect(html).toContain('data-candidate="true"');expect(html).not.toContain('<details open');
    expect(html).toContain('tabindex="0"');expect(html).toContain(t.limit);
  });
  it.each(['ru','en'] as const)('keeps equal improvements ambiguous and displays paired ranges in %s',language=>{
    const sample={seed:42,baseline:['10000000'],outputs:[{stationId:'work',quantities:['11000000']},{stationId:'prep',quantities:['11000000']}]};
    const result=summarizeBottleneck(['product'],[sample,{...sample,seed:43,baseline:['9000000']},{...sample,seed:44}]);
    const html=renderToStaticMarkup(<BottleneckResultView run={exampleRuns.queue} result={result} text={labels(language)} language={language}/>);
    expect(html).toContain(bottleneckLabels[language].ambiguous);expect(html).toContain('(+1…+2)');
    expect(html).not.toContain('data-candidate="true"');expect(html).toContain('42, 43, 44');
  });
  it.each(['ru','en'] as const)('marks only the requested station without replacing its actual state in %s',language=>{
    const run=exampleRuns.queue,runner=new Runner(run),view=runner.getView(),text=labels(language);
    const html=renderToStaticMarkup(<FlowDiagram run={run} view={view} text={text} reduced bottleneckStationId="work"/>);
    expect(html.match(/data-bottleneck="true"/g)).toHaveLength(1);
    expect(html).toContain('data-station="work" data-bottleneck="true"');expect(html).toContain('bottleneck-outline');expect(html).toContain(text.bottleneckCandidate);
    expect(html).toContain('station-body state-idle');expect(html).not.toContain('data-route-critical');
    const plain=renderToStaticMarkup(<FlowDiagram run={run} view={view} text={text} reduced/>);
    expect(plain).not.toContain('bottleneck-outline');expect(plain).not.toContain('data-bottleneck');runner.dispose();
  });
});
