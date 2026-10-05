# Аудит модальных окон и фоновой прокрутки — 2026-10-05

Подтверждён один реальный дефект в замороженном кандидате Inventory: под открытым подтверждением продажи вещей работает прокрутка фонового списка. Остальные перечисленные ниже места — очередь точечных проверок по коду, а не принятые как воспроизведённые баги. Репозиторий, общие компоненты, core, assets и готовые пакеты OWN5/compact11 не изменялись.

## Подтверждённый Inventory.sell

Источником был `/workspace/chronoworld-worktrees/night-root-inventory/src/game/scenes/InventoryScene.ts`, SHA256 `6ea6685075b0d43f6bd035a93911334c08243d20c7ec8b4030363731c95017bf`. Частный собранный кандидат root8+Inventory работал на `http://127.0.0.1:5597`: `/assets/index-CIJ2Dq28.js`, SHA256 `25e4380898ef2b81044a7c0abe91dbfe29680e04b020119c50f39b6660c39c90`.

Проверка использовала законный профиль AFTER ch10_s18 (180 очищенных этапов): `/tmp/chronoworld-night-after-rational-seed2/saves/after-ch10_s18.json`, SHA256 `55265cc661f261aa7d55d1e9516acb6dc618e5f00e49c0329b280523f7f8f9ba`. Исходный файл не менялся. Новый приватный browser context, 360×640, настоящий Canvas, офлайн Telegram SDK. Нативные Date/RAF не подменялись; игровой timeShift соответствовал часам законного профиля. Внешние запросы и записи были запрещены. Переходы выполнялись реальными кликами с проверкой верхнего input target; прямых `scene.start`, вызовов обработчиков или присваивания scroll offset не было.

Из стартовой Campaign закрыты 11 реально появившихся объявлений кнопкой «Позже», затем: «Герои» → инвентарь → только свободные вещи → предмет it3 → «Продать». Эти 11 штатных записей в приватный клон закончились до сравнения инвентаря. Действие продажи не подтверждалось.

| Измерение | До wheel | После native wheel dy=300 |
| --- | ---: | ---: |
| inventoryScroll offset | 0 | 300 |
| inventoryScroll content.y | 482 | 182 |
| inventoryScroll locked | false | false |
| Save write count | 11 | 11 |
| confirmModal alpha | 1 | 1 |
| confirmInner x/y | 540 / 705 | 540 / 705 |
| confirmInner bounds | [90, 505, 990, 905] | [90, 505, 990, 905] |

При scale=1/3 фон сдвинулся на 100 CSS px. Точка wheel лежала одновременно в полосе списка `[482,1230]` и внутри живого confirmInner; верхний объект ввода принадлежал `Image → popInner → confirmModal`. Вопрос и его геометрия не изменились, save остался побайтно прежним. Затем реальная «Отмена» убрала подтверждение без записи, а обычный wheel −240 после отмены сдвинул offset 300→60: список не завис в заблокированном состоянии.

Непосредственная причина: InventoryScene.sell создаёт confirm около строки 629 и безусловно вызывает `this.lockList(false)` в строке 640. В `ScrollArea` слушатель wheel зарегистрирован на всю сцену и проверяет только `locked` и попадание в полосу; верхний модальный input сам по себе его не останавливает.

Важная особенность будущего исправления: itemSheet передаёт действие `sell` через свой onClose, сохраняя locked=true. Если новый guard просто запомнит этот true и вернёт его после отмены, он оставит список заблокированным навсегда: предыдущий sheet уже закончил владение блокировкой. Нужно явно учесть эту передачу. Общий механизм модальных окон/ScrollArea здесь не редактировался; минимальный guard следует согласовать с владельцем foundation.

Результат — **BUG_CONFIRMED**, завершённое воспроизведение, 50 проверок, 0 console errors и 0 проваленных проверок метода. Это не приёмка исправленного продукта.

- Финальный JSON: `/tmp/night-modal-inventory-sell-before-360-canvas-final/report.json`, SHA256 `0f6523c67bdec4ad0ac91273080ff90aa60c8f15d3226ef629d07f1122c27f83`.
- Нативный переносимый helper: `/tmp/chronoworld-modal-inventory-native-probe.mjs`.
- Снимки: `confirm-before-wheel.png`, `confirm-after-wheel.png`, `cancelled.png`, `after-cancel-normal-wheel.png` в папке финального JSON.
- Подготовительные прогоны сохранены отдельно: первый остановился на ошибке private selector signature, второй — на корректном onboarding overlay; v3 уже показал wheel leak, но touch-шаг закрыл подтверждение и провалил строгую проверку его сохранения. Финальный кейс явно проверяет только wheel и настоящую отмену. Успешный touch/swipe не заявляется.
- Собственный browser закрыт. Чужие процессы приёмки не останавливались.

## Короткая очередь по коду

Проверялись авторитетные замороженные replacement-сцены, а не устаревшие копии этих сцен в root. Полные пути, SHA256 и контрольные строки 12 основных источников записаны в `/tmp/night-modal-scroll-static-sources.json`.

| Приоритет | Сцена / поток | Что отсутствует или требует проверки | Статус |
| --- | --- | --- | --- |
| 1 | Inventory.sell: 629–640 | Открытый confirm немедленно снимает lock фонового списка | **Native BUG_CONFIRMED**, доказательство выше |
| 2 | Utility4 Shop:235 refresh, :290 offer | Основной ScrollArea создан, но ни confirm платного refresh, ни offer sheet не блокируют его | Только код; проверить без покупки/списания |
| 2 | Utility4 Mail:146 openLetter, :213 deleteRead | Letter sheet и confirm удаления поверх основного незаблокированного ScrollArea | Только код; baseline брать после законной отметки письма прочитанным |
| 2 | Hero:1018 refineAllRow | Confirm безопасного плана заточки не блокирует длинное основное body | Только код; нужен существующий допустимый plan, отмена без заточки |
| 2 | Heroes:406 ascendAllConfirm | В этом confirm не используется lockUnderModal, применённый в трёх соседних picker | Только код; не путать с уже исправляемой AscendScene |
| 2 | Expeditions:565 report | Post-claim notice поверх обновлённого списка не задаёт его lock | Только код; baseline после законного claim, награду повторно не получать |
| 3 | Result:592 openStats | Stats sheet лежит поверх нового компактного bodyArea без его lock | Только код; compact11 остаётся неизменным |
| 3 | ChapterDone:212 recruitTake | Confirm замены героя поверх компактного bodyArea без lock | Только код; штатный chapter flow, compact11 неизменен |
| 3 | Campaign:456 useFast | Confirm fast rewards не блокирует компактный mapArea | Только код; отмена без rewards |

Вложенные окна — отдельные условные кандидаты: Inventory refine/card/lore, Hero training reset и branch job details, Autobattler abandon/sell, Squad preset delete. Некоторые блокируют базовый экран, но не ScrollArea родительского sheet. Дефект возможен только когда именно родительский sheet достаточно длинный для прокрутки; это условие и настоящий публичный маршрут пока не проверены. Не считать их подтверждёнными серьёзными багами.

## Уже защищённые потоки и cleanup

- **Heroes class/sort/filter** используют lockUnderModal (строка 357), захватывают конкретный area и прежнее состояние, восстанавливают на DESTROY. Это защищённые места; первоначальное подозрение по простому поиску `.locked` снято.
- **Home** блокирует mainArea в PRE_UPDATE при screenModal/settingsModal, снимает слушатель на SHUTDOWN. В settings захвачен живой confirmation, поэтому анимация закрытия не освобождает area преждевременно.
- **Tavern** аналогично блокирует основной список при reveal/screenModal и очищает PRE_UPDATE. Вне замороженного City-manifest TavernEvening не принимается автоматически как опубликованный кандидат.
- **Tower / Autobattler** внешние sheet захватывают area и revision; внешняя блокировка и защита смены поколения есть. **Hunt**, журналы/выбор локации Expeditions, Stage/Squad scout/editor, Hero skills/training/journey/copy/branch picker имеют явные guards. Возможность вложенного sheet из предыдущего абзаца ими не доказывается.
- Новые story/lore/heroStory helpers захватывают переданный lock и прежнее состояние, освобождают на DESTROY. Нужен корректный lock от вызывающего кода; отсутствие передачи в отдельном nested lore пока лишь условный кандидат. ChapterDone history находится в отдельном story follow-up и не оценивался по старой функции.
- Events/Friends OWN5, Adventure, Utility4 Quests/Achievements не имеют своих непосредственных noticeModal/confirm/bottomSheet потоков в проверенном пути. Здесь отдельный дефект не заявляется.
- У ScrollArea content DESTROY удаляет scene pointerdown/move/up/wheel, PRE_UPDATE guard и SHUTDOWN callback, уничтожает thumb/mask. Подтверждённой утечки слушателей после уничтожения нет.
- ScrollArea.pointermove не повторяет проверку locked для уже начатого dragFrom; setBounds обрывает жест. Это ограничение кода, но законного воспроизведения блокировки посреди активного жеста пока нет. Не включено в список подтверждённых дефектов.

Следующий шаг после решения владельца foundation: минимальная защита для подтверждённого Inventory wheel, затем повтор того же native before/after/cancel с точным save counter и нормальной прокруткой после закрытия. Source-only очередь проверять по приоритету, без blanket API и без расширения scope готовых пакетов.
