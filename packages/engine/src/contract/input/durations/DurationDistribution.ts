import type {BoundedDistribution} from './BoundedDistribution.js';
import type {ConstantDistribution} from './ConstantDistribution.js';
import type {LognormalDistribution} from './LognormalDistribution.js';

/** Поддерживаемый способ задания длительности обработки. */
export type DurationDistribution = BoundedDistribution | ConstantDistribution | LognormalDistribution;
