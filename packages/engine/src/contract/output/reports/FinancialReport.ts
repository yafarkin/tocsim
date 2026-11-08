/** Точный финансовый результат; денежные значения — строки микроденежных единиц. */
export interface FinancialReport {
  /** Модельное время отчёта в мс. */
  timeMs: number;
  /** true только после полного горизонта. */
  complete: boolean;
  /** Выручка от принятых рынком продуктов. */
  revenue: string;
  /** Полностью переменные затраты проданного материала. */
  tvcSold: string;
  /** Throughput: revenue минус tvcSold. */
  throughput: string;
  /** Стоимость списанного материала. */
  scrapExpense: string;
  /** Условно-постоянные затраты постов. */
  fixedExpense: string;
  /** Затраты работы в общий обед. */
  lunchExpense: string;
  /** Операционные затраты: fixedExpense, lunchExpense и scrapExpense. */
  operatingExpense: string;
  /** Чистая прибыль: throughput минус operatingExpense. */
  netProfit: string;
}
