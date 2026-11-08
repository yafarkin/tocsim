/** Накопленные результаты контроля качества на посту по материалу. */
export interface InspectionCounterSnapshot {
  /** ID поста контроля. */
  stationId: string;
  /** ID проверяемого материала. */
  materialId: string;
  /** Число завершённых повторений контроля. */
  completedRepetitions: number;
  /** Проверенное количество в микроединицах. */
  checkedQuantity: number;
  /** Количество, прошедшее контроль, в микроединицах. */
  passedQuantity: number;
  /** Количество, списанное контролем, в микроединицах. */
  scrappedQuantity: number;
  /** Суммарное время контроля в мс, десятичная строка. */
  processingMs: string;
}
