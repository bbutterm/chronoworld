# Пресеты отряда, доска поручений, достижения (K8, K9, K10)

Ядро — `src/core/meta/`, всё чистые функции без часов и случайности: день (`'YYYY-MM-DD'`), время (мс) и seed
передаёт UI. Числа — заглушки до баланса. Интерфейс: экраны «Отряд», «Поручения», «Достижения» (src/game/scenes).

```
data/bounties.json      доска поручений (K9) + лимиты пресетов (K8, временно здесь)
data/achievements.json  достижения (K10)
src/core/meta/          config, errors, formation, bounties, achievements
```

## Контекст

```ts
import bountiesJson from '../../data/bounties.json';
import achievementsJson from '../../data/achievements.json';
const mctx = withMeta(featureCtx, bountiesJson, achievementsJson); // битый конфиг → MetaError('invalid_config')
```

`withMeta` сохраняет тип исходного контекста (можно передать `FeatureContext` с башней и экипировкой).
Авто-расстановке нужен `FeatureContext` (мощь героев, K2).

Все ошибки — `MetaError` с полем `code` и русским `message` для игрока.

## Сохранение v3

`SAVE_VERSION = 3`, миграция `MIGRATIONS[2]` добавляет:

| Поле | Умолчание | Что это |
| --- | --- | --- |
| `presets` | `[]` | пресеты отряда `{ id, name, squad: (id \| null)[5] }` |
| `bounties.board` | `[]` | поручения на доске (снимки шаблонов) |
| `bounties.lastRefreshDay` | `'1970-01-01'` | день последнего обновления доски |
| `bounties.refreshesUsed` | 0 | ручных обновлений за этот день |
| `bounties.active` | `[]` | поручения в работе: снимок + `heroIds`, `startedAt`, `endsAt` |
| `achievements.counters` | см. ниже | счётчики достижений |
| `achievements.claimed` | `[]` | id полученных достижений |

При миграции счётчики-«максимумы», видные из сохранения, засчитываются сразу: `stages_cleared` (число пройденных
этапов), `tower_floor`, `hero_max_job_level` (включая уровни пройденных профессий). Накопительные — с нуля.

## K8. Пресеты и авто-расстановка

```json
"presets": { "max": 5, "nameMaxLength": 20 }
```

- `savePreset(save, name, mctx, { id?, squad? })` → `{ save, preset }`. Без `id` — новый пресет `p<N>`
  (N — наибольший номер + 1), с `id` — перезапись. `squad` по умолчанию — текущий отряд.
  Ошибки: `invalid_preset_name`, `preset_limit`, `unknown_preset`, `invalid_squad`, `unknown_hero`.
- `applyPreset(save, id)` — ставит отряд; пропавшие герои → пустые слоты. `deletePreset(save, id)`.
- `autoFormation(save, ctx)` → новый `squad` (save не меняет; применить — `{ ...save, squad }`):
  1. 5 самых сильных героев по `heroPower` (с экипировкой, если в контексте есть `equipment`); при равной
     мощи — по id героя;
  2. «передние» — танки (роль профессии `tank`), затем ближний бой (обычная атака `range: melee`) — занимают
     слоты 0, 1, 2… по порядку; «задние» — лекари (`healer`), затем дальний бой — с конца: 4, 3, 2…
     Итог: танки в 0–1, лекари в самом тылу, при нехватке группы соседняя занимает её слоты.

## K9. Доска поручений

```json
{
  "boardSize": 5,
  "dailyRefreshes": 1,
  "rarities": { "common": 70, "rare": 25, "epic": 5 },
  "templates": [
    { "id": "escort", "name": "Сопровождение каравана", "rarity": "common", "durationMinutes": 120,
      "heroCount": 2, "role": "tank", "rewards": { "gold": 300, "jobExp": 50, "gems": 0 } }
  ]
}
```

| Поле шаблона | Что это |
| --- | --- |
| `rarity` | ключ из `rarities` (вес выпадения редкости; шаблон внутри редкости — равновероятно) |
| `durationMinutes` | длительность |
| `heroCount` | сколько героев отправить (ровно), 1–5 |
| `role` | `tank`/`damage`/`healer`/`support` — нужен хотя бы один герой с профессией этой роли; `null` или нет поля — любые |
| `rewards` | `gold`, `gems` — в ресурсы, `jobExp` — каждому герою группы |

- `ensureBoard(save, day, seed, mctx)` — новый день → новая доска бесплатно (UI вызывает при открытии экрана).
  Тот же день или день раньше — тот же объект.
- `refreshBoard(save, day, seed, mctx)` — ручное обновление, не больше `dailyRefreshes` в день
  (`refresh_limit`); в новый день — то же, что `ensureBoard`. `refreshesLeft(save, day, mctx)`.
- Доска детерминирована по (`seed`, день, номер обновления за день). Поручение хранится **снимком** шаблона —
  правка `data/bounties.json` не меняет уже выданные поручения. Поручения в работе обновление не трогает.
- `startBounty(save, bountyId, heroIds, now, mctx)` — с доски в работу, `endsAt = now + durationMinutes`.
  Ошибки: `unknown_bounty`, `wrong_hero_count`, `duplicate_hero`, `unknown_hero`, `hero_busy`, `role_required`.
- **Герой на поручении продолжает сражаться**: кампания, башня, отряд, пресеты — без ограничений. Поручение
  занимает только «слот поручений» героя: на второе поручение его не отправить, пока награда не забрана.
- `bountyStatus(save, now)` — доска, поручения в работе с `remainingMs`/`done`, занятые герои.
- `claimBounty(save, bountyId, now, mctx)` — только при `now ≥ endsAt` (`bounty_not_finished`). Награда,
  герои свободны, достижение `bounties_done + 1`.

## K10. Достижения

```json
{ "id": "tower_5", "name": "Восхождение", "description": "Поднимитесь на 5 этаж башни",
  "counter": "tower_floor", "target": 5, "rewards": { "gems": 20 } }
```

`rewards`: `gold`, `gems` — в ресурсы, `jobExp` — каждому герою (как пороги активности K5); пропущенные — 0.

| Счётчик | Режим | Где считается |
| --- | --- | --- |
| `stages_cleared` | max | число пройденных этапов — после `actPlayStage`/`actSkipStage` и др. |
| `tower_floor` | max | `save.tower.floor` — после `actClimbTower` |
| `jobs_changed` | add | `actChangeJob` |
| `items_equipped` | add | `actEquip` (каждое надевание) |
| `bounties_done` | add | `claimBounty` |
| `battles_won` | add | победы в `actPlayStage`, `actSkipStage`, `actClimbTower` |
| `hero_max_job_level` | max | лучший джоб-уровень героев (с историей профессий) — после любых act* и наград |

- `trackAchievement(save, key, value, mode?)` — `add` копит, `max` хранит максимум (без `mode` — режим из таблицы).
- `syncAchievementCounters(save)` — обновить все «максимумы» из состояния сохранения.
- `achievementStatus(save, mctx)` — список с `progress` (≤ target), `done`, `claimed`.
- `claimAchievement(save, id, mctx)` — награда один раз. Ошибки: `unknown_achievement`, `achievement_not_done`,
  `achievement_already_claimed`.

Функции ядра (`playStage`, `climbTower`, `equip`…) о достижениях не знают — считают только обёртки `act*`,
поэтому UI должен вызывать именно их.
