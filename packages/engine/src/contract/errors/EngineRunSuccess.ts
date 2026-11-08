import type {DeepReadonly} from '../shared/DeepReadonly.js';
import type {EngineRunResult} from '../output/EngineRunResult.js';

/** Успешный envelope безопасного API и CLI. */
export interface EngineRunSuccess {
  /** Признак успешного завершения. */
  ok: true;
  /** Полный результат прогона. */
  result: DeepReadonly<EngineRunResult>;
}
