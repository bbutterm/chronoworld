# Размеры текста и зоны нажатия после изменения ширины

Приёмка общей сборки до нового арта: 2 сценария × Canvas/WebGL1 — 4/4 PASS. Все четыре контекста закрыты. Новая графика и последующий Result metadata reflow имеют отдельную приёмку.

У `Text`, созданного через обычный `setInteractive()`, Phaser обновляет ширину и высоту автоматического Rectangle при перерисовке текста, сохраняя прежние `x/y`. После расширения зоны до 44 CSS px это оставляло старое отрицательное смещение и сдвигало её центр. Реальные такие элементы есть в `ResultScene`: находка и ссылка «Хватает опыта на новый уровень».

`responsiveUi` сбрасывает сохранённое расширение только у отслеживаемого автоматического Rectangle перед настоящим `Text.updateText`, затем снова применяет минимум. Это действует также после `setText` и изменения стиля. Объект Input, Rectangle, callback, состояние enabled и пользовательские прямоугольники сохраняются. Три проверки с поведением настоящего Phaser: до исправления 2 FAIL/1 PASS, после исправления 3 PASS.

Финальный локальный preview: bundle `index-aeWRfDQ3.js`, SHA256 `5f0f322c713807b33620b0cc4a91fcfc03afd154573ca37e7be5137d1cf3b6ad`. Исходники: `viewport.ts` SHA `fe0e7c70…`, `responsiveUi.ts` SHA `393b59a2…`, `screen.ts` SHA `dafd0e09…`, `ui.ts` SHA `2260e83c…`; полный снимок содержит 975 исходников.

Новый `scripts/night-auto-text-hit-ui-qa.cjs` создаёт сохранение публичными `newGame`, победой `actPlayStage` на первом этапе и наградой `actClaimOffline` за 12 часов. Он проходит обычный Boot → Кампания → этап → бой → итоги, колесом показывает реальную ссылку повышения уровня и меняет ширину 360 → 320 → 360. Проверяет минимум 12 CSS px для текста, 44 CSS px для зоны нажатия, центр прямоугольника, сохранение объектов Input/Text/Rectangle/callback и отсутствие записи в save или пересоздания сцены. Физическое нажатие на текст должно открыть «Герои».

`scripts/night-viewport-metrics-ui-qa.cjs` отдельно проверяет уменьшение анимации в настройках и подпись/кнопку вечера на тех же ширинах. Его финальный fixture — сохранение настоящего свежего полного прохождения из `docs/REPORTS/2026-10-05-night-final-root-campaign/raw/final-save.json.gz`; часы браузера идут штатно. Можно передать иной законный `.json`/`.json.gz` через `SAVE_FILE`. Перед подготовкой тихого UI-состояния и после неё кампания, ресурсы, валюта, герои, отряд и инвентарь совпадают.

На обеих системах рендеринга подпись вечера и реальный интерактивный Text результата сохраняют размеры 12 → 12,148 → 12 CSS px, высота зоны нажатия — 44 → 44,148 → 44 CSS px. Центр автоматической зоны результата не смещается. Сцены не пересоздаются, Text/Input/Rectangle/callback сохраняются, save и число записей остаются прежними. Физическое нажатие в обоих Result-контекстах открыло «Герои». Ошибок JavaScript, потерянных Frame.source и остановки postrender нет. В настройках уменьшенная анимация не создаёт tween для popInner; панель сразу имеет alpha/scale 1.

При просмотре PNG320 обнаружен отдельный дефект: «Первая победа» и подпись этапа не перерасполагались после роста шрифта. В ResultScene теперь пересобираются только дочерние элементы строки metadata, сохраняя её контейнер, body scroll и интерактивный Text результата. Callback снимается на DESTROY. В существующей scene fixture три новые проверки сначала дали 3 FAIL при 10 прежних PASS, после исправления — 13 PASS. Runtime SHA `273bbb92…`, до исправления `9c296280…`. Короткая native приёмка 320 → 360 на финальной сборке с новым артом ожидает её готовности; отчёты 4/4 выше относятся строго к исходному aeWR bundle.

Сырые отчёты, снимки320 и точные SHA: [summary.json](../REPORTS/2026-10-05-night-font-touch-final/summary.json). PNG каждого сценария в Canvas и WebGL1 просмотрены; finding строки metadata сохранён в истории приёмки.

Запуск из корня репозитория на локальной сборке:

```sh
URL=http://127.0.0.1:5599/ MODE=canvas OUT=/tmp/viewport-canvas node scripts/night-viewport-metrics-ui-qa.cjs
URL=http://127.0.0.1:5599/ MODE=webgl1 OUT=/tmp/viewport-webgl1 node scripts/night-viewport-metrics-ui-qa.cjs
URL=http://127.0.0.1:5599/ MODES=canvas,webgl1 OUT=/tmp/result-auto-text node scripts/night-auto-text-hit-ui-qa.cjs
```

Для установленного вне репозитория Playwright используется `PLAYWRIGHT_MODULE`, для браузера — `CHROME_EXECUTABLE_PATH`. Контексты изолированы, разрешены только локальные GET/HEAD. Browser получает compiled bundle с двумя диагностическими ссылками на game/view; импорта исходников, принудительной смены сцен, query-флагов и изменения Date/RAF нет. Canvas и WebGL1 выполняются последовательно.

Исторический SOURCE4 отчёт в `viewport-metrics-acceptance.md` сохраняет свою прежнюю сборку и UI fixture. Он не заменяет финальную приёмку общей сборки.


## Финальная сборка с новым артом — PASS
Один native Canvas-контекст320 → 360 завершён и закрыт на `index-BPki5j24.js`, SHA `98bf58903ae72dd2200f6710bf995401d3a64910f5e52b5a587cf5249ffdf7c5`. Реальный glyph gap32world =9,481/10,667 CSS px; плашка вмещает текст. Metadata container, Text/Input/Rectangle/callback, scene/save/writecount сохранены, create0. Физическое нажатие открывает «Герои», errors/Frame.source0; PNG320/360 просмотрены. Root fullcheck2374Vitest+3Node/UI-lint/build GREEN. [Отдельный финальный отчёт](result-meta-final-art-acceptance.md) и [точные новые raw/PNG/SHA](../REPORTS/2026-10-05-night-result-meta-final-art/READY.json). Исторический aeWR2×2 не перепакован и остаётся на своём bundle.
