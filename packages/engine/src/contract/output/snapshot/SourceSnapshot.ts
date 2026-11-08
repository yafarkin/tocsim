import type {SourceAttempt} from './SourceAttempt.js';

/** Итоговое состояние источника сырья. */
export interface SourceSnapshot {
  /** ID источника из конфигурации. */
  sourceId: string;
  /** Число выполненных попыток поставки. */
  attempts: number;
  /** Суммарно выпущенное количество в микроединицах. */
  releasedQuantity: number;
  /** Стоимость закупок в микроденежных единицах, десятичная строка. */
  purchasedCost: string;
  /** Последняя попытка или null до первой попытки. */
  lastAttempt: SourceAttempt | null;
}
