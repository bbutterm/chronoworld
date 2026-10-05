# Холодная загрузка: ночной аудит 04→05.10.2026

Проверен зафиксированный исходный код root после комбинированного `npm run check` (197 файлов, 2153 Vitest + 3 Node-теста), затем отдельный Boot fix. Рабочая копия аудита — `codex/night-cold-load`, база `cb9346b`; изменения root скопированы для отдельной production-сборки. Арт, реестры, raw, данные игры и RNG в этом пакете не менялись. Метрики относятся к этому snapshot, до следующего пакета data2/shared-header; fingerprint находится в `summary.json`.

## Что измерено

`vite build` → `vite preview`, Chromium 360×640 @2, SwiftShader. CDP: CPU ×4, Fast 3G (562,5 мс, 180 000 Б/с вниз). Один диагностический cold и один warm; параллельно root выполнял e2e главы 1, поэтому их длительности **не являются изолированным benchmark** и не используются как обещание ускорения. Это браузерная эмуляция, не измерение FPS/памяти физического iPhone.

Реальные HTTP-заголовки подтверждают gzip для JS. Полный raw index — 2 926 464 байт; фактический холодный HTTP transfer index с заголовками — 773 634; Phaser — 247 568; WebP boot pack — 477 862. Тёплый визит использует cache для этих хэшированных пакетов. Персональные портреты повторно валидируются по сети (304).

Сырые диагностические отметки: cold FCP/boot/home и warm доступны в JSON. `cw:home` — первый кадр Campaign после `create()`, а не завершение всех фоновых загрузок. Загрузка фона, листов отряда и потоковой музыки начинается при открытии Campaign; нельзя приравнивать «ресурсы, завершившиеся до home» ко всему сетевому трафику запуска.

## Подтверждённая лишняя работа

Стартовый pack содержит три личных портрета новой игры:

| Файл | PNG | WebP внутри pack |
| --- | ---: | ---: |
| `hero_alan_first_profession_detail_v1` | 6561 | 2380 |
| `hero_bran_first_profession_detail_v1` | 6324 | 2270 |
| `hero_vika_acolyte_details_v2` | 5411 | 1832 |

`BootScene.queueAll` ставит только портреты `CONTENT.jobs/units`. При `create()` Blob URLs pack отзываются; `requestPortrait` снова загружает каждый личный файл через `assetUrl`. Общая `portraitChain` делает запросы последовательными. На warm Fast 3G каждый из трёх 304 занимает около 0,58 с. Cold диагностический запуск открыл Campaign через резервный таймер 4 с, пока второй/третий портрет ещё грузились.

**Исправлено:** уникальные `heroSprite` фактического `session.save.heroes` добавлены к портретам `queueAll`, пока Blob URLs живы. Личные портреты доступны к `create()`; им сохраняется прежний NEAREST-фильтр (быстрый `exists` теперь обходит `ensurePortraitFile`, где фильтр ставился раньше). Фоновые листы остаются ленивыми; fallback сохранён. Единственный production-файл — `src/game/scenes/BootScene.ts`.

В отдельном cold context с `Network.setCacheDisabled=true` до исправления идут три 200, после — **0 внешних личных portrait HTTP**. В отдельном warm context до — 304/304/200 в этом sample, после — 0. Все три textures существуют с NEAREST=1. Boot pack сохраняет прежний хэш/477 499 байт; index вырос на 197 байт.

Законный pre-final-boss snapshot seed 2 загружен без подмены прогресса: 52 героя, 238 предметов, 179 cleared stages, время из clock sidecar. Все 25 уникальных own portrait IDs, включая адвансы и героев вне отряда, готовы с NEAREST=1; личных portrait HTTP нет. Отдельный fault context получает преднамеренный 404 boot pack и портрета Вики: загрузка по файлам и вырезание из настоящего листа работают, Campaign открыт, unexpected errors=0. Ожидаемые 404/предупреждения явно сохранены.

## Изолированный CPU ×4

Все четыре UI/RPG агента подтвердили отсутствие активных browsers/tests/build/sims; root выполнял только remote API. Окно 23:36:31–23:37:53 UTC (82 с). Отдельные before/after production builds, одинаковый Phaser и boot pack. По три fresh cold + три warm; CPU ×4, сеть `none`, SwiftShader, без CPU sampler, heap query и screenshots во время timing.

| Метрика, медиана 3 | До | После |
| --- | ---: | ---: |
| Cold первый кадр Boot | 1,598 с | 1,610 с |
| Cold Campaign (`cw:home`) | 4,288 с | **4,034 с** |
| Warm первый кадр Boot | 1,327 с | 1,225 с |
| Warm Campaign | 3,859 с | **3,317 с** |
| Внешние own portrait HTTP в каждом sample | 3 | **0** |

Cold home улучшился в этом замере на 5,9%, warm — на 14,1%. Raw cold samples: до 6,713/4,288/4,152 с; после 5,551/4,034/3,995 с — первый запуск шумнее, все значения сохранены. Error count=0 во всех 12 samples. Эти результаты показывают поведение web build в данном окружении, не FPS физического iPhone и не гарантию времени production-сети.

## Размеры: разные бюджеты

| Область | Фактический размер |
| --- | ---: |
| Доставляемые sheets/portraits `assets/sprites` + compact registry | **6 337 211** |
| Неизменённый бюджет `tools/check_sprites.py` | **3 000 000** |
| Compact runtime registry | 66 128 |
| 322 файла PNG boot pack | 911 986 |
| Те же файлы WebP/PNG boot pack | 477 499 |

В full delivered payload учтены 324 PNG с фактически свежими WebP из новой `dist`. Это накопленный долг всех доступных спрайтов, а не размер первой загрузки: lazy-loading уменьшает холодный старт, но не делает 6,3 МБ меньше порога 3 МБ. Порог не поднят; новые изображения/перекодирование/удаление здесь не выполнялись.

Rolldown module accounting показывает крупные источники index: production `src/game/content.ts`, код всех сцен/эффектов/интерфейса, затем метаданные, ядро и Zod. `renderedLength` модулей относится к промежуточному коду перед финальной минификацией; сумма не равна размеру minified index. Runtime registry/provenance не являются мегабайтным основным источником: provenance не доставляется в JS.

## Память после Campaign

Через CDP найден фактический production `Phaser.Game`, без dev-export и без изменения игры. После `cw:home`, 500 мс и GC: JS heap 14,2–14,6 МБ; уникальные texture sources ~27,8–32,4 МБ (`width × height × 4`, aliases дедуплицированы). Это оценка uncompressed RGBA, не показание реальной GPU RAM. Время завершения фоновых запросов отличается, поэтому два снимка не считаются утечкой.

Крупные sources: общий `skin_atlas` 4 112 384 байт; generated forest и battle backgrounds по 3 686 400; victory/defeat banners по 1 080 000; `boot_bg` 1 029 600 продолжает храниться после выхода из Boot. Для выбора следующего изменения нужен изолированный CPU-профиль. Прежде чем освобождать текстуру, следует проверить отсутствие живых владельцев — именно эта ошибка ломала Adventures в предыдущем проходе.

## Воспроизведение и следующий замер

Сборка из отдельной копии root:

```sh
node node_modules/vite/bin/vite.js build
```

Существующий немодифицированный benchmark поддерживает окружение текущего контейнера:

```sh
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
LOAD_SKIP_BUILD=1 LOAD_PORT=5198 LOAD_CPU=4 LOAD_NET=none LOAD_RUNS=3 \
LOAD_JSON=/tmp/chronoworld-cold-load-audit/isolated-none.json \
node scripts/perf-load.mjs
```

Read-only CDP probe сохранён в `docs/REPORTS/2026-10-05-night-load/profile.mjs`; `AUDIT_CPU`, `AUDIT_NET`, `AUDIT_RUNS`, `AUDIT_DIST` выбирают профиль/сборку, `AUDIT_DETAILS=0` отключает post-home memory/screenshot для timing. `AUDIT_FAIL_PACK=1` и `AUDIT_FAIL_PORTRAIT=hero_vika_acolyte_details_v2` воспроизводят fault case. `AUDIT_SAVE` + `AUDIT_NOW=1792645536853` дают законный late-save. В private `/tmp/chronoworld-cold-load-audit` остаются полные raw JSON, screenshots, build logs и module accounting. Playwright/Chromium уже установлены; установки не выполнялись.

Перед передачей: targeted Vitest 3 файла/11 tests PASS, typecheck PASS, production build PASS; before/after network, late и fault proofs PASS. Новый regression проверяет фактические Boot.preload/pack URL rewrite/create, unknown hero sanitization, advanced/off-squad, shared job/private ID и повторные копии, dev/no-pack и failed-pack. Полный root check обязателен перед коммитом нового пакета; child коммитов/публикаций нет. Точный список файлов и hashes — `docs/REPORTS/2026-10-05-night-load/READY.json`.
