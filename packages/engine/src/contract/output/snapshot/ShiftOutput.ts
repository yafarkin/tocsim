/** Годный выпуск одного материала за одну смену. */
export interface ShiftOutput {
  /** Нулевой индекс рабочего дня. */
  dayIndex: number;
  /** ID конечного материала. */
  materialId: string;
  /** Принятое рынком количество в микроединицах. */
  quantity: number;
}
