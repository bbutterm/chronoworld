# Читаемость и цели нажатия при изменении ширины

Проверка использует настоящий браузер, обычные часы и физические касания. Сохранение и Telegram SDK изолированы
в локальном browser context. Запросы вне локального origin и все запросы, кроме GET/HEAD, блокируются.
Компилированный bundle получает только приватные диагностические `__game`/`__view`; исходники в браузер не импортируются.

На телефоне с безопасными отступами 136/34 переход 360→320→360 сохранял уже созданный шрифт счётчика36world
и цель «Пропустить»132world. При ширине320 это давало 10,667CSSpx и39,111CSSpx. Отчёт BEFORE сохранён
в `/tmp/night-ui-runtime/foundation-before-360-320/report.json`; он намеренно имеет `passed=false`.

`responsiveUi` хранит запрошенный размер отдельно от временного минимума. При изменении вьюпорта существующий
Text получает тот же минимум12CSSpx, что и новый. Перерасчёт текста завершается до `VIEW_CHANGED`, поэтому
сцена видит правильные размеры текста при собственной раскладке. Поздние `setFontSize` и прямые изменения
TextStyle остаются авторитетными; возврат к широкой/классической раскладке восстанавливает запрошенный размер.

Rectangle цели нажатия получают минимум44CSSpx с учётом масштаба объекта и его родителей. Меняется существующий
Rectangle вокруг его прежнего центра. Input, callback, enabled, display origin и ручные изменения координат
при reflow сохраняются. Другие формы hitArea не меняются. Новые элементы шапки получают тот же минимум сразу.
Обрабатываются только активные сцены; перезапуска сцены, принятия ответа или начисления наград при resize нет.

Focused regression эмулирует реальное поведение Phaser: повторный `setInteractive` сохраняет существующий
Input/Rectangle. BEFORE проявляет маленький шрифт и маленькие цели; AFTER включает вложенный Text, новые
кнопки шапки, масштабированную цель, ручной reflow, замену Rectangle, custom shape и сохранение disabled input.
Существующие viewport/compact/modal input проверки остаются без изменения ожиданий.

Повторить локальную компилированную приёмку из корня репозитория:

```sh
URL=http://127.0.0.1:5516/ MODE=canvas OUT=/tmp/chronoworld-viewport-metrics-canvas \
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright \
CHROME_EXECUTABLE_PATH=/usr/bin/chromium node scripts/night-viewport-metrics-ui-qa.cjs
```

Для WebGL1 заменить `MODE=canvas` на `MODE=webgl1`. Скрипт ожидает dev/preview с опубликованными адаптивными
Home/Tavern/TavernEvening; это обычная production policy, без `compact=1`. Он проверяет настройку уменьшения
анимации, стабильность scene/create/save, font/hit metrics, mask bounds/возвращённый offset и render heartbeat.
Порогов12/44 не ослабляет.

Фактический compiled AFTER Canvas360×640 завершён5октября04:51UTC за13,3с. Bundle `index-B4bxcymc.js`
SHA256 `55c095c7c49d93735f61e616fe20dd7334d58e6d61579b60dcdf0ebd1389ca40`, viewport `c0ec12f4…`,
responsiveUi `d0dd9bdb…`, frozen screen `dafd0e09…`/ui `2260e83c…`. На360→320→360 счётчик даёт
12→12,148→12CSSpx, цель «Пропустить»44→44,148→44CSSpx. Scene остаётся тем же, create0, сохранение byte-exact,
clip и offset возвращаются к исходным, heartbeat491→518→545, ошибок и уничтоженных frame sources0.
Настройка уменьшения анимации включена; открытие настроек не создаёт tween для popInner.
Отчёт `/tmp/night-ui-runtime/foundation-after-360-320/report.json` SHA256
`29843868391e0e2981ce1a3ac4ab80a779fb35a313f5b3241065ff68c04b7e57`, PNG `font-touch-320.png`
и `reduced-motion-settings.png` визуально просмотрены. Это самостоятельная локальная приёмка source4;
финальный combined root check/production smoke остаётся обязанностью интеграции.
