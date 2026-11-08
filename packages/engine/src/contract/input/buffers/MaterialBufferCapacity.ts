import type {BufferConfig} from './BufferConfig.js';

/** Вместимость буфера для одного конкретного материала. */
export interface MaterialBufferCapacity {
  /** ID материала из EditorConfig.materials. */
  materialId: string;
  /** Конечная или неограниченная вместимость для этого материала. */
  capacity: BufferConfig;
}
