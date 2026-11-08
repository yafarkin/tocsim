/** Возраст текущего физического запаса по одному началу отсчёта. */
export interface AgeSummary {
  /** Количество с известным началом отсчёта в микроединицах, строка. */
  knownQuantity: string;
  /** Количество, для которого обработка ещё не началась, строка. */
  notStartedQuantity: string;
  /** Количество с неизвестной начальной историей, строка. */
  unknownQuantity: string;
  /** Календарная сумма возраста в микроединицах × мс, строка. */
  calendarQuantityMs: string;
  /** Рабочая сумма возраста в микроединицах × мс, строка. */
  workQuantityMs: string;
  /** Средний календарный возраст в мс или null. */
  meanCalendarMs: number | null;
  /** Средний рабочий возраст в мс или null. */
  meanWorkMs: number | null;
}
