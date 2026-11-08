import type {BufferConfig} from './BufferConfig.js';
import type {MaterialBuffersConfig} from './MaterialBuffersConfig.js';

/** Общая вместимость для каждого материала или отдельные значения по материалам. */
export type MaterialBufferConfig = BufferConfig | MaterialBuffersConfig;
