/** Источник в нормализованной расчётной конфигурации. */
export interface ResolvedSource {
  /** ID источника. */
  id: string;
  /** ID сырья. */
  materialId: string;
  /** Виртуальный или конечный складской источник. */
  availability: 'virtual' | 'warehouse';
  /** Размер попытки поставки в микроединицах. */
  quantity: number;
  /** Интервал попыток в мс. */
  intervalMs: number;
}
