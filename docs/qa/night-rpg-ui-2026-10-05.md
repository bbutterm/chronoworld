# Развитие спутника копией — UI, 05.10.2026

READY. Рабочее дерево: `/workspace/chronoworld-worktrees/night-heroes-ui`.
UI patch относительно root `cb9346b`: `/tmp/chronoworld-night-heroes-ui/rpg-ui-only.patch`.
`git apply --check` в root прошёл. Старые navigation/presets fixes уже в #143 и в этот patch не входят.
Core зависимости скопированы read-only от night-rpg-economy; в UI patch они не включены.
Коммитов от агента нет. Полный `npm run check` и source freeze — root после интеграции.

## Изменённые файлы

1. `src/game/scenes/HeroScene.ts`: «Развить спутника» в начале вкладки «Путь», когда есть более редкая копия; переход к занятой копии с сохранением возврата к исходному герою; постоянная причина запрета менять профессию в экспедиции; проверка занятости/валюты в branch picker из свежего save; собственный lastBranch в превью до фиолетового.
2. `src/game/scenes/AscendScene.ts`: новая карточка показывает собственную восстановленную ветку, без новых branch tiles; в подтверждении явно написано восстановление прежней профессии; занятость даёт короткую причину над CTA и полный текст на нажатие.
3. `src/game/heroesView.ts`: единый ascendedBranch, preview/мощь/статы учитывают journey и ветеранский ранг после возврата уровня; needsBranchPick проверяет принадлежность lastBranch шаблону; busy-guard впереди выбора копий, обычный порядок причин нехватки ресурсов сохранён.
4. `src/game/branchPicker.ts`: если blocker появился после открытия, подтверждение обновляет видимую причину и disabled CTA.
5. Новый `src/game/heroUpgradeCopyPicker.ts`: список всех более редких копий с защитами, отдельное бесплатное подтверждение обеих редкостей, предупреждение о донорской профессии/вещах, повторная проверка eligibility и показанного результата, doubletap/shutdown/closing guards, очистка подписок/восстановление блокировки исходного списка. Новые кнопки ≥44 CSS px, текст ≥12 CSS px в безопасном игровом поле Telegram. Новая защита в списке оставляет видимую причину вместо неожиданного ухода в другую карточку.
6. Новый `tests/hero-upgrade-copy-picker.test.ts`: 10 регрессий UI callback/lifecycle/копии/ресурсов/lastBranch/свежей защиты/минимальных целей.
7. Новый `tests/ascend-own-path-view.test.ts`: 4 регрессии реального публичного core workflow после обучения/reset/обмена: собственная ветка, ветеранский preview, legacy первый выбор, игнорирование чужой ветки, busy до получения наград.

## Проверка

- `npx tsc --noEmit` PASS.
- `git diff --check` PASS.
- `VITE_CONFIG_NATIVE_IGNORE_WARNING=true npx vitest run tests/hero-upgrade-copy-picker.test.ts tests/ascend-own-path-view.test.ts tests/game-heroes.test.ts tests/game-ascend-inventory.test.ts`: 44/44 PASS, включая 14 новых тестов; подтверждение render требует ровно одну primary, список — ноль.
- Browser Chromium/Playwright: 360×640 и 390×844, Telegram safeTop24 + contentTop54, bottom16; реальные нажатия на canvas. Основные 10 цепочек, 54 кнопки, 0 page/console errors (`rpg-ui.json`).
- Ещё 2 browser цепочки: свежий lock в списке, 21 копия, drag по кнопке без выбора, прокрутка до последней копии, cancel, точное совпадение listener counts до/после, stop Hero с открытым листом без перезапуска/изменения героя (`rpg-extra.json`). 0 page/console errors.
- Всё в локальных dev fixtures. Золото/опыт для подготовок выданы fixture, часть кампании для открытия экспедиции подготовлена fixture. Это проверка интерфейса/защит, не доказательство темпа прохождения. Внешние запросы заблокированы, cloud saves не использованы.

Основные реальные цепочки на обоих размерах: синий Алан h1 ур20 → gold копией ур1, Telegram Back отменяет, doubletap не расходует ничего повторно; gold76 обученная копия → открыть «Путь» → вернуть ресурсы → снять focus → Назад к прежнему спутнику → обмен; lock между preview/confirm даёт читаемый отказ; обычное вознесение вернуло свою knight без нового выбора и сохранило Inventory parent; начавшаяся после открытия branch picker реальная экспедиция блокирует смену и обновляет причину, claim вновь разрешает действие.

## Артефакты

Выбранные скриншоты для репозитория: `rpg-copy-preview-390.png` (оба результата, путь/стоимость, полный confirm/cancel), `rpg-copy-result-360.png` (тот же h1 после обмена, уровень20).
Полные отчёты/хелперы: `/tmp/chronoworld-night-heroes-ui/rpg-ui.json`, `rpg-extra.json`, `rpg-ui.cjs`, `rpg-extra.cjs`.
Исходные провалы harness: starter был green вместо ожидаемого blue, ожидание300ms было короче намеренного shield400ms, cleared — массив вместо карты. Harness исправлен; эти провалы не записаны как дефекты продукта.

Дальше RPG UI заморожен до интеграции root. Compact foundation и адаптация сцен — отдельный scope/patch.

Репозиторные доказательства: [summary.json](../REPORTS/2026-10-05-night-rpg-ui/summary.json), [просмотр обмена](../REPORTS/2026-10-05-night-rpg-ui/rpg-copy-preview-390.png), [тот же спутник после обмена](../REPORTS/2026-10-05-night-rpg-ui/rpg-copy-result-360.png). Полная совмещённая проверка root197files/2153Vitest+3Node PASS. Старый UI навигационный ремонт уже опубликован #143; новый пакет не требует изменения облачного протокола.

Новый ui-lint entry добавлен штатным `npm run ui:lint -- --update --add-new`: одна главная CTA нового отдельного подтверждения. Остальные счётчики только снизились; постоянных инструкций нет, фразы отказа не маскируют нарушение. Frozen миграции, производительность и существующие ограничения не ослаблены.
