# CI и GitHub Pages

Инфраструктурная задача № 25 от 2026-10-20. Разработка № 19 не начата. Пользователь явно поручил добавить CI и сразу включить публикацию Pages.

## Workflow

`.github/workflows/ci-pages.yml` запускается на push в main, pull request в main и вручную. Job check устанавливает Node.js из .nvmrc и npm 12.1.0, выполняет npm ci и npm run ci. Последняя команда включает все тесты, строгий TypeScript через build, production-сборку и проверку автономного артефакта.

`tools/check-dist.mjs` проверяет, что в dist только index.html, JS/CSS встроены и нет внешних script, stylesheet/modulepreload и CSS-import. Скрипт выводит размер и SHA-256. Это проверка упаковки, не замена браузерной приёмки всех runtime-путей. Для локального запуска доступны npm run ci и npm run check:dist.

Успешный main загружает только dist как Pages-артефакт. Отдельный deploy-job зависит от check и публикует именно проверенный артефакт. Pull request не публикуется. Build имеет contents: read, deploy дополнительно pages: write и id-token: write. Постоянный токен и отдельная ветка с dist не нужны. Checkout не сохраняет Git credentials. Рабочие main-деплои не отменяются новым push; устаревшие PR-проверки могут отменяться.

Официальные actions закреплены по проверенным SHA: checkout v7.0.1, setup-node v7.1.0, configure-pages v6.0.0, upload-pages-artifact v5.0.0 и deploy-pages v5.0.1. Версии получены из GitHub API перед настройкой. Конфигурация следует [официальной документации custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) и [Pages API](https://docs.github.com/en/rest/pages/pages).

## Публикация

Работающий сайт: [yafarkin.github.io/tocsim](https://yafarkin.github.io/tocsim/). Репозиторий публичный. Pages использует build_type workflow. Публикуется только автономный HTML приложения, не исходники, история Git, документация или node_modules. Vite base остаётся относительным, поэтому тот же файл работает в подкаталоге Pages и локально.

После включения успешный push main автоматически обновляет сайт. Сам по себе локальный коммит по-прежнему не разрешает push; но разрешённый push main теперь включает предусмотренную автоматическую публикацию. Ручной workflow_dispatch на main выполняет те же проверки и деплой.

## Проверки

До первой отправки выполнены чистая установка из lock-файла через локальный кеш и npm run ci: 244 теста, TypeScript, production-сборка и check-dist. Workflow YAML разобран, проверены зависимости jobs и точные SHA. Артефакт 301 809 байт, SHA-256 b20eb421165e97cd9c9fafa48fda744678b3bed6791f38824c22deb2c0272265.

Первый [запуск Actions 39471152621](https://github.com/yafarkin/tocsim/actions/runs/39471152621) для коммита 89d402e завершился success: check и deploy прошли. Сайт вернул HTTP 200 по HTTPS, опубликованный HTML побайтно совпал с локальным dist/index.html и указанной SHA-256. Pages настроена через workflow, HTTPS enforced включён. Код приложения не менялся, № 19 не начиналась.
