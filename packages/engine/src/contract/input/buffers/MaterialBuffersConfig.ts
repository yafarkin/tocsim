import type {MaterialBufferCapacity} from './MaterialBufferCapacity.js';

/** Набор независимых вместимостей по материалам. */
export interface MaterialBuffersConfig {
  /** Признак отдельных вместимостей по материалам. */
  kind: 'materials';
  /** Полный список материалов и их вместимостей без повторяющихся ID. */
  materials: MaterialBufferCapacity[];
}
