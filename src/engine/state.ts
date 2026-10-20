import { moneyToJSON } from './arithmetic';
import { freezeData } from './config';
import type { DeepReadonly, RunConfig } from './config';

/** Data contracts only. Stock transitions, origin and events arrive in later tasks. */
export interface StationState {
  stationId: string;
  status: 'idle' | 'processing' | 'blocked';
  reason: 'notStarted' | 'input' | 'output' | 'offShift' | 'lunch' | 'complete' | null;
  remainingProcessingMs: number | null;
}
export interface StockState {
  id: string;
  ownerId: string;
  location: 'warehouse' | 'input' | 'output' | 'held' | 'reserved';
  materialId: string;
  quantity: number;
  cost: bigint;
}
export interface EngineState {
  timeMs: number;
  stations: StationState[];
  stocks: StockState[];
}
export interface Snapshot {
  schemaVersion: 1;
  engineVersion: string;
  rngVersion: string;
  calculationHash: string;
  timeMs: number;
  stations: StationState[];
  stocks: (Omit<StockState, 'cost'> & { cost: string })[];
}

/** Called only at a consistent engine boundary, not during an atomic transition. */
export function createSnapshot(run: RunConfig, state: EngineState): DeepReadonly<Snapshot> {
  return freezeData({
    schemaVersion: run.schemaVersion,
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
    })),
  });
}
