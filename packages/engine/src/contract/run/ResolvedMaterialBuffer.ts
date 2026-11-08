import type {ResolvedBuffer} from './ResolvedBuffer.js';

/** Нормализованная вместимость буфера конкретного материала. */
export interface ResolvedMaterialBuffer {
  /** ID материала. */
  materialId: string;
  /** Вместимость в микроединицах или без ограничения. */
  capacity: ResolvedBuffer;
}
