import { moneyToJSON } from './arithmetic';
import { freezeData } from './config';
import type { DeepReadonly, RunConfig } from './config';

/** Full station scheduling arrives in task 16. */
export interface StationState {
  stationId: string;
  operationVersion: number;
  status: 'idle' | 'processing' | 'blocked';
  reason: 'notStarted' | 'input' | 'output' | 'offShift' | 'lunch' | 'complete' | null;
  remainingProcessingMs: number | null;
}
export type StockOrigin = { kind: 'unreleased' } | { kind: 'known'; startedAtMs: number } | { kind: 'unknown' };
export interface Provenance {
  origin: StockOrigin;
  defective: boolean;
  defectSourceIds: string[];
  /** Integer milliseconds apportioned with remainder preservation, by station ID. */
  processingMs: Record<string, bigint>;
}
export interface StockState {
  id: string;
  ownerId: string;
  location: 'warehouse' | 'input' | 'output' | 'held' | 'reserved';
  materialId: string;
  quantity: number;
  cost: bigint;
  provenance: Provenance;
}
export interface InventoryState {
  stocks: StockState[];
  nextStockOrdinal: number;
}
export interface EngineState extends InventoryState {
  timeMs: number;
  stations: StationState[];
}
export interface Snapshot {
  schemaVersion: 2;
  engineVersion: string;
  rngVersion: string;
  calculationHash: string;
  timeMs: number;
  stations: Omit<StationState, 'operationVersion'>[];
  stocks: (Omit<StockState, 'cost' | 'provenance'> & { cost: string; provenance: Omit<Provenance, 'processingMs'> & { processingMs: Record<string, string> } })[];
}

/** Called only at a consistent engine boundary, not during an atomic transition. */
export function createSnapshot(run: RunConfig, state: EngineState): DeepReadonly<Snapshot> {
  return freezeData({
    schemaVersion: 2,
    engineVersion: run.engineVersion,
    rngVersion: run.rngVersion,
    calculationHash: run.calculationHash,
    timeMs: state.timeMs,
    stations: state.stations.map(station => ({
      stationId: station.stationId, status: station.status,
      reason: station.reason, remainingProcessingMs: station.remainingProcessingMs,
    })),
    stocks: state.stocks.map(stock => ({
      id: stock.id, ownerId: stock.ownerId, location: stock.location,
      materialId: stock.materialId, quantity: stock.quantity, cost: moneyToJSON(stock.cost),
      provenance: {
        origin: {...stock.provenance.origin}, defective: stock.provenance.defective,
        defectSourceIds: [...stock.provenance.defectSourceIds],
        processingMs: Object.fromEntries(Object.entries(stock.provenance.processingMs).map(([id, time]) => [id, moneyToJSON(time)])),
      },
    })),
  });
}
