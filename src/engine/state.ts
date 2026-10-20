import { moneyToJSON } from './arithmetic';
import { freezeData } from './config';
import type { DeepReadonly, RunConfig } from './config';

/** Internal operation token is deliberately excluded from UI snapshots. */
export interface StationState {
  stationId: string;
  operationVersion: number;
  status: 'idle' | 'processing' | 'blocked' | 'starved' | 'paused';
  reason: 'notStarted' | 'input' | 'output' | 'offShift' | 'lunch' | 'complete' | 'horizon' | null;
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
export interface SourceAttempt {
  timeMs: number;
  requestedQuantity: number;
  releasedQuantity: number;
  blockedBy: ('capacity' | 'stock')[];
}
export interface SourceState {
  sourceId: string;
  nextOrdinal: number;
  pendingQuantity: number;
  attempts: number;
  releasedQuantity: number;
  purchasedCost: bigint;
  lastAttempt: SourceAttempt | null;
}
export interface SourceTransfer {
  timeMs: number;
  sourceId: string;
  stationId: string;
  materialId: string;
  quantity: number;
  cost: bigint;
}
export interface MaterialCounter {
  materialId: string;
  produced: number;
  consumed: number;
  sold: number;
  soldCost: bigint;
  scrapped: number;
  scrapCost: bigint;
}
export interface LineTransfer {
  fromId: string;
  toId: string;
  fromLocation: 'held' | 'output';
  materialId: string;
  quantity: number;
  cost: bigint;
  kind: 'buffer' | 'route' | 'sale' | 'scrap';
}
export interface LineState {
  transferPending: boolean;
  dispatchPending: boolean;
  counters: MaterialCounter[];
  transfers: LineTransfer[];
}
export interface StationSnapshot extends Omit<StationState, 'operationVersion'> {
  progress: number | null;
  input: {materialId: string; quantity: number; missingQuantity: number};
  output: {materialId: string; quantity: number; heldQuantity: number};
  blockedBy: {stationId: string; location: 'input' | 'output'} | null;
}
export interface LineSnapshot {
  termination: 'running' | 'horizon' | 'stopped' | 'error';
  flow: 'normal' | 'exhausted' | 'missingInput' | 'blocked';
  counters: (Omit<MaterialCounter, 'soldCost' | 'scrapCost'> & {soldCost: string; scrapCost: string})[];
  transfers: (Omit<LineTransfer, 'cost'> & {cost: string})[];
}
export interface EngineState extends InventoryState {
  timeMs: number;
  stations: StationState[];
  sources: SourceState[];
  sourceTransfers: SourceTransfer[];
  line: LineState | null;
}
export interface Snapshot {
  schemaVersion: 4;
  engineVersion: string;
  rngVersion: string;
  calculationHash: string;
  timeMs: number;
  stations: StationSnapshot[];
  line: LineSnapshot | null;
  sources: (Omit<SourceState, 'nextOrdinal' | 'pendingQuantity' | 'purchasedCost'> & {purchasedCost: string})[];
  sourceTransfers: (Omit<SourceTransfer, 'cost'> & {cost: string})[];
  stocks: (Omit<StockState, 'cost' | 'provenance'> & { cost: string; provenance: Omit<Provenance, 'processingMs'> & { processingMs: Record<string, string> } })[];
}

/** Called only at a consistent engine boundary, not during an atomic transition. */
export function createSnapshot(run: RunConfig, state: EngineState): DeepReadonly<Snapshot> {
  return freezeData({
    schemaVersion: 4,
    engineVersion: run.engineVersion,
    rngVersion: run.rngVersion,
    calculationHash: run.calculationHash,
    timeMs: state.timeMs,
    stations: state.stations.map(station => {
      const config = run.resolved.stations.find(s => s.id === station.stationId)!;
      const recipe = run.resolved.recipes.find(r => r.id === config.recipeId)!;
      const count = (location: StockState['location'], materialId: string) => state.stocks.filter(s => s.ownerId === station.stationId && s.location === location && s.materialId === materialId).reduce((sum, stock) => sum + stock.quantity, 0);
      const held = count('held', recipe.output.materialId), input = count('input', recipe.input.materialId);
      const direct = config.outputBuffer.kind === 'quantity' && config.outputBuffer.quantity === 0;
      const route = run.resolved.routes.find(r => r.fromId === station.stationId)!;
      return {
        stationId: station.stationId, status: station.status, reason: station.reason,
        remainingProcessingMs: station.remainingProcessingMs,
        progress: station.remainingProcessingMs === null ? (held > 0 ? 1 : null) : Math.max(0, Math.min(1, 1 - station.remainingProcessingMs / config.timeMs)),
        input: {materialId: recipe.input.materialId, quantity: input, missingQuantity: station.remainingProcessingMs === null ? Math.max(0, recipe.input.quantity - input) : 0},
        output: {materialId: recipe.output.materialId, quantity: count('output', recipe.output.materialId), heldQuantity: held},
        blockedBy: held > 0 ? {stationId: direct ? route.toId : station.stationId, location: direct ? 'input' as const : 'output' as const} : null,
      };
    }),
    line: state.line ? {
      termination: state.timeMs === run.resolved.durationMs ? 'horizon' : 'running',
      flow: state.stations.some(s => s.remainingProcessingMs !== null) || run.resolved.stations.some(s => {
        const input = run.resolved.recipes.find(r => r.id === s.recipeId)!.input;
        return state.stocks.filter(stock => stock.ownerId === s.id && stock.location === 'input' && stock.materialId === input.materialId).reduce((sum, stock) => sum + stock.quantity, 0) >= input.quantity;
      }) ? 'normal' : state.stocks.some(s => s.location === 'held' || s.location === 'output') ? 'blocked'
        : run.resolved.sources.every(source => source.availability === 'warehouse' && !state.stocks.some(s => s.location === 'warehouse' && s.materialId === source.materialId))
          ? (state.stocks.length === 0 ? 'exhausted' : 'missingInput') : 'missingInput',
      counters: state.line.counters.map(c => ({...c, soldCost: moneyToJSON(c.soldCost), scrapCost: moneyToJSON(c.scrapCost)})),
      transfers: state.line.transfers.map(t => ({...t, cost: moneyToJSON(t.cost)})),
    } : null,
    sources: state.sources.map(source => ({
      sourceId: source.sourceId, attempts: source.attempts, releasedQuantity: source.releasedQuantity,
      purchasedCost: moneyToJSON(source.purchasedCost),
      lastAttempt: source.lastAttempt ? {...source.lastAttempt, blockedBy: [...source.lastAttempt.blockedBy]} : null,
    })),
    sourceTransfers: state.sourceTransfers.map(transfer => ({...transfer, cost: moneyToJSON(transfer.cost)})),
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
