import type { DeepReadonly } from '../engine/config';
import type { Snapshot } from '../engine/state';
export interface TransferSummary {
  fromId: string;
  toId: string;
  materialId: string;
  kind: 'source' | 'buffer' | 'route' | 'sale' | 'scrap';
  /** Sum in integer micro-units. Display aggregation must never overflow model bounds. */
  quantity: string;
}
export interface TransferBatch {
  sequence: number;
  fromTimeMs: number;
  toTimeMs: number;
  items: TransferSummary[];
}
export function collectTransfers(items: Map<string, TransferSummary>, snapshot: DeepReadonly<Snapshot>): void {
  const records: TransferSummary[] = [
    ...snapshot.sourceTransfers.map(t => ({fromId: t.sourceId, toId: t.stationId, materialId: t.materialId, kind: 'source' as const, quantity: String(t.quantity)})),
    ...(snapshot.line?.transfers ?? []).map(t => ({fromId: t.fromId, toId: t.toId, materialId: t.materialId, kind: t.kind, quantity: String(t.quantity)})),
  ];
  for (const record of records) {
    const key = JSON.stringify([record.fromId, record.toId, record.materialId, record.kind]);
    const previous = items.get(key);
    items.set(key, {...record, quantity: (BigInt(previous?.quantity ?? '0') + BigInt(record.quantity)).toString()});
  }
}
