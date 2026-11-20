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

## Общий JSON-файл процесса

Веб экспортирует объект `toc-process` со следующими полями.

| Поле | Содержимое |
| --- | --- |
| `format` | Строка `toc-process`. |
| `schemaVersion` | Версия файла, число `3`. |
| `config` | Поля `EditorConfig` версии 1. Цвета материалов и порядок отображения записываются в `web`. |
| `web` | Необязательный объект. `layout.positions` содержит координаты узлов, `displayOrder` содержит порядок ID, а `materialColors` хранит цвета по ID материалов. |

CLI читает этот же файл в обычном режиме и с `--bottleneck`. Оба режима используют `config` для расчёта и пропускают `web`. Веб проверяет настройки отображения при импорте. Если раскладка отсутствует, веб размещает узлы автоматически.

Веб и CLI также читают старые оболочки `toc-process` версий 1 и 2 и исходный `EditorConfig` в корне JSON. Функции `runSimulationJson` и `searchBottleneckJson` используют тот же разбор. Объектные функции `compileConfig` и `runSimulation` принимают прежний `EditorConfig`.

С № 174 «Мои процессы» проверяют конфигурацию по правилам движка. Для моделей за пределами возможностей форм веб открывает редактор JSON. Импорт и экспорт файлов в браузере ограничены 2 МиБ.

### Источники, запасы и горизонт

Один процесс может содержать несколько записей в `config.sources`. У каждой записи есть свой материал `materialId`, количество за попытку поставки `quantity` и интервал `intervalMs` в рабочих миллисекундах. `quantity` задаётся десятичной строкой, например `"4"`. Получателей материала задают связи в `config.routes`.

| `availability` | Откуда поступает сырьё |
| --- | --- |
| `"virtual"` | Источник может подавать сырьё весь прогон. Поставки идут по расписанию в пределах свободного места в буфере. |
| `"warehouse"` | Источник берёт сырьё из начального запаса. В `config.initialStocks` задайте `ownerId: "warehouse"`, `location: "warehouse"`, тот же `materialId`, количество и полную стоимость партии. |

Источники одного материала используют один режим доступности. Если у материала несколько конечных источников, они расходуют один общий запас. В пределах одной модели можно сочетать конечные и неограниченные источники разных материалов. Начальный запас поста задаётся его ID и местом хранения `input` или `output`. [Поля источника](../packages/engine/src/contract/input/SourceConfig.ts), [поля запаса](../packages/engine/src/contract/input/InitialStockConfig.ts).

Обычный прогон заканчивается в момент `config.durationMs`. Это календарное время от начала первой смены до конца последней. Например, для одной смены с 08:00 до 17:00 укажите `32400000`, включая обед. Если конечный склад опустеет раньше, поставки с него прекратятся, а посты смогут доработать остатки до конца горизонта. То же правило действует при неограниченном сырье.

Для повторяемого прогона укажите `config.seed`. Необязательное поле `config.warmupMs` задаёт начало окна измерения в миллисекундах от начала прогона. Эти параметры задаются в файле процесса.

### Готовый пример сборки

Сохраните пример как `assembly.json`. Его можно открыть в «Моих процессах» или передать в CLI. На стол расходуются одна столешница и четыре ножки. Столешницы поступают весь прогон, а 40 ножек со склада дают ровно 10 столов. `web` в примере задаёт цвета для схемы.

```json
{
  "format": "toc-process",
  "schemaVersion": 3,
  "config": {
    "schemaVersion": 1,
    "id": "table-assembly",
    "name": "Сборка столов",
    "language": "ru",
    "seed": 42,
    "durationMs": 32400000,
    "policy": "push",
    "calendar": {
      "shiftStartMs": 28800000, "lunchStartMs": 43200000,
      "lunchEndMs": 46800000, "shiftEndMs": 61200000
    },
    "materials": [
      {"id": "top", "name": "Столешница", "role": "raw", "purchasePrice": "0"},
      {"id": "leg", "name": "Ножка", "role": "raw", "purchasePrice": "0"},
      {"id": "table", "name": "Стол", "role": "finished", "salePrice": "0"}
    ],
    "recipes": [{
      "id": "table-recipe", "name": "Собрать стол", "kind": "production",
      "inputs": [{"materialId": "top", "quantity": "1"}, {"materialId": "leg", "quantity": "4"}],
      "output": {"materialId": "table", "quantity": "1"}
    }],
    "stations": [{
      "id": "assembly", "name": "Сборка", "priority": 0,
      "plan": [{
        "id": "assembly-plan", "recipeId": "table-recipe", "batches": 1,
        "processing": {"mode": "sequential", "repetitions": 1, "timeMs": 180000, "cv": 0}
      }],
      "inputBuffer": {"kind": "quantity", "quantity": "4"},
      "outputBuffer": {"kind": "quantity", "quantity": "0"},
      "setupMs": 0, "maintenance": {"enabled": false}, "lunchReplacement": false,
      "costs": {"perShift": "0", "perLunchHour": "0", "capital": "0"}
    }],
    "sources": [
      {"id": "top-source", "name": "Столешницы", "materialId": "top", "availability": "virtual", "quantity": "1", "intervalMs": 180000},
      {"id": "leg-source", "name": "Ножки со склада", "materialId": "leg", "availability": "warehouse", "quantity": "4", "intervalMs": 180000}
    ],
    "routes": [
      {"id": "top-route", "fromId": "top-source", "toId": "assembly", "materialId": "top"},
      {"id": "leg-route", "fromId": "leg-source", "toId": "assembly", "materialId": "leg"},
      {"id": "table-route", "fromId": "assembly", "toId": "market", "materialId": "table"}
    ],
    "initialStocks": [
      {"id": "leg-stock", "ownerId": "warehouse", "location": "warehouse", "materialId": "leg", "quantity": "40", "cost": "0"}
    ]
  },
  "web": {"materialColors": {"top": "#357dad", "leg": "#a46a29", "table": "#247e70"}}
}
```

В примере входной буфер вмещает до четырёх единиц каждого материала. Для отдельных лимитов укажите `inputBuffer.kind: "materials"` и перечислите ёмкость каждого входного материала. Такие настройки работают в CLI и в вебе, где их можно задать через JSON. [Контракт буфера](../packages/engine/src/contract/input/buffers/MaterialBuffersConfig.ts).

В результате прогона проверьте `result.reports.flow.products[0].delivered`. Значение `"10000000"` означает 10 столов, поскольку поле хранит количество в миллионных долях единицы. В `result.snapshot.line.termination` будет `"horizon"`.

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

Для общего JSON-файла достаточно передать путь к файлу или его содержимое через stdin. В задачах № 173, 174 и 175 новых флагов CLI не появилось. Изменился вход: CLI принимает файл, который экспортирует веб. Поля источников, запасов и горизонта уже были частью модели. В обычном режиме выполняется один прогон, а единственный флаг `--bottleneck` запускает поиск узкого места. Режимы завершения заказа, серий экспериментов и поиска по сроку пока запланированы. [Задачи № 169, 170 и 171](../tasks.md#задача-169-точное-измерение-завершения-заказа-в-движке-и-cli).

Сначала собрать пакет:

```sh
npm ci
npm run build:engine
```

Запуск из файла:

```sh
node packages/engine/dist/cli.js assembly.json > result.json
node packages/engine/dist/cli.js --bottleneck assembly.json > bottleneck.json
```

Чтение stdin:

```sh
node packages/engine/dist/cli.js - < assembly.json > result.json
node packages/engine/dist/cli.js < assembly.json > result.json
```

Успешный прогон возвращает код завершения 0. При ошибке данных, чтения или вызова CLI возвращает код 1 и JSON с `ok: false` в stdout. Команда установленного пакета имеет вид `toc-engine [--bottleneck] [input.json|-]`.

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

## Поиск узкого места, задача № 166

Движок экспортирует `searchBottleneck(run, options?)` для проверенного `RunConfig` и `searchBottleneckJson(json)` для JSON-файла процесса. Веб и CLI используют одну реализацию в [bottleneck-search.ts](../packages/engine/src/bottleneck-search.ts). Прежний модуль в Runner удалён.

```sh
node packages/engine/dist/cli.js --bottleneck input.json > bottleneck.json
cat input.json | node packages/engine/dist/cli.js --bottleneck - > bottleneck.json
```

Без `--bottleneck` CLI выполняет прежний полный прогон. В режиме поиска результат имеет вид `{ok: true, result: BottleneckResult}`; ошибки, коды завершения, файл и stdin работают как в режиме прогона. В stdout попадает только JSON. Неизвестные флаги отклоняются как `usage`.

```ts
import {compileConfig, searchBottleneck, searchBottleneckJson} from '@toc/engine';
const result = await searchBottleneck(compileConfig(configuration));
const response = await searchBottleneckJson(jsonText);
```

Контракт описан в [contract/search](../packages/engine/src/contract/search). `stationIds` содержит одного кандидата или равную лучшую группу. `outcome` принимает `candidate`, `tied`, `ambiguous` или `noGain`. В samples сохраняются базовый выпуск и результаты ускорения каждого поста. Количества записаны строками целых миллионных долей единицы в порядке `productIds`.

Алгоритм сокращает время обработки каждого поста на 10%, фиксирует физические буферы и сравнивает проданный выпуск по каждому продукту отдельно. Для случайной обработки или качества используются три парных seed, для детерминированной модели один. Это кандидаты на заданном горизонте, а не доказательство точного критического пути. Начальная конфигурация и текущий Runner не меняются.

Веб передаёт `cancelled` и `onProgress`; поиск отдаёт управление через `yieldTurn`, по умолчанию таймер. Отмена возвращает `null` без частичного результата. JSON API выполняет полный поиск без таймерных задержек. Новые настройки модели и изменения существующих JSON-форматов не требуются.
