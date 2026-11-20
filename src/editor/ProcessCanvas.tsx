import {useEffect, useId, useRef, useState} from 'react';
import {ConfigError} from '@toc/engine';
import type {EditorConfig} from '@toc/engine';
import type {Language} from '../ui/i18n';
import type {ProcessDraft} from './process-form';
import {connectProcessNodes, connectionIssue, outputMaterial} from './process-connections';
import {layoutNodes, NODE_HEIGHT, NODE_WIDTH, placeNode} from './process-layout';
import type {NodePosition, ProcessLayout} from './process-layout';

const words = {
  ru: {title: 'Поле процесса', help: 'Перетащите пост за название. С клавиатуры: стрелки двигают на 10, Shift + стрелки на 50, Escape отменяет перетаскивание. Расположение не меняет маршруты. Поле прокручивается в обе стороны.',
    connectHelp: 'Чтобы создать связь, перетащите кружок выхода на кружок входа. Можно нажать на выход, затем на вход мышью или клавишами Tab и Enter. Escape или кнопка отменяют соединение. Материал входа задаётся в рецепте; существующие связи меняются в формах ниже.',
    connectFrom: 'Соединить из', connectTo: 'Соединить с', cancelConnection: 'Отменить соединение',
    chooseOutput: 'Выберите выход', chooseInput: 'Выберите вход', added: 'Связь создана', cancelled: 'Соединение отменено',
    reset: 'Сбросить расположение', move: 'Переместить', source: 'Источник', product: 'Готовая продукция',
    settings: 'К настройкам поста', unit: 'мин', in: 'Вход', out: 'Выход', area: 'Поле с постами и связями',
    noInput: 'Нет входящих связей', noOutput: 'Нет исходящих связей',
    connections: 'Связи процесса', position: 'Положение', locked: 'Расположение зафиксировано на время прогона.'},
  en: {title: 'Process canvas', help: 'Drag a station by its name. Keyboard: arrows move by 10, Shift + arrows by 50, Escape cancels dragging. Positions do not change routes. Scroll the canvas in either direction.',
    connectHelp: 'To create a connection, drag an output circle to an input circle. You can also activate the output, then the input with the mouse or Tab and Enter. Escape or the cancel button cancels the connection. Set input materials in recipes; edit existing connections in the forms below.',
    connectFrom: 'Connect from', connectTo: 'Connect to', cancelConnection: 'Cancel connection',
    chooseOutput: 'Choose an output', chooseInput: 'Choose an input', added: 'Connection created', cancelled: 'Connection cancelled',
    reset: 'Reset positions', move: 'Move', source: 'Source', product: 'Finished goods', settings: 'Go to station settings',
    unit: 'min', in: 'Input', out: 'Output', area: 'Canvas with stations and connections',
    noInput: 'No incoming connections', noOutput: 'No outgoing connections',
    connections: 'Process connections', position: 'Position', locked: 'Positions are fixed during a run.'},
};
interface ConnectionPointer {pointerId: number; fromId: string; clientX: number; clientY: number; moved: boolean}
interface Drag {pointerId: number; origin: NodePosition; clientX: number; clientY: number; scrollX: number; scrollY: number}
export function ProcessCanvas({config, draft, layout, language, locked, onChange, onRoutesChange}: {
  config: EditorConfig; draft: ProcessDraft; layout: ProcessLayout; language: Language; locked: boolean;
  onChange: (layout: ProcessLayout) => void; onRoutesChange?: (routes: EditorConfig['routes']) => void;
}) {
  const text = words[language], marker = `canvas-arrow-${useId().replaceAll(':', '')}`;
  const help = `${marker}-help`, connectionHelp = `${marker}-connection-help`;
  const drag = useRef<Drag | null>(null);
  const connectionPointer = useRef<ConnectionPointer | null>(null);
  const [connection, setConnection] = useState<{fromId: string; x: number; y: number} | null>(null);
  const [connectionError, setConnectionError] = useState<{ru: string; en: string} | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pointerPosition = (current: Drag, x: number, y: number) => placeNode({positions: []}, {...current.origin,
    x: current.origin.x + x - current.clientX + (viewport.current?.scrollLeft ?? 0) - current.scrollX,
    y: current.origin.y + y - current.clientY + (viewport.current?.scrollTop ?? 0) - current.scrollY}).positions[0]!;
  const [preview, setPreview] = useState<NodePosition | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {if (locked) {drag.current = null; connectionPointer.current = null; setConnection(null); setConnectionError(null); setPreview(null);}}, [locked]);
  useEffect(() => {setConnectionError(null);}, [draft]);
  const nodes = layoutNodes(draft, layout).map(node => preview?.id === node.id ? preview : node);
  const width = Math.max(1000, ...nodes.map(node => node.x + NODE_WIDTH + 80));
  const height = Math.max(400, ...nodes.map(node => node.y + NODE_HEIGHT + 80));
  const name = (id: string) => draft.stations.find(item => item.id === id)?.name
    ?? draft.sources.find(item => item.id === id)?.name ?? text.product;
  const materialName = (id: string) => draft.materials.find(item => item.id === id)?.name ?? id;
  function commit(position: NodePosition) {
    onChange(placeNode(layout, position));
    setAnnouncement(`${name(position.id)}. ${text.position}: ${position.x}, ${position.y}`);
  }
  function cancelConnection() {
    connectionPointer.current = null; setConnection(null); setConnectionError(null);
    setAnnouncement(text.cancelled);
  }
  function beginConnection(fromId: string) {
    const node = nodes.find(item => item.id === fromId)!;
    setConnection({fromId, x: node.x + NODE_WIDTH + 60, y: node.y + NODE_HEIGHT / 2});
    setConnectionError(null);
  }
  function finishConnection(fromId: string, toId: string) {
    if (locked || !onRoutesChange) return;
    connectionPointer.current = null; setConnection(null);
    try {
      const routes = connectProcessNodes(config, draft, fromId, toId);
      onRoutesChange(routes); setConnectionError(null);
      setAnnouncement(`${text.added}: ${name(fromId)} → ${name(toId)}. ${materialName(routes.at(-1)!.materialId)}`);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      setConnectionError(error.messages); setAnnouncement('');
    }
  }
  function inputAt(clientX: number, clientY: number): string | undefined {
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-connect-to]');
    return target && viewport.current?.contains(target) ? target.dataset.connectTo : undefined;
  }
  return <section className="process-canvas" aria-label={text.title} onKeyDownCapture={event => {
    if (event.key === 'Escape' && connection) {event.preventDefault(); event.stopPropagation(); cancelConnection();}
  }} onPointerDownCapture={event => {
    if (connection && !(event.target as Element).closest('[data-connect-from], [data-connect-to]')) cancelConnection();
  }}>
    <div className="process-canvas-heading"><h2>{text.title}</h2>
      <button type="button" disabled={locked || layout.positions.length === 0} onClick={() => onChange({positions: []})}>{text.reset}</button></div>
    <p id={help} className="process-help">{locked ? text.locked : text.help}</p>
    {onRoutesChange && <><p id={connectionHelp} className="process-help">{text.connectHelp}</p>
      <div className="process-connecting" role="status"><span>{connection
        ? `${name(connection.fromId)} → … (${materialName(outputMaterial(draft, connection.fromId)!)})` : text.chooseOutput}</span>
        <button type="button" disabled={!connection || locked} onClick={cancelConnection}>{text.cancelConnection}</button></div></>}
    <div ref={viewport} className="process-canvas-viewport" tabIndex={0} role="region" aria-label={text.area} aria-describedby={help}>
      <div className="process-canvas-surface" style={{width, height}}>
        <svg className="process-canvas-routes" width={width} height={height} role="img" aria-label={text.connections}>
          <defs><marker id={marker} markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M 0 1 L 9 5 L 0 9 Z"/></marker></defs>
          {connection && (() => {
            const from = nodes.find(node => node.id === connection.fromId);
            return from && <path className="process-canvas-route process-canvas-connection-preview"
              d={`M ${from.x + NODE_WIDTH} ${from.y + NODE_HEIGHT / 2} L ${connection.x} ${connection.y}`} markerEnd={`url(#${marker})`}/>;
          })()}
          {draft.routes.map(route => {
            const from = nodes.find(node => node.id === route.fromId), to = nodes.find(node => node.id === route.toId);
            if (!from || !to) return null;
            const x1 = from.x + NODE_WIDTH, y1 = from.y + NODE_HEIGHT / 2, x2 = to.x, y2 = to.y + NODE_HEIGHT / 2;
            const bend = Math.max(72, Math.abs(x2 - x1) / 2);
            const label = materialName(route.materialId);
            return <g key={route.id}><title>{`${name(route.fromId)} → ${name(route.toId)}: ${label}`}</title>
              <path className="process-canvas-route" data-route-id={route.id} d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`} markerEnd={`url(#${marker})`}/>
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 12} textAnchor="middle">{label.length > 20 ? `${label.slice(0, 19)}…` : label}</text>
            </g>;
          })}
        </svg>
        {nodes.map(node => {
          const station = draft.stations.find(item => item.id === node.id);
          const inputs = [...new Set(draft.routes.filter(route => route.toId === node.id).map(route => materialName(route.materialId)))].join(', ');
          const output = draft.routes.find(route => route.fromId === node.id);
          return <article key={node.id} data-node-id={node.id} className={`process-canvas-node${station ? '' : ' process-canvas-terminal'}${preview?.id === node.id ? ' is-dragging' : ''}`}
            style={{left: node.x, top: node.y, width: NODE_WIDTH, height: NODE_HEIGHT}}>
            <button type="button" className="process-canvas-handle" disabled={locked} aria-label={`${text.move}: ${name(node.id)}`} aria-describedby={help}
              title={`${name(node.id)} · ${node.x}, ${node.y}`} onPointerDown={event => {
                if (locked || event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = {pointerId: event.pointerId, origin: node, clientX: event.clientX, clientY: event.clientY,
                  scrollX: viewport.current?.scrollLeft ?? 0, scrollY: viewport.current?.scrollTop ?? 0};
              }} onPointerMove={event => {
                const current = drag.current;
                if (!current || current.pointerId !== event.pointerId || locked) return;
                const moved = pointerPosition(current, event.clientX, event.clientY);
                setPreview(moved);
              }} onPointerUp={event => {
                if (drag.current?.pointerId !== event.pointerId) return;
                const origin = drag.current.origin;
                const position = pointerPosition(drag.current, event.clientX, event.clientY);
                drag.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
                if (!locked && (position.x !== origin.x || position.y !== origin.y)) commit(position);
                setPreview(null);
              }} onPointerCancel={() => {drag.current = null; setPreview(null);}}
              onLostPointerCapture={() => {drag.current = null; setPreview(null);}}
              onKeyDown={event => {
                if (event.key === 'Escape') {drag.current = null; setPreview(null); return;}
                if (locked || drag.current) return;
                const step = event.shiftKey ? 50 : 10;
                const delta: Record<string, [number, number]> = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]};
                const move = delta[event.key];
                if (!move) return;
                event.preventDefault();
                const position = placeNode({positions: []}, {...node, x: node.x + move[0], y: node.y + move[1]}).positions[0]!;
                if (position.x !== node.x || position.y !== node.y) commit(position);
              }}><span aria-hidden="true">⠿</span><span>{name(node.id)}</span></button>
            <div className="process-canvas-node-content">
              <p title={inputs || (station ? text.noInput : text.source)}>{inputs ? `${text.in}: ${inputs}` : station ? text.noInput : text.source}</p>
              <p title={output ? materialName(output.materialId) : station ? text.noOutput : text.product}>{output ? `${text.out}: ${materialName(output.materialId)}` : station ? text.noOutput : text.product}</p>
              {station && <a href={`#process-station-${station.id}`}>{station.minutes} {text.unit} · CV {station.cv} · {text.settings}</a>}
            </div>
            {onRoutesChange ? <>
              {(station || node.id === 'market') && <button type="button" data-connect-to={node.id}
                className={`process-canvas-port port-input${connection && !connectionIssue(draft, connection.fromId, node.id) ? ' can-connect' : ''}`}
                disabled={locked} aria-label={`${text.connectTo}: ${name(node.id)}`} aria-describedby={connectionHelp}
                title={connection ? connectionIssue(draft, connection.fromId, node.id)?.[language] ?? `${text.connectTo}: ${name(node.id)}` : `${text.connectTo}: ${name(node.id)}`}
                onClick={() => {if (connection) finishConnection(connection.fromId, node.id);}}><span aria-hidden="true">→</span></button>}
              {node.id !== 'market' && <button type="button" data-connect-from={node.id} className="process-canvas-port port-output"
                disabled={locked} aria-label={`${text.connectFrom}: ${name(node.id)}`} aria-describedby={connectionHelp}
                aria-pressed={connection?.fromId === node.id} title={`${text.connectFrom}: ${name(node.id)} (${materialName(outputMaterial(draft, node.id)!)})`}
                onClick={event => {if (event.detail === 0 && !locked) beginConnection(node.id);}}
                onPointerDown={event => {
                  if (locked || event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  connectionPointer.current = {pointerId: event.pointerId, fromId: node.id, clientX: event.clientX, clientY: event.clientY, moved: false};
                  beginConnection(node.id);
                }} onPointerMove={event => {
                  const current = connectionPointer.current, area = viewport.current;
                  if (!current || current.pointerId !== event.pointerId || !area || locked) return;
                  if (Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) > 4) current.moved = true;
                  const box = area.getBoundingClientRect();
                  setConnection({fromId: current.fromId, x: event.clientX - box.left - area.clientLeft + area.scrollLeft,
                    y: event.clientY - box.top - area.clientTop + area.scrollTop});
                }} onPointerUp={event => {
                  const current = connectionPointer.current;
                  if (!current || current.pointerId !== event.pointerId) return;
                  const target = inputAt(event.clientX, event.clientY);
                  connectionPointer.current = null;
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  if (target) finishConnection(current.fromId, target);
                  else if (current.moved) cancelConnection();
                }} onPointerCancel={cancelConnection} onLostPointerCapture={event => {
                  if (connectionPointer.current?.pointerId === event.pointerId) cancelConnection();
                }}><span aria-hidden="true">+</span></button>}
            </> : <>
              {inputs && <span className="process-canvas-port port-input" aria-hidden="true"/>}
              {output && <span className="process-canvas-port port-output" aria-hidden="true"/>}
            </>}
          </article>;
        })}
      </div>
    </div>{connectionError && <p className="process-error" role="alert">{connectionError[language]}</p>}<span className="process-canvas-status" role="status" aria-live="polite">{announcement}</span>
  </section>;
}
