/** Общие параметры обработки независимо от способа задания длительности. */
export interface ProcessingBase {
  /** sequential — повторения друг за другом; simultaneous — одна одновременная партия. */
  mode: 'sequential' | 'simultaneous';
  /** Число обработок в партии, целое число не меньше 1. */
  repetitions: number;
  /** Вероятность скрытого дефекта от 0 до 1; по умолчанию 0. */
  defectProbability?: number;
}
