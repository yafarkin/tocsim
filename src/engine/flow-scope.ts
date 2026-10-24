import type {RunConfig} from './config';

export type ComparableFlowReason = 'assembly' | 'quantityChange' | 'mixedProducts' | null;
/** One conserved unit across the whole line; routing may split that same flow. */
export function comparableFlowReason(run: RunConfig): ComparableFlowReason {
  if (run.resolved.recipes.some(r => r.kind === 'production' && r.inputs.length !== 1)) return 'assembly';
  if (run.resolved.recipes.some(r => r.kind === 'production' && r.inputs[0]!.quantity !== r.output.quantity)) return 'quantityChange';
  if (run.resolved.materials.filter(m => m.role === 'finished').length !== 1 || run.resolved.materials.filter(m => m.role === 'raw').length !== 1) return 'mixedProducts';
  return null;
}
