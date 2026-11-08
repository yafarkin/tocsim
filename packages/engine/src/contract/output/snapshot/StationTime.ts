/** Непересекающиеся интервалы состояний поста в миллисекундах. */
export interface StationTime {
  /** Фактическая обработка. */
  processingMs: number;
  /** Переналадка. */
  setupMs: number;
  /** Плановое обслуживание. */
  maintenanceMs: number;
  /** Ожидание входного комплекта. */
  starvedMs: number;
  /** Блокировка выгрузки. */
  blockedMs: number;
  /** Доступное рабочее время без других состояний. */
  idleMs: number;
  /** Общий обед, если пост не работает по подмене. */
  lunchMs: number;
  /** Время вне смены. */
  offShiftMs: number;
}
