# Рецепты контента: «как добавить X»

Пошагово: какие файлы, какие поля, какие команды. Модель данных целиком — [`AGENTS.md`](AGENTS.md), раздел 2;
форматы подробно — [`CONTENT.md`](CONTENT.md) и `docs/content/*.md`. Код для контента трогать не нужно: игра, симулятор и
проверки подхватывают новые JSON сами (`import.meta.glob` в `src/game/content.ts`, `readRawGameData` в Node).

Каждый рецепт заканчивается одинаково: `npm run content:check` (✗ — ошибка, ⚠ — предупреждение) → `npm run check` → глазами
(`npm run dev`, или `npm run e2e` / `npm run e2e:chapter1` для экранов).

## Генераторы `npm run content:new`

Логика — `scripts/lib/content-gen.ts`, тест — `tests/content-new.test.ts`. Существующие файлы не перезаписываются (кроме главы в `stage`).
Заготовки сразу проходят content:check; места «дописать руками» помечены строкой `TODO` — content:check выводит каждую как
предупреждение `⚠ файл: путь.поля — TODO: …`. Перед слиянием в main TODO в `data/` быть не должно.

| Команда | Что создаёт |
| --- | --- |
| `unit <id> --from <id>` | копия юнита, `visual.sprite = <id>` (нет листа — плейсхолдер и ⚠) |
| `unit <id> --kind monster` | пустой шаблон юнита (hero/monster/boss) |
| `skill <id> [--from <id>]` | копия навыка или шаблон «урон k 1 по ближайшему» |
| `boss <id> [--from mob_boss1] [--sprite <id>] [--name "…"]` | `data/units/<id>.json` (kind boss) + своя ульта `data/skills/<id>_ult.json` (копия ульты образца) |
| `chapter <id> [--name "…"] [--order N] [--prefix chN] [--mobs a,b,c] [--boss <id>] [--no-story]` | `data/campaign/<id>.json`: 10 этапов `<prefix>_s1…s10` (3/4/5 врагов, 10-й — босс ×0.5), награды — продолжение прошлой главы +10%/этап; и `data/story/<id>.json` |
| `stage <chapterId> [--from <stageId>] [--append]` | новый этап `<prefix>_s<N+1>` — копия соседнего, встаёт перед босс-этапом (или в конец) |
| `story <chapterId>` | сюжет главы: `<prefix>_intro` (chapterStart), `<bossStage>_before` (beforeStage + bossIntro), `<prefix>_outro` (afterStage последнего этапа) |

Для `chapter` без `--mobs` берутся рядовые монстры последней главы, без `--boss` — `mob_boss1` (Герой орков); `--prefix` для
id вида `chapterN` выводится сам (`ch<N>`).

---

## 1. Новый монстр

1. `npm run content:new -- unit mob_poring_king --from mob_fast` (или `--kind monster`). Файл: `data/units/mob_poring_king.json`.
2. Поля: `name` (русское), `kind: "monster"`, `role` (tank/damage/healer/support — цвет плейсхолдера и мощь),
   `stats` — **базовые** (сила на этапе = база × `mult` × 1.08^globalIndex), `moveSpeed` по желанию (Фабр 240, Люнатик 400).
3. Навыки: `skills.basic` (`basic_melee` / `basic_ranged`), `skills.ult` — свой навык `mob_<имя>_<действие>` (см. рецепт 3), при желании
   `actives` с `cooldown`/`priority` и `passives` с `trigger`.
4. Вид: `visual.sprite` — id из `assets/sprites/sprites.json` (список: `python3 -c "import json;print([s['id'] for s in json.load(open('assets/sprites/sprites.json'))['sprites']])"`);
   дальнему — `visual.projectile` (`fx_arrow`, `fx_magic`); вариант на чужом листе — `visual.tint: "#rrggbb"` и/или `visual.scale`.
5. Поставить в этап (`data/campaign/*.json`) или в башню (`data/tower.json → bands[].layouts`).
6. `npm run content:check` (дымовой бой каждого юнита), `npm run sim -- --a warrior,guard,archer,mage,priest --b mob_poring_king,mob_fast --log --seed 7`.

## 2. Новый босс (с баннером и сценой перед боем)

1. `npm run content:new -- boss mob_orc_lord --from mob_boss1 --sprite boss1 --name "Лорд орков"` → юнит `kind: boss` + ульта `mob_orc_lord_ult`.
2. Дописать ульту (`name`, `description`, эффекты) и при желании `actives` (щит, рывок в тыл — как у `mob_mastering`), `passives`.
   Большая фигура: `visual.scale` (Мастеринг 1.3); тело шире — `bodyRadius` (по умолчанию у босса 90).
3. Этап: `boss: true`, босс в слоте фронта, `mult` ~0.4–0.8 (стартовое значение — 0.5, потом рецепт 13). content:check требует
   юнита `kind: boss` на `boss`-этапе.
4. **Баннер «ИМЯ · Босс главы» и полоска HP босса** в бою появляются сами (`BattleScene`: этап `boss: true` + юнит `kind: boss`).
5. **Сцена перед боем** — в `data/story/<глава>.json` сцена `trigger: "beforeStage"`, `stageId` босс-этапа, `bossIntro: {"title": "Лорд орков",
   "subtitle": "Владыка степей"}`, спикер с `portrait: "unit:mob_orc_lord"`.
6. Арт: лист класса `boss` (256×256) — рецепт 12.

## 3. Новый навык

1. `npm run content:new -- skill job_knight_brandish --from job_swordman_magnum_break` → `data/skills/<id>.json`.
   Имена: `job_<профессия>_<навык RO>` для профессий, `mob_<монстр>_<действие>` для монстров.
2. Поля: `name`, `description` (числа в описании = числа в эффектах), `range` (melee — только вплотную к цели сражения),
   `target` (`side`, `pick`, `row`, `count`, `onlyWounded` для лечения), `hits`, `effects`.
3. **Активный:** без `trigger`; `cooldown` (сек, 0 — без перезарядки), `castTime` (сек, оглушение сбивает), `priority`
   (лечение ~10, баффы ~5). Юниту — в `skills.actives`, профессии — в `skills [{jobLevel, skill}]`.
4. **Пассивный:** `trigger` (`battleStart` — баффы на старте, `hit`, `kill`, `allyDeath`, `turnStart`) + `chance`. Юниту — в `skills.passives`, профессии — туда же, где активные (различие по `trigger`).
5. **Ульта** (только монстры/боссы): `skills.ult`, срабатывает на 100 энергии.
6. **Эффект в бою:** по умолчанию выводится из id и эффектов (`src/game/skillLook.ts`: стихия по словам fire/frost/thunder/holy…,
   снаряд/площадь по `pick`, `range`). Нужен конкретный — строка в `FX_OVERRIDE` (`projectile`: fireball/ice/lightning/beam/arrow/meteor/rock…,
   `area`: lightning/ring/arrows/blizzard/holy/quake/cloud/sanctuary). Кадры RO на попадание/бафф — `assets/effects/effects.json → skills`:
   `"job_knight_brandish": {"hit": "fx_hit"}`.
7. **Иконка:** своя — `assets/ui/icons/skill_<id навыка>.png` (подхватится сама); иконка RO — извлечь (`tools/extract_ro_skill_icons.py`,
   добавить имя в `SKILLS`) и прописать `RO_SKILL_ICONS['<id навыка>'] = '<ro_имя>'` в `skillLook.ts`; ничего — символ кодом.
8. Бой рывком в тыл, после которого боец остаётся там, — id навыка в `combat.json → movement.diveStay`.
9. Проверка: content:check (навык без владельца — ⚠), `npm run sim -- --log --seed 7`, `tests/actives.test.ts` как образец теста.

## 4. Новая профессия (в том числе вторая)

1. Скопировать ближайшую: `cp data/jobs/knight.json data/jobs/lord_knight.json`; `id`, `name`, `description`.
2. `tier` (1 — первая, 2 — вторая), `from: ["<профессия tier ниже>"]`, `maxJobLevel` (50), `role`, `baseStats`, `growth`, `basic`.
   Порог перехода — `progression.json → jobChange.tierLevel`. Tier 3 сейчас схемой не поддерживается (`tier` 0–2).
3. `skills`: 5 навыков на уровнях 1/10/20/30/40 (на уровне — не больше одного), навыки — рецепт 3.
4. Вид: `visual.sprite` (лист героя 224×192 с `cast`), `visual.projectile` для дальних, `hitFx`.
   Бюст для рамки портрета — `assets/ro/portraits/hero_<id спрайта>_portrait.png` (256×256), необязателен.
   **Варианты по полу:** лист `<id спрайта>_f` / `<id спрайта>_m` в `sprites.json` (и бюст `hero_<id спрайта>_<f|m>_portrait.png`)
   подхватываются сами для героинь / героев — в `data/jobs` ничего не менять. Нет варианта — базовый лист (его пол — `source.gender`;
   `acolyte`, `priest` — женские, остальные — мужские). Список недостающих — `docs/ART_EXTRACT_RO.md`, раздел 7.
5. Предметы только для ветки — `data/items/*.json → jobs: ["<корень ветки>"]`.
6. Экраны (Герои, Смена профессии, дерево) строятся из `data/jobs` сами. Для прогона главы ядром первые профессии заданы
   в `scripts/playthrough.ts` (`FIRST_JOBS`).
7. Проверка: content:check (достижимость от Новичка, уровни навыков, дымовой бой героя профессии на максимуме), `tests/jobs.test.ts`.

## 5. Новый этап

1. `npm run content:new -- stage chapter2` — копия предыдущего этапа, встаёт перед босс-этапом с новым id (`ch2_s11`).
   Порядок в массиве `stages` = порядок в игре; id менять нельзя, если глава уже в проде.
2. Поля: `name`, `enemies` (5 слотов, хотя бы один враг, только monster/boss), `mult`, `rewards`, `offlinePerMinute` (не меньше прошлого этапа).
3. Сцена «перед/после этапа» — рецепт 7.
4. Проверка: content:check; `tests/chapters.test.ts` ждёт ровно 10 этапов в главах 1–3 — обновить ожидание, если это осознанно; баланс — рецепт 13.

## 6. Новая глава

1. Монстры (рецепт 1) и босс (рецепт 2) — сначала, генератор проверяет, что они есть.
2. `npm run content:new -- chapter chapter4 --name "Глава 4. Пустыня Сограт" --mobs mob_a,mob_b,mob_c --boss mob_boss_x`
   → `data/campaign/chapter4.json` (order = следующий) + `data/story/chapter4.json`.
3. Дописать TODO: названия этапов, составы и `mult`, `$comment` удалить после баланса. Правило: Σhp и Σatk этапа не меньше предыдущего.
4. **Сюжет** — рецепт 7 (вступление, сцена перед боссом с `bossIntro`, финал с крючком к следующей главе).
5. **Фоны:** тема главы — по порядку (луг, топь, склеп, дальше по кругу, `backdrops.ts`). Файлы владельца — `assets/backgrounds/bg_battle_ch<N>.jpg`,
   `bg_map_ch<N>.jpg`; для N ≥ 4 сейчас нужна правка `backdrops.ts` (новая тема в `THEMES` и её рисование/файл) — иначе повторится тема 1–3.
6. **Рекрут:** `data/progression.json → heroes.recruits` `{"afterStage": "ch4_s10", "name": "…", "gender": "m|f"}` (пол — часть образа героя) (сейчас максимум отряда 5 — рекрут
   после главы 3 даст 6-го героя вне отряда; решить с владельцем).
7. **Башня:** новая полоса `data/tower.json → bands` `{"fromFloor": 60, "name": "…ярус", "layouts": [...], "bossLayouts": [...]}` из монстров главы.
8. **Выпадение:** при желании своё правило `data/drops.json → rules` с `chapter: "chapter4"`.
9. **Тесты:** `tests/chapters.test.ts` (число глав/этапов) — обновить; прохождение — `npm run playthrough -- 3 3 --idle --winrate 200`.

## 7. Новая сюжетная сцена

1. Файл главы `data/story/<глава>.json` (нет — `npm run content:new -- story <глава>`).
2. Спикеры: `speakers.<ключ> = {name, portrait}`; `hero1…heroN` — герои игрока (имя из сохранения, `portrait: "hero"`);
   `portrait` — id профессии (`swordman`), id спрайта или `unit:<id юнита>`. Пол сюжетных героев фиксирован (`progression.heroes`) —
   род в их репликах ставить можно; рекрут до вступления — спикер со своим ключом и именем (`greta`), лист по его полу.
3. Сцена: `{id (уникален по всем главам, например ch4_s5_after), trigger: chapterStart|beforeStage|afterStage, stageId (кроме chapterStart), lines}`;
   1–6 реплик, `text` ≤ 120 символов; `bossIntro` — только у beforeStage босс-этапа. Одна сцена на пару (trigger, этап).
4. Показ один раз на сохранение; уже вышедшую сцену не переименовывать (id в `save.seenScenes`). Дизайн глав — `docs/design/chapter1.md`.
5. Проверка: content:check (схема, спикеры, этапы, портреты — ⚠, если картинки нет), `tests/story.test.ts`.

## 8. Новый предмет

1. В `data/items/<слот>.json` → `items[]`: `{id, name, slot (weapon|armor|helmet|boots), rarity (common|rare|epic), stats {hp?, atk?, def?, spd?}, jobs?, drop?}`.
2. `drop: false` — не выпадает с этапов. Шансы редкостей — `data/drops.json`.
3. Иконка рисуется кодом по слоту и редкости (`src/game/itemIcons.ts`), арт не нужен.
4. Проверка: content:check, `tests/equipment.test.ts`. Удалённый предмет сохранения переживут (`sanitizeSave` уберёт его с предупреждением).

## 9. Ежедневное задание, поручение, достижение

- **Задание** — `data/quests.json → quests[]`: `{id, name, event, target, points}`; `event` — одно из `ACTIVITY_KINDS`
  (`src/core/features/quests.ts`: stage_win, stage_attempt, offline_claim, fast_rewards, job_change, hero_level_up, tower_attempt).
  Новый вид события — правка ядра (`ACTIVITY_KINDS` + запись в обёртке `act*` в `src/core/features/actions.ts`) и тест.
  Пороги активности — `milestones`.
- **Поручение** — `data/bounties.json → templates[]`: `{id, name, rarity, durationMinutes, heroCount, role|null, rewards {gold, jobExp, gems}}`;
  `role` должна быть у какой-то профессии (content:check). Баланс шаблонов — открытый вопрос владельцу (см. PROGRESS).
- **Достижение** — `data/achievements.json → achievements[]`: `{id, name, description, counter, target, rewards}`; `counter` — из
  `ACHIEVEMENT_COUNTERS` (`src/core/meta/config.ts`); новый счётчик — правка ядра + тест `tests/meta-achievements.test.ts`.
- Подробно — `docs/content/features.md`, `docs/content/meta.md`.

## 10. Сохранение: новое поле

Необязательное поле (`.optional()` / `.default()`) в `SaveStateSchema` — без смены версии. Обязательное — `SAVE_VERSION + 1`, миграция
в `MIGRATIONS` (`src/core/save/save.ts`), тест в `tests/save.test.ts` / `tests/p11-saves.test.ts`.

## 11. Башня: состав или полоса

`data/tower.json → bands[i].layouts` (обычные этажи по кругу) / `bossLayouts` (каждый `bossEvery`-й этаж). 5 слотов как у этапа.
Проверка: content:check, `tests/tower.test.ts`; `docs/content/tower.md`.

## 12. Подключение арта владельца

Сначала `git fetch origin && git merge origin/main` (владелец кладёт арт в main). Что ждём — issues #17–#26, `docs/ART_NEEDED.md`, `docs/FX_NEEDED.md`.

| Что | Куда | Регистрация |
| --- | --- | --- |
| Лист юнита/героя | `assets/sprites/{heroes,monsters,bosses}/<id>.png` по `docs/SPRITE_SPEC.md` | запись в `assets/sprites/sprites.json` (id, class, file, portrait, hitFrames, bbox) — обычно `tools/build_sprites_v2.py --only <id>`; старый лист v1 из `assets/ro` — `--from-v1`; затем `visual.sprite` у юнита/профессии |
| Портрет 64×64 | `assets/sprites/portraits/<id>.png` | поле `portrait` в `sprites.json` |
| Бюст героя | `assets/ro/portraits/hero_<id спрайта>_portrait.png` (вариант по полу — `hero_<id спрайта>_<f\|m>_portrait.png`) | сам (glob в `portraitFrame.ts`) |
| Лист героя по полу | `<id спрайта>_f` / `_m` в `assets/sprites/sprites.json` | сам (`flow.ts heroSprite`, откат на базовый лист) |
| Битые кадры | — | `assets/sprites/fixes.json` → `{"<id>": {"skip": {"death": [2, 3]}}}` |
| Иконка навыка | `assets/ui/icons/skill_<id навыка>.png` (квадрат, рисуется в 96×96) | сама; RO-иконка — `RO_SKILL_ICONS` |
| Эффект | `assets/effects/<id>.png` (атлас) | `assets/effects/effects.json → effects` (cell, columns, frames, ms, anchor) и `→ skills` |
| Фон боя/карты главы | `assets/backgrounds/bg_battle_ch<N>.jpg`, `bg_map_ch<N>.jpg` | сам (glob в `backdrops.ts`), N — тема 1–3 |
| UI (кнопки, панели, сундук, иконки) | `assets/ui/*.png` | `assets/manifest.json → assets.<id>` (`file`, `w`, `h`, `slice` для 9-slice); id скина из `skin.ts` — файл побеждает |
| Звук | — | системы звука пока нет (issue #26): нужен загрузчик в `BootScene` и вызовы в сценах — отдельная задача |

После: `python3 tools/check_sprites.py`, `python3 -m unittest discover -s tests -p 'test_*.py'`, `npm run content:check`, `npm run assets:report`,
глазами (`npm run dev`); отметить issue и `docs/qa/FIXLIST.md` «Ждёт графики».

## 13. Баланс главы

1. Цель: главы 1 — этапы 1–9 100% побед перед первой попыткой, босс ~⅔–80%; дальше — плавные стены «забери сундук», босс — 1–2 полных сундука.
2. Замер: `npm run playthrough -- <индекс главы с 0> 3 --winrate 200` (--winrate 600 для точной цифры босса — минуты, в фон);
   для глав 2+ добавить `--idle` (печатает часы сундука на этап). Прошлые главы проигрываются молча.
3. Крутить `mult` этапа (шаг 0.01–0.05; кривая у босса крутая: у Мастеринга 0.80 → 88%, 0.84 → 47%), затем состав. Статы монстра
   в `data/units` не трогать ради одного этапа — монстр общий.
4. Правило: Σhp и Σatk этапа не меньше предыдущего (`tests/chapters.test.ts` проверяет главы 2–3); `offlinePerMinute` растёт.
5. Итог: `npm run balance` (14 дней всей экономики), записать таблицу и метод в `docs/content/campaign.md` (как для глав 1–3).
6. После правок боя/профессий/главы 1 — перемерить босса главы 1 и `tests/chapter1-playthrough.test.ts`.
