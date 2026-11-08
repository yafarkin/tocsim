/** Отказ отчёта Литтла для несопоставимого потока или до разогрева. */
export interface NotApplicableLittleLawReport {
  /** Отчёт не применим. */
  applicable: false;
  /** Причина несопоставимости или недостигнутый разогрев. */
  reason: 'assembly' | 'quantityChange' | 'mixedProducts' | 'quality' | 'warmupNotReached';
}
