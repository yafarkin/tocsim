import type {TriangularDistribution} from './TriangularDistribution.js';
import type {UniformDistribution} from './UniformDistribution.js';

/** Распределение с явными минимальной и максимальной длительностями. */
export type BoundedDistribution = UniformDistribution | TriangularDistribution;
