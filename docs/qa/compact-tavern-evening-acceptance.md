# Компактные «Вечера в таверне» — приёмка 05.10.2026

«Вечера» сохраняют ширину интерфейса при Telegram safeTop 136 / safeBottom 34 на 360×640: рабочая высота 1410, текст не меньше 12 CSS px, действия не меньше 44 CSS px. Хаб, реплика, ответы, итог близости, инструкция и результат личного задания имеют отдельные полосы прокрутки. Нижние действия закреплены, маски остаются в координатах мира после popIn. Resize не перезапускает сцену и не повторяет выбор, бой, награду или близость.

## Исправления

- Первое «i» целиком находится внутри scroll-маски и отделено от «Слушать».
- Длинная реплика и последний ответ доступны без уменьшения шрифта; переход к выбору сбрасывает offset реплики.
- Drag по завершённой реплике отменяет advance. До исправления реальный drag на 90 CSS px пропускал её; обычный тап продолжает работать.
- SDK Back после Go отменяет ещё не начавшийся queued бой с задержкой 30 ms. До исправления закрытое окно всё равно запускало Battle; повторное открытие и настоящий Go работают.
- Пересмотр завершённого вечера/личной сцены не выполняет лишний commit. Done результата задания не повторяет расчёт награды.
- Превью нового вечера и итог близости используют публичный контракт утверждённого Chapter7 candidate: eveningSquadHeroes(save, eveningId, GAME). Current squad по-прежнему определяет действующие связки и доступность личного задания.

## Совместимость и честная область доказательства

Chapter7 candidate здесь был зеркалирован read-only по четырём точным SHA утверждённого manifest; в пакет интерфейса ядро не входит. Это не заявление о его публикации. Combined проверка после root integration обязательна.

Законный checkpoint до первой победы главы 1 играет public actPlayStage(ch1_s10, seed20); затем public setSquad меняет состав на запасную Лиру. Превью и finishEvening сохраняют участников победы: Алан, Бран, Вика, Дорн, Кай. Для legacy без optional snapshot начисление сохраняет прежнее правило и идёт Лире. Явный snapshot [] не превращается в legacy и не начисляет близость. Пересмотр не начисляет второй раз.

Другие fixtures проверяют интерфейс: canonical cleared set, public finishEvening/chooseOption, starter stats и тихие состояния прочитанных страниц/уведомлений. Они не доказывают самостоятельное игровое прохождение. Все saves находятся в частном локальном browser context; production и cloud writes запрещены harness.

## Фактическая проверка

- Первый холодный переход Home→classic Chronicle→лениво зарегистрированный TavernEvening получает новую геометрию до create. Предполагаемая ошибка порядка подготовки viewport не воспроизвелась; новый viewport hook не добавлен.
- DEV Canvas 360: captured/legacy/explicit-empty — 45 состояний, 27 native taps, 0 runtime errors; preview, начисление, resize, replay и SDK Back прошли.
- Focused четыре набора: 44 теста PASS; tsc и production build PASS.
- Финальная compiled приёмка без compact=1: Canvas 360×640 и WebGL1 390×844, по пять профилей first/late/captured/legacy/empty. Десять принятых контекстов дали 174 состояния и 142 native taps, без runtime errors и уничтоженных texture sources. Переходы Chronicle↔Evening и Evening↔Battle выполнены настоящими кнопками; native resize сохраняет scene/create, save и очередь реплик.
- Старый полный Canvas отчёт сохранён с passed=false: последний empty-case проверил высоту до обновления браузерного viewport. В harness фиксированные 450 ms заменены ожиданием совпадения native window.innerHeight и вычисленной view.uiHeight; продуктовые файлы не менялись. Отдельный свежий empty-case прошёл все 15 состояний. Остальные четыре Canvas профиля и все пять WebGL профилей прошли исходные assertions.

Compiled bundle index-CBJcwC1d.js: SHA-256 365449e43c18fa06430c2c6e39a0180363b68801de51ec198b3ce319b439e1c4.
Продуктовые SHA-256: TavernEveningScene.ts — e0afaec567f510ff13611ecbbd4c1eaa24e797b2550b8da0377718d1aa393ac0; compactEveningLayout.ts — ccf3826990f0a8a1c101026796e49ab4464c7639d3f0bfa41214e00fa10be121.

Эти browser proofs используют shared screen.ts ce8df5071c956e83d8059558efd90b5e500d1589c55b740b054d1002b5159094 и частную policy только уже подготовленных сцен. Последующее исправление bottomSheet hitArea a177 проверяется отдельно; общая приёмка после интеграции полного пакета ещё нужна. Матрица не утверждает компактность прежних classic Chronicle и Battle.

Сырые отчёты находятся в /tmp/night-ui-runtime/evening-final-compiled-canvas/report.json, evening-final-compiled-canvas-empty/report.json и evening-final-compiled-webgl/report.json. Финальная сводка /tmp/night-ui-runtime/evening-final-summary.json содержит точные зависимости, hashes и выбранные успешные контексты; исходный failed context из неё не удалён.

## Повторение

После интеграции Chapter7 fixture уже находится в репозитории. Для candidate proof можно передать EVENING_PREWIN_FIXTURE с путём до утверждённого checkpoint.

```sh
URL=http://127.0.0.1:5516/ MODES=canvas SIZES=360x640 \
PROFILES=first,late,captured,legacy,empty \
PLAYWRIGHT_MODULE=/path/to/already/installed/playwright \
CHROME_EXECUTABLE_PATH=/usr/bin/chromium OUT=/tmp/evening-qa \
node scripts/night-evening-compact-ui-qa.cjs
```

URL должен быть локальным. Harness инструментирует только ответ compiled bundle в собственном browser context, чтобы наблюдать game/view; dist, сервер и ядро не меняются. Для classic↔compact переходов используются реальные кнопки. SDK mock не содержит initData и не подключается к внешнему API.

## Передача

Пакет: TavernEveningScene.ts, compactEveningLayout.ts, compact-evening-layout.test.ts, night-evening-compact-ui-qa.cjs и этот документ. Read-only core mirrors, чужие сцены, shared foundation и private allowlist исключены. Production policy добавляется отдельно только вместе с source integration.
