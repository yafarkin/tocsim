import type {InheritBufferConfig} from './InheritBufferConfig.js';
import type {MaterialBufferConfig} from './MaterialBufferConfig.js';
import type {ShiftBufferConfig} from './ShiftBufferConfig.js';

/** Входной буфер поста: явная вместимость, доля смены или наследование. */
export type InputBufferConfig = MaterialBufferConfig | ShiftBufferConfig | InheritBufferConfig;
