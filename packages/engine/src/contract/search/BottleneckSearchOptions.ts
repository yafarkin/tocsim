/** Управление независимым поиском без DOM и изменения текущего прогона. */
export interface BottleneckSearchOptions {
  /** Отмена возвращает null без частичного результата. */
  cancelled?: () => boolean;
  /** Число завершённых и общее число проверочных прогонов, включая базовые. */
  onProgress?: (done: number, total: number) => void;
  /** Передача управления среде; по умолчанию используется таймер. */
  yieldTurn?: () => Promise<void>;
}
