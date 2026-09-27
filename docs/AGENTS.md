# Справочник для агентов

Всё, что нужно, чтобы продолжить работу без истории чата. Сверено с кодом (ветка `claude/idle-hero-rpg-gdd-rolicg`, 27.09.2026).
Короткая памятка — `CLAUDE.md` в корне; «как добавить X» — [`CONTENT_RECIPES.md`](CONTENT_RECIPES.md); состояние — [`PROGRESS.md`](PROGRESS.md).
Если что-то здесь разошлось с кодом — прав код, исправьте документ в том же коммите.

Содержание: 1. Карта кода · 2. Модель данных · 2а. Карточки героев (API для экранов) · 3. Сохранение · 4. Бой ·
5. Отрисовка · 6. Тесты · 7. Баланс · 8. Арт-пайплайн · 9. Деплой · 10. QA · 11. Грабли · 12. Глоссарий.

---

## 1. Карта кода

### Корень

| Путь | Что |
| --- | --- |
| `package.json` | скрипты npm (см. `CLAUDE.md`), зависимости: phaser, zod; dev: vite, vitest, tsx, typescript |
| `vite.config.ts` | сборка; плагин копирует в `dist` только используемые ассеты; в dev `assets/` отдаётся с корня |
| `vercel.json`, `netlify.toml` | статический хостинг (Vercel — основной) |
| `index.html` | контейнер `#game`, заглушка «Поверните телефон» для альбомной ориентации |
| `.github/workflows/check.yml` | CI на каждый push/PR: `npm ci`, `npm run check`, `npm run build` |
| `data/` | весь контент и числа (раздел 2) |
| `assets/` | арт: `sprites/` (листы v2), `effects/` (анимированные эффекты RO), `fx/` (статичные запасные эффекты), `ro/` (старые листы v1, бюсты, иконки ульт), `ui/` (Kenney UI + иконки навыков RO), `backgrounds/`, `tiles/`, `manifest.json` |
| `docs/` | GDD, этот справочник, рецепты, спецификации арта, отчёты, QA |
| `art-research/` | каталог задач по графике ранних фаз (строка в каталоге ≠ PNG есть) |

### Ядро `src/core` (без Phaser, детерминированное)

Публичный вход — `src/core/index.ts`. Время (`now`, мс) и день (`day`, `'YYYY-MM-DD'`) передаёт UI.

| Файл | Роль |
| --- | --- |
| `battle.ts` | `simulateBattle(content, squadA, squadB, seed, opts)` — весь бой тиками, лог событий, отчёт по юнитам |
| `targeting.ts` | выбор целей навыка (`selectTargets`), ряды фронт/тыл, расстояние |
| `formulas.ts` | урон `ATK × k × defScale/(defScale+DEF) × разброс`, лечение `ATK × k` |
| `rng.ts` | `Rng` — mulberry32 с seed, единственный источник случайности |
| `config.ts` | `COMBAT` — `data/combat.json` |
| `types.ts` | `Content`, `Unit`, `BattleEvent`, `CombatConfig`, `BattleResult` |
| `stats.ts` | разбор отряда из строки, серии боёв для `sim` |
| `context.ts` | `collectGameContext` / `buildGameContext(raw)` — одна сборка всего `data/` в `FullContext`, все ошибки списком |
| `content/schema.ts` | zod: юнит, навык, эффекты, статусы, цели, visual |
| `content/build.ts` | `buildContent` — разбор файлов + перекрёстные ссылки навыков/юнитов, затем `validateJobs`, `validateCampaign`; `ContentError` |
| `campaign/schema.ts`, `validate.ts` | глава и этап; проверки (id уникальны, враги monster/boss, boss-этап с боссом) |
| `campaign/campaign.ts` | `stageStatus`, `enemySquad` (рост силы), `squadUnits` (отряд → юниты, одна копия карточки), `playStage` (награды, опыт в пул, осколки, рекруты, подарок Таверны) |
| `campaign/offline.ts` | офлайн-сундук: накопление, лимит, «долг» при переводе часов, `bankOffline` |
| `progression/schema.ts` | профессия (`JobSchema`), `data/progression.json` (`ProgressionConfigSchema`: сюжетные карточки `heroes.start/recruits`) |
| `progression/stats.ts` | `getJob`, `statsAt` (статы профессии на уровне); реэкспорт `buildUnit`/`heroSkills` из `heroes/card.ts` |
| `progression/validate.ts` | проверки дерева профессий |
| `heroes/*` | **карточки героев** (раздел 2а): `schema` (шаблон, `cards.json`, `summon.json`), `card` (статы, навыки, формы, `buildUnit`, `heroCard`), `level` («Улучшить», пул опыта), `merge` (вознесение), `shards` (осколки), `summon` (Таверна), `roster` (ростер, отряд), `migrate` (сохранение v3 → v4), `validate`/`config` (проверки) |
| `story/schema.ts`, `story.ts` | сюжет: схема, `buildStory` (проверки), `pendingScenes`, `markScenesSeen`, очередь `storyQueue`, `queueChapterDone` |
| `save/schema.ts`, `save.ts` | формат сохранения (v4), `newGame`, `serialize`/`deserialize`, `MIGRATIONS`, `sanitizeSave`, `loadOrNew` |
| `features/*` | K1 быстрые награды, K2 мощь, K5 ежедневные задания, K7 пропуск боя; `actions.ts` — обёртки `act*` для UI (засчитывают задания и достижения, в т. ч. `actLevelUp`, `actAscend`, `actSummon`) |
| `equipment/*` | K6 предметы, выпадение (`drops.ts`), надеть/снять, `withGear` |
| `tower/*` | K4 башня: этажи по правилу из полос, `climbTower` |
| `meta/*` | K8 пресеты, `setSquad`, авторасстановка (`formation.ts`), K9 поручения (`bounties.ts`), K10 достижения |

### Экраны `src/game/scenes` (Phaser)

Список сцен — `src/main.ts` (кроме `ChapterDone`, она регистрируется при первом показе).

| Сцена (ключ) | Назначение |
| --- | --- |
| `BootScene` (`Boot`) | экран загрузки: манифест, портреты, иконки навыков, скин; листы юнитов — лениво |
| `HomeScene` (`Home`) | главная: офлайн-сундук, быстрые награды, плитки функций, «В кампанию», настройки за шестерёнкой |
| `CampaignScene` (`Campaign`) | карта главы — тропа этапов снизу вверх; сюжет `chapterStart` |
| `StageScene` (`Stage`) | подготовка к этапу: поле «отряд против противника» как в бою, список героев, «Авто», «Пресеты», «В бой»; сюжет `beforeStage` |
| `BattleScene` (`Battle`) | проигрывание лога боя: спрайты, эффекты, баннеры ульт и босса, скорость 1x/2x, пауза, «Пропустить» |
| `ResultScene` (`Result`) | итоги: награды (опыт — в запас), трофеи, MVP, подсказка «Улучшить», авто-следующий этап; сюжет `afterStage` |
| `ChapterDoneScene` (`ChapterDone`) | «Глава пройдена» (переживает перезагрузку через `save.pendingChapterDone`) |
| `HeroesScene` / `HeroScene` / `AscendScene` (`Ascend`) | H4. Коллекция: сетка карточек 3 в ряд (`heroCard.ts`), фильтры линии/роли/редкости, сортировка «Сила/Уровень/Редкость», «Коллекция N/M» (серые неполученные), метки «в отряде», «Новый!», замок, «можно улучшить / вознести». Карточка: витрина цвета редкости с героем в стойке, мощь, статы с прибавкой за уровень, «Улучшить» (удержание — повтор, обновление на месте, «до апа не хватает N»), «Вознести», вкладки «Навыки / Снаряжение / История», замок, листание ‹ ›. Вознесение: было → стало, слоты корма (выбор, «Авто»), осколки и откуда они, подтверждение, показ (вспышка, лучи, мощь «+N», новые навыки, вторая профессия и `forms[].promotion`) |
| `SquadScene` (`Squad`) | то же поле и список героев без противника, «Авто», пресеты |
| `InventoryScene`, `TowerScene`, `QuestsScene`, `BountiesScene`, `AchievementsScene` | инвентарь, башня, ежедневные задания, поручения, достижения |
| `PrepScene` (`Prep`) | тестовый бой (только dev или `?dev=1`), отряды из `data/phase0.json` |

### Помощники `src/game`

| Файл | Роль |
| --- | --- |
| `content.ts` | `GAME`/`CONTENT` — `buildGameContext` из `import.meta.glob('data/...')`; новые файлы подхватываются сами |
| `session.ts`, `storage.ts`, `state.ts` | текущее сохранение и `commit`; localStorage (ключ `chronoworld.save.v1`, ревизии, бэкапы); настройки (скорость, авто, FPS, анимации) |
| `skin.ts` | скин «тёмная бронза», рисуется кодом; файл из манифеста с тем же id побеждает |
| `theme.ts`, `layout.ts` | токены (шрифты `FS`, цвета `C`, `TOUCH`), размеры поля 1080×1920 |
| `ui.ts` | кнопки, тексты, прокрутка, защита от двойного тапа, указатель подсказки |
| `screen.ts` | каркас экрана: шапка, «Назад», валюта, нижняя навигация, портреты |
| `flow.ts` | чистые помощники экранов без Phaser (тестируются) |
| `transitions.ts` | затемнение между экранами, блок ввода во время перехода |
| `juice.ts` | «сочность» меню: летящие награды, отсчёт чисел, выезд списков; выключается «Уменьшить анимацию» |
| `audio.ts`, `audioCatalog.ts`, `audioCore.ts`, `audioSynth.ts`, `sceneAudio.ts`, `battleAudio.ts` | звук (issue #26, `docs/design/audio.md`): `sfx(id)`, музыка по экрану, заглушки синтезом, файлы `assets/audio/<id>.ogg` побеждают; настройки «Музыка»/«Звуки»/«Без звука» |
| `viewport.ts`, `viewLayout.ts` | вывод на экран телефона: безопасная зона, поля за краями, DPR |
| `backdrops.ts` | фоны боя и карты по теме главы (луг/топь/склеп), рисуются кодом; файлы `assets/backgrounds/bg_{battle,map}_ch<N>.*` побеждают |
| `ambient.ts` | тени под юнитами и частицы по теме |
| `battleFx.ts` | слои глубины боя, затемнение и баннер ульты, цифры, пулы |
| `skillFx.ts` | эффекты навыков кодом: круг каста, снаряды, площадь, искры |
| `animatedFx.ts` | каталог `assets/effects/effects.json` (кадры RO) и карта навык → эффект |
| `skillLook.ts` | вид навыка: стихия, символ, снаряд/площадь по id и эффектам; `RO_SKILL_ICONS` (навык → иконка RO) |
| `skillIcons.ts` | значок навыка: `assets/ui/icons/skill_<id>.png` → иконка RO в рамке → символ кодом |
| `portraitFrame.ts` | портрет в рамке: бюст RO (`assets/ro/portraits`) → портрет спрайта → значок |
| `sprites.ts`, `spriteCache.ts` | реестр спрайтов для Phaser, ленивые листы, LRU по памяти, плейсхолдеры по роли |
| `dialogue.ts`, `storyView.ts` | окно диалога; кто говорит и чей портрет (без Phaser) |
| `hints.ts`, `hintLayout.ts` | подсказки первой сессии и их размещение |
| `perf.ts`, `lifecycle.ts` | пулы объектов; пауза при сворачивании, ограничение FPS |
| `itemIcons.ts`, `describe.ts`, `assets.ts` | иконки предметов кодом; описание юнита; загрузка манифеста и плейсхолдеры |
| `heroCard.ts` | плитка карточки героя (общая для «Героев» и «Таверны»): `drawHeroCard(scene, x, y, hero \| template \| templateId, opts)` — рамка редкости с орнаментом, фон-сияние, лицо или фигура, значки линии и роли, имя, уровень, ромбы редкостей, метки; `rarityBackdrop`, `rarityPips`, `iconBadge`, `glowTexture`, `raysTexture` |
| `heroesView.ts` | чистые помощники H4 (тесты `tests/game-heroes.test.ts`): фильтры и сортировка коллекции, листание, прибавка за уровень, `levelShortage`, `ascendPreview`, слоты корма, `shardSources` |
| `squadEditor.ts`, `prepLayout.ts` | `FormationEditor` — подготовка к бою в духе AFK Arena: поле 2 фронт + 3 тыл по `combat.json field.slotsA` (герой в стойке, роль, уровень, мощь), список героев с прокруткой; нажатие — в лучший слот / убрать, перетаскивание из списка в слот и между слотами (касанием; цель — под «призраком» героя), «Переставить» при стрелках во фронте. `prepLayout.ts` — чистые правила (лучший слот, обмен, геометрия, жест), тесты `tests/game-prep.test.ts` |

`src/pipeline/sprites.ts` — реестр спрайтов (v2 + legacy) без Phaser, общий для игры и скриптов; `V2_SCALE`.

### Скрипты `scripts/`

| Файл | Что |
| --- | --- |
| `content-check.ts` | `npm run content:check` — все проверки контента и ассетов |
| `content-new.ts` + `lib/content-gen.ts` | `npm run content:new` — заготовки unit/skill/chapter/stage/story/boss |
| `content-schema.ts` + `lib/schemas.ts` | JSON-схемы для редактора из zod |
| `sim.ts` | серии боёв |
| `playthrough.ts` | прохождение главы ядром, `--winrate`, `--idle` |
| `balance.ts` + `lib/player-model.ts` | модель игрока на D дней → CSV |
| `chapter-save.ts` | сохранение для визуального прогона главы (`npx tsx scripts/chapter-save.ts [jobLevel] [tier2|tier1] > save.json`) |
| `e2e.mjs`, `e2e-chapter1.mjs`, `perf.mjs` | браузерные прогоны (Playwright глобальный) |
| `assets-report.ts` + `lib/used-assets.ts` | какие ассеты нужны сборке |
| `assets-legacy.ts` | старые листы `assets/ro` → `assets/sprites.legacy.json` |
| `lib/content-node.ts` | чтение `data/` в Node: `readRawGameData(root?)`, `loadFullContext`, `loadGameContext`, `ROOT` |

### Python `tools/` (арт)

| Файл | Что |
| --- | --- |
| `build_sprites_v2.py` | листы v2 из кэша рендера RO (`--only <id>`); `--from-v1` — конвертировать старые листы `assets/ro` (без кэша); `--alpha-fixes` — переприменить правки прозрачности |
| `ro_v1_to_v2.py` | конвертер v1 → v2 (используется build_sprites_v2) |
| `fetch_sprites_v2.py` | скачать кадры в кэш (`~/.cache/chronoworld/v2`) |
| `check_sprites.py` | проверка листов по `docs/SPRITE_SPEC.md` |
| `make_sprites_contact.py` | контрольная картинка всех спрайтов |
| `extract_ro_skill_icons.py` | иконки навыков RO → `assets/ui/icons/skill_<ro>.png` + `ro-skills.json` |
| `build_ui.py`, `build_terrain_tiles.py`, `build_priority1_assets.py`, `build_ro_spritesheets.py` | UI, тайлы земли, ассеты фазы 1, старые листы v1 |

---

## 2. Модель данных (`data/`)

Все файлы собирает `buildGameContext` (`src/core/context.ts`): в игре — `src/game/content.ts`, в Node — `scripts/lib/content-node.ts`.
id везде — `^[a-z][a-z0-9_]*$`. JSON-схемы для редактора — `data/schema/*.schema.json` (`$schema` в файлах).

### Юниты `data/units/<id>.json` (`UnitSchema`)

`id, name, kind (hero|monster|boss), role (tank|damage|healer|support), stats {hp, atk, def, spd, moveSpeed?},
skills {basic, ult?, actives[], passives[]}, visual {sprite, projectile?, hitFx?, tint?, scale?}, bodyRadius?`.
- Герои игрока строятся не отсюда, а из карточек (`data/heroes` → `buildUnit`); `kind: hero` в `data/units` — отряды тестового боя и `sim`.
- `skillPower` — «сила навыков» (множитель урона/лечения/щита навыков, кроме обычной атаки); у карточек золотой/красной редкости.
- `visual.tint` — перекраска листа (Дропс — оранжевый Поринг), `visual.scale` — масштаб фигуры (≤ 4).
- `bodyRadius` не задан — `combat.json → movement.bodyRadius[kind]` (босс 90).

### Навыки `data/skills/<id>.json` (`SkillSchema`)

`name, description?, icon?, range (melee|ranged, по умолчанию ranged), target {side, pick, row, rowFallback, count,
includeSelf, onlyWounded}, hits, effects[], fallback?, trigger?, chance, cooldown?, castTime, priority`.
- Эффекты: `damage {k}`, `heal {k}`, `shield {pctMaxHp}`, `status {status {id,name,turns,stats?,stun?,dot?}, chance}`,
  `energy {amount}`, `dash` (рывок к первой цели; только к врагу).
- **Пассивка** — навык с `trigger` (`battleStart`, `turnStart`, `hit`, `kill`, `allyDeath`) и `chance`; пассивка не запускает пассивки.
- **Активный** — без `trigger`, в `skills.actives` юнита или в навыках профессии: `cooldown` (сек; нет — `combat.json skills.defaultCooldown` = 8;
  0 — без перезарядки), `castTime` (сек, стоит и колдует, оглушение сбивает), `priority` (больше — раньше; при равенстве — открытый позже).
- **Ульта** (`skills.ult`) — на 100 энергии; у героев-профессий ульты нет, только у юнитов из `data/units` (монстры, боссы).
- `icon` — id из `assets/manifest.json` (проверяет content:check), но экраны его сейчас **не используют**: значок строит `skillIcons.ts`.
- Сейчас 127 навыков: `basic_*` (обычные атаки), `job_<профессия>_<навык RO>`, `mob*_…` (монстры), старые `guard_/warrior_/…` (юниты теста).

### Профессии `data/jobs/<id>.json` (`JobSchema`)

`tier (0 Новичок, 1 первая, 2 вторая), from[] (из каких профессий), maxJobLevel, role, baseStats, growth, basic,
skills [{jobLevel, skill}], visual`. **С v4 профессия — класс карточки героя**: даёт обычную атаку (`basic`), кривую статов
**линии** (первой профессии ветки: `baseStats + growth × (L − 1)`), вид (`visual`); навыки карточки — в `data/heroes`,
`skills` профессий остаются справочником (проверки линии навыков, `content:check`). Новичок — только корень дерева.
Дерево (19): Новичок → Мечник (Рыцарь, Крестоносец), Маг (Волшебник, Мудрец), Лучник (Охотник, Бард), Аколит (Жрец, Монах),
Торговец (Кузнец, Алхимик), Вор (Ассасин, Разбойник). Проверки — `progression/validate.ts` (достижимость от tier 0 и т. д.).
Спрайт профессии — `visual.sprite` (Маг → `magician`, Волшебник → `mage`, Лучник → `archer_first`, Охотник → `archer`,
Рыцарь → `warrior`, Крестоносец → `guard` — исторические id листов).

### Кампания `data/campaign/<chapter>.json` (`ChapterSchema`)

`id, name, order, stages[]`; этап: `id, name, boss, enemies (ровно 5 слотов: 0–1 фронт, 2–4 тыл; {unit, mult} | null),
rewards {jobExp, gold}, offlinePerMinute {jobExp, gold}`. Главы склеиваются по `order`, у этапа `index` (в главе) и `globalIndex` (сквозной).
Сила врага: `hp/atk/def × mult × (1 + progression.campaign.enemyStatGrowthPerStage)^globalIndex` (0.08; spd не растёт).
Сейчас 3 главы × 10 этапов, босс — 10-й этап (`ch1_s10` Мастеринг, `ch2_s10` Бафомет, `ch3_s10` Тёмный лорд).
Последний этап главы = глава пройдена (`lastStageOfChapter`). Подробности и таблицы — `docs/content/campaign.md`.

### Башня `data/tower.json` (`TowerConfigSchema`)

`unlockAfterStage` (`ch1_s5`), `maxFloor` 100, `bossEvery` 5, `baseMult`, `statGrowthPerFloor`, `bands[]` (полосы с `fromFloor`,
`name`, `layouts[]`, `bossLayouts[]` — составы по 5 слотов), `rewards`. Полосы: 1 «Лесной ярус», 20 «Болотный», 40 «Костяной».
Тема фона этажа — по номеру полосы. См. `docs/content/tower.md`.

### Сюжет `data/story/<chapter>.json` (`StorySchema`, `src/core/story/schema.ts`)

`chapter, speakers {key: {name, portrait}}, scenes [{id, trigger, stageId?, bossIntro? {title, subtitle?}, lines [{speaker, text ≤ 120}] (1–6)}]`.
- Триггеры: `chapterStart` (первый вход на карту главы, пока первый этап открыт), `beforeStage` (перед первым боем этапа),
  `afterStage` (после первой победы, поверх итогов). Одна сцена на пару (trigger, stageId); id сцен уникальны по всем главам.
- `bossIntro` — только у `beforeStage` босс-этапа: баннер после диалога.
- Спикеры `hero1…heroN` — герои сохранения по порядку (имя из сохранения). `portrait`: `hero` | id профессии | id спрайта | `unit:<id>`.
  Пол спикера — у героя из сохранения, иначе по имени (`progression.heroes`, например рекрут `greta` с `portrait: novice` → лист `novice_f`, если есть).
  Пол сюжетных героев фиксирован — в их репликах род можно ставить; профессию героя не называть.
- Увиденные — `save.seenScenes`; сцены «после этапа» ставятся в `save.storyQueue` вместе с победой (`queueAfterStage`) и
  показываются даже после перезагрузки (`queuedScenes`, идут первыми в `pendingScenes`).

### Прогрессия `data/progression.json`

- `heroes`: `start` ["alan","bran","vika"] — сюжетные карточки новой игры (зелёные, ур. 1); `recruits` [{afterStage, template}] —
  Грета после `ch1_s10`, Дорн после `ch2_s10` (карточка ур. 1 в свободный слот отряда). Имя, пол, класс — в `data/heroes`.
- `campaign`: `enemyStatGrowthPerStage` 0.08, `replayRewardMultiplier` 0.5. `offline`: `capHours` 12, `earlyExp` (опыт сундука и
  быстрых наград на первых этапах — не больше доли награды этапа в час). `newGame.gold`.
- `fastRewards` (K1) и `power` (K2) — читает `features/config.ts`.
- **Опыт наград** (`rewards.jobExp` этапов, `offlinePerMinute.jobExp`, башня, поручения, пороги заданий, достижения) — опыт **в общий
  пул героев** `resources.heroExp` (v4); все числа умножены на 3 (размер стартового отряда) — темп прежний.

### Карточки героев `data/heroes/<id>.json`, `data/cards.json`, `data/summon.json`

- Шаблон (`HeroTemplateSchema`, `src/core/heroes/schema.ts`): `id, name, gender, job (класс), line (первая профессия ветки), role,
  source (story|summon), baseRarity, maxRarity, statMods {hp,atk,def,spd}, skills [{level, skill}] (2–4), forms [{rarity, job, role?,
  statMods, skills, visual?}] (только сюжетные — вторая профессия на фиолетовом), visual {sprite?}, bio (≤160), hook (≤200)`.
- 25 карточек: сюжетные Алан, Бран, Вика, Грета, Дорн (зелёные → красный, форма Рыцарь/Охотник/Жрица/Кузнец/Разбойник); призывные
  первые Ирис, Мэйлин, Тео, Кай, Лира, Отто, Зара (зелёные/синие → золотой); 13 фиолетовых вторых (герои Биолаборатории RO, → красный).
  Таблицы — `docs/design/heroes.md`, раздел 1.
- `data/cards.json`: `rarities` (5 по порядку: цвет, `maxLevel` 20/40/60/80/100, `statMult`, `skillPower`), `level` (цена уровня:
  опыт `floor(100 × L^1.5)`, золото `floor(20 × L^1.4)`), `merge` (правила вознесения по дорожкам `first`/`second` — корм, `story` —
  осколки + `minLevel`), `shards` (осколки этапов «отстающему» сюжетному герою: `firstClear` 4, `bossFirstClear` 8, повтор — шанс
  `replayChance` 0.1).
- `data/summon.json`: `unlockAfterStage` (ch1_s5), `costs` (30 / 270), `rates` (64/32/4% и какие `baseRarities` выпадают), `pity`
  (30-й — фиолетовый), `firstTen`, `freePerDay`, `welcome` (150 гемов + 1 свиток), `storyShard` (шанс осколка за призыв).
- Рецепт — `docs/CONTENT_RECIPES.md`, «Новая карточка героя».

### Правила боя `data/combat.json`

`actionThreshold` 1000, `tickSeconds` 0.1, `timeLimitSeconds` 90, `damage`, `energy` (max 100, +25 за действие, +10 за полученный удар),
`skills.defaultCooldown` 8, `projectileSeconds` 0.3, `statusTurnSeconds` 1, `movement` (`meleeRange` 130, `moveSpeed` 320,
`stackAngles`, `retargetSeconds`, `bodyRadius`, `minSeparation`, `meleeAoeRadius`, `maxMeleePerTarget` 2, `diveStay`, `diveReturnSeconds`),
`slots`, `field` (ширина 1080, `bounds`, координаты слотов стороны A; B — зеркало).

### Предметы, задания, поручения, достижения

- `data/items/*.json` — `{items: [{id, name, slot (weapon|armor|helmet|boots), rarity (common|rare|epic), stats, jobs?, drop}]}`;
  `jobs` — корни веток (["archer"] → лучник, охотник, бард). `data/drops.json` — правила выпадения по главам. См. `docs/content/equipment.md`.
- `data/quests.json` — ежедневные задания: `event` из `ACTIVITY_KINDS` (`src/core/features/quests.ts`), `target`, `points`; `milestones` активности.
- `data/bounties.json` — доска поручений: `boardSize`, `dailyRefreshes`, веса `rarities`, `templates` (`durationMinutes`, `heroCount`, `role`, `rewards`), `presets`.
- `data/achievements.json` — `counter` из `ACHIEVEMENT_COUNTERS` (`src/core/meta/config.ts`), `target`, `rewards`. См. `docs/content/meta.md`, `features.md`.
- `data/phase0.json` — отряды тестового боя и скорости воспроизведения.

---

## 2а. Карточки героев — API ядра для экранов (H4 «Герои», H5 «Таверна»)

Всё — из `src/core` (`import { … } from '../core'`), чистые функции, время/день передаёт UI. Для записи — обёртки `act*`
(засчитывают задания и достижения), результат — `commit(r.save)`. Ошибки правил — `HeroError` (`code`, русский `message` — в тост).

**Чтение карточки**
- `heroCard(hero, ctx)` → `{ name, gender, source, track, job, jobName, line, role, rarity {id,name,color,maxLevel,…}, maxRarity,
  level, maxLevel, stats, skills [{skill, level, unlocked, passive}], nextForm? {rarity, job, jobName}, bio, hook, locked, isNew }` —
  всё для карточки и плитки коллекции одним объектом.
- Мелкие: `heroName`, `heroGender`, `heroJobId` (класс с учётом формы), `heroRole`, `heroLine`, `heroStats`, `heroSkillList`,
  `heroSkills`, `heroSpriteOverride` (свой лист формы); спрайт по реестру — `src/game/flow.ts heroSprite(hero, ctx)`.
- Редкости: `CARD_RARITIES`, `rarityDef(ctx, r)` (цвет, предел, множители), `maxLevelOf`, `nextRarity`, `rarityIndex`.
- Мощь: `heroPower(hero, ctx, save)` (K2, с экипировкой).

**«Улучшить» (уровень из общего пула опыта `save.resources.heroExp` + золото)**
- `levelUpInfo(save, heroId, ctx)` → `{ level, maxLevel, cost {exp, gold} | null, canLevel, blocker ('max_level'|'not_enough_exp'|
  'not_enough_gold'|null), affordable (сколько уровней по карману), pool, gold }`.
- `actLevelUp(save, day, heroId, ctx, times = 1)` → `{ save, levels, spent, events }` (события `levelUp`, `skillUnlocked`);
  `autoLevel(save, ctx, heroIds?)` — «Улучшить всех» (по уровню самому низкому). Цены — `levelUpCost`, `levelRangeCost`.

**Вознесение**
- `ascendRequirement(save, heroId, ctx)` → `null` (максимум) или `{ from, to, track, gold, minLevel?, shards? {templateId, have, need},
  fodder [{kind 'same'|'line', rarity, count, candidates[]}], newJob? (вторая профессия сюжетного), blockers[] }`.
- `autoFodder(save, heroId, ctx)` — самый слабый подходящий корм; `fodderBlocker(save, id, ctx)` — почему карточку нельзя в корм
  (сюжетная, замок, отряд, пресет, поручение).
- `actAscend(save, day, heroId, fodderIds, ctx)` → `{ save, events, refund {exp, gold}, consumed }` (событие `ascended {from, to, job,
  jobChanged}`; сюжетным `fodderIds = []`, тратятся осколки).
- Замок и «Новый!»: `setHeroLocked(save, heroId, bool)`, `markHeroSeen(save, heroId)`.

**Осколки** — `save.shards[<шаблон>]`: `shardCount`, `stageShardHero(save, stage, ctx)` / `stageShardReward` (чьи и сколько осколков
даст этап — для экрана подготовки), `shardTarget(save, ctx)` («отстающий»: ниже редкость → меньше осколков → по сюжету; ему идут
осколки этапов, поручений, достижений, Таверны). Событие `shards`.

**Таверна**
- `summonStatus(save, day, ctx)` → `{ unlocked, unlockAfterStage, gems, scrolls, costs, freeLeft, untilPity, pityRarity, firstTenBonus,
  firstTenRarity, total, can {gems1, gems10, scroll1, scroll10, free} }`.
- `actSummon(save, day, count 1|10, pay 'gems'|'scroll'|'free', ctx)` → `{ save, results [{heroId, templateId, name, rarity, isNew,
  guaranteed, shard?}], events }`. Результат уже в сохранении (детерминирован от `createdAt` и `summon.seq`) — анимацию показа строить по
  `results`. Подарок открытия выдаёт `playStage` (событие `tavernUnlocked`); `grantTavernWelcome` — идемпотентно.
- Пулы редкостей — `summonPool(ctx, rarity)`.

**Отряд**: одна копия карточки — `duplicateCardsInSquad`, `templateInSquad` (серые дубли в ростере), `setSquad(save, squad)`
(MetaError `duplicate_card`), `placeInSquad`; бой с дублем — `GameRuleError('duplicate_card')`. Ростер: `addHeroCard`, `newHeroId`,
`ownedStoryTemplates`, `storyHero`, `storyOrder` (hero1…heroN сюжета).

**Экраны-помощники** (`src/game/flow.ts`): `levelUpReady`, `ascendReady` (значок «Герои»), `levelText`, `describeEvents` (строки
`levelUp`, `ascended`, `shards`, `heroJoined`, `tavernUnlocked`), `defeatAdvice`. Подсказка главной `level_up` (`hints.ts`).

---

## 3. Сохранение

- Формат — `SaveStateSchema` (`src/core/save/schema.ts`), `SAVE_VERSION = 4`; ключ localStorage `chronoworld.save.v1` (ключ не менялся).
- **v4 (карточки героев)**: `heroes[] = {id, templateId, rarity, level, locked?, isNew?}`, `resources.heroExp` (пул опыта),
  `currency.scrolls`, `shards {шаблон: n}`, `summon {seq, total, sincePurple, firstTenDone, freeDay?, freeUsed?, welcomeGiven,
  discovered[]}`, `notices?` (одноразовые сообщения — `sanitizeSave` отдаёт в `warnings` и убирает). Миграция v3 → v4 —
  `src/core/heroes/migrate.ts` (заморожена, не читает `data/`): герой → сюжетная карточка по имени (Алан; Бран/Бэлла; Вика/Вик;
  Грета/Грег; Дорн), иначе — свободная по порядку, шестой и дальше — призывная карточка линии; уровень тот же (вторая профессия — 40 + ур.),
  редкость по пределу; `jobExp`, `bankedExp` и излишек уровней — в пул; +1 свиток и сообщение; `ch1_s5` пройден — подарок Таверны.
  Счётчик достижений `hero_max_job_level` → `hero_max_level`. id героев не меняются.
- `deserialize`: JSON → `MIGRATIONS[v]` по цепочке v → v+1 → zod → возврат неизвестных полей (`keepUnknownFields`, чтобы старая сборка
  не стёрла поля новой) → проверки целостности (дубли героев, неизвестные герои в отряде/предметах/поручениях). Версия новее сборки —
  `SaveError('newer_version')`, сохранение не затирается (только чтение).
- Новое поле: если оно необязательное (`.optional()`/`.default()`) — версия не меняется (так добавлены `seenScenes`, `storyQueue`,
  `pendingChapterDone`, `revision`, `bankedExp`, `hero.gender` — его `sanitizeSave` выводит по имени, неизвестное → м). Обязательное — `SAVE_VERSION + 1` и миграция в `MIGRATIONS`, тест в `tests/save.test.ts`.
- `sanitizeSave(save, ctx)` — подгоняет сохранение к текущему контенту: неизвестная карточка — экземпляр убирается вместе со ссылками,
  редкость/уровень вне правил шаблона — к правилам, вторая копия карточки уходит из отряда, неизвестные предметы убираются; сообщения
  миграции (`notices`) и правки показываются игроку тостом.
- `src/game/storage.ts` (`SaveSlot`): ревизии против двух вкладок, резервные копии нечитаемых сохранений, работа при полном хранилище.

---

## 4. Бой (`src/core/battle.ts`)

- **Тики** по `tickSeconds` (0.1 с) до `timeLimitSeconds` (90 с; не успели — победа B, `reason: timeout`). Порядок тика: снаряды →
  статусы → движение → возвраты после прыжка → выбор цели ближними (`pickEngage`) → застревание → план движения → конец кастов →
  шкала действия.
- **Шкала:** каждый тик `gauge += SPD`; на `actionThreshold` (1000) — ход. Равенство решает seed. Юнит, который не может действовать
  (бежит, не дошёл), ждёт с полной шкалой.
- **Ход:** оглушён — пропуск (`skip`). Иначе: готовый активный навык с наибольшим приоритетом, у которого есть цели → каст или применение;
  иначе ульта (энергия 100, только у юнитов с `skills.ult`); иначе обычная атака. Лечащий навык не выбирает целей с полным HP — ход не тратится.
- **Движение и строй:** ближний боец выбирает «цель сражения» (`engage`) — первую цель обычной атаки, у которой меньше
  `maxMeleePerTarget` (2) ближних противников; встаёт в веер `stackAngles` на `0.9 × meleeRange` (+ радиусы тел), пропуская занятые
  (`minSeparation`) и точки за `field.bounds`. Не может дойти `retargetSeconds` — меняет цель. Досягаемость — `reach = range + body цели + body своё`.
- **Рывки и прыжки в тыл:** эффект `dash`. Прыгнувший в тыл врага возвращается к прежнему противнику через `diveReturnSeconds`,
  если навык не в `movement.diveStay` (те остаются). Враг, прыгнувший в наш тыл, для ближних — цель в последнюю очередь.
- **Касты:** `castTime > 0` → событие `cast` `start`, эффект в конце; оглушение → `cast` `interrupt` `reason: stun` (перезарядка не тратится),
  цели пропали → `reason: noTarget`.
- **Снаряды:** дальняя атака по врагу долетает через `projectileSeconds`; погибшая за это время цель не получает урон.
- **Статусы в секундах:** `turns × statusTurnSeconds`; тот же статус обновляет длительность; `dot` тикает раз в `statusTurnSeconds`,
  статус спадает по времени у любого носителя (и бегущего, и оглушённого).
- **Энергия:** +25 за действие, +10 за полученный удар (не от dot).
- **События для UI** (`BattleEvent`, `types.ts`): `turn`, `skip`, `move` (walk/dash, from/to/duration), `attack`, `cast`, `ult`, `passive`,
  `damage`, `heal`, `buff` (щит), `status` (apply/expire), `energy`, `death`, `end`. Сцена Phaser только проигрывает лог; удар показывается
  на кадре `hitFrame` анимации атаки.
- Проверки: `tests/battle*.test.ts`, `actives.test.ts`, `formation.test.ts` (строй), `fuzz-battle.test.ts` (инварианты на случайных отрядах).

---

## 5. Отрисовка

- **Спрайты v2** — `docs/SPRITE_SPEC.md`: родной масштаб RO ×1, лицом вправо, точка ног — anchor клетки. Сетки: герой 224×192
  (anchor 104,144; 6 рядов idle/walk/attack/cast/hurt/death), монстр 240×224 (100,120; 5 рядов без cast), босс 256×256 (112,216).
  8 колонок, лист ≤ 2048 px. Реестр — `assets/sprites/sprites.json` (schema 2); `assets/sprites/fixes.json` — пропуск битых кадров (`skip`).
- **Лист карточки героя:** везде, где выбирается спрайт героя (`flow.ts heroSprite`, его зовут Герои, Герой, Отряд, Поручения, Башня,
  «Глава пройдена», диалоги; бой — `BattleScene squadDefs`): свой лист карточки (`visual.sprite` формы или шаблона — `knight_m`,
  `priest_f`…, листы по имени класса RO), если он есть в реестре; иначе `<visual.sprite класса>_f` / `_m` по полу карточки, если такой
  лист есть в `sprites.json`, иначе базовый лист
  (`pipeline/sprites.ts genderedSpriteId`). Базовые листы одного пола (`source.gender`): `acolyte`, `priest` — женские, остальные
  героические — мужские; так что женщина без `_f` выглядит мужским листом, мужчина-Аколит без `_m` — женским (терпимо до арта).
  Бюст в рамке (`portraitFrame.ts bustFor`): `hero_<база>_<m|f>_portrait.png` → бюст листа → портрет листа. Реестр для чистых
  помощников — `src/game/spriteRegistry.ts` (`hasSprite`; в Node/тестах пустой — варианты не находятся).
- **Масштаб:** все листы v2 на экране × `V2_SCALE` = 3.2 (`src/pipeline/sprites.ts`), дальше × `visual.scale` юнита. Legacy-листы
  (`assets/sprites.legacy.json`) — свой `scale`. Враги отражаются по горизонтали. Нет листа — плейсхолдер-силуэт по роли.
- **Тени** — `ambient.ts` (`SHADOW_TEX`), ширина по `bbox.idle` листа; в листах тени нет.
- **Эффекты навыков:** `skillLook.ts` выводит стихию/снаряд/площадь из id и эффектов (`FX_OVERRIDE` — явные), `skillFx.ts` рисует их кодом;
  кадры RO — `assets/effects/effects.json` (`fx_hit`, `fx_arrow`, `fx_magic`, `fx_heal`, `fx_death`, `fx_shield`), карта навык → эффект —
  секция `skills` там же (`{"<skillId>": {"hit": "...", "buff": "..."}}`, сейчас пустая — работают правила по умолчанию, см.
  `assets/effects/README.md`); статичные `assets/fx/*` — запасные.
- **Значки навыков:** `assets/ui/icons/skill_<id навыка>.png` (если есть) → иконка RO `skill_<ro>.png` через `RO_SKILL_ICONS` в
  `skillLook.ts` (32 иконки первых профессий) → символ кодом. Поле `icon` навыка (id манифеста, например `icon_ult_mage` → `assets/ro/icons`) проверяется, но экранами не используется.
- **Фоны:** тема по порядку главы (1 луг, 2 топь, 3 склеп, дальше по кругу) и по полосе башни; рисуются кодом (`backdrops.ts`).
  Файл владельца `assets/backgrounds/bg_battle_ch<N>.(jpg|png|webp)` / `bg_map_ch<N>.*` подменяет нарисованный (N = номер темы 1–3).
- **UI:** скин кодом (`skin.ts`), файлы из `assets/manifest.json` (id → `file`/`atlas`/`frame`/`slice`) побеждают; сборка копирует только
  используемое (`scripts/lib/used-assets.ts`).

---

## 6. Тесты

- `tests/*.test.ts` — vitest (`npm test`): ядро боя, контент, кампания, прогрессия, сохранения, K-функции, чистые помощники UI (`game-*.test.ts`),
  фазз (`fuzz-*.test.ts`), главы (`chapters.test.ts` — жёстко 3 главы/30 этапов, Σhp/Σatk без провалов), прохождение главы 1
  (`chapter1-playthrough.test.ts`), генераторы контента (`content-new.test.ts`). Общие помощники — `tests/helpers.ts`, `invariants.ts`, `formation.ts`, `fixtures/`.
- `tests/test_*.py` — проверки арт-пайплайна: `python3 -m unittest discover -s tests -p 'test_*.py'`.
- Производительность: `tests/sim.test.ts` («1000 боёв» по CPU-времени), `npm run perf` (браузер).
- **e2e** (`scripts/e2e.mjs`, `e2e-chapter1.mjs`) кликают по тексту кнопок в активной сцене через `window.__game` (только dev-сборка);
  `e2e-chapter1` проверяет, что кнопка не перекрыта другим объектом (иначе ошибка «перекрыт»), падает на ошибках консоли.
  Переименовали кнопку — поправьте подпись в скрипте. Подробно — `docs/content/e2e.md`, `docs/content/testing.md`.
- **Строй** (`tests/formation.test.ts` + `tests/formation.ts`): метрики центроида, кучи и левой трети на этапах ch1_s5…s10.

---

## 7. Баланс

- **Цели:** этапы 1–9 главы 1 — 100% побед перед первой попыткой; босс главы 1 — около ⅔–80% (сейчас `mob_mastering` mult 0.84 → 83–84%
  на 600 seed'ах). Главы 2–3 — «иди, упрись, забери сундук»: стены растут плавно, босс главы — 1–2 полных сундука.
- **Метод (как подбирали босса главы 1):** `npm run playthrough -- 0 3 --winrate 600` — новая игра, этапы по порядку, перед каждым этапом
  доля побед на 600 seed'ах текущим отрядом; меняли `mult` босса шагом 0.01–0.02 и смотрели кривую (карточки v4, отряд Алан 5 / Бран 4 /
  Вика 4: 0.81 → 97%, 0.83 → 91%, 0.84 → 83%, 0.85 → 74%, 0.86 → 57%, 0.90 → 4%).
  Кривая крутая — после любых правок боя, профессий, главы 1 — перемерить.
- **Главы 2–3:** `npm run playthrough -- <1|2> 3 --idle --winrate 200` — при 3 поражениях подряд забирает офлайн-сундук за 1 час и
  печатает, сколько часов сундука понадобилось; `mult` подобраны так, чтобы Σhp/Σatk этапов не падали (тест) и ожидание росло плавно.
- **Вся экономика:** `npm run balance` (14 дней модели игрока с башней, экипировкой, заданиями) → `balance.csv`, `docs/content/balance.md`.
- Таблицы и цифры — `docs/content/campaign.md`. Рецепт — `docs/CONTENT_RECIPES.md` «Баланс главы».

---

## 8. Арт-пайплайн

- **Как приходит арт:** владелец (или его агент-художник по промтам `docs/SPRITE_SPEC.md`, `docs/UI_ART_PROMPT.txt`, `docs/ART_EXTRACT_RO.md`,
  `docs/FX_NEEDED.md`) кладёт файлы в `main` коммитом/PR. Что нужно — issues #17–#26 и `docs/ART_NEEDED.md`. Оркестратор регулярно
  (плановая проверка) делает `git fetch && git merge origin/main` в рабочую ветку и подключает новое.
- **Спрайты:** лист + запись в `assets/sprites/sprites.json` (обычно пишет `tools/build_sprites_v2.py`; старые листы `assets/ro` →
  `python3 tools/build_sprites_v2.py --from-v1`; правки прозрачности — `--alpha-fixes`); проверка `python3 tools/check_sprites.py`
  и python-тесты. Игра и сборка подхватывают реестр сами; юниту/профессии — `visual.sprite = <id>`.
- **Иконки навыков RO:** `python3 tools/extract_ro_skill_icons.py` (список `SKILLS` в скрипте) → `assets/ui/icons/skill_<ro>.png`,
  затем строка в `RO_SKILL_ICONS` (`src/game/skillLook.ts`). Своя иконка навыка — просто `assets/ui/icons/skill_<id навыка>.png`.
- **Эффекты:** атлас в `assets/effects/` + запись в `effects.json → effects`; привязка к навыку — `effects.json → skills`.
- **Фоны:** `assets/backgrounds/bg_battle_ch<N>.jpg` / `bg_map_ch<N>.jpg` (720×1280 или 1080×1920, JPEG ради веса) — подхватываются glob'ом.
- **UI:** PNG в `assets/ui/` + запись в `assets/manifest.json` с id скина — файл побеждает нарисованный.
- После любого арта: `npm run content:check`, `npm run assets:report` (вес, листы > 2048), глазами — `npm run dev` или скриншоты e2e.

---

## 9. Деплой

Vercel собирает `main` (`vercel.json`: `npm ci`, `npm run build`, `dist`). Пошагово — `docs/DEPLOY.md`. Перед слиянием в main —
зелёный CI; после крупных изменений экранов — `npm run e2e` и `npm run e2e:chapter1` локально (в CI браузера нет).
Сохранение — в localStorage браузера; облако Telegram — позже.

---

## 10. QA

1. Тестировщики (агенты с ролями: новый игрок, бой, интерфейс, мета/сохранения, контент) играют сборку и пишут отчёты
   `docs/qa/tester1-new-player.md` … `tester5-content.md` (номера багов T1-xx … T5-xx с шагами воспроизведения).
2. Сборщик сводит их в `docs/qa/BUGLOG.md` (уникальные баги BUG-xxx, серьёзность, статус, ссылка на T-номер).
3. Оркестратор режет баги на пакеты по файлам в `docs/qa/FIXLIST.md` (P1…P12) — каждый пакет отдаётся одному сабагенту с
   непересекающимися файлами. После слияния — статус ✅ с коммитом в FIXLIST и BUGLOG (пересчёт сводки).
4. Ручная проверка — `docs/qa/MANUAL_TEST.md`. Скриншоты отчётов — `docs/REPORTS/screens/`.

---

## 11. Грабли (из истории)

- **Worktree сабагента создаётся от старого коммита** (от main): первой командой `git fetch origin && git merge origin/claude/idle-hero-rpg-gdd-rolicg`.
  Долгоживущие агенты, начавшие со старой базы, дают тяжёлые конфликты — перед сдачей пусть ещё раз сольют свежую рабочую ветку.
- **Нет `node_modules` в worktree** — `ln -s /home/user/chronoworld/node_modules node_modules` (в `.gitignore`, не коммитится).
- **vite перезагружает страницу при изменении файлов** — e2e/perf падают, если в тот же checkout кто-то пишет. Гонять в своём worktree.
- **Порты e2e** 5173/5174/5185 заняты другим прогоном — `E2E_PORT`/`PERF_PORT`. `playwright install` не запускать.
- **Жёсткие числа в тестах:** `tests/chapters.test.ts` (3 главы, 30 этапов, босс на 10-м), `chapter1-playthrough.test.ts`, `formation.test.ts`
  (этапы главы 1) — новая глава или переделка главы 1 требуют осознанно обновить ожидания и перемерить баланс.
- **Поменяли zod-схему** — `npm run content:schema`, иначе content:check: «устарел».
- **Лист больше 2048 px** — на части телефонов не загрузится; content:check — ошибка для v2.
- **id листов ≠ id профессий** (исторически): Маг → `magician`, Волшебник → `mage`, Лучник → `archer_first`, Охотник → `archer`.
- **Тест «1000 боёв»** меряет CPU-время и сравнивает с эталоном; при перегрузке контейнера возможен сбой — перезапустить, не ослаблять.
- **Фон главы 4+** берётся по теме по кругу (`themeOfChapter` в `backdrops.ts`): файл `bg_battle_ch4.jpg` сейчас не будет показан
  (ищется `bg_battle_ch<номер темы 1–3>`). Для новой главы со своим фоном — расширить `THEMES`/поиск файла.
- **Сохранения живут дольше кода:** не переименовывать id этапов/профессий/предметов/сцен/карточек (`data/heroes`); `sanitizeSave`
  убирает неизвестные карточки и предметы. Старый формат (v3) читает замороженная миграция `heroes/migrate.ts` — её не трогать.
- **Опыт наград — в пул, не героям:** `rewards.jobExp` в данных (этапы, башня, поручения, задания) — опыт в `resources.heroExp`,
  уровни поднимает игрок («Улучшить»). Модель игрока (`playthrough`, `balance`) тратит пул сама (`autoLevel`).
- **Одна копия карточки в отряде:** редактор отряда и пресеты проверяют (`setSquad`, `duplicate_card`), бой с дублем — ошибка.
- **Владелец читает в мессенджере** — промты и отчёты простым текстом.

---

## 12. Глоссарий (RU ↔ RO / код)

| В игре | RO / код |
| --- | --- |
| Новичок, Мечник, Маг, Лучник, Аколит, Торговец, Вор | Novice, Swordman, Mage (лист `magician`), Archer (`archer_first`), Acolyte, Merchant, Thief |
| Рыцарь, Крестоносец, Волшебник, Мудрец, Охотник, Бард | Knight (`warrior`), Crusader (`guard`), Wizard (`mage`), Sage, Hunter (`archer`), Bard |
| Жрец, Монах, Кузнец, Алхимик, Ассасин, Разбойник | Priest, Monk, Blacksmith, Alchemist, Assassin, Rogue |
| Фабр, Люнатик, Поринг, Дропс, Попоринг, Мандрагора, Рокер | Fabre, Lunatic, Poring (`mob_fast`), Drops, Poporing, Mandragora, Rocker |
| Мастеринг (босс гл. 1), Бафомет (гл. 2), Тёмный лорд (гл. 3), Герой орков | Mastering, Baphomet (`mob_boss2`), Dark Lord (`mob3_boss`), Orc Hero (`mob_boss1`) |
| Зомби, Скелет-лучник, Ожившая ива, Золотой жук-вор | Zombie (`melee`), Archer Skeleton (`ranged`), Willow (`tank`), Golden Thief Bug (`elite`) |
| Рейдрик, Мимик, Гаргулья, Тёмный жрец | Raydric, Mimic, Gargoyle, Dark Priest (глава 3) |
| джоб-уровень, профессия, смена профессии | job level, job, job change |
| ульта | ultimate (`skills.ult`, на 100 энергии) |
| этап, глава, кампания, босс-этап | stage, chapter, campaign |
| офлайн-сундук, быстрые награды | AFK rewards (`offline`), fast rewards (K1) |
| мощь | power (K2) |
| Башня испытаний | tower (K4) |
| ежедневные задания, активность | daily quests (K5) |
| поручения, доска | bounties (K9) |
| пресеты отряда, авторасстановка | presets / formation (K8) |
| фронт / тыл | слоты 0–1 / 2–4 |
| K1…K10, P1…P12, T1-xx…T5-xx, BUG-xxx | функции из GDD, пакеты FIXLIST, номера багов тестировщиков, сводный баг-лог |
| Герои: Алан м, Бран м, Вика ж (старт), Грета ж, Дорн м (рекруты) | сюжетные карточки `data/heroes/{alan,bran,vika,greta,dorn}.json`, `progression.json → heroes.start / recruits` |
| карточка, шаблон, экземпляр, редкость (зелёный…красный), вознесение, корм, осколки, Таверна, пул опыта, «Улучшить» | hero card, template, instance, rarity, ascend/merge, fodder, hero shards, summon (tavern), `resources.heroExp`, level up |
