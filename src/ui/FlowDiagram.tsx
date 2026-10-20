import { useEffect, useRef, useState } from 'react';
import type { DeepReadonly, RunConfig } from '../engine/config';
import type { RunnerView } from '../runner/runner';
import type { StationSnapshot } from '../engine/state';
import { FIRST_X, NODE_GAP, fillRatio, linearOrder, quantityText, tokenFills } from './diagram';
import { nameFor } from './i18n';
import type { Labels } from './i18n';

interface Props { run: RunConfig; view: DeepReadonly<RunnerView>; text: Labels; reduced: boolean }
export function stationReason(station: DeepReadonly<StationSnapshot>, run: RunConfig, text: Labels): string {
  if (station.reason === 'notStarted') return text.notStarted;
  if (station.reason === 'lunch' || station.reason === 'offShift' || station.reason === 'horizon') return text[station.reason];
  if (station.reason === 'input') {
    const material = run.source.materials.find(m => m.id === station.input.materialId)!;
    return `${text.needs}: ${quantityText(station.input.missingQuantity)} ${nameFor(material.id, material.name, text)}`;
  }
  if (station.reason === 'output' && station.blockedBy) {
    const blocker = run.source.stations.find(s => s.id === station.blockedBy!.stationId);
    return `${station.blockedBy.location === 'input' ? text.fullInput : text.fullOutput}: ${nameFor(station.blockedBy.stationId, blocker?.name ?? text.market, text)}`;
  }
  return station.remainingProcessingMs !== null ? `${text.remaining}: ${Math.ceil(station.remainingProcessingMs / 60_000)} ${text.minutes}` : text[station.status];
}
function Tokens({quantity, x, y, color}: {quantity: number; x: number; y: number; color: string}) {
  return <g aria-hidden="true">{tokenFills(quantity).map((fill, i) => <g key={i}>
    <rect x={x} y={y - i * 13} width="30" height="9" rx="2" fill="var(--surface)" stroke={color}/>
    <rect x={x} y={y - i * 13} width={30 * fill} height="9" rx="2" fill={color}/>
  </g>)}</g>;
}
export function FlowDiagram({run, view, text, reduced}: Props) {
  const order = linearOrder(run), width = FIRST_X + order.length * NODE_GAP + 130;
  const xOf = (id: string) => FIRST_X + order.indexOf(id) * NODE_GAP;
  const source = run.source.sources[0]!, marketX = FIRST_X + order.length * NODE_GAP - 30;
  const materialName = (id: string) => {const m = run.source.materials.find(m => m.id === id)!; return nameFor(id, m.name, text);};
  const materialColor = (id: string) => run.source.materials.find(m => m.id === id)!.color;
  const stationName = (id: string) => nameFor(id, run.source.stations.find(s => s.id === id)!.name, text);
  const sold = view.model.line!.counters.reduce((sum, c) => sum + c.sold, 0);
  const [overlay, setOverlay] = useState({sequence: -1, visible: false});
  const seen = useRef(-1);
  useEffect(() => {
    const sequence = view.transfers.sequence;
    const fresh = seen.current !== sequence;
    seen.current = sequence;
    if (fresh) setOverlay({sequence, visible: view.transfers.items.length > 0});
    if (view.status !== 'running' || view.transfers.items.length === 0) return;
    const timer = setTimeout(() => setOverlay(previous => previous.sequence === sequence ? {...previous, visible: false} : previous), 520);
    return () => clearTimeout(timer);
  }, [view.transfers.sequence, view.status]);
  const moving = view.status === 'running' && view.speed !== 'max' && view.speed <= 300 && !reduced;
  return <>
    <div className="diagram-scroll" tabIndex={0} role="region" aria-label={text.diagram}>
      <svg className="flow-svg" viewBox={`0 0 ${width} 480`} style={{minWidth: width}} role="img" aria-labelledby="flow-title flow-description" data-testid="flow-svg">
        <title id="flow-title">{text.diagram}</title><desc id="flow-description">{text.diagramDescription}</desc>
        <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--route)"/></marker></defs>
        <path d={`M 30 215 H ${width - 30}`} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 7"/>
        <g className="endpoint"><rect x="22" y="147" width="112" height="118" rx="8"/><text x="78" y="173" textAnchor="middle">{text.source}</text>
          <rect x="60" y="193" width="36" height="24" rx="3" fill={materialColor(source.materialId)} stroke="none"/>
          <text x="78" y="242" textAnchor="middle" className="small">{materialName(source.materialId)}</text>
        </g>
        {run.resolved.routes.map(route => {
          const from = route.fromId === source.id ? 140 : xOf(route.fromId) + 244;
          const to = route.toId === 'market' ? marketX - 8 : xOf(route.toId) - 82;
          return <path key={route.id} d={`M ${from} 215 H ${to}`} className="route-arrow" markerEnd="url(#flow-arrow)" data-route={route.id}/>;
        })}
        {order.map((id, index) => {
          const x = xOf(id), config = run.resolved.stations.find(s => s.id === id)!;
          const state = view.model.stations.find(s => s.stationId === id)!, inputColor = materialColor(state.input.materialId), outputColor = materialColor(state.output.materialId);
          const inputFill = fillRatio(state.input.quantity, config.inputBuffer), outputFill = fillRatio(state.output.quantity, config.outputBuffer);
          const direct = config.outputBuffer.kind === 'quantity' && config.outputBuffer.quantity === 0;
          const cap = (buffer: typeof config.inputBuffer) => buffer.kind === 'infinite' ? '∞' : quantityText(buffer.quantity);
          return <g key={id} data-station={id} data-state={state.status}>
            <text x={x} y="56" className="station-number">{String(index + 1).padStart(2, '0')}</text>
            <text x={x} y="84" className="station-title">{stationName(id)}</text>
            <text x={x} y="108" className="small">{config.timeMs / 60_000} {text.minutes}</text>
            <g className="buffer"><text x={x - 50} y="139" textAnchor="middle" className="small">{text.input}</text>
              <rect x={x - 77} y="150" width="56" height="122" rx="5"/>
              <rect x={x - 73} y="267" width={48 * (inputFill ?? 0)} height="3" fill={inputColor}/>
              <Tokens quantity={state.input.quantity} x={x - 64} y={244} color={inputColor}/>{state.input.quantity > 6_000_000 && <text x={x - 49} y="166" textAnchor="middle" className="tiny">+</text>}
              <text x={x - 49} y="295" textAnchor="middle" className="quantity">{quantityText(state.input.quantity)}</text>
              <text x={x - 49} y="314" textAnchor="middle" className="tiny">/ {cap(config.inputBuffer)}</text>
            </g>
            <path d={`M ${x - 17} 215 H ${x - 3}`} className="route-arrow" markerEnd="url(#flow-arrow)"/>
            <rect x={x} y="150" width="176" height="122" rx="8" className={`station-body state-${state.status}`}/>
            <circle cx={x + 16} cy="172" r="4" className={`state-dot state-${state.status}`}/>
            <text x={x + 28} y="177" className="state-label">{state.reason === 'notStarted' ? text.notStarted : state.status === 'paused' && state.reason ? text[state.reason === 'input' || state.reason === 'output' ? 'paused' : state.reason] : text[state.status]}</text>
            <text x={x + 14} y="204" className="small">{state.remainingProcessingMs !== null ? `${Math.round((state.progress ?? 0) * 100)}%` : ' '}</text>
            <rect x={x + 14} y="216" width="148" height="7" rx="3" fill="var(--track)"/>
            <rect x={x + 14} y="216" width={148 * (state.progress ?? 0)} height="7" rx="3" fill="var(--progress)"/>
            <text x={x + 14} y="251" className="small">{text.held}: <tspan className="quantity">{quantityText(state.output.heldQuantity)}</tspan></text>
            {state.output.heldQuantity > 0 && <rect x={x + 132} y="239" width="29" height="11" rx="2" fill={outputColor}/>}
            <g className="buffer">
              <text x={x + 217} y="139" textAnchor="middle" className="small">{text.output}</text>
              {direct ? <><title>{text.directLong}</title><path d={`M ${x + 181} 215 H ${x + 240}`} className="direct-path"/><text x={x + 214} y="246" textAnchor="middle" className="tiny">{text.direct}</text></>
                : <><rect x={x + 190} y="150" width="54" height="122" rx="5"/><Tokens quantity={state.output.quantity} x={x + 202} y={244} color={outputColor}/>
                  <rect x={x + 194} y="267" width={46 * (outputFill ?? 0)} height="3" fill={outputColor}/>
                  <text x={x + 217} y="295" textAnchor="middle" className="quantity">{quantityText(state.output.quantity)}</text><text x={x + 217} y="314" textAnchor="middle" className="tiny">/ {cap(config.outputBuffer)}</text></>}
            </g>
            <foreignObject x={x - 5} y="339" width="252" height="80"><div className={`reason reason-${state.status}`}>{stationReason(state, run, text)}</div></foreignObject>
          </g>;
        })}
        <g className="endpoint"><rect x={marketX} y="147" width="130" height="118" rx="8"/><text x={marketX + 65} y="173" textAnchor="middle" className="small">{text.market}</text>
          <text x={marketX + 65} y="220" textAnchor="middle" className="output-total" data-testid="output-total">{quantityText(sold)}</text><text x={marketX + 65} y="246" textAnchor="middle" className="tiny">{text.unit}</text>
        </g>
        {overlay.visible && overlay.sequence === view.transfers.sequence && view.transfers.items.map(transfer => {
          const start = transfer.fromId === source.id ? 134 : xOf(transfer.fromId) + (transfer.kind === 'buffer' ? 160 : 244);
          const end = transfer.toId === 'market' ? marketX - 14 : transfer.kind === 'buffer' ? xOf(transfer.toId) + 210 : xOf(transfer.toId) - 86;
          const key = `${transfer.fromId}:${transfer.toId}:${transfer.materialId}:${transfer.kind}`;
          return <g key={`${view.transfers.sequence}:${key}`} className={`transfer-token ${moving ? 'moving' : ''}`} style={{'--from-x': `${start - end}px`} as React.CSSProperties} data-transfer={key}>
            <title>{text.transfer}: {quantityText(transfer.quantity)} {materialName(transfer.materialId)}</title>
            <circle cx={end} cy="215" r="7" fill={materialColor(transfer.materialId)} stroke="var(--surface)" strokeWidth="2"/>
            <rect x={end - 23} y="182" width="46" height="20" rx="5" fill="var(--surface)" stroke="var(--border)"/>
            <text x={end} y="196" textAnchor="middle" className="tiny">{quantityText(transfer.quantity)}</text>
          </g>;
        })}
      </svg>
    </div>
    <p className="flow-note">{text.note}</p>
    <details className="text-view"><summary>{text.textView}</summary>
      <div className="table-scroll"><table><thead><tr><th>{text.state}</th><th>{text.queue}</th><th>{text.progress}</th><th>{text.held}</th></tr></thead><tbody>
        {order.map(id => {const state = view.model.stations.find(s => s.stationId === id)!; return <tr key={id}><th>{stationName(id)}<span>{stationReason(state, run, text)}</span></th><td>{quantityText(state.input.quantity)} {materialName(state.input.materialId)}</td><td>{state.progress === null ? '—' : `${Math.round(state.progress * 100)}%`}</td><td>{quantityText(state.output.heldQuantity)} {materialName(state.output.materialId)}</td></tr>;})}
      </tbody></table></div>
      <ul>{run.resolved.routes.map(route => <li key={route.id}>{route.fromId === source.id ? text.source : stationName(route.fromId)} → {route.toId === 'market' ? text.market : stationName(route.toId)}: {materialName(route.materialId)}</li>)}</ul>
    </details>
  </>;
}
