import type {BufferDefaultsConfig} from './buffers/BufferDefaultsConfig.js';
import type {CalendarConfig} from './CalendarConfig.js';
import type {InitialStockConfig} from './InitialStockConfig.js';
import type {MaterialConfig} from './MaterialConfig.js';
import type {RecipeConfig} from './RecipeConfig.js';
import type {RouteConfig} from './RouteConfig.js';
import type {SourceConfig} from './SourceConfig.js';
import type {StationConfig} from './StationConfig.js';

/** Полный входной JSON производственной модели, принимаемый compileConfig и runSimulation. */
export interface EditorConfig {
  /** Версия входного формата; текущее значение строго 1. */
  schemaVersion: 1;
  /** Уникальный ID конфигурации; не входит в расчётный хеш. */
  id: string;
  /** Отображаемое название конфигурации; не влияет на расчёт. */
  name: string;
  /** Язык исходных названий и подписей; не влияет на расчёт. */
  language: 'ru' | 'en';
  /** Необязательный порядок сущностей для UI; не влияет на расчёт. */
  displayOrder?: string[];
  /** Общие значения для буферов постов с kind: inherit. */
  bufferDefaults?: BufferDefaultsConfig;
  /** Seed воспроизводимых случайных последовательностей, от 0 до 4294967295. */
  seed: number;
  /** Горизонт модели в миллисекундах от начала первой смены до конца последней. */
  durationMs: number;
  /** Начало окна измерения в миллисекундах; по умолчанию 0, не больше durationMs. */
  warmupMs?: number;
  /** Производственная политика; текущая версия поддерживает только push. */
  policy: 'push';
  /** Повторяющийся календарь смены и обеда. */
  calendar: CalendarConfig;
  /** Все материалы сети; каждый должен участвовать в модели. */
  materials: MaterialConfig[];
  /** Все рецепты сети; каждый должен использоваться хотя бы в одном плане. */
  recipes: RecipeConfig[];
  /** Все посты сети; каждый должен иметь входные и выходные маршруты. */
  stations: StationConfig[];
  /** Источники сырья и условия их поставок. */
  sources: SourceConfig[];
  /** Направленные маршруты материалов без циклов и повторов. */
  routes: RouteConfig[];
  /** Начальные физические запасы; пустой массив означает запуск без запасов. */
  initialStocks: InitialStockConfig[];
}
