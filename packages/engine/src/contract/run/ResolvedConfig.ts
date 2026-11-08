import type {CalendarConfig} from '../input/CalendarConfig.js';
import type {RouteConfig} from '../input/RouteConfig.js';
import type {ResolvedInitialStock} from './ResolvedInitialStock.js';
import type {ResolvedMaterial} from './ResolvedMaterial.js';
import type {ResolvedRecipe} from './ResolvedRecipe.js';
import type {ResolvedSource} from './ResolvedSource.js';
import type {ResolvedStation} from './ResolvedStation.js';

/** Полностью проверенные и нормализованные параметры расчёта без UI-метаданных. */
export interface ResolvedConfig {
  /** Seed случайных последовательностей. */
  seed: number;
  /** Горизонт модели в мс. */
  durationMs: number;
  /** Начало окна измерения в мс. */
  warmupMs: number;
  /** Производственная политика. */
  policy: 'push';
  /** Календарь смены. */
  calendar: CalendarConfig;
  /** Материалы в микроединицах и bigint деньгах. */
  materials: ResolvedMaterial[];
  /** Нормализованные рецепты. */
  recipes: ResolvedRecipe[];
  /** Нормализованные посты. */
  stations: ResolvedStation[];
  /** Нормализованные источники. */
  sources: ResolvedSource[];
  /** Маршруты с исходными стабильными ID. */
  routes: RouteConfig[];
  /** Нормализованные начальные запасы. */
  initialStocks: ResolvedInitialStock[];
}
