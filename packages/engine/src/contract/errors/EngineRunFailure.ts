import type {EngineRunError} from './EngineRunError.js';

/** Ошибочный envelope безопасного API и CLI без частичного результата. */
export interface EngineRunFailure {
  /** Признак ошибки. */
  ok: false;
  /** Структурированная ошибка с сообщениями RU/EN. */
  error: EngineRunError;
}
