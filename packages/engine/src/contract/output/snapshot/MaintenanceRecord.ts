import type {MaintenanceDeferral} from './MaintenanceDeferral.js';
import type {MaintenanceTrigger} from './MaintenanceTrigger.js';

/** Последнее завершённое обслуживание поста. */
export interface MaintenanceRecord {
  /** Момент, когда обслуживание стало требоваться, в мс модели. */
  dueAtMs: number;
  /** Причины возникновения требования. */
  dueBy: MaintenanceTrigger[];
  /** Причины, по которым начало было отложено. */
  deferredBy: MaintenanceDeferral[];
  /** Фактическое начало обслуживания в мс модели. */
  startedAtMs: number;
  /** Фактическое завершение обслуживания в мс модели. */
  completedAtMs: number;
  /** Накопленное время обработки на момент требования. */
  processingMs: number;
  /** Накопленное число повторений на момент требования. */
  repetitions: number;
}
