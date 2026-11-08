import type {DurationDistribution} from '../durations/DurationDistribution.js';
import type {ProcessingBase} from './ProcessingBase.js';

/** Обработка с явно заданным распределением длительности. */
export interface DistributionProcessingConfig extends ProcessingBase {
  /** Постоянное, логнормальное, равномерное или треугольное распределение. */
  distribution: DurationDistribution;
  /** Поле отсутствует при явном распределении. */
  timeMs?: never;
  /** Поле отсутствует при явном распределении. */
  cv?: never;
}
