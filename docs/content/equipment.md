# Экипировка (K6)

Упрощённая экипировка в духе AFK Arena (GDD фаза 2): 4 слота, 3 редкости, фиксированные статы, выпадение с этапов,
надеть/снять. Без улучшений, сетов, звёзд и разбора. Все числа — заглушки до баланса.

```
data/items/*.json        предметы (файлы по слотам: weapon, armor, helmet, boots)
data/drops.json          правила выпадения по главам
src/core/equipment/      schema, load, equipment, drops, errors
```

## Предмет

```json
{ "id": "gladius", "name": "Гладиус", "slot": "weapon", "rarity": "rare",
  "stats": { "atk": 18, "spd": 3 }, "jobs": ["swordman", "thief", "merchant"] }
```

| Поле | Что это |
| --- | --- |
| `id` | латиница, `a-z0-9_`, уникален по всем файлам |
| `name` | название для игрока |
| `slot` | `weapon` (оружие), `armor` (доспех), `helmet` (шлем), `boots` (обувь) |
| `rarity` | `common` (обычный), `rare` (редкий), `epic` (эпический) |
| `stats` | **плоские** прибавки `hp`, `atk`, `def`, `spd` (целые ≥ 0, отсутствующий = 0) |
| `jobs` | необязательно: ветки профессий, которым можно надеть предмет |
| `drop` | необязательно, `false` — не выпадает с этапов (по умолчанию `true`) |
| `minChapter` | необязательно, с какой главы (номер с 1) предмет попадает в выбор любого источника: этапы, сундук, быстрые награды, Лавка, охота (по умолчанию 1). Эпики — 2, Слейпнир — 3 |

**Статы — только плоские прибавки** (решение K6): проще читать в интерфейсе («+18 АТК»), мощь считается той же
формулой. Проценты можно добавить позже отдельным полем.

**Ограничение по профессии**: `jobs` — список «корней» веток. Герой может надеть предмет, если его профессия есть в
списке или происходит от неё по полю `from`: `["archer"]` → Лучник, Охотник, Бард. Послушник (novice) носит только
предметы без `jobs`. Смена профессии надетый предмет **не снимает** и его статы продолжают действовать
(ограничение проверяется только при `equip`).

Файл: `{ "items": [ ... ] }`. Сейчас 29 предметов-заглушек (Нож, Кинжал, Меч, Лук, Гладиус, Кольчуга, Латы, Шлем,
Слейпнир…); у каждого слота есть все три редкости.

## Выпадение — `data/drops.json`

```json
{ "rules": [
  { "chapter": "chapter1", "chance": 0.3, "rarityWeights": { "common": 85, "rare": 15, "epic": 0 },
    "firstClearGuaranteed": true, "firstClearRarityWeights": { "common": 70, "rare": 30, "epic": 0 } },
  { "chance": 0.35, "rarityWeights": { "common": 70, "rare": 25, "epic": 5 } }
] }
```

- Правило этапа — первое с `chapter` = глава этапа, иначе первое без `chapter` (по умолчанию).
- **Первое прохождение** (`firstClearGuaranteed`, по умолчанию `true`) — ровно 1 предмет, веса
  `firstClearRarityWeights` (нет — `rarityWeights`).
- **Повтор** (и пропуск боя K7) — 1 предмет с шансом `chance`, веса `rarityWeights`.
- Предмет — равновероятно среди предметов выбранной редкости с `drop ≠ false` и `minChapter` ≤ глава этапа. Веса
  относительные; редкость без открытых в главе предметов не выпадает (её вес уходит остальным).
- **Ворота по главам** (`minChapter`, «Слейпнир в самом начале — перебор»): в главе 1 — только обычные и редкие, эпики — с главы 2,
  знаменитые предметы RO (сейчас Слейпнир) — с главы 3. Так же выбирают сундук и быстрые награды (глава последнего пройденного этапа),
  Лавка и охота (глава игрока); код — `itemPools(items, глава)`, `chapterNumber`, `progressChapter` (`src/core/equipment/gates.ts`),
  проверки content:check — `lintItemGates` (`src/core/equipment/lint.ts`).
- Поражение — ничего.
- Случайность — `Rng` из seed боя (отдельный поток), поэтому тот же seed → тот же предмет.

## Сохранение

`save.inventory.items`: `{ id, itemId, equippedBy }` (есть с v2, миграция не нужна). id экземпляра — `it<N>`,
следующий N = максимальный + 1. Предмет, которого больше нет в `data/items`, остаётся в инвентаре, но не даёт статов
и не надевается (`unknown_item_def`).

## API (`src/core/equipment/`)

```ts
const ectx = withEquipment(fctx, itemFiles, dropsJson); // itemFiles: RawFile[] из data/items; битое → EquipmentError('invalid_config')
equip(save, heroId, itemInstanceId, ectx)   // предмет того же слота уходит в инвентарь
unequip(save, itemInstanceId)
heroEquipment(save, heroId)                 // надетые экземпляры
heroSlots(save, heroId, ectx)               // { weapon?: { instance, def }, ... }
equipmentStats(defs)                        // сумма прибавок
rollDrops(stageId, seed, firstClear, ectx)  // id предметов (0 или 1)
addItems(save, itemIds)
```

Ошибки — `EquipmentError`: `unknown_hero`, `unknown_item`, `unknown_item_def`, `job_restricted`,
`item_equipped_by_other` (предмет надет на другого героя — сначала снять), `invalid_config`.

**Бой и мощь.** `buildUnit(hero, ctx, gear?)` прибавляет экипировку: явный `gear` или `ctx.heroGear[hero.id]`.
`withGear(ctx, save)` заполняет `ctx.heroGear` по инвентарю. Обёртки `actPlayStage` / `actSkipStage` делают это сами
и при победе добавляют выпадение в инвентарь (поле `drops` в итоге). `heroPower(hero, ctx, save)` и
`squadPower(save, ctx)` учитывают экипировку, если в контексте есть `equipment`. Голый `playStage` без
`withGear` экипировку не видит — UI должен вызывать `act*`-обёртки.

Обёртки `actEquip` / `actUnequip` — то же, что `equip` / `unequip` (ежедневных заданий на экипировку пока нет).
