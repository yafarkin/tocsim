/** Интегралы запаса по конкретному месту и материалу. */
export interface StockTimeSnapshot {
  /** ID владельца места хранения. */
  ownerId: string;
  /** ID материала. */
  materialId: string;
  /** Физическое место внутри линии, исключая общий склад. */
  location: 'input' | 'output' | 'held' | 'reserved';
  /** Календарный интеграл в микроединицах × мс, десятичная строка. */
  calendarQuantityMs: string;
  /** Рабочий интеграл в микроединицах × мс, десятичная строка. */
  workQuantityMs: string;
}
