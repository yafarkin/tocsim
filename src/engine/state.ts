import { lunchCost, moneyToJSON } from './arithmetic';
import { calendarForDuration, elapsedTime } from './calendar';
import { freezeData, outputCapacity } from './config';
import type { DeepReadonly, RunConfig } from './config';

export type MaintenanceTrigger = 'processingTime' | 'repetitions';
export type MaintenanceDeferral = 'batch' | 'output' | 'calendar';
/** Only the last completed service is retained; no unbounded event history. */
export interface MaintenanceRecord {
  dueAtMs: number; dueBy: MaintenanceTrigger[]; deferredBy: MaintenanceDeferral[]; startedAtMs: number; completedAtMs: number;
  processingMs: number; repetitions: number;
}

/** Internal operation token is deliberately excluded from UI snapshots. */
export interface StationState {
  stationId: string;
  /** Occupied processing, setup and maintenance time during paid lunch. */
  lunchBusyMs: number;
  /** Zero-based row and number of fully processed batches within that row. */
  planIndex: number;
  completedBatches: number;
  configuredRecipeId: string;
  targetRecipeId: string | null;
  remainingSetupMs: number | null;
  remainingMaintenanceMs: number | null;
  maintenanceProcessingMs: number;
  maintenanceRepetitions: number;
  maintenanceDueAtMs: number | null;
  maintenanceDueBy: MaintenanceTrigger[];
  maintenanceDeferredBy: MaintenanceDeferral[];
  maintenanceStartedAtMs: number | null;
  lastMaintenance: MaintenanceRecord | null;
  operationVersion: number;
  operationOrdinal: number;
  /** Full duration of the current processing, setup or maintenance operation. */
  operationDurationMs: number | null;
  /** Once released, every remaining held item stays eligible until fully unloaded. */
  transferReady: boolean;
  status: 'idle' | 'maintenance' | 'setup' | 'processing' | 'blocked' | 'starved' | 'paused';
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
  /** Availability at the current buffer; held → output preserves production readiness. */
  readyAtMs: number;
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
/** Aggregates by detector/material/source set, not an event history. */
export interface ScrapSummary {
  detectedAtId: string;
  materialId: string;
  defectSourceIds: string[];
  quantity: number;
  cost: bigint;
  processingMs: Record<string, bigint>;
}
export interface InspectionCounter {
  stationId: string;
  materialId: string;
  completedRepetitions: number;
  checkedQuantity: number;
  passedQuantity: number;
  scrappedQuantity: number;
  processingMs: bigint;
}
export interface LineTransfer {
  fromId: string;
  toId: string;
  fromLocation: 'held' | 'output' | 'reserved';
  materialId: string;
  quantity: number;
  cost: bigint;
  kind: 'buffer' | 'route' | 'sale' | 'scrap';
}
export interface ShiftOutput {dayIndex: number; materialId: string; quantity: number}
export interface LineState {
  transferPending: boolean;
  dispatchPending: boolean;
  counters: MaterialCounter[];
  inspections: InspectionCounter[];
  shiftOutput: ShiftOutput[];
  scraps: ScrapSummary[];
  transfers: LineTransfer[];
}
export interface StationSnapshot extends Omit<StationState, 'operationVersion' | 'operationOrdinal'> {
  /** Available work in [0, timeMs), including this station's lunch replacement. */
  availableWorkMs: number;
  lunchCost: string;
  progress: number | null;
  inputs: {materialId: string; quantity: number; missingQuantity: number; reservedQuantity: number}[];
  /** Material of held work, or the next recipe output when the station is clear. */
  output: {materialId: string; quantity: number; heldQuantity: number};
  outputs: {materialId: string; quantity: number; heldQuantity: number}[];
  blockedBy: {stationId: string; location: 'input' | 'output'}[];
}
export interface LineSnapshot {
  shiftOutput: ShiftOutput[];
  termination: 'running' | 'horizon' | 'stopped' | 'error';
  flow: 'normal' | 'exhausted' | 'missingInput' | 'blocked';
  counters: (Omit<MaterialCounter, 'soldCost' | 'scrapCost'> & {soldCost: string; scrapCost: string})[];
  transfers: (Omit<LineTransfer, 'cost'> & {cost: string})[];
  inspections: (Omit<InspectionCounter, 'processingMs'> & {processingMs: string})[];
  scraps: (Omit<ScrapSummary, 'cost' | 'processingMs'> & {cost: string; processingMs: Record<string, string>})[];
}
export interface EngineState extends InventoryState {
  timeMs: number;
  stations: StationState[];
  sources: SourceState[];
  sourceTransfers: SourceTransfer[];
  line: LineState | null;
}
export interface Snapshot {
  schemaVersion: 17;
  engineVersion: string;
  rngVersion: string;
  calculationHash: string;
  timeMs: number;
  /** Observed [0, timeMs): common work excludes lunch even with replacement. */
  observation: {calendarMs: number; workMs: number};
  stations: StationSnapshot[];
  line: LineSnapshot | null;
  sources: (Omit<SourceState, 'nextOrdinal' | 'pendingQuantity' | 'purchasedCost'> & {purchasedCost: string})[];
  sourceTransfers: (Omit<SourceTransfer, 'cost'> & {cost: string})[];
  stocks: (Omit<StockState, 'cost' | 'provenance'> & { cost: string; provenance: Omit<Provenance, 'processingMs'> & { processingMs: Record<string, string> } })[];
}

/** Called only at a consistent engine boundary, not during an atomic transition. */
export function createSnapshot(run: RunConfig, state: EngineState): DeepReadonly<Snapshot> {
  const calendar = calendarForDuration(run.resolved.calendar, run.resolved.durationMs);
  const replacement = run.resolved.stations.some(s => s.lunchReplacement)
    ? calendarForDuration(run.resolved.calendar, run.resolved.durationMs, true) : calendar;
  return freezeData({
    schemaVersion: 17,
    engineVersion: run.engineVersion,
    rngVersion: run.rngVersion,
    calculationHash: run.calculationHash,
    timeMs: state.timeMs,
    observation: elapsedTime(calendar, 0, state.timeMs),
    stations: state.stations.map(station => {
      const config = run.resolved.stations.find(s => s.id === station.stationId)!;
      const row = config.plan[station.planIndex]!;
      const recipe = run.resolved.recipes.find(r => r.id === row.recipeId)!;
      const count = (location: StockState['location'], materialId: string) => state.stocks.filter(s => s.ownerId === station.stationId && s.location === location && s.materialId === materialId).reduce((sum, stock) => sum + stock.quantity, 0);
      const outputMaterialId = state.stocks.find(stock => stock.ownerId === station.stationId && stock.location === 'held')?.materialId ?? recipe.output.materialId;
      const held = count('held', outputMaterialId);
      const capacity = outputCapacity(config, outputMaterialId);
      const direct = capacity.kind === 'quantity' && capacity.quantity === 0;
      const routes = run.resolved.routes.filter(r => r.fromId === station.stationId && r.materialId === outputMaterialId);
      const recipients = run.resolved.stations.filter(s => routes.some(r => r.toId === s.id))
        .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return {
        availableWorkMs: elapsedTime(config.lunchReplacement ? replacement : calendar, 0, state.timeMs).workMs,
        stationId: station.stationId, lunchBusyMs: station.lunchBusyMs, lunchCost: moneyToJSON(lunchCost(config.costs.perLunchHour, station.lunchBusyMs)), planIndex: station.planIndex, completedBatches: station.completedBatches, status: station.status, reason: station.reason,
        configuredRecipeId: station.configuredRecipeId, targetRecipeId: station.targetRecipeId, remainingSetupMs: station.remainingSetupMs,
        remainingMaintenanceMs: station.remainingMaintenanceMs, maintenanceProcessingMs: station.maintenanceProcessingMs,
        maintenanceRepetitions: station.maintenanceRepetitions, maintenanceDueAtMs: station.maintenanceDueAtMs,
        maintenanceDueBy: station.maintenanceDueBy, maintenanceDeferredBy: station.maintenanceDeferredBy, maintenanceStartedAtMs: station.maintenanceStartedAtMs,
        lastMaintenance: station.lastMaintenance,
        transferReady: station.transferReady, remainingProcessingMs: station.remainingProcessingMs, operationDurationMs: station.operationDurationMs,
        progress: station.remainingSetupMs !== null || station.remainingMaintenanceMs !== null ? null : station.remainingProcessingMs === null ? (held > 0 ? 1 : null) : Math.max(0, Math.min(1, 1 - station.remainingProcessingMs / (station.operationDurationMs ?? row.timeMs))),
        inputs: config.inputBuffers.map(input => ({materialId: input.materialId, quantity: count('input', input.materialId), missingQuantity: station.remainingProcessingMs === null && count('reserved', input.materialId) === 0 ? Math.max(0, (recipe.inputs.find(component => component.materialId === input.materialId)?.quantity ?? 0) * row.repetitions - count('input', input.materialId)) : 0, reservedQuantity: count('reserved', input.materialId)})),
        output: {materialId: outputMaterialId, quantity: count('output', outputMaterialId), heldQuantity: held},
        outputs: [...new Set(config.plan.map(row => run.resolved.recipes.find(recipe => recipe.id === row.recipeId)!.output.materialId))].sort().map(materialId => ({
          materialId, quantity: count('output', materialId), heldQuantity: count('held', materialId),
        })),
        blockedBy: held > 0 && station.transferReady ? (direct ? recipients.map(s => ({stationId: s.id, location: 'input' as const})) : [{stationId: station.stationId, location: 'output' as const}]) : [],
      };
    }),
    line: state.line ? {
      termination: state.timeMs === run.resolved.durationMs ? 'horizon' : 'running',
      flow: state.stations.some(s => s.remainingProcessingMs !== null || s.remainingSetupMs !== null || s.remainingMaintenanceMs !== null) || run.resolved.stations.some(s => {
        const row = s.plan[state.stations.find(station => station.stationId === s.id)!.planIndex]!;
        const inputs = run.resolved.recipes.find(r => r.id === row.recipeId)!.inputs;
        return inputs.every(input => state.stocks.filter(stock => stock.ownerId === s.id && stock.location === 'input' && stock.materialId === input.materialId).reduce((sum, stock) => sum + stock.quantity, 0) >= input.quantity * row.repetitions);
      }) ? 'normal' : state.stocks.some(s => s.location === 'held' || s.location === 'output') ? 'blocked'
        : run.resolved.sources.every(source => source.availability === 'warehouse' && !state.stocks.some(s => s.location === 'warehouse' && s.materialId === source.materialId))
          ? (state.stocks.length === 0 ? 'exhausted' : 'missingInput') : 'missingInput',
      shiftOutput: state.line.shiftOutput.map(row => ({...row})).sort((a,b) => a.dayIndex - b.dayIndex || (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0)),
      counters: state.line.counters.map(c => ({...c, soldCost: moneyToJSON(c.soldCost), scrapCost: moneyToJSON(c.scrapCost)})),
      inspections: state.line.inspections.map(c => ({...c, processingMs: moneyToJSON(c.processingMs)})),
      scraps: state.line.scraps.map(s => ({...s, cost: moneyToJSON(s.cost), processingMs: Object.fromEntries(Object.entries(s.processingMs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, time]) => [id, moneyToJSON(time)]))})),
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
      materialId: stock.materialId, quantity: stock.quantity, cost: moneyToJSON(stock.cost), readyAtMs: stock.readyAtMs,
      provenance: {
        origin: {...stock.provenance.origin}, defective: stock.provenance.defective,
        defectSourceIds: [...stock.provenance.defectSourceIds],
        processingMs: Object.fromEntries(Object.entries(stock.provenance.processingMs).map(([id, time]) => [id, moneyToJSON(time)])),
      },
    })),
  });
}
