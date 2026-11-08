import type {InheritBufferConfig} from './InheritBufferConfig.js';
import type {MaterialBufferConfig} from './MaterialBufferConfig.js';

/** Выходной буфер поста: явная вместимость по материалам или наследование. */
export type OutputBufferConfig = MaterialBufferConfig | InheritBufferConfig;
