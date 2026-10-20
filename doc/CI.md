# CI и GitHub Pages

Инфраструктурная задача № 25 от 2026-10-20. Разработка № 19 не начата. Пользователь явно поручил добавить CI и сразу включить публикацию Pages.

Текущая ветка с 2026-10-21: master, по поручению пользователя в № 34. Workflow и разрешённая ветка среды github-pages переведены на master. Старые записи о первых запусках main ниже являются историческими.

## Workflow

`.github/workflows/ci-pages.yml` запускается на push в master, pull request в master и вручную. Job check устанавливает Node.js из .nvmrc и npm 12.1.0, выполняет npm ci и npm run ci. Последняя команда включает все тесты, строгий TypeScript через build, production-сборку и проверку автономного артефакта.

`tools/check-dist.mjs` проверяет, что в dist только index.html, JS/CSS встроены и нет внешних script, stylesheet/modulepreload и CSS-import. Скрипт выводит размер и SHA-256. Это проверка упаковки, не замена браузерной приёмки всех runtime-путей. Для локального запуска доступны npm run ci и npm run check:dist.

Успешный master загружает только dist как Pages-артефакт. Отдельный deploy-job зависит от check и публикует именно проверенный артефакт. Pull request не публикуется. Build имеет contents: read, deploy дополнительно pages: write и id-token: write. Постоянный токен и отдельная ветка с dist не нужны. Checkout не сохраняет Git credentials. Рабочие master-деплои не отменяются новым push; устаревшие PR-проверки могут отменяться.

Официальные actions закреплены по проверенным SHA: checkout v7.0.1, setup-node v7.1.0, configure-pages v6.0.0, upload-pages-artifact v5.0.0 и deploy-pages v5.0.1. Версии получены из GitHub API перед настройкой. Конфигурация следует [официальной документации custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) и [Pages API](https://docs.github.com/en/rest/pages/pages).

## Публикация

Работающий сайт: [yafarkin.github.io/tocsim](https://yafarkin.github.io/tocsim/). Репозиторий публичный. Pages использует build_type workflow. Публикуется только автономный HTML приложения, не исходники, история Git, документация или node_modules. Vite base остаётся относительным, поэтому тот же файл работает в подкаталоге Pages и локально.

После включения успешный push master автоматически обновляет сайт. С 2026-10-21 пользователь постоянно разрешил немедленный push после каждой завершённой и проверенной задачи и коммита; он включает автоматическую публикацию. Ручной workflow_dispatch на master выполняет те же проверки и деплой.

## Проверки

До первой отправки выполнены чистая установка из lock-файла через локальный кеш и npm run ci: 244 теста, TypeScript, production-сборка и check-dist. Workflow YAML разобран, проверены зависимости jobs и точные SHA. Артефакт 301 809 байт, SHA-256 b20eb421165e97cd9c9fafa48fda744678b3bed6791f38824c22deb2c0272265.

Первый [запуск Actions 39471152621](https://github.com/yafarkin/tocsim/actions/runs/39471152621) для коммита 89d402e завершился success: check и deploy прошли. Сайт вернул HTTP 200 по HTTPS, опубликованный HTML побайтно совпал с локальным dist/index.html и указанной SHA-256. Pages настроена через workflow, HTTPS enforced включён. Код приложения не менялся, № 19 не начиналась.

Финальный документальный коммит 9df04dc также прошёл [CI и deploy 39471470686](https://github.com/yafarkin/tocsim/actions/runs/39471470686). При последующем bfe этот success подтверждён повторно. Сам bfe сохранён локально без push и не запускает новую публикацию.

Переход № 34 от 2026-10-21 завершён: единственная удалённая ветка master, GitHub default master, origin/HEAD → origin/master. Коммит 3c75ebe прошёл [CI и Pages 39507562430](https://github.com/yafarkin/tocsim/actions/runs/39507562430). Прежняя master 4e2fdcc и main 7f00cef проверены через merge-base --is-ancestor и входят в новую master; force push и переписывание истории не применялись. Среда github-pages разрешает только master. Код незавершённой на тот момент № 28 в этот push не входил.

Задача № 28, коммит c7c3bcd, прошла [CI и Pages 39509369843](https://github.com/yafarkin/tocsim/actions/runs/39509369843). Начиная с № 29 действует постоянное поручение пользователя сразу выполнять push после завершения задачи и английского коммита, затем проверять CI/Pages. Отдельный вопрос на каждый push не требуется.

При bfe № 40 повторно подтверждены success запусков [39512217929](https://github.com/yafarkin/tocsim/actions/runs/39512217929) для 519719d и [39512575697](https://github.com/yafarkin/tocsim/actions/runs/39512575697) для 3a14868. Последний проверяет 295 тестов, типы и автономный HTML. Bfe меняет только документы и тоже отправляется по постоянному поручению; результат нового CI/Pages проверяется перед завершением. № 30 не начата.
