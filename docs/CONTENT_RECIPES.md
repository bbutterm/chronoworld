# Рецепты контента: «как добавить X»

Пошагово: какие файлы, какие поля, какие команды. Модель данных целиком — [`AGENTS.md`](AGENTS.md), раздел 2;
форматы подробно — [`CONTENT.md`](CONTENT.md) и `docs/content/*.md`. Код для контента трогать не нужно: игра, симулятор и
проверки подхватывают новые JSON сами (`import.meta.glob` в `src/game/content.ts`, `readRawGameData` в Node).

Каждый рецепт заканчивается одинаково: `npm run content:check` (✗ — ошибка, ⚠ — предупреждение) → `npm run check` → глазами
(`npm run dev`, или `npm run e2e` / `npm run e2e:chapter1` для экранов).

## Генераторы `npm run content:new`

Логика — `scripts/lib/content-gen.ts`, тест — `tests/content-new.test.ts`. Существующие файлы не перезаписываются (кроме главы в `stage`
и `data/progression.json` в `hero --story`).
Заготовки сразу проходят content:check; места «дописать руками» помечены строкой `TODO` — content:check выводит каждую как
предупреждение `⚠ файл: путь.поля — TODO: …`. Перед слиянием в main TODO в `data/` быть не должно.

| Команда | Что создаёт |
| --- | --- |
| `unit <id> --from <id>` | копия юнита, `visual.sprite = <id>` (нет листа — плейсхолдер и ⚠) |
| `unit <id> --kind monster` | пустой шаблон юнита (hero/monster/boss) |
| `skill <id> [--from <id>]` | копия навыка или шаблон «урон k 1 по ближайшему» |
| `boss <id> [--from mob_boss1] [--sprite <id>] [--name "…"]` | `data/units/<id>.json` (kind boss) + своя ульта `data/skills/<id>_ult.json` (копия ульты образца) |
| `chapter <id> [--name "…"] [--order N] [--prefix chN] [--mobs a,b,c] [--boss <id>] [--no-story]` | `data/campaign/<id>.json`: 10 этапов `<prefix>_s1…s10` (3/4/5 врагов, 10-й — босс ×0.5, все `mult` 1 — подобрать); экономика по формуле баланса: сундук `offlinePerMinute` +9%/этап от последнего этапа прошлой главы, золото 0.7 от опыта, `rewards` = 30 мин сундука (босс — 45); и `data/story/<id>.json` |
| `stage <chapterId> [--from <stageId>] [--append]` | новый этап `<prefix>_s<N+1>` — копия соседнего, встаёт перед босс-этапом (или в конец) |
| `story <chapterId>` | сюжет главы: `<prefix>_intro` (chapterStart), `<bossStage>_before` (beforeStage + bossIntro), `<prefix>_outro` (afterStage последнего этапа) |
| `hero <id> --class <job> --gender m\|f [--rarity green\|blue\|purple] [--sprite <id>] [--name "…"]` | призывная карточка `data/heroes/<id>.json`: `line`, `role` — из класса; редкости по правилам (первая профессия — green (или blue) → gold, вторая — purple → red); навыки 1/10/30/50 из навыков класса, подобраны так, чтобы с карточками того же класса было ≤ 2 общих и другой фирменный (если нельзя — меньше навыков); `statMods` пустые; имя, bio, hook, `$comment` — TODO. В Таверну регистрировать не нужно |
| `hero <id> --class <job 1-й профессии> --gender m\|f --story [--form <job 2-й>] [--after <stageId>]` | сюжетная карточка green → red + форма второй профессии на purple (`promotion` — TODO) и рекрут в `data/progression.json → heroes.recruits` (по умолчанию — после последнего этапа кампании) |

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
6. **Профессия — класс карточки героя** (v4): чтобы игрок её увидел, нужна карточка с этим классом (рецепт 4а) — сюжетная форма
   или призывная карточка. Навыки героям даёт карточка, а `skills` профессии — справочник «навыков своей линии» (⚠ content:check).
7. Проверка: content:check (достижимость от Новичка, уровни навыков), `tests/jobs.test.ts`.

## 4а. Новая карточка героя

Дизайн и таблицы — `docs/design/heroes.md`; модель и API — `docs/AGENTS.md`, разделы 2 и 2а.

0. **Генератор** (быстрый путь, заготовка сразу проходит content:check — только ⚠ TODO и ⚠ арта):
   ```
   npm run content:new -- hero nia --class hunter --gender f                    призывная, вторая профессия: purple → red
   npm run content:new -- hero tom --class thief --gender m --rarity blue       призывная, первая профессия: blue → gold
   npm run content:new -- hero mira --class archer --gender f --story --form bard --after ch4_s10   сюжетная + рекрут
   ```
   Дальше — дописать TODO (имя, bio, hook, `promotion` формы), подобрать `statMods` (п. 1), проверить навыки (п. 2), удалить `$comment`.
   Список классов — ошибка генератора без `--class` его печатает. Несколько карточек подряд — просто несколько команд: каждая
   учитывает уже созданные (навыки подбираются с оглядкой на карточки того же класса).
1. Файл `data/heroes/<id>.json` (генератор или копия ближайшей: `cp data/heroes/iris.json data/heroes/<id>.json`). id — латиница, после
   выпуска не менять (лежит в сохранениях). Поля:
   - `name` (уникально, по-русски), `gender` (`m`/`f`), `job` — класс из `data/jobs`, `line` — первая профессия его ветки
     (для Рыцаря — `swordman`), `role` (`tank|damage|healer|support` — своя у карточки, авторасстановка и поручения берут её);
   - `source`: `summon` — выпадает в Таверне; `story` — выдаёт сюжет (тогда id в `data/progression.json → heroes.start` или `recruits`);
   - редкости: первая профессия призыва — `baseRarity` `green` (выпадает зелёной и синей), `maxRarity` ≤ `gold`; вторая профессия —
     `purple` → `red`; сюжетная — `green` → `red` + `forms: [{rarity: "purple", job: <вторая профессия линии>, role, statMods,
     skills, visual, promotion}]` (`promotion` — строка истории ≤ 200 симв. на экране вознесения, когда герой получает профессию);
   - `statMods` {hp, atk, def, spd} — множители к статам линии (танк: hp/def выше, atk ниже; сумма у вторых профессий ≈ ×1,2–1,3);
   - `skills` — 2–4 навыка `[{level, skill}]`, уровни строго растут, первый — 1 (обычно 1/10/30/50), не выше предела `maxRarity`
     (зелёный 20, синий 40, фиолетовый 60, золотой 80, красный 100). Навыки — своей линии; новый навык — рецепт 3;
   - `visual.sprite` — свой лист (id из `assets/sprites/sprites.json`, например `wizard_f`), у формы — свой; нет — лист класса по полу;
   - `bio` (≤ 160) и `hook` (≤ 200) — кто это и крючок для сцен.
2. Правило различия (⚠): у карточек одного класса общих навыков ≤ 2, «фирменный» (последний) навык разный.
3. В Таверне карточка появится сама (пулы — `data/summon.json → rates[].baseRarities`, регистрировать не нужно). Правила вознесения её
   дорожки уже есть (`data/cards.json → merge`: `first`/`second` — корм, `story` — осколки); content:check проверит. Сюжетная — только
   через `data/progression.json → heroes.start/recruits` (генератор с `--story` добавляет сам; нет — ✗).
4. Проверка: `npm run content:check` (схема, ссылки, навыки, редкости, дымовой бой на пределе каждой редкости; раздел 8 —
   `scripts/lib/content-check-heroes.ts`: ✗ лист карточки не находится ни свой, ни класса / призывную карточку Таверна не выдаёт
   (baseRarity или maxRarity мимо `rates`); ⚠ своего листа нет в реестре, лист чужого пола, у листа нет портрета, общие навыки),
   `npm run check`; глазами — карточка в «Героях» (для призывной — вручную добавить в сохранение или призвать в Таверне).
5. Арт: лист `<класс RO>_<m|f>` (например `sage_f`) по `docs/SPRITE_SPEC.md` + запись в `sprites.json` → `visual.sprite` карточки.

## 5. Новый этап

1. `npm run content:new -- stage chapter2` — копия предыдущего этапа, встаёт перед босс-этапом с новым id (`ch2_s11`).
   Порядок в массиве `stages` = порядок в игре; id менять нельзя, если глава уже в проде.
2. Поля: `name`, `enemies` (5 слотов, хотя бы один враг, только monster/boss), `mult`, `rewards`, `offlinePerMinute` (не меньше прошлого этапа).
3. Сцена «перед/после этапа» — рецепт 7.
4. Проверка: content:check; `tests/chapters.test.ts` проверяет структуру любой главы (босс — последний этап, id `<префикс>_s<N>`,
   Σhp/Σatk не убывают) и ровно 10 этапов только у выпущенных глав 1–3; баланс — рецепт 13 (окно нового этапа регулятор возьмёт
   у предыдущего этапа, если его нет в `data/progression.json → balance.windows`).

## 6. Новая глава: чеклист от заготовки до баланса

Порядок важен: каждая следующая команда опирается на предыдущую. Пример — глава 4 (индекс 3 в `playthrough`).

1. **Монстры и босс.** Монстры — рецепт 1 (`npm run content:new -- unit mob4_x --from mob3_melee`), босс — рецепт 2
   (`npm run content:new -- boss mob4_boss --from mob3_boss --name "…"`). Генератор главы проверяет, что они есть.
2. **Заготовка:** `npm run content:new -- chapter chapter4 --name "Глава 4. Пустыня Сограт" --mobs mob4_a,mob4_b,mob4_c --boss mob4_boss`
   → `data/campaign/chapter4.json` (order = следующий, этапы `ch4_s1…s10`) + `data/story/chapter4.json`. Без `--mobs` — монстры прошлой
   главы. Сундук и награды уже посчитаны по формуле баланса (`docs/content/balance.md`, раздел 2) — не трогать без причины.
3. **`npm run content:check`** — должны быть только ⚠ TODO (и ⚠ арта). Это точка «заготовка цела».
4. **Дизайн этапов:** названия, составы (5 слотов), `mult` (стартовое 1, босс 0.5). Правило: Σhp и Σatk этапа не меньше предыдущего
   (`tests/chapters.test.ts`). Первый грубый замер: `npm run playthrough -- 3 3 --idle` (часы сундука на этап).
5. **Сюжет** — рецепт 7: TODO в `data/story/chapter4.json` (вступление, сцена перед боссом с `bossIntro`, финал с крючком).
6. **Рекрут (если есть):** `npm run content:new -- hero <id> --class <1-я профессия> --gender m|f --story --after ch4_s10` (рецепт 4а);
   спикер-рекрут в сюжете — рецепт 7. Сейчас максимум отряда 5 — шестой герой вне отряда (решить с владельцем).
7. **Баланс по графику.** Скрипт не правится: регулятор сам находит главу в `data/campaign`. Окна первого прохождения (часы от начала
   первой сессии) — `data/progression.json → balance`: без записей глава получает окна по правилу `balance.default` от босса прошлой
   главы (гл. 4 — дни 5–7: `ch4_s1–s3 [108, 124.5]` … `ch4_s10 [150, 166.5]`, стена каждые 3 этапа; docs/content/balance.md, раздел 6).
   Свой график — дописать окна этапов в `balance.windows` (`"ch4_s1": [108, 124.5]`, …). Затем:
   `npx tsx scripts/balance-fit.ts 1 0.8 --dry --chapter 4` (где этапы относительно окон; первой строкой — окна главы) →
   `npx tsx scripts/balance-fit.ts 15 0.7 --chapter 4` (подбирает `mult` целиком по этапу, держит монотонность Σ; лучший вариант
   остаётся в `data/campaign`). Дней модели скрипт берёт сам (`balance.fitDays`, но не меньше, чем нужно окнам); `--days D` — вручную.
8. **Рекомендуемая мощь:** `npm run balance -- --days 10 --fit-recommended` → печатает `power.recommendedStages`: перенести этапы новой
   главы в `data/progression.json → power.recommendedStages` (только отличающиеся > 5% от общего коэффициента). `tests/balance.test.ts`
   проверяет, что поражения модели — не ниже 0.85 рекомендуемой.
9. **Итог экономики:** `npm run balance -- --days 10` — сводка «первое прохождение», стены, сигналы; записать итерацию и таблицу в
   `docs/content/balance.md` (раздел 3) и `docs/content/campaign.md`.
10. **Фоны:** тема главы — по порядку (луг, топь, склеп, дальше по кругу, `backdrops.ts`). Файлы владельца — `assets/backgrounds/bg_battle_ch<N>.jpg`,
    `bg_map_ch<N>.jpg`; для N ≥ 4 нужна правка `backdrops.ts` (новая тема в `THEMES`) — иначе повторится тема 1–3. Арт — issue владельцу.
11. **Башня:** новая полоса `data/tower.json → bands` `{"fromFloor": 80, "name": "…ярус", "layouts": [...], "bossLayouts": [...]}` из монстров главы.
12. **Выпадение:** при желании своё правило `data/drops.json → rules` с `chapter: "chapter4"`; трофеи сундука — рецепт 8а
    (без своего правила глава берёт правило `chest.rules` без `chapter`).
13. **Тесты** правок не требуют: `tests/chapters.test.ts` проверяет любую главу по структуре (order без повторов, этапы подряд,
    босс — последний, id `<префикс>_s<N>`, Σhp/Σatk не убывают, граница глав открывает этап, каждый этап играется), точные числа —
    только у выпущенных глав 1–3; `tests/content-new.test.ts` считает order и сундук от последней главы; `tests/balance-fit.test.ts` —
    окна регулятора. Падают только незаконченная заготовка (TODO, провал Σ) — это шаги 4 и 14. Затем `npm run check`, `npm run e2e`.
    Когда глава ушла в прод, её можно зафиксировать в `RELEASED` в `tests/chapters.test.ts` (id этапов попали в сохранения;
    проверка ждёт 10 этапов `ch<N>_s1…s10`).
14. **TODO → 0:** `npm run content:check` без ⚠ TODO, `$comment` заготовки удалён. Только после этого — PR в main.

## 7. Новая сюжетная сцена

1. Файл главы `data/story/<глава>.json` (нет — `npm run content:new -- story <глава>`).
2. Спикеры: `speakers.<ключ> = {name, portrait}`; `hero1…heroN` — сюжетные карточки игрока по порядку `progression.heroes`
   (start, затем recruits: Алан, Бран, Вика, Грета, Дорн; имя и портрет — из карточки, `portrait: "hero"`);
   `portrait` — id профессии (`swordman`), id спрайта или `unit:<id юнита>`. Пол сюжетных героев фиксирован (`data/heroes`) —
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

## 8а. Трофеи сундука для главы (предметы, осколки, гемы, свитки)

1. `data/drops.json → chest.rules[]`: `{"chapter": "chapter4", "item": 0.08, "rarityWeights"?: {...}, "shards": {"chance": 0.06, "count": 1},
   "gems": {"chance": 0.03, "count": 5}, "scrolls": {"chance": 0.005, "count": 1}}`. Броски — за каждые `chest.tickMinutes` (30) минут
   простоя, по главе последнего пройденного этапа; быстрые награды — те же броски за свои часы. Без `rarityWeights` редкость предмета
   берётся из `rules` этой главы. Нет своего правила — правило без `chapter`.
2. Ожидание за сутки простоя: тиков 24·60/tickMinutes (48); предметов 48·item, гемов 48·chance·count и т. д. Ориентиры (глава 2+):
   ≈ 2 предмета в полном 12-часовом сундуке, гемов ≤ 10 в день, свиток — раз в несколько дней. Потолок — `CHEST_LIMITS`
   (60 гемов, 1 свиток в сутки): больше — content:check упадёт.
3. Предметы — главный источник силы из сундука: +0.02 к `item` заметно ускоряет главы. После правки — `npm run balance -- --days 7`
   (сводка «предметы/осколки по источникам», гемы `offline`, крючки Ц6/Ц9) и запись в `docs/content/balance.md`.
4. Проверка: `npm run content:check`, `tests/chest-loot.test.ts`.

## 9. Ежедневное задание, поручение, достижение

- **Задание** — `data/quests.json → quests[]`: `{id, name, event, target, points}`; `event` — одно из `ACTIVITY_KINDS`
  (`src/core/features/quests.ts`: stage_win, stage_attempt, offline_claim, fast_rewards, summon, hero_level_up, hero_ascend, tower_attempt).
  Новый вид события — правка ядра (`ACTIVITY_KINDS` + запись в обёртке `act*` в `src/core/features/actions.ts`) и тест.
  Пороги активности — `milestones`.
- **Поручение** — `data/bounties.json → templates[]`: `{id, name, rarity, durationMinutes, heroCount, role|null, rewards {gold, jobExp,
  gems, shards?}}`; `jobExp` — в общий пул, `shards` — осколки «отстающего» сюжетного героя; `role` должна быть у какой-то профессии
  (content:check). Баланс шаблонов — открытый вопрос владельцу (см. PROGRESS).
- **Достижение** — `data/achievements.json → achievements[]`: `{id, name, description, counter, target, rewards}`; `counter` — из
  `ACHIEVEMENT_COUNTERS` (`src/core/meta/config.ts`); новый счётчик — правка ядра + тест `tests/meta-achievements.test.ts`.
- Подробно — `docs/content/features.md`, `docs/content/meta.md`.

## 9б. Открыть функцию на этапе

Все этапы открытия — одна таблица `data/unlocks.json → features[]`: `{id, stage, title, description, icon, line?}`
(схема `src/core/unlocks/schema.ts`, подсказки в редакторе — `data/schema/unlocks.schema.json`).

1. Перенести существующую функцию — поменять `stage` (id этапа из `data/campaign`). Порядок строк — порядок баннеров, держите его
   по возрастанию этапов (тест `tests/unlocks.test.ts`). Таверну с `ch1_s5` не двигать без перебаланса: на неё опираются
   цель Ц4 (`docs/content/balance.md`) и `npm run e2e:chapter1`.
2. Текст баннера: `title` (≤ 40, он же в тосте замка «Поручения: откроется на этапе 1-8»), `description` (≤ 140, 1–2 фразы),
   `icon` — иконка скина (`map, helmet, home, gear, gift, bag, lock, chest, scroll, tower, trophy, swords, check, back, next,
   hourglass, flag, star`) или `mug` (кружка Таверны). `line` — необязательная реплика капитана Гаррета (≤ 120, как строка сюжета);
   длинная сцена с несколькими репликами — обычная сцена `afterStage` того же этапа в `data/story` (она идёт перед баннером).
3. Новая функция (нового id ещё нет) — это правка кода: id в `FEATURE_IDS` (`src/core/unlocks/schema.ts`), замок на её входе
   (`isUnlocked` / `lockedTile` / `lockCover` / `lockedScreen` из `src/game/unlockBanner.ts`), куда ведёт «Перейти» (`GOTO` там же),
   модель игрока (`featureUnlocked` в `scripts/lib/player-model.ts`), затем `npm run content:schema`. id лежат в сохранениях
   (`seenUnlocks`) — после выпуска не переименовывать.
4. Проверка: `npm run content:check` (этап существует), `npm run check`, `npm run balance -- --days 7` (крючки не хуже),
   `npm run e2e` и `npm run e2e:chapter1` (оба закрывают баннеры «Позже»; e2e:chapter1 проверяет, что каждый баннер главы 1
   показан ровно один раз — функции на этапах глав 2+ не проверяет).

## 9а. Награды событий («Вход 7 дней», «7 дней новичка», письма)

Всё в `data/events.json` (схема `data/schema/events.schema.json`, ядро `src/core/events`). Награда — `{gold?, gems?, jobExp?, scrolls?,
heroes?: [id шаблона]}`; `jobExp` — в общий пул, карточка — на базовой редкости шаблона (неизвестный id — ошибка content:check).
- **День входа** — `login.days[i] = {rewards, label?}`; `label` — подпись крупной награды (день 7). Число дней — длина массива.
- **Задание новичка** — `newbie.days[d].tasks[] = {id, name, counter, target, points}`: `counter` — ключ `ACHIEVEMENT_COUNTERS`
  (stages_cleared, tower_floor, hero_max_level, summons, ascensions, bounties_done, battles_won, items_equipped; копятся с начала игры).
  Задания дня d открываются на d-й день от первого открытия игры; `durationDays` — сколько дней событие идёт, `graceDays` — дни,
  когда ещё можно забрать выполненное. id заданий не переименовывать (лежат в сохранениях).
- **Сундук новичка** — `newbie.milestones[] = {points, rewards}`, пороги строго растут и не больше суммы очков заданий (схема проверит);
  оставляйте запас в 2–3 задания до последнего порога — не все успевают всё.
- **Письмо всем (подарок, компенсация)** — `mail.letters[] += {id, from, title, body, rewards, untilDay?}`: доставится каждому игроку
  один раз при следующем открытии игры (и новым игрокам, пока не прошёл `untilDay`). id письма не менять и не переиспользовать.
- **Бюджет**: свитки + гемы обоих событий вместе — не больше ~2 призывов ×10 (сейчас 10 свитков + 270 гемов и 2 фиолетовые карточки;
  тест `tests/events.test.ts`). После правки — `npm run check` и `npm run balance -- --days 7` (сравнить с `--no-events`;
  `docs/content/balance.md`, раздел «События новичка»).

## 10. Сохранение: новое поле

Необязательное поле (`.optional()` / `.default()`) в `SaveStateSchema` — без смены версии. Обязательное — `SAVE_VERSION + 1`, миграция
в `MIGRATIONS` (`src/core/save/save.ts`), тест в `tests/save.test.ts` / `tests/p11-saves.test.ts`.

## 11. Башня: состав или полоса

`data/tower.json → bands[i].layouts` (обычные этажи по кругу) / `bossLayouts` (каждый `bossEvery`-й этаж). 5 слотов как у этапа.
Проверка: content:check, `tests/tower.test.ts`; `docs/content/tower.md`.

## 11а. Босс охоты

«Охота на босса» — `data/hunt.json` (схема `data/schema/hunt.schema.json`, ядро `src/core/hunt`, API — `docs/AGENTS.md`, раздел 2г).

1. Босс — любой юнит `kind: boss` (или `monster`) из `data/units`; нового юнита для охоты не нужно. Строка в `bosses[]`:
   `{unit, hpMult, atkMult, defMult, scale?, title?}`. `hpMult` — огромный (сейчас 180–200 → 500 тыс. hp): босс не должен падать
   даже у сильного отряда (упал — урон упрётся в его hp). `atkMult` — насколько больно он бьёт (лекари обычно вытягивают).
   `scale` — только вид в бою (крупнее фигура). `title` — подпись на экране охоты.
2. Ротация: день d берёт `bosses[d mod длина]` (d — номер дня с 1970-01-01), то есть босс меняется каждый день по кругу.
   Добавили босса — сдвинулся весь круг; лучший урон («Зачистка») хранится по id юнита, поэтому новый босс начинается с нуля.
3. Пороги `tiers[] {damage, rewards}`: `damage` строго растёт, награды (`gold`, `jobExp`, `gems`, `shards`) не убывают, `item` —
   редкость предмета (`common`/`rare`/`epic`). Выдаётся только высший достигнутый порог. Подбирайте так, чтобы первые пороги брались
   в день открытия, а верхние — через недели (урон по дням модели — `npm run balance -- --days 7`, блок «Охота на босса»).
4. Бюджет: гемы высшего порога × `attemptsPerDay` ≤ 20 в день (тест `tests/hunt.test.ts`). Опыт и золото — малые: опыт охоты
   заметно ускоряет главы (см. `docs/content/balance.md`, «Охота на босса»).
5. Проверка: `npm run content:check`, `npm run check`, `npm run balance -- --days 7` и сравнить с `--no-hunt` (крючки не хуже).

## 12. Подключение арта владельца

Сначала `git fetch origin && git merge origin/main` (владелец кладёт арт в main). Что ждём — issues #17–#26, `docs/ART_NEEDED.md`, `docs/FX_NEEDED.md`.

| Что | Куда | Регистрация |
| --- | --- | --- |
| Лист юнита/героя | `assets/sprites/{heroes,monsters,bosses}/<id>.png` по `docs/SPRITE_SPEC.md` | запись в `assets/sprites/sprites.json` (id, class, file, portrait, hitFrames, bbox) — обычно `tools/build_sprites_v2.py --only <id>`; старый лист v1 из `assets/ro` — `--from-v1`; затем `visual.sprite` у юнита/профессии |
| Портрет 64×64 | `assets/sprites/portraits/<id>.png` | поле `portrait` в `sprites.json` |
| Бюст героя | `assets/ro/portraits/hero_<id спрайта>_portrait.png` (вариант по полу — `hero_<id спрайта>_<f\|m>_portrait.png`) | сам (glob в `portraitFrame.ts`) |
| Лист героя по полу | `<id спрайта>_f` / `_m` в `assets/sprites/sprites.json` | сам (`flow.ts heroSprite`, откат на базовый лист) |
| Лист карточки героя (класс RO по имени: `knight_m`, `wizard_f`…) | `sprites.json` | `visual.sprite` карточки (`data/heroes`) или её формы; content:check ⚠ — у кого ещё откат по полу |
| Битые кадры | — | `assets/sprites/fixes.json` → `{"<id>": {"skip": {"death": [2, 3]}}}` |
| Иконка навыка | `assets/ui/icons/skill_<id навыка>.png` (квадрат, рисуется в 96×96) | сама; RO-иконка — `RO_SKILL_ICONS` |
| Эффект | `assets/effects/<id>.png` (атлас) | `assets/effects/effects.json → effects` (cell, columns, frames, ms, anchor) и `→ skills` |
| Фон боя/карты главы | `assets/backgrounds/bg_battle_ch<N>.jpg`, `bg_map_ch<N>.jpg` | сам (glob в `backdrops.ts`), N — тема 1–3 |
| UI (кнопки, панели, сундук, иконки) | `assets/ui/*.png` | `assets/manifest.json → assets.<id>` (`file`, `w`, `h`, `slice` для 9-slice); id скина из `skin.ts` — файл побеждает |
| Звук / музыка | `assets/audio/<id>.ogg` + `<id>.m4a` (id — `src/game/audioCatalog.ts`; музыка `music_*`, фоны `amb_*`) | сам (glob в `audio.ts`, файл побеждает заглушку); список и форматы — `docs/design/audio.md`, `docs/ART_EXTRACT_RO.md` 6.1 |

После: `python3 tools/check_sprites.py`, `python3 -m unittest discover -s tests -p 'test_*.py'`, `npm run content:check`, `npm run assets:report`,
глазами (`npm run dev`); отметить issue и `docs/qa/FIXLIST.md` «Ждёт графики».
Новый или заменённый PNG — `npm run assets:webp` (WebP без потерь для прод-сборки, коммитить `assets-webp/`). Без этого
файл уходит в игру как PNG (работает, просто тяжелее; `npm run build` предупредит), см. `docs/content/performance.md`, «Загрузка».

## 13. Баланс главы

1. Цель (`docs/content/balance.md`, раздел 1): главы 1 — этапы 1–9 100% побед перед первой попыткой, босс 75–88% в среднем по выдачам
   Таверны; дальше — стены «забери сундук» на 1–2 сундука, глава 2 — дни 1–2, глава 3 — дни 3–5. Для новой главы — рецепт 6, шаги 7–9
   (окна в `data/progression.json → balance`, регулятор `scripts/balance-fit.ts --chapter N`, затем `npm run balance -- --fit-recommended`).
2. Замер: `npm run playthrough -- <индекс главы с 0> 3 --winrate 200` (--winrate 600 для точной цифры босса — минуты, в фон);
   для глав 2+ добавить `--idle` (печатает часы сундука на этап). Прошлые главы проигрываются молча.
3. Крутить `mult` этапа (шаг 0.01–0.05; кривая у босса крутая: у Мастеринга 0.80 → 88%, 0.84 → 47%), затем состав. Статы монстра
   в `data/units` не трогать ради одного этапа — монстр общий.
4. Правило: Σhp и Σatk этапа не меньше предыдущего (`tests/chapters.test.ts` проверяет все главы, кроме первой); `offlinePerMinute` растёт.
5. Итог: `npm run balance` (14 дней всей экономики), записать таблицу и метод в `docs/content/campaign.md` (как для глав 1–3).
6. После правок боя/профессий/карточек/главы 1 — перемерить босса главы 1 и `tests/chapter1-playthrough.test.ts`. Модель игрока
   (`playthrough`, `balance`) тратит опыт пула сама (`autoLevel` — по уровню самому низкому герою отряда) и возносит сюжетных
   героев за осколки; опыт этапов — в пул (прежние числа ×3).
