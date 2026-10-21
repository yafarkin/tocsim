import type { DeepReadonly, ResolvedBuffer, RunConfig } from '../engine/config';
export const NODE_GAP = 350, FIRST_X = 235;
export function quantityText(value: number | string): string {
  const units = BigInt(value), whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
export function tokenFills(quantity: number): number[] {
  const amount = quantity / 1_000_000;
  return Array.from({length: Math.min(6, Math.ceil(amount))}, (_, i) => Math.min(1, amount - i));
}
export function fillRatio(quantity: number, capacity: DeepReadonly<ResolvedBuffer>): number | null {
  return capacity.kind === 'infinite' || capacity.quantity === 0 ? null : Math.min(1, quantity / capacity.quantity);
}

export const outputMaterials = (run: RunConfig, stationId: string): string[] => [...new Set(run.resolved.stations.find(station => station.id === stationId)!.plan.map(row => run.resolved.recipes.find(recipe => recipe.id === row.recipeId)!.output.materialId))].sort();
export const multiInputY = (index: number) => 187 + index * 86;
export const stationReasonHeight = (lines: number, setups = false) => Math.max(setups ? 140 : 80, lines * 30);
export const stationReasonY = (inputs: number) => Math.max(339, inputs > 1 ? 148 + (inputs - 1) * 86 + 78 + 25 : 339);
export interface DiagramNode {x: number; y: number; depth: number}
/** Stable layers for an acyclic network. Coordinates never affect model order. */
export function graphLayout(run: RunConfig) {
  const ids = [...run.resolved.sources.map(s => s.id), ...run.resolved.stations.map(s => s.id), 'market'];
  const depths = new Map<string, number>();
  const pending = new Set(ids);
  while (pending.size) {
    const ready = [...pending].filter(id => run.resolved.routes.filter(r => r.toId === id).every(r => depths.has(r.fromId))).sort();
    if (!ready.length) throw new Error('Diagram requires an acyclic network');
    for (const id of ready) {
      const incoming = run.resolved.routes.filter(r => r.toId === id);
      depths.set(id, incoming.length ? Math.max(...incoming.map(r => depths.get(r.fromId)!)) + 1 : 0);
      pending.delete(id);
    }
  }
  // Every final output shares one market column, including shorter branches.
  depths.set('market', Math.max(...run.resolved.stations.map(s => depths.get(s.id)!)) + 1);
  const nodeGap = run.resolved.stations.some(station => outputMaterials(run, station.id).length > 1) ? NODE_GAP + 30 : NODE_GAP;
  const rowPitch = Math.max(420, ...run.resolved.stations.map(station => {
    const count = Math.max(station.inputBuffers.length, outputMaterials(run, station.id).length);
    const lines = Math.max(count, run.resolved.routes.filter(route => route.fromId === station.id).length);
    return stationReasonY(count) + stationReasonHeight(lines, station.setupMs > 0) + 1;
  }));
  const nodes = new Map<string, DiagramNode>();
  let rows = 1;
  for (let depth = 0; depth <= depths.get('market')!; depth++) {
    const priority = (id: string) => run.resolved.stations.find(s => s.id === id)?.priority ?? 0;
    const layer = ids.filter(id => depths.get(id) === depth).sort((a, b) => priority(b) - priority(a) || (a < b ? -1 : a > b ? 1 : 0));
    rows = Math.max(rows, layer.length);
    layer.forEach((id, row) => nodes.set(id, {depth, x: id === 'market' ? FIRST_X + (depth - 1) * nodeGap - 30 : depth === 0 ? 22 : FIRST_X + (depth - 1) * nodeGap, y: row * rowPitch}));
  }
  const baseHeight = rows * rowPitch + 60;
  const paths = new Map<string, {path: string; x: number; y: number}>();
  let lanes = 0;
  for (const route of run.resolved.routes) {
    const from = nodes.get(route.fromId)!, to = nodes.get(route.toId)!;
    const outputs = from.depth === 0 ? [] : outputMaterials(run, route.fromId);
    const x1 = from.x + (from.depth === 0 ? 118 : outputs.length > 1 ? 274 : 244);
    const y1 = from.y + (outputs.length > 1 ? multiInputY(outputs.indexOf(route.materialId)) : 215);
    const station = run.resolved.stations.find(station => station.id === route.toId);
    const inputs = station?.inputBuffers ?? [];
    const multiple = inputs.length > 1;
    const x2 = to.x - (route.toId === 'market' ? 8 : multiple ? 96 : 82), y2 = to.y + (multiple ? multiInputY(inputs.findIndex(input => input.materialId === route.materialId)) : 215);
    const middle = (x1 + x2) / 2;
    const path = to.depth - from.depth > 1
      ? `M ${x1} ${y1} H ${x1 + 12} V ${baseHeight - 30 + lanes++ * 26} H ${x2 - 12} V ${y2} H ${x2}`
      : y1 === y2 ? `M ${x1} ${y1} H ${x2}` : `M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`;
    paths.set(route.id, {path, x: x2, y: y2});
  }
  const order = run.resolved.stations.map(s => s.id).sort((a, b) => nodes.get(a)!.depth - nodes.get(b)!.depth || nodes.get(a)!.y - nodes.get(b)!.y);
  return {nodes, paths, order, width: nodes.get('market')!.x + 160, height: baseHeight + lanes * 26};
}
