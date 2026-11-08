import type {BufferConfig} from './BufferConfig.js';
import type {ShiftBufferConfig} from './ShiftBufferConfig.js';

/** Общие значения, наследуемые буферами постов с kind: inherit. */
export interface BufferDefaultsConfig {
  /** Общая входная вместимость или доля смены; обязательна при наследовании входа. */
  input?: BufferConfig | ShiftBufferConfig;
  /** Общая выходная вместимость; обязательна при наследовании выхода. */
  output?: BufferConfig;
}
