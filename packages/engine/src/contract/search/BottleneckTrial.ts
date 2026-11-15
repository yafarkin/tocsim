/** Выпуск при сокращении времени обработки одного поста на 10%. */
export interface BottleneckTrial {
  /** Идентификатор ускоренного поста. */
  stationId: string;
  /** Проданные количества по productIds, целые миллионные доли единицы. */
  quantities: string[];
}
