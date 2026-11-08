import type {InputBufferConfig} from './buffers/InputBufferConfig.js';
import type {OutputBufferConfig} from './buffers/OutputBufferConfig.js';
import type {MaintenanceConfig} from './processing/MaintenanceConfig.js';
import type {StationCostsConfig} from './StationCostsConfig.js';
import type {StationPlanConfig} from './StationPlanConfig.js';

/** Производственный пост с циклическим планом, буферами и затратами. */
export interface StationConfig {
  /** Уникальный стабильный ID поста. */
  id: string;
  /** Отображаемое название; не влияет на расчёт. */
  name: string;
  /** Приоритет при распределении материала и запуске; большее число означает более высокий приоритет. */
  priority: number;
  /** Непустой циклический план рецептов. */
  plan: StationPlanConfig[];
  /** Входной буфер или наследование общего значения. */
  inputBuffer: InputBufferConfig;
  /** Выходной буфер или наследование общего значения. */
  outputBuffer: OutputBufferConfig;
  /** Минимальное количество для передачи готового материала; по умолчанию весь выпуск обработки. */
  transportThreshold?: string;
  /** Начальный рецепт; по умолчанию первая строка плана. */
  initialRecipeId?: string;
  /** Длительность переналадки при смене рецепта в миллисекундах. */
  setupMs: number;
  /** Настройка планового обслуживания. */
  maintenance: MaintenanceConfig;
  /** Разрешает работу поста в общий обед с отдельным учётом затрат. */
  lunchReplacement: boolean;
  /** Затраты и капитал поста. */
  costs: StationCostsConfig;
}
