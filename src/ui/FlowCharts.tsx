import {useEffect, useMemo, useState} from 'react';
import type {DeepReadonly, RunConfig} from '../engine/config';
import type {FlowHistory} from '../engine/flow-history';
import {durationText} from './metric-format';
import {quantityText} from './diagram';
import {nameFor} from './i18n';
import type {Labels, Language} from './i18n';
import {chartGeometry, CHART_HEIGHT, CHART_WIDTH, closestChartPoint, flowChartData, globalCfdReason, LINE_SCOPE, plot, pointTime} from './flow-chart-data';
import type {ChartSeries, FlowChartData, TimeScale} from './flow-chart-data';

const palette = ['#347db0','#c68218','#9865b6','#218d7c','#ce586b','#587aa3'];
const PAGE_SIZE = 40;
type Props = {run: RunConfig; history: DeepReadonly<FlowHistory>; text: Labels; language: Language};
type Kind = 'cfd' | 'wip' | 'output';
export function FlowCharts(props: Props) {
  const [open, setOpen] = useState(false);
  return <details className="flow-charts" data-testid="flow-charts" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{props.text.flowCharts}</summary>
    {open && <FlowChartsContent key={props.run.calculationHash} {...props}/>}
  </details>;
}
export function FlowChartsContent({run, history, text, language}: Props) {
  const unavailable = globalCfdReason(run);
  const [scope, setScope] = useState(unavailable ? (run.resolved.materials.find(m => m.role === 'intermediate') ?? run.resolved.materials[0]!).id : LINE_SCOPE);
  const [scale, setScale] = useState<TimeScale>('calendar');
  const [selected, setSelected] = useState<number | null>(null);
  const [tableKind, setTableKind] = useState<Kind>('cfd');
  const [page, setPage] = useState<number | null>(null);
  useEffect(() => {setSelected(null); setPage(null);}, [history.initial]);
  const data = useMemo(() => flowChartData(run, history, scope), [run, history, scope]);
  const index = Math.min(selected ?? data.frames.length - 1, data.frames.length - 1), frame = data.frames[index]!;
  const titles = {cfd: text.cfdTitle, wip: text.wipChartTitle, output: text.outputChartTitle};
  const materialName = (id: string) => nameFor(id, run.source.materials.find(m => m.id === id)!.name, text);
  const label = (series: ChartSeries) => series.kind === 'station' ? nameFor(series.id!, run.source.stations.find(s => s.id === series.id)!.name, text)
    : series.kind === 'material' ? materialName(series.id!) : series.kind === 'delivered' ? text.goodOutput : series.kind === 'scrapped' ? text.chartScrap : text.chartConsumed;
  const stationIds = data.cfd.filter(s => s.kind === 'station').map(s => s.id).reverse();
  const color = (series: ChartSeries, i: number) => series.kind === 'delivered' ? '#218d7c' : series.kind === 'scrapped' ? '#ce586b' : series.kind === 'consumed' ? '#9865b6' : palette[(series.kind === 'station' ? stationIds.indexOf(series.id) : i) % palette.length]!;
  const timeLabel = (f: typeof frame) => `${durationText(f.point.timeMs)} / ${durationText(f.point.workMs)}${f.point.phase === 'initial' ? ` (${text.chartInitial})` : ''}`;
  const pages = Math.ceil(data.frames.length / PAGE_SIZE), activePage = Math.min(page ?? pages - 1, pages - 1);
  const tableFrames = data.frames.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  return <div className="flow-charts-content">
    <p>{text.chartHelp}</p>
    <p className="summary-help">{text.chartSamplingHelp} {text.chartInterval}: {durationText(history.sampling.intervalMs)}. {text.chartPointCount}: {history.points.length} / {history.sampling.maxPoints}.</p>
    <div className="chart-settings">
      <label>{text.cfdScope}<select aria-label={text.cfdScope} value={scope} onChange={e => setScope(e.target.value)}><option value={LINE_SCOPE} disabled={unavailable !== null}>{text.wholeLineCfd}</option>{run.resolved.materials.map(m => <option key={m.id} value={m.id}>{materialName(m.id)}</option>)}</select></label>
      <label>{text.chartTimeScale}<select aria-label={text.chartTimeScale} value={scale} onChange={e => setScale(e.target.value as TimeScale)}><option value="calendar">{text.chartCalendar}</option><option value="work">{text.chartWork}</option></select></label>
    </div>
    {unavailable && <p className="chart-limitation" data-global-cfd="unavailable">{text.globalCfdUnavailable} {unavailable === 'assembly' ? text.cfdAssemblyReason : unavailable === 'quantityChange' ? text.cfdQuantityReason : text.cfdProductsReason}</p>}
    <p data-cfd-scope={scope}><strong>{text.chartBoundary}:</strong> {scope === LINE_SCOPE ? text.cfdLineBoundary : `${materialName(scope)}. ${text.cfdMaterialBoundary}`}</p>
    <p className="summary-help">{text.cfdStageHelp}</p>
    <div className="chart-inspector">
      <label htmlFor="chart-point">{text.chartSelectedPoint}: <output>{timeLabel(frame)}</output></label>
      <input id="chart-point" aria-label={text.chartSelectedPoint} aria-valuetext={timeLabel(frame)} type="range" min={0} max={data.frames.length - 1} value={index} onChange={e => setSelected(Number(e.target.value))}/>
      <div className="chart-point-buttons"><button type="button" disabled={index === 0} onClick={() => setSelected(index - 1)}>{text.chartPreviousPoint}</button><button type="button" disabled={index === data.frames.length - 1} onClick={() => setSelected(index + 1)}>{text.chartNextPoint}</button><button type="button" onClick={() => setSelected(null)}>{text.chartFollowCurrent}</button></div>
      <p className="summary-help">{text.chartInspectHelp}</p>
    </div>
    {(['cfd','wip','output'] as const).map(kind => <FlowPlot key={kind} kind={kind} data={data} scale={scale} selected={index} onPick={setSelected} title={titles[kind]} label={label} color={color} text={text} language={language} timeLabel={timeLabel(frame)}/>)}
    <details className="chart-data-table"><summary>{text.chartDataTable}</summary><p>{text.chartTableHelp}</p>
      <div className="chart-settings"><label>{text.chartTableChoice}<select aria-label={text.chartTableChoice} value={tableKind} onChange={e => setTableKind(e.target.value as Kind)}>{(['cfd','wip','output'] as const).map(kind => <option key={kind} value={kind}>{titles[kind]}</option>)}</select></label>
        <label>{text.chartTablePage}<select aria-label={text.chartTablePage} value={activePage} onChange={e => setPage(Number(e.target.value))}>{Array.from({length: pages}, (_,i) => <option key={i} value={i}>{i * PAGE_SIZE + 1}–{Math.min((i+1)*PAGE_SIZE,data.frames.length)} / {data.frames.length}</option>)}</select></label>
      </div>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={text.chartDataTable}><table className="metric-table"><caption>{titles[tableKind]}, {text.unit}</caption><thead><tr><th scope="col">{text.chartCalendar}, {text.timeFormat}</th><th scope="col">{text.chartWork}, {text.timeFormat}</th><th scope="col">{text.chartPointPhase}</th>{data[tableKind].map(series => <th scope="col" key={series.key}>{label(series)}</th>)}</tr></thead><tbody>
        {tableFrames.map((f,i) => <tr key={activePage * PAGE_SIZE + i} data-chart-row={activePage * PAGE_SIZE + i}><th scope="row">{durationText(f.point.timeMs)}</th><td>{durationText(f.point.workMs)}</td><td>{f.point.phase === 'initial' ? text.chartInitial : text.chartSettled}</td>{f[tableKind].map((quantity,j) => <td key={data[tableKind][j]!.key} data-chart-quantity={quantity}>{quantityText(quantity)}</td>)}</tr>)}
      </tbody></table></div>
    </details>
  </div>;
}
function FlowPlot({kind, data, scale, selected, onPick, title, label, color, text, language, timeLabel}: {
  kind: Kind; data: FlowChartData; scale: TimeScale; selected: number; onPick: (index: number) => void; title: string;
  label: (series: ChartSeries) => string; color: (series: ChartSeries, i: number) => string; text: Labels; language: Language; timeLabel: string;
}) {
  const geometry = useMemo(() => chartGeometry(data, kind, scale), [data,kind,scale]);
  const timeTicks = geometry.end ? [0,0.25,0.5,0.75,1] : [0];
  const definition = (series: ChartSeries) => kind === 'wip' ? text.wipPlotHelp : kind === 'output' || series.kind === 'delivered' ? text.outputPlotHelp : series.kind === 'station' ? text.cfdStationDefinition : series.kind === 'scrapped' ? text.cfdScrapDefinition : text.cfdConvertedDefinition;
  const quantityLabel = (value: number) => new Intl.NumberFormat(language, {notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 2}).format(value);
  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width * CHART_WIDTH;
    const time = Math.max(0,Math.min(1,(x-plot.left)/(plot.right-plot.left))) * geometry.end;
    onPick(closestChartPoint(data.frames.map(f => pointTime(f.point,scale)),time));
  };
  return <figure className="flow-plot" data-chart={kind}>
    <figcaption>{title}</figcaption>
    <p className="summary-help">{kind === 'cfd' ? text.cfdPlotHelp : kind === 'wip' ? text.wipPlotHelp : text.outputPlotHelp}</p>
    <div className="chart-svg-scroll" tabIndex={0} role="region" aria-label={`${title}: ${text.chartVisual}`}>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-labelledby={`plot-${kind}-title plot-${kind}-desc`} onPointerMove={pick}>
        <title id={`plot-${kind}-title`}>{title}</title><desc id={`plot-${kind}-desc`}>{text.chartAccessibleHelp}</desc>
        {[0,0.25,0.5,0.75,1].map(r => <g key={r}><line className="chart-grid" x1={plot.left} x2={plot.right} y1={geometry.y(r*geometry.ceiling)} y2={geometry.y(r*geometry.ceiling)}/><text className="chart-tick" x={plot.left-10} y={geometry.y(r*geometry.ceiling)+4} textAnchor="end">{quantityLabel(r*geometry.ceiling)}</text></g>)}
        <text className="chart-axis-title" x={plot.left} y={14}>{text.quantity}, {text.unit}</text>
        {geometry.paths.map((d,i) => <path key={data[kind][i]!.key} d={d} fill={kind === 'cfd' ? color(data[kind][i]!,i) : 'none'} fillOpacity={0.72} stroke={color(data[kind][i]!,i)} strokeWidth={kind === 'cfd' ? 0.7 : 2.4} vectorEffect="non-scaling-stroke"><title>{`${label(data[kind][i]!)}: ${quantityText(data.frames[selected]![kind][i]!)} ${text.unit}\n${timeLabel}\n${definition(data[kind][i]!)}`}</title></path>)}
        <line className="chart-cursor" x1={geometry.xs[selected]} x2={geometry.xs[selected]} y1={plot.top} y2={plot.bottom}/>
        {timeTicks.map(r => <text key={r} className="chart-tick" x={geometry.x(r*geometry.end)} y={281} textAnchor={r === 0 ? 'start' : r === 1 ? 'end' : 'middle'}>{durationText(Math.round(r*geometry.end))}</text>)}
        <text className="chart-axis-title" x={(plot.left+plot.right)/2} y={310} textAnchor="middle">{scale === 'calendar' ? text.chartCalendarAxis : text.chartWorkAxis}</text>
      </svg>
    </div>
    <p className="chart-readout">{text.chartSelectedPoint}: {timeLabel}</p>
    <ul className="chart-legend" aria-label={`${title}: ${text.chartValues}`}>{data[kind].map((series,i) => <li key={series.key} title={definition(series)}><i aria-hidden="true" style={{backgroundColor:color(series,i)}}/><span>{label(series)}</span><strong data-chart-value={series.key}>{quantityText(data.frames[selected]![kind][i]!)} {text.unit}</strong></li>)}</ul>
  </figure>;
}
