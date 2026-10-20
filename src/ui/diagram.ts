import type { DeepReadonly, ResolvedBuffer, RunConfig } from '../engine/config';
export const NODE_GAP = 350, FIRST_X = 235;
export function linearOrder(run: RunConfig): string[] {
  if (run.resolved.sources.length !== 1) throw new Error('Linear view requires one source');
  const result: string[] = [], seen = new Set<string>();
  let from = run.resolved.sources[0]!.id;
  while (from !== 'market') {
    const routes = run.resolved.routes.filter(r => r.fromId === from);
    if (routes.length !== 1 || seen.has(from)) throw new Error('Linear view requires a single chain');
    seen.add(from); from = routes[0]!.toId;
    if (from !== 'market') result.push(from);
  }
  if (result.length !== run.resolved.stations.length) throw new Error('Disconnected linear view');
  return result;
}
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
