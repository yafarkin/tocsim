/** Накопленные моменты поступления и выбытия для проверки сохранения потока. */
export interface FlowBoundarySnapshot {
  /** Моменты поступления по календарю в микроединицах × мс, строка. */
  admissionCalendarQuantityMs: string;
  /** Моменты поступления по рабочему времени в микроединицах × мс, строка. */
  admissionWorkQuantityMs: string;
  /** Моменты выбытия по календарю в микроединицах × мс, строка. */
  exitCalendarQuantityMs: string;
  /** Моменты выбытия по рабочему времени в микроединицах × мс, строка. */
  exitWorkQuantityMs: string;
}
