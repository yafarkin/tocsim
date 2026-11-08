import type {InfiniteBufferConfig} from '../input/buffers/InfiniteBufferConfig.js';
import type {ResolvedQuantityBuffer} from './ResolvedQuantityBuffer.js';

/** Нормализованная вместимость буфера в микроединицах или без ограничения. */
export type ResolvedBuffer = ResolvedQuantityBuffer | InfiniteBufferConfig;
