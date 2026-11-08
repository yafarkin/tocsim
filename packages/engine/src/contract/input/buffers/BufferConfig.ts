import type {InfiniteBufferConfig} from './InfiniteBufferConfig.js';
import type {QuantityBufferConfig} from './QuantityBufferConfig.js';

/** Вместимость буфера: конечное количество или отсутствие явного ограничения. */
export type BufferConfig = QuantityBufferConfig | InfiniteBufferConfig;
