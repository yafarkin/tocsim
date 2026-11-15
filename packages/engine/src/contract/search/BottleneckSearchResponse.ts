import type {BottleneckResult} from './BottleneckResult.js';
import type {EngineRunFailure} from '../errors/EngineRunFailure.js';

/** JSON-ответ режима CLI --bottleneck: полный результат или ошибка. */
export type BottleneckSearchResponse = {ok: true; result: BottleneckResult} | EngineRunFailure;
