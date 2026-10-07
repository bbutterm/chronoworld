# Chronoworld

Сюжетная idle-RPG в мире Ragnarok Online и отдельный автобатлер «Арена товарищей». TypeScript, Phaser 3, Vite; русский интерфейс, поддержка Telegram Mini App. Исходный дизайн: [docs/GDD.md](docs/GDD.md); актуальная переработка: [аудит 04.10.2026](docs/qa/overhaul-audit.md).

**Состояние:** 10 глав, 180 этапов, 12 личных героев с ветками профессий и адвансами. Копии повышают редкость; спутник сохраняет личность, историю, отношения и освоенную профессию. Есть выбор выучки, возврат оплаченного обучения, вечера и личные испытания всех героев, офлайн-награды, Башня-рогалик, MVP-охота, экспедиции, экипировка и ежедневные задания. Арена открывается после первой главы: семь раундов, собственная лавка и монеты, нормализованные герои, сохранение незавершённого матча. Результаты модели и мобильных проверок описаны в аудите; часть уникального арта ещё требует импорта.

**Версия 1.0.0:** локальный кандидат прошёл финальный аудит и готов к демонстрации;
публикация и проверка на настоящем Telegram-телефоне остаются отдельным шагом.
[Приёмка v1, исправления и ограничения](docs/qa/v1-final-audit-2026-10-07.md).

Последний отчёт: [docs/REPORTS/](docs/REPORTS/) · вопросы к владельцу: [docs/QUESTIONS.md](docs/QUESTIONS.md) · прогресс: [docs/PROGRESS.md](docs/PROGRESS.md).

## Запуск

```bash
npm ci               # Node.js >=22.13; CI использует Node.js 24
npm run dev          # http://localhost:5173, в DevTools включите мобильный вьюпорт
npm test             # юнит-тесты механики боя и контента
npm run check        # проверка контента + типы + тесты — перед коммитом (то же гоняет CI на каждый пуш: .github/workflows/check.yml)
npm run sim -- --n 1000                                   # зеркальный бой отрядов по умолчанию
npm run sim -- --a guard,warrior,archer,mage,priest --b guard,assassin,archer,mage,priest --n 1000
npm run sim -- --log --seed 7                             # лог одного боя
npm run balance      # прогресс модельного игрока по дням → balance.csv (docs/content/balance.md)
npm run e2e          # прогон игры в браузере: Главная → бой → итоги (docs/content/e2e.md)
npm run e2e:chapter1 # вся первая глава через настоящий интерфейс
npm run backend:check # типы Edge Functions, нужен Deno 2.5.2
npm run backend:sql  # транзакции/миграции, нужен Docker; временный PostgreSQL удаляется
npm run assets:report # какие ассеты используются, какие лишние, каких спрайтов не хватает
npm run build        # статическая сборка в dist/ (под Vercel/Netlify)
```

Отряд задаётся id юнитов через запятую по слотам: `0,1` — фронт, `2,3,4` — тыл, `-` — пустой слот.

**Добавление героев, монстров и навыков — [docs/CONTENT.md](docs/CONTENT.md).** Формат спрайтов — [docs/SPRITE_SPEC.md](docs/SPRITE_SPEC.md).

## Деплой (для проверки на телефоне)

Сборка статическая (`dist/`), конфиги: `vercel.json` и `netlify.toml`. Прод Vercel собирается из `main`. Для новой версии облачного протокола сначала применяются SQL-миграции, затем публикуется Edge Function и клиент; порядок и совместимость описаны в [backend-reliability.md](docs/qa/backend-reliability.md). Секреты Supabase/Telegram задаются окружением. Общая инструкция: [docs/DEPLOY.md](docs/DEPLOY.md).

## Структура

| Путь | Что там |
| --- | --- |
| `src/core/` | Ядро без Phaser, детерминированное: бой (поле, движение, навыки, статусы, пассивки, лог), `progression/` (профессии, опыт), `campaign/` (этапы, офлайн), `features/` (быстрые награды, мощь, задания, пропуск), `equipment/`, `tower/`, `meta/` (пресеты, поручения, достижения), `save/` (версии и миграции), `context.ts` (сборка всего контекста) |
| `src/pipeline/` | Реестр спрайтов — общий для игры и скриптов |
| `src/game/` | Phaser: экраны (Главная, Кампания, Этап, Бой, Итоги, Герои, Инвентарь, Башня, Задания, Отряд, Поручения, Достижения), `theme.ts` — токены интерфейса |
| `data/` | Весь контент и числа: `units/`, `skills/`, `jobs/`, `campaign/`, `items/`, `combat.json`, `progression.json`, `quests.json`, `tower.json`, `drops.json`, `bounties.json`, `achievements.json`; `schema/` — JSON-схемы для редактора |
| `assets/` | `sprites/` (спрайты v2), `ui/` (Kenney CC0), `ro/` (старые листы), `effects/` ([анимированные RO FX](assets/effects/README.md)), `manifest.json` (UI, статичные запасные эффекты, иконки по id) |
| `scripts/` | CLI: симулятор, проверка и заготовки контента, баланс, e2e, отчёт по ассетам |
| `tests/` | Vitest: механика, контент, прогрессия, фазз-тесты (docs/content/testing.md) |
| `docs/` | GDD, как добавлять контент (`CONTENT.md`, `content/*.md`), спецификация спрайтов, задачи, отчёты |

## Арт

Основной реестр анимированных героев, врагов и NPC — [`assets/sprites/sprites.json`](assets/sprites/sprites.json). Старые листы и сведения об импорте RO — [`assets/ro/`](assets/ro/). Задачи по графике — в [каталоге](art-research/README.md): наличие записи не означает, что PNG уже есть.

Интерфейс собран на [Kenney RPG UI (CC0)](assets/ui/): кнопки, панели, полосы HP и энергии, слоты, плашки итога.

Для части сигнатурных навыков используются процедурные эффекты, для новых поздних вещей — существующие иконки по явным алиасам. Проверка происхождения эффектов: [combat-overhaul.md](docs/qa/combat-overhaul.md); ограничения импорта: [docs/HANDOFF_ADVANCES.md](docs/HANDOFF_ADVANCES.md).

## Как подключить арт

- **Спрайты юнитов** — листы v2 в `assets/sprites/` + `sprites.json` (см. [docs/SPRITE_SPEC.md](docs/SPRITE_SPEC.md)); в юните `visual.sprite` = id спрайта. Старые листы `assets/ro` подключены через `assets/sprites.legacy.json`.
- **UI, эффекты, иконки** — PNG в `assets/` и запись в `assets/manifest.json` по id. Код трогать не нужно.
