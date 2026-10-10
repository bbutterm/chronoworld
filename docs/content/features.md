# Быстрые награды, мощь, ежедневные задания, пропуск боя (K1, K2, K5, K7)

Ядро — `src/core/features/`, всё чистые функции без часов и случайности: день игрока (`'YYYY-MM-DD'`) и время передаёт UI.
Числа — заглушки до баланса.

```
data/progression.json   fastRewards (K1), power (K2) — новые ключи верхнего уровня
data/quests.json        задания и пороги активности (K5)
src/core/features/      config, daily, fastRewards, power, quests, skip, actions, errors
```

## Контекст

Новые ключи `progression.json` не входят в `ProgressionConfigSchema` (она их отбрасывает), поэтому K-функции берут
`FeatureContext` = `GameContext` + `features`:

```ts
import progressionJson from '../../data/progression.json';
import questsJson from '../../data/quests.json';
const fctx = withFeatures(gameCtx, progressionJson, questsJson); // битый конфиг → FeatureError('invalid_config')
```

## Сохранение v2

`SAVE_VERSION = 2`, миграция `MIGRATIONS[1]` добавляет поля с умолчаниями:

| Поле | Умолчание | Что это |
| --- | --- | --- |
| `daily.day` | `'1970-01-01'` | день, к которому относятся счётчики |
| `daily.fastRewardsUsed` | 0 | быстрых наград взято сегодня |
| `daily.quests` | `{}` | счётчики событий заданий: вид события → число |
| `daily.claimedQuests` | `[]` | задания, за которые получены очки |
| `daily.activityClaimed` | `[]` | пороги активности, награда за которые получена |
| `currency.gems` | 0 | гемы — заглушка премиум-валюты (только из заданий) |
| `tower.floor` | 0 | резерв под башню (K4) |
| `inventory.items` | `[]` | резерв под экипировку (K6): `{ id, itemId, equippedBy }` |

`newGame(ctx, now, day?)` и `loadOrNew(storage, ctx, now, day?)` принимают день (по умолчанию `'1970-01-01'`).

## Смена дня — `rollDay(save, day)`

Общая точка сброса суточных счётчиков; её вызывают все K-функции с параметром `day`.
Новый день (строка больше сохранённой) — всё в `daily` обнуляется. Тот же день или день **раньше** (часы переведены
назад) — ничего не меняется: так переводом часов нельзя получить лишние попытки.

## K1. Быстрые награды

```json
"fastRewards": { "hours": 2, "freePerDay": 1, "gemCosts": [50, 80, 100] }
```

- `fastRewardsPreview(save, fctx)` — доход сундука (`offlinePerMinute` последнего пройденного этапа) × `hours` × 60.
  Лимит сундука `offline.capHours` не действует, таймер сундука не сбрасывается.
- `fastRewardsStatus(save, day, fctx)` — `{ used, freeLeft, usesLeft, nextCost }` (`nextCost`: 0 — бесплатно, `null` — всё на сегодня).
- `useFastRewards(save, day, fctx)` → `{ save, rewards, events }`. Сначала `freePerDay` бесплатных, затем платные по
  `gemCosts` по порядку (длина списка = число платных в день). Золото — в ресурсы, опыт — каждому герою.
- Ошибки `FeatureError`: `fast_rewards_limit`, `not_enough_gems`, `no_income` (нет пройденных этапов — попытка не тратится).

## K2. Мощь

```json
"power": { "hp": 0.1, "atk": 2, "def": 1.5, "spd": 0.5, "perActive": 50, "perPassive": 30 }
```

```
мощь = round(hp·0.1 + atk·2 + def·1.5 + spd·0.5 + 50·активных + 30·пассивных)
```

Активные — навыки сверх обычной атаки (у юнита это ульта: 0 или 1), пассивные — `skills.passives`.

- `unitPower(unit, fctx)` — любой `UnitDef` (герой, монстр);
- `heroPower(hero, fctx)` — через `buildUnit`;
- `squadPower(save, fctx)` — сумма героев в слотах отряда;
- `stagePower(stageId, fctx)` — сумма врагов этапа (`enemySquad`, с ростом по кривой кампании).

Мощь только для экранов и баланса — на бой не влияет.

## K5. Ежедневные задания

`data/quests.json`:

```json
{
  "quests": [
    { "id": "win_stages", "name": "Победить в 3 боях кампании или Башни", "event": "battle_win", "target": 3, "points": 20 }
  ],
  "milestones": [
    { "points": 20, "rewards": { "gold": 200, "gems": 0, "jobExp": 0 } }
  ]
}
```

- `id` — уникален; `event` — вид события (ниже); `target` — сколько раз за день; `points` — очки активности за задание.
- `milestones` — пороги очков по возрастанию; награда: `gold`, `gems`, `jobExp` (каждому герою). Поля награды необязательны (0).

Виды событий:

| event | Когда засчитывается |
| --- | --- |
| `stage_attempt` | любой бой кампании (в т. ч. пропущенный) |
| `stage_win` | победа в бою кампании |
| `battle_win` | победа в бою кампании или Башни (`win_stages`: повторов этапов нет — у «стены» победы добираются в Башне) |
| `offline_claim` | сбор непустого офлайн-сундука |
| `fast_rewards` | взяты быстрые награды |
| `summon` | каждая карточка, призванная в Таверне |
| `hero_level_up` | каждый уровень, поднятый «Улучшить» (`actLevelUp`) |
| `hero_ascend` | вознесение карточки (`actAscend`) |

Функции:

- `recordActivity(save, day, kind, amount = 1)` — прибавить счётчик (после `rollDay`);
- `questStatus(save, fctx, day?)` — задания с прогрессом, очки активности, пороги (`reached`, `claimed`);
- `claimQuest(save, day, questId, fctx)` — забрать очки за выполненное задание (`unknown_quest`, `quest_not_done`, `quest_already_claimed`);
- `claimActivity(save, day, milestone, fctx)` — награда порога (`unknown_milestone`, `not_enough_activity`, `milestone_already_claimed`).

Очки активности = сумма `points` заданий, за которые получена награда.

### Обёртки действий (для UI)

Функции кампании и профессий о заданиях не знают. UI вызывает обёртки из `features/actions.ts` — они вызывают ядро и
засчитывают события:

| Обёртка | Вызывает | Засчитывает |
| --- | --- | --- |
| `actPlayStage(save, day, stageId, seed, ctx)` | `playStage` | `stage_attempt`, `stage_win`, `battle_win` |
| `actSkipStage(save, day, stageId, seed, ctx)` | `skipStage` | то же |
| `actClaimOffline(save, now, day, ctx)` | `claimOffline` | `offline_claim` (если что-то получено) |
| `actLevelUp(save, day, heroId, ctx, times?)` | `levelUpHero` | `hero_level_up` (по числу уровней) |
| `actAscend(save, day, heroId, fodderIds, ctx)` | `ascendHero` | `hero_ascend` |
| `actSummon(save, day, count, pay, ctx)` | `summon` | `summon` (по числу карточек) |
| `actUseFastRewards(save, day, fctx)` | `useFastRewards` | `fast_rewards` |
| `actClaimQuest(save, day, questId, fctx)` | `claimQuest` | — (только очки) |
| `actClaimActivity(save, day, milestone, fctx)` | `claimActivity` | — (`jobExp` порога — в общий пул) |
| `actClaimExpedition(save, day, locationId, now, ctx)`, `actClaimAllExpeditions(save, day, now, ctx)` | `claimExpedition`, `claimAllExpeditions` (K9) | — (`jobExp` — в пул, осколки — «отстающему», предметы — в инвентарь) |

С v4 (карточки героев) опыт всех наград идёт в общий пул `resources.heroExp`, уровни поднимает только «Улучшить».
| `actClaimAchievement(save, day, id, mctx)` | `claimAchievement` (K10) | `hero_level_up` (`jobExp` достижения) |

`hero_level_up` считает level-up из **всех** источников опыта: `hero_level_up += число событий levelUp` в ответе.
Счётчики достижений эти четыре функции ядра обновляют сами, обёртки их не дублируют. Рекурсии нет: засчитанный
level-up только увеличивает `daily.quests.hero_level_up` — задание `level_ups` не забирается автоматически,
игрок забирает его сам (`actClaimQuest`).

## K7. Повтор и пропуск боя

Выключено в выпущенных данных (`data/progression.json → campaign.replay: false`, решение владельца 10.10.2026): как в AFK Arena,
пройденный этап больше не сражается — обе функции и `playStage` бросают `GameRuleError('stage_cleared')`, экран этапа
показывает пройденный этап только для просмотра. Ниже — поведение при `replay ≠ false` (тесты, песочница адвансов).

- `skipStage(save, stageId, seed, ctx)` — только для пройденного этапа (`FeatureError('stage_not_cleared')`).
  Это обычный `playStage` (тот же seed → тот же итог, награда за повтор × `campaign.replayRewardMultiplier`),
  но из результата убран лог (`result.log = []`). Бой можно и проиграть — итог честный.
- `repeatStage(save, stageId, seed, ctx)` — то же для пройденного этапа, но с логом, чтобы показать бой.

## События для UI

Кроме событий прогрессии (`rewards`, `levelUp`, …): `fastRewardsUsed { gemCost, hours }`, `gems { amount }`,
`questClaimed { questId, points, activity }`, `activityClaimed { milestone }`.
