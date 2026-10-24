import {comparableFlowReason, type ComparableFlowReason} from '../engine/flow-scope';
import type {DeepReadonly, RunConfig} from '../engine/config';
import type {FlowHistory, FlowPoint} from '../engine/flow-history';

export const LINE_SCOPE = '@line';
export type TimeScale = 'calendar' | 'work';
export type GlobalCfdReason = ComparableFlowReason;
export const globalCfdReason = comparableFlowReason;
/** Stable route order, including parallel branches. Config already rejects cycles. */
export function chartStationOrder(run: RunConfig): string[] {
  const remaining = new Set(run.resolved.stations.map(s => s.id)), order: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(id => !run.resolved.routes.some(r => r.toId === id && remaining.has(r.fromId))).sort();
    for (const id of ready) {order.push(id); remaining.delete(id);}
  }
  return order;
}
export interface ChartSeries {key: string; kind: 'station' | 'delivered' | 'scrapped' | 'consumed' | 'material'; id?: string}
export interface ChartFrame {point: DeepReadonly<FlowPoint>; cfd: string[]; wip: string[]; output: string[]}
export interface FlowChartData {cfd: ChartSeries[]; wip: ChartSeries[]; output: ChartSeries[]; frames: ChartFrame[]}
/** Every CFD band has the same selected unit. No production-rate or mean is inferred here. */
export function flowChartData(run: RunConfig, history: DeepReadonly<FlowHistory>, scope: string): FlowChartData {
  if (scope === LINE_SCOPE && globalCfdReason(run) !== null) throw new Error('The selected line does not preserve a comparable flow unit.');
  if (scope !== LINE_SCOPE && !run.resolved.materials.some(m => m.id === scope)) throw new Error('Unknown CFD material.');
  const owners = chartStationOrder(run).filter(id => scope === LINE_SCOPE || run.resolved.stations.find(s => s.id === id)!.plan.some(p => {
    const r = run.resolved.recipes.find(r => r.id === p.recipeId)!;
    return r.output.materialId === scope || r.inputs.some(input => input.materialId === scope);
  }));
  const cfd: ChartSeries[] = [{key: 'delivered', kind: 'delivered'}, {key: 'scrapped', kind: 'scrapped'},
    ...(scope === LINE_SCOPE ? [] : [{key: 'consumed', kind: 'consumed'} as const]),
    ...[...owners].reverse().map(id => ({key: `station-${id}`, kind: 'station' as const, id}))];
  const wip: ChartSeries[] = run.resolved.materials.map(m => ({key: m.id, kind: 'material', id: m.id}));
  const output: ChartSeries[] = run.resolved.materials.filter(m => m.role === 'finished').map(m => ({key: m.id, kind: 'material', id: m.id}));
  const points = history.points[0]?.phase === 'initial' ? [history.initial] : [history.initial, ...history.points];
  const frames = points.map(point => {
    const materials = new Map(point.values.materials.map(m => [m.materialId, m]));
    const stationStock = new Map(owners.map(id => [id, 0n]));
    for (const place of point.values.places) if (scope === LINE_SCOPE || place.materialId === scope) {
      stationStock.set(place.ownerId, (stationStock.get(place.ownerId) ?? 0n) + BigInt(place.quantity));
    }
    const selected = scope === LINE_SCOPE ? [...materials.values()] : [materials.get(scope)!];
    const sum = (key: 'delivered' | 'scrapped' | 'consumed') => String(selected.reduce((total, m) => total + BigInt(m[key]), 0n));
    return {point, cfd: cfd.map(s => s.kind === 'station' ? String(stationStock.get(s.id!)!) : sum(s.kind as 'delivered' | 'scrapped' | 'consumed')),
      wip: wip.map(s => materials.get(s.id!)!.wip), output: output.map(s => materials.get(s.id!)!.delivered)};
  });
  return {cfd, wip, output, frames};
}

export const CHART_WIDTH = 900, CHART_HEIGHT = 320;
export const plot = {left: 76, right: 876, top: 24, bottom: 258};
export function pointTime(point: DeepReadonly<FlowPoint>, scale: TimeScale) {return scale === 'calendar' ? point.timeMs : point.workMs;}
export function chartGeometry(data: FlowChartData, kind: 'cfd' | 'wip' | 'output', scale: TimeScale) {
  const times = data.frames.map(f => pointTime(f.point, scale)), end = times.at(-1) ?? 0;
  const rows = data.frames.map(f => f[kind].map(q => Number(BigInt(q)) / 1_000_000));
  const maximum = Math.max(0, ...rows.map(row => kind === 'cfd' ? row.reduce((a,b) => a+b,0) : Math.max(0,...row)));
  const magnitude = maximum ? 10 ** Math.floor(Math.log10(maximum)) : 1;
  const ceiling = maximum ? Math.ceil(maximum / magnitude) * magnitude : 1;
  const x = (time: number) => plot.left + (end ? time / end : 0) * (plot.right - plot.left);
  const y = (value: number) => plot.bottom - value / ceiling * (plot.bottom - plot.top);
  const xs = times.map(x);
  const step = (ys: number[]) => `M${xs[0]},${ys[0]}` + ys.slice(1).map((v,i) => `H${xs[i+1]}V${v}`).join('');
  const paths = data[kind].map((_, series) => {
    if (kind !== 'cfd') return step(rows.map(row => y(row[series]!)));
    const lower = rows.map(row => y(row.slice(0,series).reduce((a,b) => a+b,0)));
    const upper = rows.map(row => y(row.slice(0,series+1).reduce((a,b) => a+b,0)));
    let d = step(upper) + `L${xs.at(-1)},${lower.at(-1)}`;
    for (let i=lower.length-2;i>=0;i--) d += `V${lower[i]}H${xs[i]}`;
    return d + 'Z';
  });
  return {paths, xs, ceiling, end, x, y};
}
/** Last observation wins at repeated work-time coordinates, preserving calendar order. */
export function closestChartPoint(times: readonly number[], target: number): number {
  let low = 0, high = times.length;
  while (low < high) {const mid = (low + high) >>> 1; if (times[mid]! <= target) low = mid + 1; else high = mid;}
  if (low === 0) return 0;
  if (low === times.length || target - times[low-1]! <= times[low]! - target) return low - 1;
  let index = low; while (index + 1 < times.length && times[index+1] === times[index]) index++;
  return index;
}
