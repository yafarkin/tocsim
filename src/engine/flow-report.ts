import type {DeepReadonly, RunConfig} from './config';
import type {Snapshot, StockState} from './state';

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const productionLocations = ['input', 'reserved', 'held', 'output'] as const;
export type ProductionLocation = typeof productionLocations[number];
export interface MaterialStock {
  materialId: string;
  input: string; reserved: string; held: string; output: string;
  total: string;
}
/** Read-only aggregation of disjoint physical lots. No quality flags or UI state. */
export function flowReport(run: RunConfig, model: DeepReadonly<Snapshot>) {
  const stockByMaterial = new Map(run.resolved.materials.map(m => [m.id, {input: 0n, reserved: 0n, held: 0n, output: 0n, warehouse: 0n}]));
  const places = new Map<string, {ownerId: string; materialId: string; location: StockState['location']; quantity: bigint}>();
  for (const stock of model.stocks) {
    stockByMaterial.get(stock.materialId)![stock.location] += BigInt(stock.quantity);
    const key = JSON.stringify([stock.ownerId, stock.materialId, stock.location]);
    const row = places.get(key) ?? {ownerId: stock.ownerId, materialId: stock.materialId, location: stock.location, quantity: 0n};
    row.quantity += BigInt(stock.quantity);places.set(key, row);
  }
  const materials: MaterialStock[] = run.resolved.materials.map(m => {
    const stock = stockByMaterial.get(m.id)!;
    return {materialId: m.id, input: String(stock.input), reserved: String(stock.reserved), held: String(stock.held), output: String(stock.output), total: String(stock.input + stock.reserved + stock.held + stock.output)};
  });
  const products = run.resolved.materials.filter(m => m.role === 'finished').map(m => {
    const counter = model.line!.counters.find(c => c.materialId === m.id)!;
    return {materialId: m.id, produced: String(counter.produced), delivered: String(counter.sold), awaitingAcceptance: materials.find(row => row.materialId === m.id)!.total};
  });
  return {
    timeMs: model.timeMs, complete: model.line!.termination === 'horizon', products, materials,
    warehouse: run.resolved.materials.map(m => ({materialId: m.id, quantity: String(stockByMaterial.get(m.id)!.warehouse)})).filter(row => row.quantity !== '0'),
    places: [...places.values()].sort((a,b) => compareIds(a.ownerId, b.ownerId) || compareIds(a.materialId, b.materialId) || productionLocations.indexOf(a.location as ProductionLocation) - productionLocations.indexOf(b.location as ProductionLocation)).map(row => ({...row, quantity: String(row.quantity)})),
    shifts: model.line!.shiftOutput,
  };
}
