# Независимая проверка packet 3: герои, подготовка боя и Telegram Back

Статус: итоговые три окна Ascend прошли Canvas360 и WebGL390→360 на одной compiled сборке после captured-body guard и исправления общей hit-area при resize. Production и отдельный сценарий нажатия во время анимации закрытия ещё ожидаются. Продуктовый код, тесты, ассеты и allowlist этим аудитом не изменялись.

Метод: приватный контекст Chromium, обычный Boot → Campaign и настоящие кнопки навигации. Telegram SDK имитирован с пустым initData; все внешние запросы и любые методы кроме GET/HEAD заблокированы. Ответ оригинального compiled bundle дополнен только наблюдателями Phaser Game/View. Сцены не запускаются принудительно; browser source imports и query-флаги не используются. Проверка ждёт успешный renderer postrender, camera postrender и завершение popInner анимаций.

UI stock fixture построен до Boot через публичные Node core API из законного сохранения 36/180 этапов. Увеличены запасы золота/опыта, добавлены копии и контракты, Alan-companion h1 повышен до purple, уровень 20. Campaign clears не изменены. Это проверка интерфейса, не дополнительное прохождение игры.

## Подтверждённые дефекты

| Окно и фактический вход | Проверка | Фактическое состояние |
| --- | --- | --- |
| Hero → Ascend → fodderSlot_0 → fodderPicker | Canvas 360×640, TG 136/34, wheel −180 | Body offset 300 → 120; picker остаётся открытым, exact save не изменён |
| То же, WebGL1 390×844 → реальный viewport resize 360×640 | Wheel +180 и touch +60 CSS над заголовком панели | Body offset 0 → 180 → 0; picker остаётся, exact save не изменён |
| Ascend → copySources → noticeModal «Где взять копии» | Canvas 360×640, wheel −180 над настоящим текстом окна | Body offset 150 → 0; окно остаётся, Back закрывает только notice, exact save не изменён |
| Ascend → AutoFodder → ascendConfirm → confirmModal | Canvas 360×640, wheel +180 над вопросом подтверждения | Body offset 0 → 180; выбранные h42/h41 сохраняются, Back отменяет только confirm, exact save не изменён |

Выбор копии BEFORE: original bundle `/assets/index-D_qI0UNK.js`, SHA256 `bfd10c912207c5cba4a71844a0a102251e91399710c57856905111d475ad5da1`. Notice/confirm proper BEFORE и первый AFTER выбора копии: `/assets/index-B2f1cJ4p.js`, SHA256 `607ea26d767f29dd0972686084da52eb1f80e810d50c46147609bdc7ade537cb`.

Первый captured-body fix выбора копии: Canvas360 — 18 checks PASS; WebGL390→360 — 19 checks PASS. Body max offset 415; wheel/touch сохраняют 300→300 и 0→0 соответственно; locked=true пока открыт picker, Back восстанавливает locked=false. В обоих случаях 0 ошибок и реальные postrender/camera heartbeats.

## Финальный unified guard: Canvas и новый resize-дефект

Compiled `index-DBPZONl-.js`, SHA256 `ddf15e5fa5110260cf14da20e99c4bbff3aeeec5445635064b984503016ec836`: proper advancing clock, normal RAF, все popInner стабильны. Canvas360×640/TG136/34 — 44 checks PASS, 15 snapshot phases; исходящие записи и source imports отсутствуют, ошибок 0. Picker и notice удерживают offset300, confirm offset0; native wheel и touch не меняют точное сохранение/выбранные копии. SDKBack закрывает каждое окно и возвращает locked=false после DESTROY. Два настоящих native mouse clicks создают ровно один confirm: created1/maxAlive1/final1, 14 наблюдавшихся кадров, без списания ресурсов.

Touch направлен внутрь доступного диапазона underlying body: при offset0 вверх, при offset>0 вниз. Для заголовка picker используется −20CSS, чтобы весь жест оставался внутри видимой панели. Это усиливает проверку: движение вниз при offset0 само по себе было бы ограничено началом списка и не доказывало бы блокировку.

WebGL390×844→360×640 честно остановлен на picker touch. Независимая geometry-проба подтвердила общую ошибку `bottomSheet.onViewChange`: фон перерисован на top852, заголовок worldY932, но существующая input.hitArea остаётся Rectangle `{x:-240,y:1308.4615384615386,width:1560,height:918}` из высоты uiH1866.46. После resize uiH1410 и world transform этой hit-area не меняются. Поэтому touch заголовка world932→872, полностью внутри видимой панели, попадает в shade и закрывает окно. Ascend guard при этом правильно сохраняет offset/save; это отдельный дефект геометрии shared screen.

Новый Canvas AFTER: `/tmp/night-packet3-triple-after-360-canvas/report.json`, adapter SHA256 `69c9c46487b7c7fb9e0fb73f140a930dc82629744aadd8a028dbd6ff54e498c1`. Exact stale-hit geometry: `/tmp/night-packet3-picker-hit-before-390-webgl/report.json`, snapshots до/после viewport resize с `modalHits`; это воспроизводимая ошибка, не PASS. Продуктовый fix поручен runtime владельцем репозитория.

## Итоговый compiled AFTER на обоих renderers

Оригинальный `/assets/index-B5Ril8ga.js`, SHA256 `6a5b9ee700e42fbd4eb778b4dece19f401c4560a4013acfb3537ea8ce4264bcb`. Source freeze: shared `screen.ts` SHA256 `a1773c9a391ad6ec89699122cd51d75f20d22213143166e625b66380eaf64881`, Ascend SHA256 `2719a740c319c9b29c03415f1d812284d6e69d3bd9096f599ca56da18634f57b`. Для обоих прогонов использован тот же неизменный adapter `6f2c2acf6c1ed60cb13156dceb006d253f3ab02979544fd1a774249f31208a9f`, proper advancing clock, настоящие camera/renderer postrender и обычная навигация.

| Реальный прогон | Checks / snapshot phases | Picker wheel/touch offset | Notice wheel/touch offset | Final confirm offset |
| --- | --- | --- | --- | --- |
| Canvas 360×640, TG136/34 | 44 / 15 PASS | 300 → 300 | 300 → 300 | 0 → 0 |
| WebGL1 390×844 → 360×640, TG136/34 | 45 / 17 PASS | 0 → 0 | 150 → 150 | 0 → 0 |

Во всех трёх окнах сохранение совпадает побайтно после wheel/touch/cancel. Confirm сохраняет выбранные h42/h41; SDKBack закрывает только нужный слой и возвращает body.locked=false после DESTROY. В обоих прогонах два реальных native mouse clicks создают ровно один confirm без перекрывающихся слоёв и списания ресурсов. Ошибок и browser source imports — 0; браузеры закрыты после каждого sequential прогона.

Ключевой AFTER resize: input Rectangle меняет y1308.4615 → 852 вместе с visual panel. Прежний жест worldY932 → 872 теперь остаётся внутри действующей hit-area и сохраняет открытый picker. Старый WebGL failure сохранён, его assertions не ослаблялись.

- Canvas raw: `/tmp/night-packet3-triple-final-360-canvas/report.json`, SHA256 `f06f39f4cdf0932a9d16beab7a6bfd70bf3fa9d333f8215bf07c7c81a8c82aa1`.
- WebGL raw: `/tmp/night-packet3-triple-final-390-webgl/report.json`, SHA256 `a8c1a5057e4eda30e5db899a867ae102968bee2b9def347f9409a22876dbfe7a`.
- Representative actual PNG: WebGL `ascend-picker-after-touch.png`, Canvas `ascend-confirm-after-touch.png` в соответствующих OUT.

Выборка сохранённых артефактов в репозитории: [папка packet3-native](../REPORTS/2026-10-05-packet3-native). Пять raw JSON сохраняют исходные байты: три proper-clock BEFORE (sources, confirm, shared picker resize hit-area) и оба итоговых triple AFTER. Также сохранены две BEFORE и две AFTER PNG; общая выборка 612945 байт. Historical picker-body BEFORE остаётся в исходном OUT, отмеченном ниже: это отдельная первая ошибка, не shared resize failure.

## Ограничения и недействительные попытки

Первые попытки helper остановились до нужной проверки: неверное имя Camera postrender event и выбор запасной копии, которую Heroes группирует вокруг companion. Они не считаются продуктовым PASS.

Проба WebGL390 с body max=0 не проверяла изоляцию прокрутки; её заменяет 390→360 с max=415. Swipe вне панели штатно закрывал backdrop; его не считают дефектом Back.

В ранних notice/confirm попытках Date.now был неподвижным. Это останавливало Phaser TweenManager: scroll-текст notice вне popInner оставался видимым, но панель ещё не завершила появление. Для итоговых notice/confirm BEFORE используются только повторы с Date.now = lawful clock + real elapsed и строгой проверкой ВСЕХ popInner на alpha1/scale1. Неподвижный clock используется лишь в сохранённом минимальном picker probe, где при reduced motion bottomSheet не анимируется; его реальные PNG проверены.

Физический iPhone/Safari не проверялся. Покрытие — настоящий Canvas и WebGL1 в Chromium, с имитацией Telegram safe-area SDK и приватными сохранениями.

## Временные воспроизводимые артефакты

- Неизменный минимальный picker probe: `/tmp/night-packet3-ascend-probe.mjs`, SHA256 `0c12f18903e23ff77a9779f217a0e092f86c5ded00953f58f922338706c54b4b`.
- Picker BEFORE: `/tmp/night-packet3-ascend-baseline-360-canvas-v3/report.json`, `/tmp/night-packet3-ascend-baseline-390-webgl-v3/report.json`.
- Первый picker AFTER: `/tmp/night-packet3-ascend-after-360-canvas/report.json`, `/tmp/night-packet3-ascend-after-390-webgl/report.json`.
- Notice proper BEFORE: `/tmp/night-packet3-ascend-sources-before-360-canvas-v3/report.json`.
- Confirm proper BEFORE: `/tmp/night-packet3-ascend-confirm-before-360-canvas-v2/report.json`.
- Новый автономный helper: `scripts/night-packet3-native-qa.mjs`, SHA256 `6f2c2acf6c1ed60cb13156dceb006d253f3ab02979544fd1a774249f31208a9f`; scopes `ascend`, `sources`, `confirm`, `triple`, `full`, `late`, bounded deadline 180 s. Он сохраняет точные байты своего adapter в каждом OUT. `full` и `late` пока подготовлены, но не считаются пройденными.

Пример воспроизведения proper triple на compiled preview (явно укажите текущий ROOT и пути fixture):

```sh
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
node scripts/night-packet3-native-qa.mjs \
  --root /workspace/chronoworld \
  --url http://127.0.0.1:5595/ \
  --scope triple --renderer webgl --width 390 --height 844 \
  --save docs/REPORTS/2026-10-05-night-adventure-modes/fixtures/lawful-36.save.json \
  --out /tmp/night-packet3-triple-repro
```

Вариант Canvas: `--renderer canvas --width 360 --height 640`. Node core API используются только для подготовки приватного stock fixture до Boot и расчёта ожидаемого результата контракта; браузер не импортирует исходники и не выполняет core actions через evaluate. Для production используется настроенный HTTPS_PROXY и доверенная CA, без отключения TLS-проверок; после публикации требуется `--bundle-sha` с точным хешем оригинальной production сборки. Каждый нерешённый assert, неверная сцена, отсутствие postrender или истечение deadline завершает helper с exit 1.

Production URL от владельца репозитория: `https://chronoworld-ecru.vercel.app`. Production проверка ещё не выполнена; localhost proof не заменяет проверку опубликованной сборки.
