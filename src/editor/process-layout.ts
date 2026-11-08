import {ConfigError} from '@toc/engine';
import type {EditorConfig} from '@toc/engine';

export interface NodePosition {id: string; x: number; y: number}
/** Presentation metadata. Never supplied to compileConfig or Simulation. */
export interface ProcessLayout {positions: NodePosition[]}
export interface ProcessDocument {config: EditorConfig; layout: ProcessLayout}
export const NODE_WIDTH = 200, NODE_HEIGHT = 128, MAX_COORDINATE = 20_000;

export function parseProcessLayout(value: unknown, config: EditorConfig): ProcessLayout {
  const fail = (): never => {throw new ConfigError('value', 'layout', null,
    {ru: 'Некорректное расположение: нужны уникальные ID узлов и целые координаты от 0 до 20000.',
      en: 'Invalid layout: use unique node IDs and whole coordinates from 0 to 20000.'});};
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => key !== 'positions') || !('positions' in value) || !Array.isArray(value.positions)) fail();
  const positions = (value as {positions: unknown[]}).positions;
  const ids = new Set([...config.sources.map(item => item.id), ...config.stations.map(item => item.id), 'market']);
  if (positions.length > ids.size) fail();
  const seen = new Set<string>();
  return {positions: positions.map(position => {
    if (!position || typeof position !== 'object' || Array.isArray(position)) return fail();
    const row = position as NodePosition;
    if (Object.keys(row).length !== 3 || !Object.keys(row).every(key => ['id', 'x', 'y'].includes(key))
      || !ids.has(row.id) || seen.has(row.id)
      || ![row.x, row.y].every(number => Number.isInteger(number) && number >= 0 && number <= MAX_COORDINATE)) return fail();
    seen.add(row.id);
    return {id: row.id, x: row.x, y: row.y};
  })};
}

/** The chain graph determines the initial order, independently of entity array order. */
export function layoutNodes(config: EditorConfig, layout: ProcessLayout): NodePosition[] {
  const ids = [config.sources[0]!.id];
  while (ids.at(-1) !== 'market') ids.push(config.routes.find(route => route.fromId === ids.at(-1))!.toId);
  return ids.map((id, index) => layout.positions.find(position => position.id === id)
    ?? {id, x: 32 + index * 260, y: 96});
}

export function placeNode(layout: ProcessLayout, position: NodePosition): ProcessLayout {
  const next = {id: position.id, x: Math.max(0, Math.min(MAX_COORDINATE, Math.round(position.x))),
    y: Math.max(0, Math.min(MAX_COORDINATE, Math.round(position.y)))};
  return {positions: [...layout.positions.filter(item => item.id !== position.id), next].sort((a, b) => a.id.localeCompare(b.id))};
}

export function retainLayout(config: EditorConfig, layout: ProcessLayout): ProcessLayout {
  const ids = new Set([...config.sources.map(item => item.id), ...config.stations.map(item => item.id), 'market']);
  return {positions: layout.positions.filter(position => ids.has(position.id))};
}
