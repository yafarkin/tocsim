/** Списания, сгруппированные по месту обнаружения, материалу и источникам дефекта. */
export interface ScrapSummarySnapshot {
  /** ID поста-контролёра или market. */
  detectedAtId: string;
  /** ID списанного материала. */
  materialId: string;
  /** Отсортированные ID постов, где возникли дефекты. */
  defectSourceIds: string[];
  /** Списанное количество в микроединицах. */
  quantity: number;
  /** Стоимость списания в микроденежных единицах, строка. */
  cost: string;
  /** Приписанное время обработки по ID постов в мс, десятичные строки. */
  processingMs: Record<string, string>;
}
