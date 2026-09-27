# Как добавлять контент

Подробно по разделам: [профессии](content/jobs.md) · [кампания](content/campaign.md) · [баланс-тул](content/balance.md) · [быстрые награды, мощь, задания](content/features.md) · [башня](content/tower.md) · [экипировка](content/equipment.md) · [пресеты, поручения, достижения](content/meta.md).

Юниты (герои, монстры, боссы) и навыки — это JSON-файлы. Код трогать не нужно: игра и симулятор подхватывают новые файлы сами.

```
data/units/<id>.json     юнит: статы, навыки, внешний вид
data/skills/<id>.json    навык: кого бьёт и что делает
data/combat.json         общие правила боя (шкала, энергия, дальность ближнего боя, скорость бега, поле)
data/story/<chapter>.json  сюжет главы: спикеры и диалоговые сцены (раздел «Сюжет» ниже)
data/schema/*.json       JSON-схемы для подсказок в редакторе (генерируются)
assets/manifest.json     UI, эффекты, иконки — по id
assets/sprites/          спрайтшиты v2 (формат — docs/SPRITE_SPEC.md)
assets/sprites.legacy.json  старые листы assets/ro в формате реестра (npm run assets:legacy)
```

## Команды

| Команда | Что делает |
| --- | --- |
| `npm run content:new -- unit <id> --from <id>` | копия юнита с новым id |
| `npm run content:new -- unit <id> --kind monster` | пустой шаблон монстра |
| `npm run content:new -- skill <id> --from <id>` | копия навыка |
| `npm run content:check` | проверка всего: схемы, ссылки, ассеты, спрайтшиты, дымовой бой каждого юнита |
| `npm run content:schema` | перегенерировать JSON-схемы после правки `src/core/content/schema.ts` |
| `npm run sim -- --a <отряд> --b <отряд> --n 1000` | серия боёв: винрейт, длительность, урон по юнитам |
| `npm run sim -- --a <отряд> --log --seed 7` | лог одного боя по событиям |
| `npm run check` | content:check + типы + тесты — перед коммитом |

## Контекст игры

Все данные из `data/` собираются в один полный контекст (`FullContext`) одной функцией ядра — `buildGameContext(raw)` из `src/core/context.ts`:
контент (юниты, навыки, профессии, кампания) → `progression.json` → быстрые награды/мощь/задания (`quests.json`) → экипировка (`items/`, `drops.json`) →
башня (`tower.json`) → поручения и достижения (`bounties.json`, `achievements.json`).

- Игра: `src/game/content.ts` читает файлы через `import.meta.glob` и вызывает `buildGameContext` (`GAME`, `CONTENT`).
- Node (баланс, тесты, `content:check`): `readRawGameData()` / `loadFullContext()` из `scripts/lib/content-node.ts`.

Каждый файл проверяется независимо, ошибки собираются в один список с именами файлов — `npm run content:check` показывает всё сразу,
а битые данные в игре дают `ContentError` при старте. Новый конфиг добавляйте в `RawGameData` и `collectGameContext`, а не в каждое место отдельно.

## Порядок добавления юнита

1. `npm run content:new -- unit knight --from warrior` → `data/units/knight.json`.
2. Поправить имя, роль, статы, навыки. В VS Code поля подсказываются по `$schema`.
3. Если нужен новый навык — `npm run content:new -- skill knight_bash --from warrior_cleave`.
4. Спрайт: положить лист v2 в `assets/sprites/` и описать в `sprites.json`; в юните `visual.sprite` = id спрайта. Пока спрайта нет — рисуется плейсхолдер (content:check предупредит).
5. `npm run content:check`, потом посмотреть бой: `npm run dev` или `npm run sim -- --a knight,... --log`.

## Юнит

```json
{
  "$schema": "../schema/unit.schema.json",
  "id": "knight",
  "name": "Рыцарь",
  "kind": "hero",                      // hero | monster | boss
  "role": "damage",                    // tank | damage | healer | support
  "stats": { "hp": 1400, "atk": 115, "def": 40, "spd": 100, "moveSpeed": 320 },
  "skills": {
    "basic": "basic_melee",            // обычная атака; range навыка решает, ближний ли это боец
    "ult": "knight_bash",              // на 100 энергии
    "passives": ["knight_endure"]      // навыки с trigger
  },
  "visual": { "sprite": "knight", "hitFx": "fx_hit", "projectile": "fx_arrow" }
}
```

`moveSpeed` необязателен (по умолчанию из `combat.json`). `projectile` нужен только дальнему бою.

## Навык

```json
{
  "$schema": "../schema/skill.schema.json",
  "id": "knight_bash",
  "name": "Сокрушение",
  "description": "Удар по цели с шансом оглушить.",
  "icon": "icon_ult_warrior",
  "range": "melee",
  "target": { "side": "enemy", "pick": "nearest", "row": "front" },
  "hits": 1,
  "effects": [
    { "type": "damage", "k": 2.0 },
    { "type": "status", "chance": 0.5, "status": { "id": "stun", "name": "Оглушение", "turns": 1, "stun": true } }
  ]
}
```

**range** — `melee`: применяется, только когда боец стоит вплотную к цели сражения (сначала дойдёт); `ranged`: с любого расстояния.

**target** — кого выбрать:

| Поле | Значения |
| --- | --- |
| `side` | `enemy`, `ally` |
| `pick` | `nearest`, `lowestHp`, `lowestHpPct`, `random`, `all`, `self` |
| `row` | `front` (слоты 0–1), `back` (2–4), `any` (по умолчанию) |
| `rowFallback` | если ряд пуст — брать другой (по умолчанию `true`) |
| `count` | сколько целей (для nearest / lowestHp / random) |
| `includeSelf` | для союзников: учитывать себя |
| `onlyWounded` | только раненые (для лечения) |

**hits** — сколько раз применить эффекты; при `pick: random` цель выбирается заново на каждый удар.

**effects** — выполняются по порядку для каждой цели:

| type | Поля | Что делает |
| --- | --- | --- |
| `damage` | `k` | урон `ATK × k × 100 / (100 + DEF) × разброс` |
| `heal` | `k` | лечение `ATK × k` |
| `shield` | `pctMaxHp` | щит на долю макс. HP цели |
| `status` | `status`, `chance` | статус на `turns` ходов носителя: `stats` (±доли ATK/DEF/SPD), `stun`, `dot: { k }` |
| `energy` | `amount` | добавить/отнять энергию |
| `dash` | — | рывок вплотную к первой цели (ставить перед `damage`) |

**fallback** — навык на случай, если целей нет (лекарь атакует, когда все целы).

**cooldown / castTime / priority** (для активных) — перезарядка и время каста в секундах, приоритет среди активных (больше — раньше; при равенстве — открытый позже). Без `cooldown` — `combat.json → skills.defaultCooldown`. В ход юнит применяет готовый навык с наибольшим приоритетом, для которого есть цели, иначе — обычную атаку. Каст сбивается оглушением.

**trigger** (для пассивок) — `battleStart`, `turnStart`, `hit` (по носителю попали), `kill`, `allyDeath`; `chance` — шанс срабатывания. Пассивка не запускает другие пассивки.

## Сюжет

`data/story/<chapter>.json` — диалоги главы (пример — `data/story/chapter1.json`, замысел — `docs/design/chapter1.md`, разделы 5 и 7).
Схема — `StorySchema` в `src/core/story/schema.ts` (JSON-схема для редактора — `data/schema/story.schema.json`).

```json
{
  "$schema": "../schema/story.schema.json",
  "chapter": "chapter1",                              // id главы из data/campaign
  "speakers": {
    "garret": { "name": "Капитан Гаррет", "portrait": "swordman" },
    "hero1":  { "name": "Алан", "portrait": "hero" },
    "boss":   { "name": "Мастеринг", "portrait": "unit:mob_mastering" }
  },
  "scenes": [
    { "id": "ch1_intro", "trigger": "chapterStart", "lines": [{ "speaker": "garret", "text": "…" }] },
    { "id": "ch1_s10_before", "trigger": "beforeStage", "stageId": "ch1_s10",
      "bossIntro": { "title": "Мастеринг", "subtitle": "Король порингов" }, "lines": [ … ] },
    { "id": "ch1_outro", "trigger": "afterStage", "stageId": "ch1_s10", "lines": [ … ] }
  ]
}
```

| Поле | Что это |
| --- | --- |
| `trigger` | `chapterStart` — при первом входе на карту главы (и перед первым этапом, если ещё не видели); `beforeStage` — перед первым боем этапа, до старта боя; `afterStage` — после первой победы, поверх экрана итогов |
| `stageId` | обязателен для `beforeStage` / `afterStage`, этап должен быть из этой главы |
| `bossIntro` | заголовок баннера босса — только у `beforeStage` босс-этапа |
| `lines` | 1–6 реплик, `text` ≤ 120 символов |
| `speaker` | ключ из `speakers`; `hero1`…`heroN` — герои сохранения по порядку, имя берётся из сохранения |
| `portrait` | `hero` — текущая профессия героя; id профессии; id спрайта; `unit:<id>` — спрайт юнита. Нет картинки — иконка скина (content:check предупредит) |

Каждая сцена показывается один раз: id увиденных — в сохранении (`seenScenes`), на повторах этапа сцен нет.
Какую сцену показать, решает ядро: `pendingScenes(save, trigger, ctx)`; отметка — `markScenesSeen`. Диалог в игре — `src/game/dialogue.ts`
(касание дописывает строку / листает, «Пропустить» закрывает сцену; в авто-прохождении строки листаются сами).

`content:check` проверяет: глава и этапы существуют, этап из этой главы, спикеры объявлены, id сцен уникальны по всем главам,
одна сцена на пару (`trigger`, `stageId`), `bossIntro` только у босс-этапа, длину реплик.

## Как устроен бой (коротко)

- Поле в единицах экрана 1080×1920, слоты в `combat.json → field`. Сторона B — зеркало A.
- Каждый тик шкала юнита растёт на SPD; на 1000 — ход. Равенство решает seed.
- Ближний боец выбирает цель сражения (цель обычной атаки), идёт к ней (`move` в логе) и бьёт, только когда дошёл; пока идёт — ждёт с полной шкалой. Два бойца, нацеленные друг на друга, встречаются посередине.
- Активные навыки (`skills.actives`, у героев — все открытые навыки профессии без trigger): по перезарядке и приоритету, с кастом (событие `cast` в логе).
- Энергия: +25 за атаку или навык, +10 за полученный удар; на 100 — ульта (если есть `skills.ult`, у монстров и боссов).
- Сцена Phaser только проигрывает лог; удар показывается на кадре `hitFrame` анимации.
