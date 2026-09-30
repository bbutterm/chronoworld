# QA — регрессионный прогон 30.09 (после «поведения в бою», эффектов RO ×1.35, историй героев, догоняющего уровня)

- **Сборка:** ветка `claude/idle-hero-rpg-gdd-rolicg` @ `9dc296c` (PR #91 «Эффекты навыков RO крупнее»), vite dev
  (`--port 5541`), worktree тестировщика.
- **Браузер:** Chromium (Playwright, headless, software WebGL), 390×844, deviceScaleFactor 2.
- **Как играл:** бот прошлого тестировщика (`qa-newbie/route-bot3.mjs`) с доработками → `scratchpad/qa-regress/newbie.mjs`:
  выбор ветки в окне после «Вознести всех», «Взять в отряд» на «Глава пройдена», журнал подписей поведения в бою
  («Отход!», «Перехват!», фазы, ярость), замер «эффекты закрывают героя» и памяти после каждого просмотренного боя.
- Новичок: «Начать заново» → главы 1–3. Поздняя игра: `scripts/qa-save-late.ts --day 15 --from 8` → главы 8–10.

Скриншоты и журналы: `/tmp/claude-0/-home-user-chronoworld/f2fe4333-4c2a-57a5-b5b2-db51f3f090ee/scratchpad/qa-regress/`
(`newbie/`, `late/` — `log.txt`, `story.txt`, `balance.jsonl`, PNG).

_Прогон идёт — отчёт дописывается по частям._
