# Башня испытаний (K4)

Отдельная от кампании лестница этажей (как King's Tower в AFK Arena): отряд штурмует следующий этаж, победа — этаж пройден и награда получена, поражение — можно пробовать снова с другим seed / составом. Повторов пройденных этажей нет, награда за этаж даётся один раз.

```
data/tower.json          правила башни (этажи не перечисляются — строятся по правилу)
src/core/tower/schema.ts схема data/tower.json
src/core/tower/tower.ts  towerFloor, towerStatus, climbTower, withTower
save.tower.floor         последний пройденный этаж (0 — башня не начата)
```

## Как устроен этаж

Этаж `n` (от 1 до `maxFloor`) собирается функцией `towerFloor(n, ctx)`:

1. **Полоса.** Берётся последняя полоса из `bands`, у которой `fromFloor ≤ n`. В полосе — свой пул врагов (например, 1–19 гоблины, 20–39 болото, 40+ нежить).
2. **Босс или нет.** Этаж босса — каждый `bossEvery`-й (при 5 — этажи 5, 10, 15…).
3. **Состав.** Обычный этаж: `layouts[(n − fromFloor) mod число составов]` — составы идут по кругу. Босс-этаж: `bossLayouts[k mod число]`, где k — номер босса внутри полосы (0 для первого босс-этажа полосы).
4. **Сила врагов.** Как в кампании, но свой рост:
   ```
   hp/atk/def = база из data/units × mult слота × baseMult × (1 + statGrowthPerFloor) ^ (n − 1)   (округление до целого)
   spd, moveSpeed — без изменений
   ```
   id врага на этаже — `tower_f<n>_<слот>`.
5. **Награда.**
   ```
   gold   = floor((gold.base   + gold.perFloor   × (n − 1)) × (босс ? bossMultiplier : 1))
   jobExp = floor((jobExp.base + jobExp.perFloor × (n − 1)) × (босс ? bossMultiplier : 1))   — каждому герою отряда
   gems   = босс ? bossGems : 0
   ```

Всё детерминировано: этаж зависит только от `n` и конфига, бой — от seed (как у этапов кампании).

## Штурм

`climbTower(save, seed, ctx)` играет этаж `save.tower.floor + 1` отрядом `save.squad`:

- башня закрыта, пока не пройден этап `unlockAfterStage` → `TowerError('tower_locked')`; `null` — открыта сразу;
- пройден `maxFloor` → `TowerError('tower_completed')`;
- пустой отряд / неизвестный герой → `GameRuleError('empty_squad' / 'unknown_hero')`;
- `battleSeq + 1` всегда;
- победа: `tower.floor + 1`, золото и гемы в ресурсы, джоб-опыт каждому герою отряда; события `rewards`, `gems` (если есть), `towerFloorCleared`, `levelUp` и т. д.;
- поражение: только `battleSeq`.

Для UI: `towerStatus(save, ctx)` → `{ unlocked, unlockAfterStage, floor, next, maxFloor }`, `towerFloor(next, ctx)` — превью врагов и награды. Обёртка `actClimbTower(save, day, seed, ctx)` дополнительно засчитывает ежедневным заданиям событие `tower_attempt` (за каждый штурм, и победу, и поражение) и `hero_level_up`.

Контекст башни: `withTower(gameCtx, towerJson)` — разбирает `data/tower.json` и сверяет с контентом; ошибка → `TowerError('invalid_config')` с описанием.

## Формат data/tower.json

```json
{
  "unlockAfterStage": "ch1_s5",   // id этапа кампании или null
  "maxFloor": 100,
  "bossEvery": 5,
  "baseMult": 1.4,                // сила 1-го этажа относительно базовых статов монстров
  "statGrowthPerFloor": 0.04,     // +4% hp/atk/def за этаж (сложный процент)
  "rewards": {
    "gold":   { "base": 100, "perFloor": 15 },
    "jobExp": { "base": 60,  "perFloor": 8 },
    "bossMultiplier": 2,          // × к золоту и опыту на босс-этаже
    "bossGems": 20                // гемы только на босс-этажах
  },
  "bands": [
    {
      "fromFloor": 1,             // у первой полосы обязательно 1; дальше — строго по возрастанию
      "name": "Гоблинский ярус",
      "layouts": [                // обычные этажи, по кругу; 5 слотов как у этапа: 0–1 фронт, 2–4 тыл
        [{ "unit": "mob_melee" }, { "unit": "mob_melee", "mult": 1.2 }, { "unit": "mob_ranged" }, null, null]
      ],
      "bossLayouts": [            // босс-этажи, по кругу; в каждом нужен юнит kind boss
        [{ "unit": "mob_tank" }, { "unit": "mob_boss1" }, { "unit": "mob_ranged" }, null, null]
      ]
    }
  ]
}
```

Правила, которые проверяются: враги существуют и имеют `kind` monster/boss, в каждом составе хотя бы один враг, в `bossLayouts` есть босс, `unlockAfterStage` — существующий этап, полосы начинаются не выше `maxFloor`.

## Как настраивать

- **Башня слишком лёгкая/тяжёлая в начале** — `baseMult`. Ориентир: сила врага этапа кампании с номером `globalIndex` = 1,08^globalIndex; при `baseMult = 1.4` первый этаж примерно равен 5-му этапу главы 1 (башня и открывается после него).
- **Слишком быстро/медленно растёт** — `statGrowthPerFloor`. При 0,04 этаж 50 сильнее первого в 1,04⁴⁹ ≈ 6,8 раза, этаж 100 — в ≈ 49 раз.
- **Разнообразие** — добавить составы в `layouts` / `bossLayouts` или новую полосу `bands` с другим пулом монстров. Точечно усилить слот — `mult`.
- **Награды** — `rewards`: линейный рост и множитель босса; гемы — только за боссов.
- **Высота** — `maxFloor`; этажи строятся сами, дописывать их не нужно.

Все числа — заглушки до баланса.
