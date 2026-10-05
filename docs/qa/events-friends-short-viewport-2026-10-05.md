# События, друзья и рекорды: короткий Telegram viewport

Дата: 2026-10-05. Область изменения: только `EventsScene.ts`, `FriendsScene.ts`, один focused test и отдельный локальный browser harness. Общая адаптивная политика, ядро, данные, сохранения, графика и UI-lint budgets не меняются этим пакетом.

## Подтверждённые дефекты

Исходные сцены проверены настоящим Canvas-рендером при 360×640 CSS, Telegram top inset 136 и bottom inset 34. Date сдвинут на день fixture, но продолжает идти; requestAnimationFrame и анимации работают штатно.

| Дефект | Доказательство | Исправление |
| --- | --- | --- |
| Вход: нижний ряд наград уходил под навигацию без возможности прокрутки | `loginDay_5…7` bottom 1322 при безопасном content bottom 1220; у страницы нет ScrollArea | Баннер, вкладки и все награды находятся в едином прокручиваемом теле |
| Задания новичка почти не помещались под фиксированными баннером и вкладками | Маска старого списка 1114…1230: всего 116 world, 38,7 CSS; одна строка имеет высоту 136 world | Прокручивается вся страница вместе с дорожкой наград и днями; задания доступны целиком |
| Собственное место в рейтинге не следовало изменению Telegram insets | После top 136→156 безопасный низ 1160, а `myPlace` остался на bottom 1220: перекрытие 20 CSS | Reflow существующей строки и маски без перезапуска сцены, запроса или записи сохранения |
| Двойной тап по готовому заданию после сортировки открывал другую сцену | В полном native-прогоне второй mouse click через 100 мс попал в новую строку «Перейти» и открыл Таверну | Общий существующий `shieldTaps` включается перед перестановкой/переходом, плюс один claim до restart |
| Кэш друзей/рейтингов рисовался пустым при повторном открытии | `sys.isActive()` ещё false внутри Phaser `create`; проверка отбрасывала синхронную отрисовку кэша. Native empty-list fixture завершался пустой страницей | Синхронный draw проверяет generation; ответы после await дополнительно проверяют активность сцены |
| Ответ старой отправки или получения мог изменить новый экран/busy | Focused deferred-проверки и native mock-transport: выйти, открыть новый запрос и вернуть старый ответ | Generation фиксируется до await; старый UI не меняется, новый запрос остаётся занят, глобальный одноразовый grant сохраняет прежнюю обработку |

Нативные доказательства исходной геометрии: `/tmp/night-events-friends-original-native-clock-360-canvas/report.json` и PNG рядом. Отрицательные прогоны двух последних найденных дефектов: `/tmp/night-events-friends-full-360-canvas-v1/report.json` и `…-v2/report.json`. Эти FAIL сохранены как доказательства обнаружения и не считаются финальной приёмкой. Первые пробные скриншоты с полностью замороженным Date исключены: они не завершали intro tween и не отражали реальный вид экрана.

## Поведение после исправления

ScrollArea создаётся сразу, включая обычную высоту: поздние insets не оставляют сцену со старой фиксированной компоновкой. Изменение границ сохраняет/clamp прокрутку. События сохраняют выбранный день и положение при получении награды и возврате из выбора героя. Координата полёта награды учитывает прокрутку. Заблокированные дни и уже полученные награды по-прежнему объясняют ограничение.

Друзья и рекорды резервируют реальную высоту 44 CSS для сегментов, кнопки колокольчика и строк. Offline, пустой ответ и ошибка находятся в прокручиваемом теле, поэтому «Повторить» и «Открыть в Telegram» доступны на коротком экране. Своя строка рейтинга остаётся над навигацией, список обрезается выше неё. Повторный тап во время запроса не создаёт второй запрос; ошибка возвращает доступную кнопку. Смена вкладки, поколение сцены и живые insets учитываются перед отрисовкой ответа.

## Локальная приёмка

Portable harness: `scripts/night-events-friends-qa.mjs`. Он принимает только localhost origin, блокирует внешние запросы и любые не-GET/HEAD сетевые операции, подменяет Telegram SDK и явно обслуживает `/cw-api` детерминированным local mock transport. `save_put` mock намеренно отвечает ошибкой; приглашение/бот записываются только в массив fake SDK. Используется отдельный private browser context с новым синтетическим UI fixture, а не существующее сохранение игрока. Первые три cleared slots fixture нужны для задания новичка и не являются доказательством прохождения кампании.

Переход в проверяемую сцену выполняет UI harness. После него claim, выбор сегмента/дня, повтор, отправка, прокрутка, header Back и возврат из выбора героя проверяются настоящими mouse/wheel/SDKBack событиями. Перед кликом проверяется верхний Phaser hit target; shortcut-вызовов claim/scroll callbacks нет. После каждого шага сохраняются PNG, измеренные шрифты/hit areas, маски, scene/create counters, save/write counters и mock calls. Native RAF/postrender подтверждает фактическую отрисовку; FPS устройства не оценивается.

Проверяются: login и newbie rewards ровно один раз; повтор полученной награды без записи; объяснение locked day; day7 contract и Back; empty/error/retry для друзей и досок; offline height 500; отправленное ограничение; повторные/запоздалые send/claim/board ответы; replay стабильного grant ID без новых гемов; Telegram insets 136→156→136; window resize 360↔390 и 640↔720 без повторного create, изменения save/selection; сохранение/clamp offset; SDKBack и header Back к родителю/root; body/caption минимум 12 CSS и интерактивные цели минимум 44 CSS. Renderer type и adaptive policy утверждаются по фактическому renderer каждой сцены, hashes двух исходников должны совпадать до/после прогона.

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/night-events-friends-qa.mjs --origin http://127.0.0.1:5538 \
  --width 360 --renderer canvas --out /tmp/night-events-friends-final-360-canvas

PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
  node scripts/night-events-friends-qa.mjs --origin http://127.0.0.1:5538 \
  --width 390 --renderer webgl1 --out /tmp/night-events-friends-final-390-webgl
```

Compiled проверяется тем же harness на preview после централизованного включения Events/Friends в adaptive policy. Debug handles добавляются только к HTTP-ответу JS внутри isolated Playwright route; исходный dist и продукт не изменяются. Assertion адаптивности не позволяет принять production со старой allowlist.

## Результаты

| Приёмка | Результат | Артефакт |
| --- | --- | --- |
| DEV 360×640 Canvas | PASS: 21 экранный шаг, 227 assertions, actual renderer type 1, 0 ошибок, минимум текста 12 CSS | `/tmp/night-events-friends-final-360-canvas/report.json` + PNG |
| DEV 390×640 WebGL 1 | PASS: 21 экранный шаг, 227 assertions, actual renderer type 2 и `WebGL 1.0`, 0 ошибок, минимум текста 13 CSS | `/tmp/night-events-friends-final-390-webgl/report.json` + PNG |
| Compiled 360×640 Canvas | PASS: все те же 21 экранный шаг / 227 assertions, actual renderer type 1, production adaptive policy, 0 ошибок | `/tmp/night-events-friends-compiled-360-canvas/report.json` + PNG |
| Compiled 390×640 WebGL 1 | PASS: все те же 21 экранный шаг / 227 assertions, actual renderer type 2 и `WebGL 1.0`, production adaptive policy, 0 ошибок | `/tmp/night-events-friends-compiled-390-webgl/report.json` + PNG |
| Focused regressions + прежние shop/events и UI-lint | 3 файла / 23 теста PASS, включая 11 новых регрессий | `npx vitest run tests/game-social-compact.test.ts tests/shop-events-ui.test.ts tests/ui-lint.test.ts` |
| Typecheck и production build | `tsc --noEmit` и `npm run build` PASS | child bundle `index-CTH-mVYE.js` |

DEV проверял readonly root policy SHA `250786f0cba0edcd9653751934e6c5e7938e59f538047d1a8cbe631c1e3917c4` с разрешённым DEV `?compact=1`. Для compiled runtime-owner отдельно предоставил readonly child overlay root8 + Events/Friends SHA `f2c0950c235880c3efe96514474bcbde93e6725843d1291ae427dfcc0385043b`; неподключённые City/Combat/modes остаются classic. Общий header `ce8df507…`, UI `1c949cf5…` и modal Back `27d7595b…` остаются byte-equal readonly. Политика не входит в 5 файлов этого пакета; централизованный production delta применяется runtime-owner после Utility4 и точных owner source hashes.

Проверенный child production bundle `index-CTH-mVYE.js` SHA `5ff8f46e8acbda7915fa51fc0413f3051005134768ce9f047f9f7a7751bb58f0`. В четырёх финальных прогонах фактический renderer, адаптивность, неизменность двух source hashes и все assertions подтверждены; внешних сетевых запросов нет. После compiled приёмки браузеры закрыты. Production delta общего дерева остаётся отдельным runtime-owner пакетом.

Замороженные source hashes: `EventsScene.ts` — `5beca12f515059a7b0e5deb806d69fdd35084ab38ef3d980c1eb02a1dc1bf6ea`; `FriendsScene.ts` — `f508d735adf5a14c3d0a3d906b7982afccef354316633f2cb2e73fcc05fae349`. Предыдущие frozen compact Battle11 и экономический аудит в старом worktree не изменены. Общий strict check после интеграции выполняет root-owner.
