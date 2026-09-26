# Idle Hero RPG (рабочее название)

Idle-RPG в духе AFK Arena, которая будет жить в Telegram как Mini App. Дизайн-документ: [docs/GDD.md](docs/GDD.md).

**Текущая фаза: 0 — бой.** Пока это просто веб-сборка, Telegram подключается в фазе 1.

## Запуск

```bash
npm install
npm run dev          # http://localhost:5173, в DevTools включите мобильный вьюпорт
npm test             # юнит-тесты механики боя и контента
npm run check        # проверка контента + типы + тесты — перед коммитом
npm run sim -- --n 1000                                   # зеркальный бой отрядов по умолчанию
npm run sim -- --a guard,warrior,archer,mage,priest --b guard,assassin,archer,mage,priest --n 1000
npm run sim -- --log --seed 7                             # лог одного боя
npm run balance      # прогресс модельного игрока по дням → balance.csv (docs/content/balance.md)
npm run build        # статическая сборка в dist/ (под Vercel/Netlify)
```

Отряд задаётся id юнитов через запятую по слотам: `0,1` — фронт, `2,3,4` — тыл, `-` — пустой слот.

**Добавление героев, монстров и навыков — [docs/CONTENT.md](docs/CONTENT.md).** Формат спрайтов — [docs/SPRITE_SPEC.md](docs/SPRITE_SPEC.md).

## Структура

| Путь | Что там |
| --- | --- |
| `src/core/` | Ядро боя без Phaser: поле и движение, шкала действий, навыки из данных, статусы, пассивки, лог событий |
| `src/core/content/` | Схемы контента (zod) и сборка реестра с проверкой ссылок |
| `src/pipeline/` | Реестр спрайтов — общий для игры и скриптов |
| `src/game/` | Phaser: сцены подготовки, боя (проигрывает лог) и итога |
| `data/units/`, `data/skills/` | Контент: юниты и навыки |
| `data/combat.json` | Общие правила боя |
| `assets/manifest.json` | UI, эффекты, иконки по id |
| `scripts/` | CLI: симулятор, проверка и заготовки контента, конвертер старых спрайтов |
| `tests/` | Vitest |

## Арт

Спрайты героев и врагов из Ragnarok Online лежат в [`assets/ro/`](assets/ro/) (владелец репозитория подтверждает права на использование). Там 12 героев, 8 рядовых врагов и 6 боссов: спрайтшиты, боевые кадры, портреты и иконки ульт. Покадровая разметка — в [`assets/ro/manifest.json`](assets/ro/manifest.json), инструкция — в [`assets/ro/README.md`](assets/ro/README.md). Задачи по графике фаз 0–2 — в [каталоге](art-research/README.md): наличие строки в каталоге **не** означает, что PNG уже есть.

Интерфейс собран на [Kenney RPG UI (CC0)](assets/ui/): кнопки, панели, полосы HP и энергии, слоты, плашки итога.

В фазе 0 подключены 6 стартовых героев. В бою у каждого покадровые анимации: стойка, атака, получение урона и смерть. Фон арены и эффекты пока остаются плейсхолдерами.

## Как подключить арт

- **Спрайты юнитов** — листы v2 в `assets/sprites/` + `sprites.json` (см. [docs/SPRITE_SPEC.md](docs/SPRITE_SPEC.md)); в юните `visual.sprite` = id спрайта. Старые листы `assets/ro` подключены через `assets/sprites.legacy.json`.
- **UI, эффекты, иконки** — PNG в `assets/` и запись в `assets/manifest.json` по id. Код трогать не нужно.
