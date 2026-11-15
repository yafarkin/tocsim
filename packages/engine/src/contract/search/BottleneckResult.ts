import type {BottleneckSample} from './BottleneckSample.js';
/** Кандидаты на заданном горизонте; результат не доказывает точный критический путь. */
export interface BottleneckResult {
  /** Порядок продуктов в массивах количеств. */
  productIds: string[];
  /** Базовые и проверочные результаты по seeds. */
  samples: BottleneckSample[];
  /** Единственный или равные лучшие кандидаты; иначе пустой массив. */
  stationIds: string[];
  /** Кандидат, равные кандидаты, неоднозначность или отсутствие прироста. */
  outcome: 'candidate' | 'tied' | 'ambiguous' | 'noGain';
}
