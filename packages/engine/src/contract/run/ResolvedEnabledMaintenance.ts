/** Нормализованное включённое обслуживание с явными порогами. */
export interface ResolvedEnabledMaintenance {
  /** Обслуживание включено. */
  enabled: true;
  /** Длительность обслуживания в мс. */
  durationMs: number;
  /** Порог времени обработки в мс или null. */
  processingThresholdMs: number | null;
  /** Порог повторений или null. */
  repetitionsThreshold: number | null;
}
