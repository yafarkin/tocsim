import type {BottleneckTrial} from './BottleneckTrial.js';
/** Парные прогоны с одним seed и одинаковыми буферами. */
export interface BottleneckSample {
  /** Seed базового и проверочных прогонов. */
  seed: number;
  /** Базовый выпуск по productIds, целые миллионные доли единицы. */
  baseline: string[];
  /** Выпуск при ускорении каждого поста. */
  outputs: BottleneckTrial[];
}
