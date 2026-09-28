# Экипировка (K6)

Упрощённая экипировка в духе AFK Arena (GDD фаза 2): 4 слота, 3 редкости, фиксированные статы, выпадение с этапов,
надеть/снять, заточка за золото с риском поломки (+1…+10, раздел «Заточка»). Без сетов, звёзд и разбора. Все числа — заглушки до баланса.

```
data/items/*.json        предметы (файлы по слотам: weapon, armor, helmet, boots)
data/drops.json          правила выпадения по главам
src/core/equipment/      schema, load, equipment, drops, refine, errors
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

`save.inventory.items`: `{ id, itemId, equippedBy, refine? }` (есть с v2, миграция не нужна; `refine` — уровень заточки, нет поля — +0; выше `maxLevel` — `sanitizeSave` ограничивает до него). `save.inventory.refineSeq?` — номер следующей попытки заточки (seed броска поломки), нет поля — 0. id экземпляра — `it<N>`,
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

## Заточка (кузнец RO)

Главный сток золота: после предела уровней редкости мощь растёт заточкой снаряжения. Как в RO, вещь может сломаться:
шаг на +N ломает её с шансом (N−1)·10% (+1 — безопасно, +2 — 10% … +10 — 90%); сломанная вещь исчезает (надетая — снимается
с героя), золото за шаг списывается в любом случае. Числа — `data/drops.json → refine` (`RefineConfigSchema`, `src/core/equipment/schema.ts`):

```json
"refine": { "maxLevel": 10, "bonusPerLevel": 0.2, "cost": { "base": { "common": 1000, "rare": 2000, "epic": 4000 }, "growth": 1.6 },
            "breakChance": [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] }
```

- Статы предмета +N: `база × (1 + bonusPerLevel · N)`, каждый стат округляется (`refinedStats`). +10 — ×3 базы.
- Цена шага +N → +N+1: `cost.base[редкость] × growth^N`, 2 значащие цифры (`refineStepCost`): эпик 4 000, 6 400, 10 000 … 270 тыс.
  (+9→+10); обычный +4→+5 — 6 600. Всего до +10 без поломок: обычный 290 тыс., редкий 580 тыс., эпик 1.16 млн.
- `breakChance[N−1]` — шанс поломки при шаге на +N; длина ровно `maxLevel`, шансы не убывают (проверка схемы). Нет поля — без поломок.
- Бросок детерминирован: `Rng(refineSeed(createdAt, inventory.refineSeq))`, счётчик растёт с каждой попыткой — перезагрузка страницы
  исход не меняет. `refineItem` принимает и явный `seed` (тесты, инструменты).
- Максимум был +15 (до поломки): у таких сохранений `sanitizeSave` ограничивает заточку до +10 (предупреждение игроку), статы и так
  считаются не выше +10.
- Точится любой экземпляр (надетый или свободный); при снятии заточка остаётся на предмете. Нет `refine` в конфиге — заточки нет.
- Открывается после этапа `ch2_s5` (`data/unlocks.json → refine`, баннер «Новая функция!» ведёт в «Герои»).
- Статы с заточкой идут везде через `heroGearStats` → `withGear`: бой, мощь K2 (`heroPower`, `squadPower`), «Надеть лучшее»
  (`gearUpgrades` сравнивает предметы с заточкой: +8 обычный может быть лучше голого эпика).

API (`src/core/equipment/refine.ts`):

```ts
refineCost(instance, def, ctx)            // { gold } следующего шага или null (максимум / нет конфига)
refineBreakChance(from, ctx)              // шанс поломки шага from → from+1
refineItem(save, instanceId, ctx, seed?)  // { save, events: [{ type: 'refined', ok: true, from, to, gold, chance, … }
                                          //                  | { type: 'refineBroken', itemId, level, heroId, gold, chance, … }] }
refineAllPlan(save, heroId, ctx)          // «Заточить всё надетое»: только безопасные шаги → { steps, gold, safe, risky }
actRefineAll(save, heroId, ctx)           // выполнить план
refineSeed(createdAt, seq), refinedStats(def, refine, ctx), refinedName(def, refine) /* «+7 Меч» */, refineLevel(instance), refineUnlocked(save, ctx)
```

Ошибки `EquipmentError`: `unknown_item`, `unknown_item_def`, `refine_unavailable` (нет конфига), `refine_locked` (этап не пройден),
`refine_max`, `not_enough_gold`.

Экраны: окно предмета (Инвентарь → слот героя) — ряд «Заточка +N → +N+1», прирост статов, «Шанс поломки: 30%» (зелёный «Без риска
поломки» / жёлтый до 30% / красный выше) и кнопка «Заточить» с ценой (нет золота — серая, касание — «не хватает N»). Риск > 0 —
подтверждение «Вещь может сломаться (30%)…» (выше 30% — красная кнопка «Точить»). Успех — `equip` (выше тоном) + `coin`, вспышка `burst`;
поломка — «Вещь сломалась!» красным, `hit_blunt` + `ui_error`, тряска экрана и осколки из ячейки. «+N» на иконке (`itemCell(…, refine)`,
`refineBadge`) и в названии. Вкладка «Снаряжение» карточки героя — «+N» в слотах и «Заточить всё надетое · сумма»: только безопасные
шаги (сейчас +0 → +1), подпись «рискованные — вручную»; безопасных нет — неактивная кнопка с подписью почему.
Модель игрока и баланс — `docs/content/balance.md`, «Заточка снаряжения».
