import { useEffect, useRef, useState } from 'react';
import { inputCapacity } from '../engine/config';
import type { DeepReadonly, RunConfig, ResolvedBuffer } from '../engine/config';
import type { RunnerView } from '../runner/runner';
import type { StationSnapshot } from '../engine/state';
import { fillRatio, graphLayout, quantityText, tokenFills, multiInputY, stationReasonY, stationReasonHeight } from './diagram';
import { nameFor } from './i18n';
import type { Labels } from './i18n';

interface Props { run: RunConfig; view: DeepReadonly<RunnerView>; text: Labels; reduced: boolean }
export function stationReason(station: DeepReadonly<StationSnapshot>, run: RunConfig, text: Labels): string {
  if (station.reason === 'notStarted') return text.notStarted;
  if (station.reason === 'lunch' || station.reason === 'offShift' || station.reason === 'horizon') return text[station.reason];
  if (station.reason === 'input') {
    return `${text.needs}: ` + station.inputs.filter(input => input.missingQuantity > 0).map(input => {
      const material = run.source.materials.find(m => m.id === input.materialId)!;
      return `${quantityText(input.missingQuantity)} ${nameFor(material.id, material.name, text)}`;
    }).join(', ');
  }
  if (station.reason === 'output' && station.blockedBy.length) {
    return station.blockedBy.map(block => {
      const blocker = run.source.stations.find(s => s.id === block.stationId);
      return `${block.location === 'input' ? text.fullInput : text.fullOutput}: ${nameFor(block.stationId, blocker?.name ?? text.market, text)}`;
    }).join('; ');
  }
  return station.remainingProcessingMs !== null ? `${text.remaining}: ${Math.ceil(station.remainingProcessingMs / 60_000)} ${text.minutes}` : text[station.status];
}
export function batchOutputStatus(station: DeepReadonly<StationSnapshot>, threshold: number, text: Labels): string {
  if (station.output.heldQuantity === 0) return '';
  return station.transferReady ? text.awaitingUnload : `${text.accumulating}: ${quantityText(station.output.heldQuantity)} / ${quantityText(threshold)}`;
}
function Tokens({quantity, x, y, color}: {quantity: number; x: number; y: number; color: string}) {
  return <g aria-hidden="true">{tokenFills(quantity).map((fill, i) => <g key={i}>
    <rect x={x} y={y - i * 13} width="30" height="9" rx="2" fill="var(--surface)" stroke={color}/>
    <rect x={x} y={y - i * 13} width={30 * fill} height="9" rx="2" fill={color}/>
  </g>)}</g>;
}
export function FlowDiagram({run, view, text, reduced}: Props) {
  const layout = graphLayout(run), {order, width, height} = layout;
  const xOf = (id: string) => layout.nodes.get(id)!.x;
  const yOf = (id: string) => layout.nodes.get(id)!.y;
  const marketX = xOf('market');
  const isSource = (id: string) => run.resolved.sources.some(s => s.id === id);
  const objectName = (id: string) => id === 'market' ? text.market : isSource(id) ? `${text.source} (${id})` : stationName(id);
  const materialName = (id: string) => {const m = run.source.materials.find(m => m.id === id)!; return nameFor(id, m.name, text);};
  const materialColor = (id: string) => run.source.materials.find(m => m.id === id)!.color;
  const stationName = (id: string) => nameFor(id, run.source.stations.find(s => s.id === id)!.name, text);
  const sold = view.model.line!.counters.reduce((sum, c) => sum + BigInt(c.sold), 0n).toString();
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
      <svg className="flow-svg" viewBox={`0 0 ${width} ${height}`} style={{minWidth: width}} role="img" aria-labelledby="flow-title flow-description" data-testid="flow-svg">
        <title id="flow-title">{text.diagram}</title><desc id="flow-description">{text.diagramDescription}</desc>
        <defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--route)"/></marker></defs>
        <path d={`M 30 215 H ${width - 30}`} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 7"/>
        {run.resolved.sources.map(source => <g key={source.id} className="endpoint" transform={`translate(0 ${yOf(source.id)})`}><rect x="22" y="147" width="112" height="118" rx="8"/><text x="78" y="173" textAnchor="middle">{text.source}</text>
          <rect x="60" y="193" width="36" height="24" rx="3" fill={materialColor(source.materialId)} stroke="none"/>
          <text x="78" y="242" textAnchor="middle" className="small">{materialName(source.materialId)}</text>
          {run.resolved.sources.length > 1 && <text x="78" y="286" textAnchor="middle" className="tiny">{source.id}</text>}
        </g>)}
        {run.resolved.routes.map(route => <path key={route.id} d={layout.paths.get(route.id)!.path} className="route-arrow" markerEnd="url(#flow-arrow)" data-route={route.id}><title>{`${objectName(route.fromId)} → ${objectName(route.toId)}: ${materialName(route.materialId)}`}</title></path>)}
        {order.map((id, index) => {
          const x = xOf(id), config = run.resolved.stations.find(s => s.id === id)!;
          const state = view.model.stations.find(s => s.stationId === id)!, input = state.inputs[0]!, inputColor = materialColor(input.materialId), outputColor = materialColor(state.output.materialId);
          const inputFill = fillRatio(input.quantity, inputCapacity(config, input.materialId)), outputFill = fillRatio(state.output.quantity, config.outputBuffer);
          const recipe = run.resolved.recipes.find(recipe => recipe.id === config.recipeId)!;
          const repetition = config.repetitions - input.reservedQuantity / recipe.inputs[0]!.quantity + 1;
          const operation = config.mode === 'simultaneous' ? text.cycle : `${text.repetition} ${repetition}/${config.repetitions}`;
          const outputStatus = batchOutputStatus(state, config.transportThreshold, text);
          const direct = config.outputBuffer.kind === 'quantity' && config.outputBuffer.quantity === 0;
          const cap = (buffer: DeepReadonly<ResolvedBuffer>) => buffer.kind === 'infinite' ? '∞' : quantityText(buffer.quantity);
          return <g key={id} transform={`translate(0 ${yOf(id)})`} data-station={id} data-state={state.status} data-duration-ms={state.operationDurationMs ?? undefined} data-transfer-ready={state.transferReady} data-held-quantity={state.output.heldQuantity}>
            <text x={x} y="56" className="station-number">{String(index + 1).padStart(2, '0')}</text>
            <text x={x} y="84" className="station-title">{stationName(id)}</text>
            <text x={x} y="108" className="small">{config.timeMs / 60_000} {text.minutes} {config.mode === 'simultaneous' ? text.perCycle : text.perRepetition}{config.cv > 0 && ` (${text.mean})`}</text>
            <text x={x} y="128" className="tiny">{text.priority}: {config.priority}{config.cv > 0 && ` · CV ${config.cv}`}</text>
            {state.inputs.length === 1 ? <>
            <g className="buffer"><text x={x - 50} y="139" textAnchor="middle" className="small">{text.input}</text>
              <rect x={x - 77} y="150" width="56" height="122" rx="5"/>
              <rect x={x - 73} y="267" width={48 * (inputFill ?? 0)} height="3" fill={inputColor}/>
              <Tokens quantity={input.quantity} x={x - 64} y={244} color={inputColor}/>{input.quantity > 6_000_000 && <text x={x - 49} y="166" textAnchor="middle" className="tiny">+</text>}
              <text x={x - 49} y="295" textAnchor="middle" className="quantity">{quantityText(input.quantity)}</text>
              <text x={x - 49} y="314" textAnchor="middle" className="tiny">/ {cap(inputCapacity(config, input.materialId))}</text>
            </g>
            <path d={`M ${x - 17} 215 H ${x - 3}`} className="route-arrow" markerEnd="url(#flow-arrow)"/>
            </> : <>
              <text x={x - 52} y="139" textAnchor="middle" className="small">{text.input}</text>
              {state.inputs.map((entry, inputIndex) => {
                const y = 148 + inputIndex * 86, capacity = inputCapacity(config, entry.materialId), fill = fillRatio(entry.quantity, capacity);
                const name = materialName(entry.materialId), color = materialColor(entry.materialId);
                return <g key={entry.materialId} className="buffer" data-input-material={entry.materialId}>
                  <title>{`${name}: ${quantityText(entry.quantity)} / ${cap(capacity)}; ${text.reserved}: ${quantityText(entry.reservedQuantity)}`}</title>
                  <rect x={x - 92} y={y} width="80" height="78" rx="5"/>
                  <text x={x - 52} y={y + 17} textAnchor="middle" className="tiny">{name.length > 12 ? `${name.slice(0, 11)}…` : name}</text>
                  <text x={x - 52} y={y + 38} textAnchor="middle" className="small">{quantityText(entry.quantity)} / {cap(capacity)}</text>
                  <text x={x - 52} y={y + 57} textAnchor="middle" className="tiny">{text.reserved}: {quantityText(entry.reservedQuantity)}</text>
                  <rect x={x - 86} y={y + 68} width="68" height="4" rx="2" fill="var(--track)"/>
                  <rect x={x - 86} y={y + 68} width={68 * (fill ?? 0)} height="4" rx="2" fill={color}/>
                  <path d={`M ${x - 8} ${multiInputY(inputIndex)} H ${x - 4} V 215 H ${x - 3}`} className="route-arrow" markerEnd="url(#flow-arrow)"/>
                </g>;
              })}
            </>}
            <rect x={x} y="150" width="176" height="164" rx="8" className={`station-body state-${state.status}`}/>
            <circle cx={x + 16} cy="172" r="4" className={`state-dot state-${state.status}`}/>
            <text x={x + 28} y="177" className="state-label">{state.reason === 'notStarted' ? text.notStarted : state.status === 'paused' && state.reason ? text[state.reason === 'input' || state.reason === 'output' ? 'paused' : state.reason] : text[state.status]}</text>
            <text x={x + 14} y="204" className="tiny">{state.remainingProcessingMs !== null ? `${operation}: ${Math.round((state.progress ?? 0) * 100)}%` : ' '}</text>
            <rect x={x + 14} y="216" width="148" height="7" rx="3" fill="var(--track)"/>
            <rect x={x + 14} y="216" width={148 * (state.progress ?? 0)} height="7" rx="3" fill="var(--progress)"/>
            <text x={x + 14} y="237" className="small" data-reserved={id}><title>{state.inputs.map(entry => `${materialName(entry.materialId)}: ${quantityText(entry.reservedQuantity)}`).join('; ')}</title>{text.reserved}: {state.inputs.length === 1 ? quantityText(input.reservedQuantity) : text.reserveAtInputs}</text>
            <text x={x + 14} y="258" className="small">{text.readyOutput}: <tspan className="quantity">{quantityText(state.output.heldQuantity)}</tspan></text>
            {state.output.heldQuantity > 0 && <rect x={x + 132} y="247" width="29" height="11" rx="2" fill={outputColor}/>}
            <text x={x + 14} y="279" className={`tiny batch-output-${state.transferReady ? 'released' : 'accumulating'}`} data-batch-output={id}>{outputStatus}</text>
            <text x={x + 14} y="301" className="tiny">{text.batch} {config.repetitions}, {text.thresholdShort} {quantityText(config.transportThreshold)}</text>
            <g className="buffer">
              <text x={x + 217} y="139" textAnchor="middle" className="small">{text.output}</text>
              {direct ? <><title>{text.directLong}</title><path d={`M ${x + 181} 215 H ${x + 240}`} className="direct-path"/><text x={x + 214} y="246" textAnchor="middle" className="tiny">{text.direct}</text></>
                : <><rect x={x + 190} y="150" width="54" height="122" rx="5"/><Tokens quantity={state.output.quantity} x={x + 202} y={244} color={outputColor}/>
                  <rect x={x + 194} y="267" width={46 * (outputFill ?? 0)} height="3" fill={outputColor}/>
                  <text x={x + 217} y="295" textAnchor="middle" className="quantity">{quantityText(state.output.quantity)}</text><text x={x + 217} y="314" textAnchor="middle" className="tiny">/ {cap(config.outputBuffer)}</text></>}
            </g>
            <foreignObject x={x - 5} y={stationReasonY(state.inputs.length)} width="252" height={stationReasonHeight(Math.max(state.inputs.length, state.blockedBy.length))}><div className={`reason reason-${state.status}`}>{stationReason(state, run, text)}</div></foreignObject>
          </g>;
        })}
        <g className="endpoint"><rect x={marketX} y="147" width="130" height="118" rx="8"/><text x={marketX + 65} y="173" textAnchor="middle" className="small">{text.market}</text>
          <text x={marketX + 65} y="220" textAnchor="middle" className="output-total" data-testid="output-total">{quantityText(sold)}</text><text x={marketX + 65} y="246" textAnchor="middle" className="tiny">{text.unit}</text>
        </g>
        {overlay.visible && overlay.sequence === view.transfers.sequence && view.transfers.items.map(transfer => {
          const edge = transfer.kind === 'buffer' ? null : run.resolved.routes.find(route => route.fromId === transfer.fromId && route.toId === transfer.toId && route.materialId === transfer.materialId);
          const geometry = edge ? layout.paths.get(edge.id)! : {path: `M ${xOf(transfer.fromId) + 160} ${yOf(transfer.fromId) + 215} H ${xOf(transfer.fromId) + 210}`, x: xOf(transfer.fromId) + 210, y: yOf(transfer.fromId) + 215};
          const key = `${transfer.fromId}:${transfer.toId}:${transfer.materialId}:${transfer.kind}`;
          return <g key={`${view.transfers.sequence}:${key}`} className={`transfer-token ${moving ? 'moving' : ''}`} transform={moving ? undefined : `translate(${geometry.x} ${geometry.y})`} data-transfer={key}>
            {moving && <animateMotion dur="0.5s" path={geometry.path} fill="freeze"/>}
            <title>{`${text.transfer}: ${quantityText(transfer.quantity)} ${materialName(transfer.materialId)}`}</title>
            <circle cx="0" cy="0" r="7" fill={materialColor(transfer.materialId)} stroke="var(--surface)" strokeWidth="2"/>
            <rect x="-23" y="-33" width="46" height="20" rx="5" fill="var(--surface)" stroke="var(--border)"/>
            <text x="0" y="-19" textAnchor="middle" className="tiny">{quantityText(transfer.quantity)}</text>
          </g>;
        })}
      </svg>
    </div>
    <p className="flow-note">{text.note}</p>
    <details className="scheme-help"><summary>{text.schemeHelp}</summary><dl>
      <div><dt>{text.input}</dt><dd>{text.inputHelp}</dd></div>
      <div><dt>{text.reserved}</dt><dd>{text.reserveHelp}</dd></div>
      <div><dt>{text.readyOutput}</dt><dd>{text.readyHelp}</dd></div>
      <div><dt>{text.awaitingUnload}</dt><dd>{text.unloadHelp}</dd></div>
    </dl></details>
    <details className="text-view"><summary>{text.textView}</summary>
      <div className="table-scroll"><table><thead><tr><th>{text.state}</th><th>{text.queue}</th><th>{text.progress}</th><th>{text.held}</th></tr></thead><tbody>
        {order.map(id => {const state = view.model.stations.find(s => s.stationId === id)!; return <tr key={id}><th>{stationName(id)}<span>{stationReason(state, run, text)}</span></th><td>{state.inputs.map(input => <div key={input.materialId}>{quantityText(input.quantity)} {materialName(input.materialId)}{input.reservedQuantity > 0 && ` (${text.reserved}: ${quantityText(input.reservedQuantity)})`}</div>)}</td><td>{state.progress === null ? '—' : `${Math.round(state.progress * 100)}%`}</td><td>{quantityText(state.output.heldQuantity)} {materialName(state.output.materialId)}<div>{batchOutputStatus(state, run.resolved.stations.find(s => s.id === id)!.transportThreshold, text)}</div></td></tr>;})}
      </tbody></table></div>
      <ul>{run.resolved.routes.map(route => <li key={route.id}>{objectName(route.fromId)} → {objectName(route.toId)}: {materialName(route.materialId)}</li>)}</ul>
    </details>
  </>;
}
