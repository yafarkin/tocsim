import type {ConstantProcessingConfig} from './ConstantProcessingConfig.js';
import type {DistributionProcessingConfig} from './DistributionProcessingConfig.js';

/** Параметры одной обработки: timeMs/cv или явное distribution, но не оба варианта. */
export type ProcessingConfig = ConstantProcessingConfig | DistributionProcessingConfig;
