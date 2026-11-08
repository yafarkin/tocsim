# Самостоятельное ядро и JSON API

Задача № 159, 2026-11-08. Реализация влита в master merge-коммитом `e734c88`. CI/Pages 42454921522 успешны, опубликованный автономный HTML совпал с локальной сборкой.

Задача № 160, 2026-11-08. Публичные DTO вынесены в `contract` и прокомментированы; CI/Pages 42459406112 успешны, опубликованный HTML снова совпал со сборкой.

## Архитектура

Расчётный код находится в npm workspace `packages/engine` и собирается как пакет `@toc/engine`. Web UI и CLI используют один пакет, один `Simulation`, один компилятор конфигурации и одни отчёты. Копии производственной модели нет.

```text
React UI → Runner ───────┐
                         ├─→ @toc/engine
JSON файл/stdin → CLI ───┘
```

`Runner` остаётся адаптером воспроизведения в приложении: он управляет паузой, скоростью, таймерами и промежуточными снимками. CLI использует синхронный полный прогон без реального времени. Сетевого сервера нет.

Изменения алгоритма в пакете после сборки действуют в обоих потребителях. Новый вид отчёта нужно включить в фасад `runSimulation`, а новый визуальный элемент отдельно добавить в React UI. Поэтому общая логика не дублируется, но пользовательские представления не появляются автоматически.

## Модели контракта в исходном коде

Единственным источником подробного описания полей являются TypeScript DTO в `packages/engine/src/contract`. Документ не дублирует таблицы всех свойств: у каждой DTO и каждого её свойства есть TSDoc-комментарий в коде. Правило «одна сущность — один файл» проверяется отдельным тестом `packages/engine/src/contract.test.ts`.

| Часть контракта | Корневая DTO | Каталог вложенных моделей |
| --- | --- | --- |
| Входной JSON | [EditorConfig.ts](../packages/engine/src/contract/input/EditorConfig.ts) | [contract/input](../packages/engine/src/contract/input) |
| Проверенный прогон | [RunConfig.ts](../packages/engine/src/contract/run/RunConfig.ts) | [contract/run](../packages/engine/src/contract/run) |
| Успешный результат | [EngineRunResult.ts](../packages/engine/src/contract/output/EngineRunResult.ts) | [contract/output](../packages/engine/src/contract/output) |
| Итоговый Snapshot | [Snapshot.ts](../packages/engine/src/contract/output/snapshot/Snapshot.ts) | [contract/output/snapshot](../packages/engine/src/contract/output/snapshot) |
| История потока | [FlowHistory.ts](../packages/engine/src/contract/output/history/FlowHistory.ts) | [contract/output/history](../packages/engine/src/contract/output/history) |
| Отчёты | [EngineRunReports.ts](../packages/engine/src/contract/output/EngineRunReports.ts) | [contract/output/reports](../packages/engine/src/contract/output/reports) |
| Ошибка и envelope | [EngineRunError.ts](../packages/engine/src/contract/errors/EngineRunError.ts), [EngineRunResponse.ts](../packages/engine/src/contract/errors/EngineRunResponse.ts) | [contract/errors](../packages/engine/src/contract/errors) |
| Общие типы | [DeepReadonly.ts](../packages/engine/src/contract/shared/DeepReadonly.ts) | [contract/shared](../packages/engine/src/contract/shared) |

Корневой экспорт [contract/index.ts](../packages/engine/src/contract/index.ts) собирает все публичные DTO без дублирования определений. Расчётные модули и UI импортируют те же самые типы.

## TypeScript API

```ts
import {runSimulation, runSimulationJson, runSimulationSafely} from '@toc/engine';

const result = runSimulation(configuration);
const safeResult = runSimulationSafely(configuration);
const fromJson = runSimulationJson(jsonText);
```

- `runSimulation(input: unknown)` проверяет вход, выполняет полный прогон и возвращает неизменяемый результат. Ошибки выбрасываются как исключения.
- `runSimulationSafely(input: unknown)` возвращает envelope `ok/result` или `ok/error`.
- `runSimulationJson(json: string)` дополнительно разбирает JSON и возвращает тот же envelope.
- `compileConfig` и `Simulation` остаются доступны для пошаговых и интерактивных потребителей.

Входом является [EditorConfig](../packages/engine/src/contract/input/EditorConfig.ts) со `schemaVersion: 1`. Строгая проверка неизвестных полей, ссылок, диапазонов и топологии выполняется прежним `compileConfig`. Количества и деньги во входе задаются строками с точностью до шести знаков, чтобы не использовать двоичное представление десятичных дробей.

## Результат

[EngineRunResult](../packages/engine/src/contract/output/EngineRunResult.ts) имеет собственный `schemaVersion: 1`:

| Поле | Содержание и DTO |
| --- | --- |
| `engineVersion`, `rngVersion`, `calculationHash` | Версии и идентичность расчётных условий |
| `snapshot` | [Snapshot](../packages/engine/src/contract/output/snapshot/Snapshot.ts) 24: выпуск, запасы, состояния постов и источники |
| `reports.flow` | [FlowReport](../packages/engine/src/contract/output/reports/FlowReport.ts): выпуск, поставки, запасы и выпуск по сменам |
| `reports.littleLaw` | [LittleLawReport](../packages/engine/src/contract/output/reports/LittleLawReport.ts): проверка потока и конечное приближение закона Литтла |
| `reports.financial` | [FinancialReport](../packages/engine/src/contract/output/reports/FinancialReport.ts): выручка, TVC, throughput, расходы и чистая прибыль |
| `reports.investment` | [InvestmentReport](../packages/engine/src/contract/output/reports/InvestmentReport.ts): запасы, капитал, средние вложения и ROI за период |
| `history` | [FlowHistory](../packages/engine/src/contract/output/history/FlowHistory.ts) 1 для графиков и анализа во времени |

Результат целиком совместим с `JSON.stringify`: внутренние `bigint` уже преобразованы в десятичные строки в Snapshot и отчётах. История ограничена существующим числом отсчётов, но полный ответ всё равно может быть большим. Он предназначен для машинной обработки, а не для вывода в терминал вручную.

Фасад только объединяет существующие вычисления. Он не меняет правила модели, версии движка, Snapshot, FlowHistory, EditorConfig или RunConfig.

## Ошибки

Безопасные функции и CLI возвращают:

```json
{
  "ok": false,
  "error": {
    "code": "value",
    "path": "config.stations.0.inputBuffer",
    "objectId": "s1",
    "messages": {"ru": "Причина", "en": "Reason"}
  }
}
```

`path` и `objectId` могут быть `null`. Ошибка JSON имеет код `json`, чтения файла — `io`, неправильного вызова CLI — `usage`. Неизвестная внутренняя ошибка преобразуется в `internal` без stack trace. Частичный результат после ошибки не возвращается.

## CLI в репозитории

Сначала собрать пакет:

```sh
npm ci
npm run build:engine
```

Запуск из файла:

```sh
node packages/engine/dist/cli.js input.json > result.json
```

Чтение stdin:

```sh
cat input.json | node packages/engine/dist/cli.js - > result.json
cat input.json | node packages/engine/dist/cli.js > result.json
```

Успешный прогон возвращает код завершения 0. Ошибка данных, чтения или вызова — 1 и JSON с `ok: false` в stdout. При установленном npm-пакете та же команда доступна как `toc-engine [input.json|-]`.

`@toc/engine` сейчас является локальным npm workspace внутри репозитория. Пакет не опубликован в npm registry, поэтому обычная команда `npm install @toc/engine` из публичного registry пока недоступна. Любой может получить исходники, выполнить `npm ci && npm run build:engine` и использовать пакет локально. Для распространения архива можно отдельно выполнить `npm pack -w @toc/engine`; публикация в registry является следующей отдельной задачей.

## Сборка и разработка

- `npm run build:engine` — JavaScript ESM и декларации TypeScript в `packages/engine/dist`.
- `npm run test:engine` — сборка и независимые тесты пакета, включая реальные вызовы собранного CLI.
- `npm test` — сборка пакета и полный регрессионный набор приложения.
- `npm run dev` — предварительно собирает пакет, затем запускает Vite.
- `npm run build` — собирает пакет, проверяет типы приложения и создаёт один автономный HTML.

Старые предметные тесты движка остаются в `src/engine`: многие из них являются интеграционными и используют `Runner` и конфигурации UI. Они обращаются к исходникам пакета напрямую. Независимые проверки публичного API и CLI находятся в `packages/engine/src`. Приложение и `Runner` импортируют только `@toc/engine`.

## Проверка

Проверяются равенство фасада прежнему `Simulation.runToEnd()`, повторяемость, пошаговый и нерегулярный прогон, JSON round-trip, неизменяемость входа, независимость от представления, ошибки RU/EN, файл и stdin CLI, коды завершения и равенство CLI прямому вызову. Production-сборка UI и `check:dist` подтверждают, что выделение пакета не нарушило автономный HTML.
