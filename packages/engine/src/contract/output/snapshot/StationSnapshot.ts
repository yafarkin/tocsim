import type {MaintenanceRecord} from './MaintenanceRecord.js';
import type {MaintenanceDeferral} from './MaintenanceDeferral.js';
import type {MaintenanceTrigger} from './MaintenanceTrigger.js';
import type {StationBlockSnapshot} from './StationBlockSnapshot.js';
import type {StationInputSnapshot} from './StationInputSnapshot.js';
import type {StationOutputSnapshot} from './StationOutputSnapshot.js';
import type {StationTime} from './StationTime.js';

/** Полное JSON-состояние поста без внутренних токенов планировщика. */
export interface StationSnapshot {
  /** ID поста из конфигурации. */
  stationId: string;
  /** Накопленное время по непересекающимся состояниям. */
  timeByState: StationTime;
  /** Оплачиваемая занятость в общий обед в мс. */
  lunchBusyMs: number;
  /** Нулевой индекс текущей строки плана. */
  planIndex: number;
  /** Полностью завершённые партии текущей строки. */
  completedBatches: number;
  /** ID рецепта, на который настроен пост. */
  configuredRecipeId: string;
  /** ID рецепта переналадки или null. */
  targetRecipeId: string | null;
  /** Остаток переналадки в мс или null. */
  remainingSetupMs: number | null;
  /** Остаток обслуживания в мс или null. */
  remainingMaintenanceMs: number | null;
  /** Накопленное время обработки для порога обслуживания. */
  maintenanceProcessingMs: number;
  /** Накопленные повторения для порога обслуживания. */
  maintenanceRepetitions: number;
  /** Момент требования обслуживания или null. */
  maintenanceDueAtMs: number | null;
  /** Причины требования обслуживания. */
  maintenanceDueBy: MaintenanceTrigger[];
  /** Причины отсрочки обслуживания. */
  maintenanceDeferredBy: MaintenanceDeferral[];
  /** Момент начала обслуживания или null. */
  maintenanceStartedAtMs: number | null;
  /** Последнее завершённое обслуживание или null. */
  lastMaintenance: MaintenanceRecord | null;
  /** Полная длительность текущей операции в мс или null. */
  operationDurationMs: number | null;
  /** Признак разрешённой выгрузки удержанного материала. */
  transferReady: boolean;
  /** Текущее состояние поста. */
  status: 'idle' | 'maintenance' | 'setup' | 'processing' | 'blocked' | 'starved' | 'paused';
  /** Машинная причина состояния или null. */
  reason: 'notStarted' | 'input' | 'output' | 'offShift' | 'lunch' | 'complete' | 'horizon' | null;
  /** Остаток обработки в мс или null. */
  remainingProcessingMs: number | null;
  /** Доступное рабочее время поста с начала модели в мс. */
  availableWorkMs: number;
  /** Начисленная стоимость работы в обед в микроденежных единицах, строка. */
  lunchCost: string;
  /** Доля выполнения обработки от 0 до 1 или null, если неприменимо. */
  progress: number | null;
  /** Входные материалы, нехватка и резерв. */
  inputs: StationInputSnapshot[];
  /** Текущий или ожидаемый выход поста для индикатора. */
  output: StationOutputSnapshot;
  /** Все возможные выходы плана поста. */
  outputs: StationOutputSnapshot[];
  /** Непосредственные места блокировки выгрузки. */
  blockedBy: StationBlockSnapshot[];
}
