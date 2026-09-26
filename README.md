# Idle Hero RPG (рабочее название)

Idle-RPG в духе AFK Arena, которая будет жить в Telegram как Mini App. Дизайн-документ: [docs/GDD.md](docs/GDD.md).

**Состояние:** играбельный цикл по образцу AFK Arena — кампания (3 главы × 10 этапов), профессии как в RO (Новичок → 6 первых → 12 вторых), офлайн-сундук и быстрые награды, башня испытаний, экипировка, ежедневные задания, поручения, достижения, пресеты отряда. Числа — заглушки до баланса, часть арта — плейсхолдеры. Пока веб-сборка; Telegram Mini App — позже.

Последний отчёт: [docs/REPORTS/](docs/REPORTS/) · вопросы к владельцу: [docs/QUESTIONS.md](docs/QUESTIONS.md) · прогресс: [docs/PROGRESS.md](docs/PROGRESS.md).

## Запуск

```bash
npm install
npm run dev          # http://localhost:5173, в DevTools включите мобильный вьюпорт
npm test             # юнит-тесты механики боя и контента
npm run check        # проверка контента + типы + тесты — перед коммитом (то же гоняет CI на каждый пуш: .github/workflows/check.yml)
npm run sim -- --n 1000                                   # зеркальный бой отрядов по умолчанию
npm run sim -- --a guard,warrior,archer,mage,priest --b guard,assassin,archer,mage,priest --n 1000
npm run sim -- --log --seed 7                             # лог одного боя
npm run balance      # прогресс модельного игрока по дням → balance.csv (docs/content/balance.md)
npm run e2e          # прогон игры в браузере: Главная → бой → итоги (docs/content/e2e.md)
npm run assets:report # какие ассеты используются, какие лишние, каких спрайтов не хватает
npm run build        # статическая сборка в dist/ (под Vercel/Netlify)
```

Отряд задаётся id юнитов через запятую по слотам: `0,1` — фронт, `2,3,4` — тыл, `-` — пустой слот.

**Добавление героев, монстров и навыков — [docs/CONTENT.md](docs/CONTENT.md).** Формат спрайтов — [docs/SPRITE_SPEC.md](docs/SPRITE_SPEC.md).

## Структура

| Путь | Что там |
| --- | --- |
| `src/core/` | Ядро без Phaser, детерминированное: бой (поле, движение, навыки, статусы, пассивки, лог), `progression/` (профессии, опыт), `campaign/` (этапы, офлайн), `features/` (быстрые награды, мощь, задания, пропуск), `equipment/`, `tower/`, `meta/` (пресеты, поручения, достижения), `save/` (версии и миграции), `context.ts` (сборка всего контекста) |
| `src/pipeline/` | Реестр спрайтов — общий для игры и скриптов |
| `src/game/` | Phaser: экраны (Главная, Кампания, Этап, Бой, Итоги, Герои, Инвентарь, Башня, Задания, Отряд, Поручения, Достижения), `theme.ts` — токены интерфейса |
| `data/` | Весь контент и числа: `units/`, `skills/`, `jobs/`, `campaign/`, `items/`, `combat.json`, `progression.json`, `quests.json`, `tower.json`, `drops.json`, `bounties.json`, `achievements.json`; `schema/` — JSON-схемы для редактора |
| `assets/` | `sprites/` (спрайты v2), `ui/` (Kenney CC0), `ro/` (старые листы), `manifest.json` (UI, эффекты, иконки по id) |
| `scripts/` | CLI: симулятор, проверка и заготовки контента, баланс, e2e, отчёт по ассетам |
| `tests/` | Vitest: механика, контент, прогрессия, фазз-тесты (docs/content/testing.md) |
| `docs/` | GDD, как добавлять контент (`CONTENT.md`, `content/*.md`), спецификация спрайтов, задачи, отчёты |

## Арт

Спрайты героев и врагов из Ragnarok Online лежат в [`assets/ro/`](assets/ro/) (владелец репозитория подтверждает права на использование). Там 12 героев, 8 рядовых врагов и 6 боссов: спрайтшиты, боевые кадры, портреты и иконки ульт. Покадровая разметка — в [`assets/ro/manifest.json`](assets/ro/manifest.json), инструкция — в [`assets/ro/README.md`](assets/ro/README.md). Задачи по графике фаз 0–2 — в [каталоге](art-research/README.md): наличие строки в каталоге **не** означает, что PNG уже есть.

Интерфейс собран на [Kenney RPG UI (CC0)](assets/ui/): кнопки, панели, полосы HP и энергии, слоты, плашки итога.

Спрайты v2 (`assets/sprites/`): 6 героев с оружием, 5 монстров, 2 босса — анимации стойки, ходьбы, атаки, каста, урона и смерти. Не хватает: Новичок, Торговец, босс главы 3, фоны, эффекты, иконки навигации (`npm run assets:report`).

## Как подключить арт

- **Спрайты юнитов** — листы v2 в `assets/sprites/` + `sprites.json` (см. [docs/SPRITE_SPEC.md](docs/SPRITE_SPEC.md)); в юните `visual.sprite` = id спрайта. Старые листы `assets/ro` подключены через `assets/sprites.legacy.json`.
- **UI, эффекты, иконки** — PNG в `assets/` и запись в `assets/manifest.json` по id. Код трогать не нужно.
