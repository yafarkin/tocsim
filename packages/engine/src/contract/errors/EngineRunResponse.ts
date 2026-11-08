import type {EngineRunFailure} from './EngineRunFailure.js';
import type {EngineRunSuccess} from './EngineRunSuccess.js';

/** Результат безопасного вызова: ровно один успех или одна ошибка. */
export type EngineRunResponse = EngineRunSuccess | EngineRunFailure;
