import {useEffect, useId, useRef, useState} from 'react';
import type {EditorConfig} from '../engine/config';
import type {Language} from '../ui/i18n';
import type {ProcessDraft} from './process-form';
import {layoutNodes, NODE_HEIGHT, NODE_WIDTH, placeNode} from './process-layout';
import type {NodePosition, ProcessLayout} from './process-layout';

const words = {
  ru: {title: 'Поле процесса', help: 'Перетащите пост за название. С клавиатуры: стрелки двигают на 10, Shift + стрелки на 50, Escape отменяет перетаскивание. Расположение не меняет маршруты. Поле прокручивается в обе стороны.',
    reset: 'Расположить по цепочке', move: 'Переместить', source: 'Источник', product: 'Готовая продукция',
    settings: 'К настройкам поста', unit: 'мин', in: 'Вход', out: 'Выход', area: 'Поле с постами и связями',
    connections: 'Связи процесса', position: 'Положение', locked: 'Расположение зафиксировано на время прогона.'},
  en: {title: 'Process canvas', help: 'Drag a station by its name. Keyboard: arrows move by 10, Shift + arrows by 50, Escape cancels dragging. Positions do not change routes. Scroll the canvas in either direction.',
    reset: 'Arrange as a chain', move: 'Move', source: 'Source', product: 'Finished goods', settings: 'Go to station settings',
    unit: 'min', in: 'Input', out: 'Output', area: 'Canvas with stations and connections',
    connections: 'Process connections', position: 'Position', locked: 'Positions are fixed during a run.'},
};
interface Drag {pointerId: number; origin: NodePosition; clientX: number; clientY: number; scrollX: number; scrollY: number}
export function ProcessCanvas({config, draft, layout, language, locked, onChange}: {
  config: EditorConfig; draft: ProcessDraft; layout: ProcessLayout; language: Language; locked: boolean;
  onChange: (layout: ProcessLayout) => void;
}) {
  const text = words[language], marker = `canvas-arrow-${useId().replaceAll(':', '')}`;
  const help = `${marker}-help`;
  const drag = useRef<Drag | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pointerPosition = (current: Drag, x: number, y: number) => placeNode({positions: []}, {...current.origin,
    x: current.origin.x + x - current.clientX + (viewport.current?.scrollLeft ?? 0) - current.scrollX,
    y: current.origin.y + y - current.clientY + (viewport.current?.scrollTop ?? 0) - current.scrollY}).positions[0]!;
  const [preview, setPreview] = useState<NodePosition | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {if (locked) {drag.current = null; setPreview(null);}}, [locked]);
  const nodes = layoutNodes(config, layout).map(node => preview?.id === node.id ? preview : node);
  const width = Math.max(1000, ...nodes.map(node => node.x + NODE_WIDTH + 80));
  const height = Math.max(400, ...nodes.map(node => node.y + NODE_HEIGHT + 80));
  const name = (id: string) => draft.stations.find(item => item.id === id)?.name
    ?? config.sources.find(item => item.id === id)?.name ?? text.product;
  const materialName = (id: string) => draft.materials.find(item => item.id === id)?.name ?? id;
  function commit(position: NodePosition) {
    onChange(placeNode(layout, position));
    setAnnouncement(`${name(position.id)}. ${text.position}: ${position.x}, ${position.y}`);
  }
  return <section className="process-canvas" aria-label={text.title}>
    <div className="process-canvas-heading"><h2>{text.title}</h2>
      <button type="button" disabled={locked || layout.positions.length === 0} onClick={() => onChange({positions: []})}>{text.reset}</button></div>
    <p id={help} className="process-help">{locked ? text.locked : text.help}</p>
    <div ref={viewport} className="process-canvas-viewport" tabIndex={0} role="region" aria-label={text.area} aria-describedby={help}>
      <div className="process-canvas-surface" style={{width, height}}>
        <svg className="process-canvas-routes" width={width} height={height} role="img" aria-label={text.connections}>
          <defs><marker id={marker} markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M 0 1 L 9 5 L 0 9 Z"/></marker></defs>
          {config.routes.map(route => {
            const from = nodes.find(node => node.id === route.fromId)!, to = nodes.find(node => node.id === route.toId)!;
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
          const input = config.routes.find(route => route.toId === node.id);
          const output = config.routes.find(route => route.fromId === node.id);
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
              <p title={input ? materialName(input.materialId) : text.source}>{input ? `${text.in}: ${materialName(input.materialId)}` : text.source}</p>
              <p title={output ? materialName(output.materialId) : text.product}>{output ? `${text.out}: ${materialName(output.materialId)}` : text.product}</p>
              {station && <a href={`#process-station-${station.id}`}>{station.minutes} {text.unit} · CV {station.cv} · {text.settings}</a>}
            </div>
            {input && <span className="process-canvas-port port-input" aria-hidden="true"/>}
            {output && <span className="process-canvas-port port-output" aria-hidden="true"/>}
          </article>;
        })}
      </div>
    </div><span className="process-canvas-status" role="status" aria-live="polite">{announcement}</span>
  </section>;
}
