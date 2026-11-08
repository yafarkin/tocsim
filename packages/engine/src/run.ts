import {ArithmeticError} from './arithmetic.js';
import {compileConfig, freezeData} from './config.js';
import type {DeepReadonly} from './config.js';
import {financialReport} from './financial-report.js';
import type {FlowHistory} from './flow-history.js';
import {flowReport} from './flow-report.js';
import {investmentReport} from './investment-report.js';
import {Simulation} from './simulation.js';
import type {Snapshot} from './state.js';

export const RUN_RESULT_SCHEMA_VERSION = 1;

export interface EngineRunResult {
  schemaVersion: typeof RUN_RESULT_SCHEMA_VERSION;
  engineVersion: string;
  rngVersion: string;
  calculationHash: string;
  snapshot: DeepReadonly<Snapshot>;
  reports: {
    flow: ReturnType<typeof flowReport>;
    littleLaw: ReturnType<Simulation['getFlowReport']>;
    financial: ReturnType<typeof financialReport>;
    investment: ReturnType<typeof investmentReport>;
  };
  history: DeepReadonly<FlowHistory>;
}

export interface EngineRunError {
  code: string;
  path: string | null;
  objectId: string | null;
  messages: {ru: string; en: string};
}

export type EngineRunResponse =
  | {ok: true; result: DeepReadonly<EngineRunResult>}
  | {ok: false; error: EngineRunError};

export function runSimulation(input: unknown): DeepReadonly<EngineRunResult> {
  const run = compileConfig(input);
  const simulation = new Simulation(run);
  const snapshot = simulation.runToEnd();
  return freezeData({
    schemaVersion: RUN_RESULT_SCHEMA_VERSION,
    engineVersion: run.engineVersion,
    rngVersion: run.rngVersion,
    calculationHash: run.calculationHash,
    snapshot,
    reports: {
      flow: flowReport(run, snapshot),
      littleLaw: simulation.getFlowReport(),
      financial: financialReport(run, snapshot),
      investment: investmentReport(run, snapshot),
    },
    history: simulation.getHistory(),
  });
}

export function toEngineRunError(error: unknown): EngineRunError {
  if (error instanceof ArithmeticError) {
    return {code: error.code, path: null, objectId: null, messages: error.code === 'range'
      ? {ru: 'Превышен допустимый числовой диапазон.', en: 'Supported numeric range was exceeded.'}
      : {ru: 'Некорректные данные точной арифметики.', en: 'Invalid exact arithmetic data.'}};
  }
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    && 'messages' in error && error.messages && typeof error.messages === 'object'
    && 'ru' in error.messages && typeof error.messages.ru === 'string'
    && 'en' in error.messages && typeof error.messages.en === 'string') {
    return {
      code: error.code,
      path: 'path' in error && typeof error.path === 'string' ? error.path : null,
      objectId: 'objectId' in error && typeof error.objectId === 'string' ? error.objectId : null,
      messages: {ru: error.messages.ru, en: error.messages.en},
    };
  }
  return {code: 'internal', path: null, objectId: null, messages: {
    ru: 'Не удалось выполнить прогон.', en: 'Unable to complete the run.',
  }};
}

export function runSimulationSafely(input: unknown): DeepReadonly<EngineRunResponse> {
  try {
    return freezeData({ok: true, result: runSimulation(input)});
  } catch (error) {
    return freezeData({ok: false, error: toEngineRunError(error)});
  }
}

export function runSimulationJson(json: string): DeepReadonly<EngineRunResponse> {
  try {
    return runSimulationSafely(JSON.parse(json));
  } catch {
    return freezeData({ok: false, error: {
      code: 'json', path: null, objectId: null,
      messages: {ru: 'Входные данные не являются корректным JSON.', en: 'Input is not valid JSON.'},
    }});
  }
}
