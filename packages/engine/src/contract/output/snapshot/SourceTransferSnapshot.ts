/** Передача сырья от источника к посту за текущую атомарную отметку. */
export interface SourceTransferSnapshot {
  /** Момент передачи в мс модели. */
  timeMs: number;
  /** ID источника. */
  sourceId: string;
  /** ID поста-получателя. */
  stationId: string;
  /** ID материала. */
  materialId: string;
  /** Количество в микроединицах. */
  quantity: number;
  /** Стоимость передачи в микроденежных единицах, десятичная строка. */
  cost: string;
}
