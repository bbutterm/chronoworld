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
| `index.html` | контейнер `#game`, заглушка «Поверните телефон» для альбомной ориентации, HTML-заставка `#splash` (inline CSS: лента, орнамент, полоса с фаской — те же числа и цвета, что `src/game/bootLook.ts`; меняете одно — меняйте и другое) |
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
| `campaign/campaign.ts` | `stageStatus`, `enemySquad` (рост силы), `squadUnits` (отряд → юниты, одна копия карточки), `playStage` (награды, опыт в пул, карты героя, рекруты, подарок Таверны) |
| `campaign/offline.ts` | офлайн-сундук: накопление, лимит, «долг» при переводе часов, `bankOffline`; трофеи `offlineLoot`, таймер `offlineFullInMs` |
| `progression/schema.ts` | профессия (`JobSchema`), `data/progression.json` (`ProgressionConfigSchema`: сюжетные карточки `heroes.start/recruits`) |
| `progression/stats.ts` | `getJob`, `statsAt` (статы профессии на уровне); реэкспорт `buildUnit`/`heroSkills` из `heroes/card.ts` |
| `progression/validate.ts` | проверки дерева профессий |
| `heroes/*` | **герои v2** (раздел 2а): `schema` (шаблон с двумя ветками, `cards.json`, `summon.json`), `card` (форма по ветке, статы, навыки, `buildUnit`, `heroCard`), `level` («Улучшить», пул опыта), `merge` (вознесение копиями, «Авто»), `branch` (выбор и смена ветки), `cardDrops` (карты случайных героев из наград), `contract` («Контракт героя»), `summon` (Таверна), `roster` (ростер, копии, отряд), `migrate` (v3 → v4) и `migrate-v7` (v6 → v7, герои v2) — заморожены, `validate`/`config` (проверки) |
| `story/schema.ts`, `story.ts` | сюжет: схема, `buildStory` (проверки), `pendingScenes`, `markScenesSeen`, очередь `storyQueue`, `queueChapterDone` |
| `save/schema.ts`, `save.ts` | формат сохранения (v4), `newGame`, `serialize`/`deserialize`, `MIGRATIONS`, `sanitizeSave`, `loadOrNew` |
| `features/*` | K1 быстрые награды, K2 мощь, K5 ежедневные задания, K7 пропуск боя; `actions.ts` — обёртки `act*` для UI (засчитывают задания и достижения, в т. ч. `actLevelUp`, `actAscend`, `actSummon`) |
| `equipment/*` | K6 предметы, выпадение (`drops.ts`), надеть/снять, `withGear`; трофеи сундука и быстрых наград (`chest.ts`) |
| `tower/*` | K4 башня: этажи по правилу из полос, `climbTower` |
| `hunt/*` | «Охота на босса» (раздел 2г): босс дня, пороги урона, `fightHunt` (бой с лимитом времени), `sweepHunt` («Зачистка»), `huntStatus` |
| `meta/*` | K8 пресеты, `setSquad`, авторасстановка (`formation.ts`), K9 экспедиции по локациям (`expeditions.ts`: `autoParty` — отряд одним нажатием по порогу мощи, `startExpedition`, `claimExpedition`, `expeditionStatus`; docs/content/meta.md, K9), K10 достижения. «Забрать всё» — `claimAllExpeditions`, `claimAllAchievements`, заданий дня — `features/quests.ts claimAllQuests` (задания, затем пороги); обёртки `actClaimAll*`; тесты `tests/claim-all.test.ts` |
| `shop/*` | Лавка (магазин AFK): `data/shop.json` (`ShopConfigSchema`), ассортимент дня `rollShop`/`ensureShop`, `shopStatus`, `refreshShop` (за гемы), `buyShopSlot`; раздел 2д |
| `unlocks/*` | открытие функций по этапам (`data/unlocks.json`): `featureUnlocked`, `lockedText` («Откроется на этапе 1-8»), `stageLabel`, `pendingUnlocks` / `markUnlocksSeen` (баннер один раз, `save.seenUnlocks`), `initSeenUnlocks` (старые сохранения), `unlocksOfStage` |

### Экраны `src/game/scenes` (Phaser)

Список сцен — `src/main.ts` (кроме `ChapterDone`, она регистрируется при первом показе).

| Сцена (ключ) | Назначение |
| --- | --- |
| `BootScene` (`Boot`) | экран загрузки (вид — `bootLook.ts`: тёплый полумрак, лента «Chronoworld», полоса с фаской; совпадает с `#splash` в index.html): манифест, портреты, иконки навыков, скин; листы юнитов — лениво |
| Навигация | нижняя панель — 4 вкладки как в AFK Arena (`screen.ts TABS`, слева направо): «Кампания» (`Campaign`), «Герои» (`Heroes`), «Город» (`Home`), «Приключения» (`Adventure`). Игра открывается на «Кампании» (`BootScene`). Красный кружок вкладки — сумма значков её страницы (`navBadges.ts`: `campaignBadge` — сундук полон, бесплатные быстрые награды; `cityBadge` — Таверна, задания, достижения, события, почта, контракт; `adventureBadge` — экспедиции, Башня, попытки охоты); «Герои» — как раньше (`heroesNavBadge`). Подэкраны подсвечивают вкладку своей страницы и «Назад» ведут на неё: Таверна, Лавка, Задания, Достижения, События, Почта → «Город»; Башня, Экспедиции, Охота → «Приключения» |
| `HomeScene` (`Home`) | страница «Город»: плашка игрока в шапке, иконки событий, почты и контракта (`homeEvents.ts`), шестерёнка настроек; лента «Город» и четыре крупных «здания» 2×2 — Таверна, Лавка, Задания, Достижения (`buildingTile` в `tavernEntry.ts`: медальон, название, состояние, пояснение `note`, значок или зелёная точка, замок «Откроется на этапе …»; крупная плитка — высота ≥ 300; плитки заданий/достижений — `featureTiles.ts`); раскладка — константа `L` в сцене |
| `AdventureScene` (`Adventure`) | страница «Приключения» («Тёмный лес» AFK): Башня во всю ширину, под ней Экспедиции и Охота на босса (`featureTiles.ts towerTile/expeditionsTile`, `huntEntry.ts`); подсказка `tower_open` — на медальоне Башни; раз в секунду сверяет вернувшиеся экспедиции. Новые режимы (Лабиринт, Арена) — сюда же плитками |
| `CampaignScene` (`Campaign`) | страница «Кампания»: лента главы со стрелками, тропа этапов змейкой (узел 120, у текущего — мощь отряда против рекомендуемой), ряд «Быстрые награды» (`fastRewards`, «Бесплатно» / цена в гемах / «Закрыто») + «В бой · этап N» (`fightCta`, плашка мощи), карточка сундука офлайн-наград (`ChestCardView`: накопленное иконками, таймер «Полон через», «Собрать» `chestClaim`; у новичка без кнопки); подсказки первой сессии (`pickHomeHint`: «В бой», «Собрать», вкладка «Герои», вкладка «Приключения») — зазор под плашку между карточкой и навигацией, раскладка — `L` в сцене; сюжет `chapterStart`, баннеры открытий |
| `StageScene` (`Stage`) | подготовка к этапу: поле «отряд против противника» как в бою, список героев, «Авто», «Пресеты», «В бой»; сюжет `beforeStage` |
| `BattleScene` (`Battle`) | проигрывание лога боя: спрайты, эффекты, баннеры ульт и босса, скорость 1x/2x, пауза, «Пропустить». Показанная позиция = позиция ядра + разведение (`battleSpread.ts`); ходьба и разворот — по скорости показанной фигуры (`battleGait.ts`: walk только при своём шаге ядра и реальном движении, свой шаг/рывок назад — лицом по ходу, стоит/бьёт/сдвинут разведением — лицом к цели/ближайшему врагу; листы нарисованы лицом вправо) |
| `ResultScene` (`Result`) | итоги: награды (опыт — в запас), трофеи, MVP, подсказка «Улучшить», авто-следующий этап; сюжет `afterStage` |
| `ChapterDoneScene` (`ChapterDone`) | «Глава пройдена» (переживает перезагрузку через `save.pendingChapterDone`) |
| `HeroesScene` / `HeroScene` / `AscendScene` (`Ascend`) | H4. Коллекция: сетка карточек 3 в ряд (`heroCard.ts`), фильтры линии/роли/редкости, сортировка «Сила/Уровень/Редкость», «Коллекция N/M» (серые неполученные), метки «в отряде», «Новый!», замок, «можно улучшить / вознести». Карточка: витрина цвета редкости с героем в стойке, мощь, статы с прибавкой за уровень, «Улучшить» (удержание — повтор, обновление на месте, «до апа не хватает N»), «Вознести», вкладки «Навыки / Снаряжение / История», замок, листание ‹ ›. Вознесение: было → стало, слоты корма (выбор, «Авто», цепочка `autoChain` «сначала слить 3 зелёные в синюю»), откуда копии, на синем → фиолетовом шаг «Выберите ветку» (две панели, `branchPicker.ts`), показ (вспышка, лучи, мощь «+N», новые навыки, ветка и `branches[].promotion`). Коллекция группирует копии одного героя (плитка «×N», `groupCopies`), значок «Выберите ветку!», первая плитка — «Контракт героя». Карточка: «Выбрать ветку» / «Сменить ветку» (цена), «Ветки на фиолетовом» (превью), «Копий: N» (`copyCounter`), в «Навыках» — другая ветка серым, касание навыка — окно подробностей (`skillDetail.ts`: полное описание и цифры `skillFacts.ts`; то же в `branchPicker.ts`); «История» — начало пути, «После возвышения: <ветка>» (promotion + `branches[].bio`), другая ветка превью |
| `HeroPickScene` (`HeroPick`) | «Контракт героя» (`save.pendingPicks`): сетка 12 героев → выбор ветки (`branchPicker.ts`) → `claimHeroPick` → показ. Вход: плитка в «Героях», иконка в шапке главной (`contractIcon`, красный кружок), сразу после награды с контрактом в «Событиях» и «Почте» (данные `{index?, back?}`) |
| `SquadScene` (`Squad`) | то же поле и список героев без противника, «Авто», пресеты |
| `InventoryScene`, `TowerScene`, `QuestsScene`, `ExpeditionsScene` (`Expeditions`), `AchievementsScene` | инвентарь, башня, ежедневные задания, экспедиции (карточки локаций, сроки, «Отправить», «Забрать всё»), достижения |
| `HuntScene` (`Hunt`) | «Охота на босса»: босс дня, пороги урона с отметкой лучшего результата, попытки, «Зачистка», «В бой» (`Battle` с `{mode: 'hunt'}`), итог попытки поверх экрана; вход — `huntTile` (`huntEntry.ts`) на странице «Приключения»; счётчик урона в бою — `huntBattle.ts` |
| `ShopScene` (`Shop`) | Лавка: 8 карточек товаров дня (2 × 4), «Купить», «Продано», «Обновить» (первое за день бесплатно), таймер до полуночи; вход — `shopTile` (`src/game/shopEntry.ts`) на странице «Город» |
| `TavernScene` | Таверна (H5): призыв карточек, показ «рубашкой вверх» с переворотом, итог; вход — `tavernTile` на странице «Город» |
| `PrepScene` (`Prep`) | тестовый бой (только dev или `?dev=1`), отряды из `data/phase0.json` |

### Помощники `src/game`

| Файл | Роль |
| --- | --- |
| `content.ts` | `GAME`/`CONTENT` — `buildGameContext` из `import.meta.glob('data/...')`; новые файлы подхватываются сами |
| `session.ts`, `storage.ts`, `state.ts` | текущее сохранение и `commit`; localStorage (ключ `chronoworld.save.v1`, ревизии, бэкапы); настройки (скорость, авто, FPS, анимации) |
| `skin.ts` | скин «тёмная бронза», рисуется кодом (плитки с фаской и металлической рамкой, кнопки с «толщиной», вкладки, «таблетка» валюты, лента, медальон, свечение, блик, орнамент шапки, серая недоступная кнопка `skin_btn_disabled`); файл из манифеста с тем же id побеждает |
| `decor.ts` | украшения экранов в духе AFK: `ribbon` (лента-заголовок), `medallion` (иконка в медальоне), `ctaShine` (блик по главной кнопке), `slowRays`, `glow`, `motes`, `sparkBurst`; движение выключается «Уменьшить анимацию» |
| `theme.ts`, `layout.ts` | токены (шрифты `FS`, цвета `C`, `TOUCH`), размеры поля 1080×1920 |
| `ui.ts` | кнопки, тексты, прокрутка, защита от двойного тапа, указатель подсказки. Недоступная кнопка — `button(...).setEnabled(false)` (серый «камень», приглушённые подпись и иконки, без свечения/блика), а не `setAlpha`: нажатие по-прежнему приходит в onClick (экран объясняет тостом), кому не нужно — `.container.disableInteractive()` |
| `screen.ts` | каркас экрана: шапка, «Назад», валюта, нижняя навигация, портреты. `screen(..., { player: true })` — плашка игрока на главной (лидер отряда в рамке, «уровень лагеря» `flow.ts campLevel`, полоска опыта). Вытянутый телефон (`topBand()` ≥ 84 ед. над полем, `view().safeTop`) — валюта уезжает в полосу над шапкой одной строкой. `powerChip`/`setPowerChip` — плашка «мощь отряда / рекомендуемая · вердикт» (главная, этап); значок «Герои»: число (вознести/вещь) или зелёная стрелка «можно Улучшить» (`flow.ts heroesNavBadge`) |
| `flow.ts` | чистые помощники экранов без Phaser (тестируются). Красные кружки плиток главной: задания — `claimableCount`, достижения — `claimableAchievements`, экспедиции — `expeditionsBadgeCount` (вернувшиеся + свободные локации, куда хватает мощи), Башня — `towerBadgeCount` (мощь отряда ≥ мощи следующего этажа). «Крючок»: `recommendedPower(stageId)` (пока = мощь врагов `stagePower`; появится рекомендация баланса в ядре — заменить здесь), `powerCheck` (мощь отряда, рекомендуемая, тон ahead/close/behind, вердикт «Сил хватает / Чуть не хватает / Слабее») — главная «В кампанию», узел текущего этапа в кампании, этап; `campLevel` — «уровень лагеря» из прогресса (этапы, этажи, уровни героев; `CAMP_EXP`, `campLevelCost`), `leadHero` — аватар; тесты `tests/game-polish.test.ts` |
| `transitions.ts` | затемнение между экранами, блок ввода во время перехода |
| `juice.ts` | «сочность» меню: летящие награды, отсчёт чисел, выезд списков; выключается «Уменьшить анимацию» |
| `audio.ts`, `audioCatalog.ts`, `audioCore.ts`, `audioSynth.ts`, `sceneAudio.ts`, `battleAudio.ts` | звук (issue #26, `docs/design/audio.md`): `sfx(id)`, музыка по экрану, заглушки синтезом, файлы `assets/audio/<id>.ogg` побеждают; настройки «Музыка»/«Звуки»/«Без звука». Музыка RO (`music_*`, 22 трека) и фоны из файлов играют потоком (`<audio>` → `createMediaElementSource`, не `AudioBuffer`: трек RO в PCM — до ~105 МБ), звуки и заглушки — `AudioBuffer`. Один трек на две дорожки — один файл (второй в `files`). Отладка в dev: `window.__audio.stats()` — `streams` (живые потоки: 2 во время затухания, 1 потом), `trackBuffers` (только заглушки). Тесты движка — поддельные `AudioContext`/`Audio` в `tests/game-audio.test.ts` |
| `viewport.ts`, `viewLayout.ts` | вывод на экран телефона: безопасная зона, поля за краями, DPR |
| `backdrops.ts`, `backdropsExtra.ts`, `backdropsRoute.ts` | фоны боя и карты по **теме** главы (`theme` в `data/campaign` или тема слота — `chapterTheme` в ядре; не по месту главы): луг, канализация, орки, пустыня, ночной лес, корабль, часовая башня, склеп (Гласт Хейм), лабиринт, Нифльхейм, топь (ярус Башни); рисуются кодом; файлы `assets/backgrounds/bg_{battle,map}_ch<N>.*` (N — номер главы маршрута темы, `THEME_FILE`) побеждают |
| `tavern.ts`, `tavernArt.ts`, `tavernEntry.ts` | Таверна: чистые помощники (порядок и ритм показа, раскладка карт, кнопки, гарант — тесты `tests/game-tavern.test.ts`), нарисованный зал, рубашка карты и эффекты (файл `assets/backgrounds/bg_tavern.*` побеждает), плитка на главной со значком. Лицо карты призыва — общий `heroCard.ts drawHeroCard` (бюст на столе, фигура на крупной) |
| `chestView.ts` | карточка сундука на странице «Кампания»: иконки накопленного (золото, опыт, предметы, карты героя, гемы, свитки), таймер «Полон через Ч:ММ», строки трофеев для тостов сундука и быстрых наград |
| `ambient.ts` | тени под юнитами и частицы по теме |
| `battleFx.ts` | слои глубины боя, затемнение и баннер ульты, цифры, пулы |
| `skillFx.ts` | эффекты навыков кодом: круг каста, снаряды, площадь, искры (примитивы и текстуры) |
| `skillVisuals.ts` | свой вид навыка (без Phaser): `sig` рецепт целиком, `hit` попадание, `aura` бафф/щит/лечение на цели, `proc` вспышка пассивки, `tint`; аудит — `docs/content/skills-vfx.md` |
| `skillSigs.ts` | рецепты `playSignature` / `playAura` / `playProc` (Боулинг Баш, сокол, ловушки, колбы, Великий крест, Метеоритный дождь, Асура…) |
| `animatedFx.ts` | каталог `assets/effects/effects.json` (кадры RO) и карта навык → эффект |
| `skillLook.ts` | вид навыка: стихия, символ, снаряд/площадь по id и эффектам; `RO_SKILL_ICONS` (навык → иконка RO) |
| `skillIcons.ts` | значок навыка: `assets/ui/icons/skill_<id>.png` → иконка RO в рамке → символ кодом |
| `portraitFrame.ts` | портрет в рамке: бюст RO (`assets/ro/portraits`) → портрет спрайта → значок |
| `sprites.ts`, `spriteCache.ts` | реестр спрайтов для Phaser, ленивые листы, LRU по памяти, плейсхолдеры по роли |
| `dialogue.ts`, `storyView.ts` | окно диалога; кто говорит и чей портрет (без Phaser) |
| `hints.ts`, `hintLayout.ts` | подсказки первой сессии и их размещение |
| `unlockBanner.ts` | открытия функций: `showUnlockBanners(scene, onDone?)` — полноэкранный «Новая функция!» (своя иконка у функции — `featureIcon`: сундук, свиток, «2x», кубок, кружка, карта, башня; окно по высоте содержимого; название, описание, реплика Гаррета, «Перейти» / «Позже»), зовут страницы «Кампания» (после сюжета), «Город», «Приключения» и итоги (после сюжета, не в авто); «Перейти» — экран функции (быстрые награды — «Кампания»), его «Назад» — страница навигации; `lockCover` / `lockedTile` (HomeScene) / `lockedScreen` — замок «Откроется на этапе 1-8», касание — `lockedToast`; `installUnlockGates(game)` (main.ts) — скорость ×2 закрыта до своего этапа (`state.ts speedGate`, `playback.raw` — выбор, `playback.speed` — действующая) |
| `perf.ts`, `lifecycle.ts` | пулы объектов; пауза при сворачивании, ограничение FPS |
| `itemIcons.ts`, `describe.ts`, `assets.ts` | иконки предметов кодом; описание юнита; загрузка манифеста и плейсхолдеры |
| `bootLook.ts` | вид экрана загрузки (BootScene) маленькими canvas-текстурами до загрузки скина; `BOOT`/`BOOT_COLORS` — раскладка и цвета, повторены в CSS `#splash` index.html |
| `heroCard.ts` | плитка карточки героя (общая для «Героев» и «Таверны»): `drawHeroCard(scene, x, y, hero \| template \| templateId, opts)` — рамка редкости с орнаментом, фон-сияние, лицо или фигура, значки линии и роли, имя, уровень, ромбы редкостей, метки; `rarityBackdrop`, `rarityPips`, `iconBadge`, `glowTexture`, `raysTexture` |
| `heroesView.ts` | чистые помощники H4 (тесты `tests/game-heroes.test.ts`): фильтры и сортировка коллекции, листание, прибавка за уровень, `levelShortage`, `ascendPreview`, слоты корма, `copySources` |
| `squadEditor.ts`, `prepLayout.ts` | `FormationEditor` — подготовка к бою в духе AFK Arena: поле 2 фронт + 3 тыл по `combat.json field.slotsA` (герой в стойке, роль, уровень, мощь), список героев с прокруткой; нажатие — в лучший слот / убрать, перетаскивание из списка в слот и между слотами (касанием; цель — под «призраком» героя), «Переставить» при стрелках во фронте. `prepLayout.ts` — чистые правила (лучший слот, обмен, геометрия, жест), тесты `tests/game-prep.test.ts` |

`src/pipeline/sprites.ts` — реестр спрайтов (v2 + legacy) без Phaser, общий для игры и скриптов; `V2_SCALE`.

### Скрипты `scripts/`

| Файл | Что |
| --- | --- |
| `content-check.ts` + `lib/content-check-heroes.ts` | `npm run content:check` — все проверки контента и ассетов; карточки героев и Таверна (лист находится — свой или класса по полу, портрет, пол листа; призывную карточку Таверна выдаёт) — отдельный модуль, тест `tests/content-check-heroes.test.ts` |
| `content-new.ts` + `lib/content-gen.ts` | `npm run content:new` — заготовки unit/skill/chapter/stage/story/boss/hero (карточка героя: `hero <id> --class <job> --gender m\|f [--rarity] [--story --form --after]`); глава — с экономикой по формуле баланса (сундук +9%/этап, награды 30/45 мин сундука). Рецепты и чеклист новой главы — `docs/CONTENT_RECIPES.md`, 4а и 6 |
| `content-schema.ts` + `lib/schemas.ts` | JSON-схемы для редактора из zod |
| `sim.ts` | серии боёв |
| `playthrough.ts` | прохождение главы ядром, `--winrate`, `--idle` |
| `balance.ts` + `lib/player-model.ts` | модель игрока на D дней (часы сессии, «крючки», рекомендуемая мощь) → CSV |
| `balance-fit.ts` | регулятор `mult` глав (кроме главы 1) по окнам из `data/progression.json` → balance, `--chapter N` (docs/content/balance.md) |
| `balance-smooth.ts` | сила этапов по бою (D) и плавная кривая глав 4+: замер, подбор якорей по модели игрока (`--fit`), рекомендуемая мощь (`--recommended`); `--chapters chapter7,chapter8,chapter10 --base chapter6` — какие главы подбирать (docs/content/balance.md, 6а) |
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

`id, name, order, theme?, episode?, legend?, chronicle?, stages[]`; этап: `id, name, boss, inserted?, enemies (ровно 5 слотов: 0–1 фронт,
2–4 тыл; {unit, mult} | null), rewards {jobExp, gold}, offlinePerMinute {jobExp, gold}, finding?`. Главы склеиваются по `order`, у этапа
`index` (в главе) и `globalIndex` (сквозной). Сила врага: `hp/atk/def × mult × (1 + enemyStatGrowthPerStage)^growthStep` (0.08; spd не
растёт; `growthStep` — сквозной номер без вставных этапов `inserted`, по 10 ступеней на главу).

**Маршрут из 10 глав** (`docs/design/lore-route.md`, библия `docs/design/story.md`): слоты стабильны, содержимое переезжает.
1 Поля Пронтеры (Мастеринг), 2 Канализация Пронтеры (Золотой жук-вор), 3 Орочья деревня (Орк-лорд), 4 Пески Сограта (Осирис),
5 Пайон (Лунный цветок), 6 Затонувший корабль (Дрейк), 7 Альдебаран (Смотритель башни), 8 Гласт Хейм (Тёмный лорд `mob7_boss`,
мини-босс Верховный жрец `mob3_boss` на ch8_s15), 9 Лабиринтный лес (пока нет), 10 Нифльхейм (Владыка мёртвых
`mob_lord_of_death`, мини-босс Страж моста на ch10_s9). У глав 1–7 — 18 этапов (выпущенные s1…s10 + вставные s11…s18, босс — s10
последним), у глав 8 и 10 — s1…s18 подряд, босс s18. **Номер главы — `order`** («Глава N», «Эпизод N», этап «N-K» — `stageLabel`,
`flow.ts stageNo`; ворота предметов `minChapter` — `equipment/gates.ts chapterNumber`), а не место в списке. Вставка главы между готовыми сдвигает рост силы
следующих глав — рецепт 6 в `docs/CONTENT_RECIPES.md`.
Сюжет сезона — `docs/design/story.md`: Серый капюшон (спикер `herald`, портрет `unit:mob3_ranged`) — Ансгар, оруженосец Гаррета и
старший брат Вики; узнавание — гл. 8 (`ch8_s15_after`, `ch8_s16_after`), развязка — гл. 10 (`ch10_outro`: закрывает врата изнутри).
Последний этап главы = глава пройдена (`lastStageOfChapter`). Подробности и таблицы — `docs/content/campaign.md`.

### Башня `data/tower.json` (`TowerConfigSchema`)

`maxFloor` 100, `bossEvery` 5, `baseMult`, `statGrowthPerFloor`, `bands[]` (полосы с `fromFloor`,
`name`, `layouts[]`, `bossLayouts[]` — составы по 5 слотов), `rewards`. Полосы: 1 «Лесной ярус», 20 «Болотный», 40 «Костяной».
Тема фона этажа — по номеру полосы. См. `docs/content/tower.md`. Этап открытия — `data/unlocks.json` (`tower`, сейчас `ch1_s10`);
`ctx.tower.unlockAfterStage` заполняет сборка контекста (поле в tower.json — только для контекстов без таблицы, вместе с ней — ошибка).

### Охота на босса `data/hunt.json` (`HuntConfigSchema`, `src/core/hunt/schema.ts`)

`attemptsPerDay` (2), `timeLimitSeconds` (45 — бой короче обычного `combat.timeLimitSeconds`), `sweep` («Зачистка»), `slot` (слот
босса), `bosses[] {unit, hpMult, atkMult, defMult, scale?, title?}` (ротация по дням), `tiers[] {damage, rewards {gold?, jobExp?,
gems?, heroCards? {blue?, purple?}, item? (редкость)}}` — пороги строго растут, награды не убывают. Этап открытия — `data/unlocks.json` (`hunt`, `ch2_s1`).
Подробно — раздел 2г, рецепт — `docs/CONTENT_RECIPES.md`, «Босс охоты».

### Открытие функций `data/unlocks.json` (`UnlocksConfigSchema`, `src/core/unlocks/schema.ts`)

`features [{id, stage, title (≤40), description (≤140), icon, line? (≤120)}]` — одна таблица «функция → этап» (как в AFK: функции
открываются по ходу главы 1). `id` — из `FEATURE_IDS` (`fast_rewards` 1-2, `quests` 1-2, `speed_x2` 1-3, `achievements` 1-3, `tavern` 1-5,
`bounties` 1-8, `tower` 1-10, `hunt` 2-1, `shop` 2-1); нет строки — функция открыта сразу. `icon` — иконка скина или `mug` (кружка Таверны). `line` — реплика
капитана Гаррета на баннере (контент-хук). Открыта = этап в `campaign.cleared`. Таверна и Башня берут этап отсюда (ядро:
`summonUnlocked`, `towerUnlocked`); быстрые награды, задания, достижения, поручения, скорость ×2 — закрывают экраны
(`src/game/unlockBanner.ts`) и модель игрока (`scripts/lib/player-model.ts`), действия ядра их не проверяют. **Таверна — на `ch1_s5`**:
на это опираются Ц4 баланса и `e2e:chapter1`. Рецепт — `docs/CONTENT_RECIPES.md`, «Открыть функцию на этапе».

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

- Шаблон (`HeroTemplateSchema`, `src/core/heroes/schema.ts`): `id, name, gender, job (первая профессия), line, role, source
  (story|summon), baseRarity (green), maxRarity (red), statMods {hp,atk,def,spd}, skills [{level, skill}] (2–4), branches [{job (вторая
  профессия), role, statMods, skills, promotion, bio? (история формы ≤300, вкладка «История»), visual {sprite?}}] (ровно 2), visual {sprite?}, bio (≤160), hook (≤200)`.
- 12 героев (герои v2): 6 первых профессий × парень и девушка — сюжетные Алан, Бран, Вика, Грета, Дорн и из Таверны Ирис, Мэйлин,
  Кай, Лира, Зара, Тео, Отто; у каждого 2 ветки (24 формы; Танцовщица — новая профессия `data/jobs/dancer.json`). Таблицы —
  `docs/design/heroes-v2.md`, раздел 1.
- `data/cards.json`: `rarities` (5 по порядку: цвет, `maxLevel` 20/40/60/80/100, `statMult`, `skillPower`), `level` (цена уровня),
  `merge` (одна дорожка: `fodder [{kind same|any, rarity, count}]`, золото, `branch: true` — выбор ветки на переходе в фиолетовый),
  `branchChange {gems 300, firstFree}`, `heroCards` (карты случайных героев за этапы: `firstClear`, `bossFirstClear`, `replay` —
  ожидаемое число `{blue?, purple?}`).
- `data/summon.json`: `costs` (30 / 270), `rates` (73/25/2%), `pity [{blue, 10}, {purple, 50}]`, `firstTen {blue, count 2}`,
  `freePerDay`, `welcome` (150 гемов + 10 свитков). Этап
  открытия — `data/unlocks.json` (`tavern`, ch1_s5), в `ctx.summon.unlockAfterStage` его кладёт `parseHeroesConfig`.
- Рецепт — `docs/CONTENT_RECIPES.md`, «Новый герой».

### Правила боя `data/combat.json`

`actionThreshold` 1000, `tickSeconds` 0.1, `timeLimitSeconds` 90, `damage`, `energy` (max 100, +25 за действие, +10 за полученный удар),
`skills.defaultCooldown` 8, `projectileSeconds` 0.3, `statusTurnSeconds` 1, `movement` (`meleeRange` 130, `moveSpeed` 320,
`stackAngles`, `retargetSeconds`, `bodyRadius`, `minSeparation`, `meleeAoeRadius`, `maxMeleePerTarget` 2, `diveStay`, `diveReturnSeconds`),
`slots`, `field` (ширина 1080, `bounds`, координаты слотов стороны A; B — зеркало).

### Предметы, задания, экспедиции, достижения

- `data/items/*.json` — `{items: [{id, name, slot (weapon|armor|helmet|boots), rarity (common|rare|epic), stats, jobs?, drop, minChapter}]}`;
  `jobs` — корни веток (["archer"] → лучник, охотник, бард); `minChapter` — ворота по главе для всех источников предметов (этапы,
  сундук, быстрые награды, Лавка, охота; номер главы — `order`, т. е. номер на маршруте): эпики — с главы 2, Слейпнир — с 3, у глав 4–8 и
  10 — по 4 свои вещи (`src/core/equipment/gates.ts`, проверки — `lint.ts`). `data/drops.json` — правила выпадения по главам (`rules`) и трофеи сундука
  (`chest`, раздел 2в). См. `docs/content/equipment.md`.
- `data/quests.json` — ежедневные задания: `event` из `ACTIVITY_KINDS` (`src/core/features/quests.ts`), `target`, `points`; `milestones` активности.
- `data/expeditions.json` — экспедиции: `maxHeroes`, `durations` (`hours`, `bonus`), `locations` (`stage`, `power`, `tint`, `monster`, `perHour`, `loot`), `presets` (K8). См. `docs/content/meta.md`, K9.
- `data/achievements.json` — `counter` из `ACHIEVEMENT_COUNTERS` (`src/core/meta/config.ts`), `target`, `rewards`. См. `docs/content/meta.md`, `features.md`.
- `data/shop.json` (`ShopConfigSchema`, `src/core/shop/schema.ts`) — Лавка: `slots` (8 списков id товаров), `refresh {gemCosts, maxPerDay}`,
  `chapterGrowth`, `goods [{id, kind (item|heroCard|heroExp|scrolls|gold), rarity? (предмет), cardRarity? (карта героя), count, price {currency gold|gems, amount}, stock, weight,
  fromStage?, perDay?}]`. Раздел 2д, рецепт — `CONTENT_RECIPES.md` «Товары лавки».
- `data/phase0.json` — отряды тестового боя и скорости воспроизведения.
- `data/events.json` (`EventsConfigSchema`, `src/core/events/schema.ts`) — «Вход 7 дней» (`login.days[].rewards`), «7 дней новичка»
  (`newbie`: `durationDays`, `graceDays`, `days[].tasks` со счётчиками достижений, `milestones`), системные письма (`mail.letters`).
  Награда (`RewardBundle`): `gold, gems, jobExp, scrolls, heroes[]`. См. раздел 2б и `CONTENT_RECIPES.md` «Награды событий».

---

## 2а. Герои (v2: 12 героев × 2 ветки) — API ядра для экранов (H4 «Герои», H5 «Таверна»)

Дизайн — `docs/design/heroes-v2.md`. Всё — из `src/core` (`import { … } from '../core'`), чистые функции, время/день передаёт UI.
Для записи — обёртки `act*` (засчитывают задания и достижения) или функции ядра, результат — `commit(r.save)`. Ошибки правил —
`HeroError` (`code`, русский `message` — в тост).

**Модель.** Герой — шаблон `data/heroes/<id>.json` (первая профессия `job`, две ветки `branches[]`); экземпляр — `save.heroes[]`
`{id, templateId, rarity, level, locked?, isNew?, branch?, branchChanges?}`. Копий одного героя может быть много (корм для вознесения);
в отряде — один экземпляр героя. **Форма** (класс, роль, статы, навыки, лист) — ветка `hero.branch`, если редкость ≥ фиолетовой и
ветка своя; иначе — первая профессия (фиолетовый без ветки воюет первой профессией со статами фиолетового — «Выберите ветку!»).

**Чтение героя**
- `heroCard(hero, ctx)` → `{ name, gender, source, job, jobName, line, role, rarity {id,name,color,maxLevel,…}, maxRarity, level,
  maxLevel, stats, skills [{skill, level, unlocked, passive}], branch?, needsBranch, branches [BranchView], branchAt? ('purple' — пока
  герой ниже), bio, hook, locked, isNew }`. `BranchView` = `{ job, jobName, role, skills, promotion, bio?, sprite? }` — для превью веток на
  синем, выбора ветки при вознесении и контракте, «Сменить ветку».
- Форма: `activeForm(template, {rarity, branch?})` → `{ job, role, statMods, skills, sprite?, branch?, promotion? }`,
  `activeBranch`, `branchOf(template, job)`, `needsBranch(hero, ctx)`, `branchOptions(templateId, ctx)`, `BRANCH_RARITY` ('purple').
- Мелкие: `heroName`, `heroGender`, `heroJobId` (класс формы), `heroRole`, `heroLine`, `heroStats`, `heroSkillList`, `heroSkills`,
  `heroSpriteOverride` (лист формы); спрайт по реестру — `src/game/flow.ts heroSprite(hero, ctx)`; статы — `cardStats(t, level,
  rarity, ctx, branch?)`.
- Копии: `heroCopies(save, templateId)` (сильнейший первым), `storyHero(save, templateId)` — сильнейший экземпляр.
- Редкости: `CARD_RARITIES`, `rarityDef(ctx, r)` (цвет, предел, множители), `maxLevelOf`, `nextRarity`, `rarityIndex`.
- Мощь: `heroPower(hero, ctx, save)` (K2, с экипировкой), `squadPower(save, ctx)`, `stagePower(stageId, ctx)` (враги этапа).
- **Рекомендуемая мощь этапа** (как в AFK над «В бой»): `recommendedPower(stageId, ctx)` — красивое число; `stagePowerCheck(save,
  stageId, ctx)` → `{ squad, recommended, ratio, verdict 'easy'|'ok'|'hard'|'very_hard' }` (≥1.1 / ≥0.95 / ≥0.85 / ниже) — цвет и
  подсказка «чуть-чуть не хватает — поднимите уровни». Коэффициенты — `data/progression.json → power.recommended*`, подбор —
  `npm run balance -- --fit-recommended` (`docs/content/balance.md`, раздел 4).
- **Уровни врагов и «герои ур. N (синие)»** (`src/core/features/levels.ts`, только отображение): `stageLevels(stageId, ctx)` →
  `{ recommended {level, rarity, squad}, rarity, enemies (по слотам enemySquad), typical, boss? }`; `recommendedHeroLevel` — наименьший
  уровень, при котором `squad` медианных героев полосы набирают `recommendedPower`; `unitLevel(unit, rarity, ctx, bossFactor?)` —
  hp·atk врага / `enemyScale` (босс — ещё / `bossScale` × поправка этапа²) против медианного героя; `enemyLevels(units, rarity, ctx)`
  (башня); `levelBand(stageId)` / `progressLevelBand(save)` — полоса (редкость и число героев) этапа / текущего этапа игрока
  (башня, охота); `squadAverageLevel(save)`, `levelTone(enemy, squad)` → red (> +5) / yellow (выше) / white. Экраны: `flow.ts`
  `enemyLevelColor`, `levelLabel`, `recommendText`. Конфиг — `data/progression.json → power.levels`, калибровка —
  `npm run balance -- --levels` (`docs/content/balance.md`, раздел 4а).

**«Улучшить» (уровень из общего пула опыта `save.resources.heroExp` + золото)**
- `levelUpInfo(save, heroId, ctx)` → `{ level, maxLevel, cost {exp, gold} | null, canLevel, blocker ('max_level'|'not_enough_exp'|
  'not_enough_gold'|null), affordable (сколько уровней по карману), pool, gold }`.
- `actLevelUp(save, day, heroId, ctx, times = 1)` → `{ save, levels, spent, events }` (события `levelUp`, `skillUnlocked`);
  `autoLevel(save, ctx, heroIds?)` — «Улучшить всех» (по уровню самому низкому). Цены — `levelUpCost`, `levelRangeCost`.

**Вознесение (одна дорожка для всех, `data/cards.json → merge`)**: зелёный → синий — 2 зелёные копии того же героя; синий →
фиолетовый — 2 синие копии + **выбор ветки**; фиолетовый → золотой — 1 фиолетовая копия (любой ветки); золотой → красный — 1 своя
фиолетовая + 2 фиолетовые любых героев. Корм — ровно нужной редкости; плюс золото. Уровень цели сохраняется, опыт/золото корма
возвращаются, вещи корма — в инвентарь.
- `ascendRequirement(save, heroId, ctx)` → `null` (максимум) или `{ from, to, gold, fodder [{kind 'same'|'any', rarity, count,
  candidates[]}], branch (выбрать ветку на этом переходе), branches? [BranchView], blockers[] }`.
- `ascendPlan(save, heroId, ctx)` → `{ fodder[], complete, missing }` («Авто» — самые слабые свободные копии); `autoFodder` — то же или
  null; `canAscend(save, heroId, ctx)`; `autoChain(save, heroId, ctx)` → шаги `[{targetId, fodderIds}]` «сначала слить 3 зелёные в
  синюю» (выполнять `ascendHero` по порядку); `fodderBlocker(save, id, ctx)` — почему нельзя в корм (замок, отряд, пресет, экспедиция).
- `actAscend(save, day, heroId, fodderIds, ctx, { branch? })` / `ascendHero(…)` → `{ save, events, refund {exp, gold}, consumed }`;
  события `ascended {from, to, job, jobChanged}`, `branchChosen`, `skillUnlocked` (навыки новой формы). Коды: `branch_required`,
  `bad_branch`, `bad_fodder`, `fodder_busy`, `not_enough_gold`, `max_rarity`. Ветку вознесение не меняет (только ставит, если её нет).
- Замок и «Новый!»: `setHeroLocked(save, heroId, bool)`, `markHeroSeen(save, heroId)`.

**Ветка второй профессии** (`src/core/heroes/branch.ts`)
- `branchStatus(save, heroId, ctx)` → `{ branch?, canChoose, canChange, changeCost, changeFree }`.
- `chooseBranch(save, heroId, job, ctx)` — фиолетовый и выше без ветки, бесплатно (`branch_locked`, `bad_branch`).
- `changeBranch(save, heroId, job, ctx)` → `{ save, events, gems }` — первая смена бесплатно, дальше `data/cards.json →
  branchChange.gems` (300); `not_enough_gems`; вещи, которые новая форма носить не может, снимаются (ctx с `equipment`).
- `branchChangeCost(hero, ctx)`. Событие `branchChosen {heroId, branch, changed, gems}`.

**Карты героя из наград** (`src/core/heroes/cardDrops.ts`; решение владельца 28.09 — вместо осколков): синие и фиолетовые карты
**случайного героя** — новый экземпляр с «Новый!» (копия ему в рост). Источники: этапы (`data/cards.json → heroCards`: первое
прохождение / босс главы / повтор, бросок от seed боя), сундук и быстрые награды (`drops.json → chest.rules[].heroCards`), охота
(`hunt.json → tiers[].rewards.heroCards`), экспедиции (`loot kind heroCard`), достижения (`rewards.heroCards`), Лавка (`kind heroCard`),
награды событий/письма (`RewardBundle.heroCards`). Числа в данных — ожидаемое число (`HeroCardDropSchema {blue?, purple?}`: целая
часть — точно, дробная — шанс). API: `stageCardDrop(stage, firstTime, ctx)` (превью на подготовке), `dropText(drop)`,
`rollHeroCards(drop, rng, ctx)`, `grantHeroCards(save, cards, ctx)`. Событие `heroCard {heroId, templateId, rarity, name}`.

**«Контракт героя»** (`src/core/heroes/contract.ts`): награда `heroPicks: [{rarity}]` (день 7 входа, 180 очков новичка) кладёт
контракт в `save.pendingPicks [{rarity, source}]` (событие `heroPick`). `pendingPicks(save)`, `pickOptions(pick, ctx)` (все 12),
`claimHeroPick(save, index, templateId, branch, ctx)` → `{ save, heroId, events }` (фиолетовый — ветка обязательна:
`branch_required`, `bad_branch`, `unknown_pick`).

**Таверна**
- Пул — все 12 героев (`summonPool(ctx, rarity)`), шансы 73 / 25 / 2% (`data/summon.json`), гаранты `pity [{blue, 10}, {purple,
  50}]` (счётчики `save.summon.sinceBlue` / `sincePurple`), первый ×10 — не меньше двух синих. Фиолетовый приходит без ветки.
- `summonStatus(save, day, ctx)` → `{ unlocked, unlockAfterStage, gems, scrolls, costs, freeLeft, untilPity, pityRarity (младший
  гарант — синяя), pities [{rarity, until}], rates, firstTenBonus, firstTenRarity, firstTenCount, total, can {gems1, gems10, scroll1,
  scroll10, free} }`.
- `actSummon(save, day, count 1|10, pay 'gems'|'scroll'|'free', ctx)` → `{ save, results [{heroId, templateId, name, rarity, isNew,
  guaranteed}], events }`. Результат уже в сохранении (детерминирован от `createdAt` и `summon.seq`) — анимацию показа строить по
  `results`. Подарок открытия выдаёт `playStage` (событие `tavernUnlocked`); `grantTavernWelcome` — идемпотентно.
- Экран — `TavernScene` (`src/game/scenes/TavernScene.ts`): `actSummon` → `scene.restart({ reveal })` → показ по `results`
  (для e2e `scene.reveal.phase`: deal → pick → flipping/showcase → done). Звук — `summonSound(rarity)`, его задержка = нарастание.

**Сюжет**: рекрут (`progression.heroes.recruits`) приходит зелёным; если герой уже есть (из Таверны) — приходит его зелёная копия
(событие `heroJoined {copy: true}`, в отряд не ставится).

**Отряд**: один экземпляр героя — `duplicateCardsInSquad`, `templateInSquad` (серые дубли в ростере), `setSquad(save, squad)`
(MetaError `duplicate_card`), `placeInSquad`; бой с дублем — `GameRuleError('duplicate_card')`. Ростер: `addHeroCard`, `newHeroId`,
`ownedStoryTemplates`, `storyHero`, `heroCopies`, `storyOrder` (hero1…heroN сюжета).

**Сохранение v7** (`src/core/heroes/migrate-v7.ts`, заморожен; шаг `MIGRATIONS[6]` после экспедиций): 13 старых фиолетовых шаблонов →
герой + ветка (таблица в файле), сюжетные фиолетовые → прежняя ветка, дубли в отряде/пресетах — сильнейший, осколки → копии героя
(10 осколков вверх — зелёная, 3 зелёные — синяя), незабранные старые фиолетовые в почте → «Контракт героя», Лавка и экспедиции,
10 свитков и сообщение. `sanitizeSave` снимает чужую ветку и ветку ниже фиолетового.

**Экраны-помощники** (`src/game/flow.ts`): `levelUpReady`, `ascendReady` (значок «Герои»), `levelText`, `describeEvents` (строки
`levelUp`, `ascended`, `heroCard`, `branchChosen`, `heroJoined`, `tavernUnlocked`), `defeatAdvice`; `src/game/heroesView.ts`:
`ascendPreview(hero, ctx, branch?)` (превью по выбранной ветке), `groupCopies` (коллекция: одна плитка на героя), `copyCounter` («Копий: N ·
в корм син. 1/2»), `copySources`, `fodderSlots`, `fodderSlotLabel`. Подсказка главной `level_up` (`hints.ts`). Значок вкладки «Герои»
(`heroesBadgeCount`) считает ещё фиолетовых без ветки и невыбранные контракты; `describeEvents` пишет и `heroPick`.
Пакет V2 (экраны): `src/game/branchPicker.ts` — окно выбора ветки (`openBranchPicker`: две панели — фигура формы, класс, роль,
возвышение, 4 навыка; `current`, `selected`, `viewOnly`, предупреждение `branchRoleWarning` «в отряде не останется лекаря») — общее
для вознесения, карточки и контракта; `heroCardIcon(scene, x, y, size, rarity, templateId?, {pick, dim})` (`heroCard.ts`) — мини-карта
героя в рамке редкости для наград (сундук, итоги, почта, события: `rewardItems` виды `heroCard` / `heroPick`); у `drawHeroCard` опции
`branch`, `copies` (×N), `needsBranch`. Сообщение перевода сохранения v7 показывает `screen.ts` окном «Обновление героев»
(`isHeroesNotice`, `noticeModal`), остальные предупреждения сохранения — красным тостом, как раньше.

---

## 2б. События новичка и почта — API ядра (`src/core/events`)

Чистые функции, день ('YYYY-MM-DD') передаёт UI (`today()`); календарь считается арифметикой (`dayNumber`, `daysBetween`), без Date.
Ошибки — `EventError` (`code`, русский `message`).
- `touchEvents(save, day, ctx)` — «игрок открыл игру»: первый раз — старт событий (`save.events.startDay`) и доставка системных писем;
  новый день (больше `lastDay`) — `loginDays + 1` (пропуски не сбрасывают, как в AFK); тот же день или часы назад — тот же объект.
  Заодно доставляет новые письма из `data/events.json → mail.letters` (`deliverSystemMail`, каждое один раз, `untilDay`; `onlyIfCleared` —
  только тем, у кого этап уже пройден, остальным письмо молча помечается доставленным: так `world_changed_1` о переезде глав 2, 3, 7).
  UI зовёт `touchToday()` (`src/game/homeEvents.ts`) на главной, в «Событиях» и «Почте».
- «Вход 7 дней»: `loginStatus(save, day, ctx)` → `{ loginDays, days [{day, rewards, label?, reached, claimed, ready}], claimable, done }`;
  `claimLogin(save, day, n, ctx)` → `{ save, rewards, events }` (любой наступивший незабранный день; `login_locked`, `login_claimed`).
- «7 дней новичка»: `newbieStatus(save, day, ctx)` → `{ eventDay, active, open (идёт или льготный день), daysLeft, closesIn, days [{day,
  locked, tasks [{…, progress, done, claimed, locked, ready}]}], points, maxPoints, milestones [{points, rewards, reached, claimed, ready}],
  claimable, done }`. Прогресс заданий — счётчики достижений (`save.achievements.counters`, копятся с начала игры).
  `claimNewbieTask(save, day, id, ctx)` → очки; `claimNewbieMilestone(save, day, points, ctx)` → награда сундука.
- Значки главной — `eventsBadges(save, day, ctx)` → `{ login, newbie, loginVisible, newbieVisible }`.
- Почта (`mail.ts`): `mailStatus(save)` → `{ letters (новые первыми), unread, claimable }`, `sendMail(save, day, {from, title, body,
  rewards?, source?})` (компенсации из кода/тестов; лимит `MAIL_MAX` = 100, письма с вложением не теряются), `readMail`, `claimMail`,
  `claimAllMail` (сумма вложений), `deleteReadMail`, `letterClaimable`.
- Выдача наград — `grantRewards(save, bundle, ctx)`: золото, гемы, свитки, опыт в пул, карточки (`heroes` — на `baseRarity` шаблона,
  значок «Новый!», в отряд не ставятся; события `heroCard`, `scrolls`, `gems`, `rewards`).
- Экраны: `EventsScene` (вкладки «Вход»/«Новичок», данные `{tab, day}`), `MailScene` (`{open?}`), иконки в шапке главной —
  `homeEventIcons` (`src/game/homeEvents.ts`, объекты `eventsIcon`, `mailIcon`), тексты наград — `src/game/rewardsView.ts`.
- Модель баланса забирает всё это каждую сессию (`PLAYER_MODEL.events`, `npm run balance -- --no-events` — без событий).

## 2в. Сундук с трофеями (AFK Chest) — API ядра

Кроме золота и опыта сундук простоя копит трофеи: предметы, карты случайного героя (синие, изредка фиолетовые — новые экземпляры),
изредка гемы и свитки. Данные — `data/drops.json → chest` (`ChestDropsSchema`, `src/core/equipment/schema.ts`, JSON Schema
`data/schema/drops.schema.json`): `tickMinutes` (30) и `rules` по главам `{chapter?, item (шанс предмета за тик), rarityWeights?
(нет — веса `rules` этой главы), heroCards {blue, purple} (шансы за тик), gems|scrolls {chance, count}}`. Глава — глава последнего пройденного этапа.
- Бросок за каждый **полный** тик засчитанных минут (с `banked`, в пределах `capHours`); неполный тик при сборе сгорает (как в AFK).
  У тика свой поток `Rng` от seed и номера тика — превью растёт монотонно, уже показанное не меняется.
- seed: сундук — `chestSeed(save)` (createdAt + `offline.lastClaimAt`: сбор сдвигает якорь → новый seed); быстрые награды —
  `fastLootSeed(save, day)` (createdAt, день, номер использования за день). Время передаёт UI; в ядре нет Date/Math.random.
- `offlineLoot(save, now, ctx)` → `ChestLoot {ticks, items (id описаний), cards [{templateId, rarity}], gems, scrolls}` — превью, совпадает со сбором в тот же now.
  `offlineFullInMs(save, now, ctx)` → мс до заполнения (0 — полон, null — нет пройденных этапов).
- `claimOffline` / `actClaimOffline` → ещё и `loot: ChestLootGrant` (`added` — экземпляры в инвентаре, `heroEvents` — новые герои), события `heroCard`.
- Быстрые награды: `fastRewardsLoot(save, day, ctx)` — превью; `useFastRewards` / `actUseFastRewards` → `loot` (те же правила за
  `fastRewards.hours`, сундук не трогается).
- Без `ctx.equipment` (например, `loadGameContext()` в тестах) или без `chest` в `drops.json` трофеев нет — только золото и опыт.
- Проверка ставок: `validateEquipment` — ожидание за сутки простоя не больше `CHEST_LIMITS` (60 гемов, 1 свиток); тест `tests/chest-loot.test.ts`.
- Сохранение не менялось: трофеи считаются при сборе из времени, новых полей нет.
- Экран: `src/game/chestView.ts` (`ChestCardView` на карточке сундука главной, `lootLines`/`lootSummary` для тостов и подтверждения).

## 2г. Охота на босса — API ядра (`src/core/hunt`)

Аналог гильдейской охоты AFK Arena, одиночный: `attemptsPerDay` раз в день отряд бьёт огромного босса `timeLimitSeconds` секунд,
награда — высший порог `tiers`, которого достиг урон. Босс падать не должен (hp × `hpMult`); если всё же упал — урон = его hp.
- Контекст: `FullContext.hunt` (сборка `buildGameContext`, сырые данные `RawGameData.hunt`); функции принимают `HuntContext`.
- `huntBoss(day, ctx)` — босс дня: `bosses[dayNumber(day) mod длина]` (одна ротация у всех), `def` — юнит с id `hunt_boss` и статами × множители.
- `huntStatus(save, day, ctx)` → `{unlocked, lockedText, boss, attemptsPerDay, used, attemptsLeft, best (лучший урон по этому боссу),
  bestTier, canSweep, tiers}`.
- `fightHunt(save, day, ctx)` → `HuntOutcome {save, result, boss, damage, tier, grant, record, sweep: false}`. Бой — обычный
  `simulateBattle` с `combat.timeLimitSeconds = hunt.timeLimitSeconds` (лимит времени в симуляторе уже был, отдельного флага не нужно),
  отряд `save.squad` с экипировкой. Урон — `huntDamage(result)` (урон по боссу, щит тоже считается). seed — `huntSeed(save, day)`
  (createdAt, день, номер попытки), `battleSeq` не меняется. Попытка тратится при любом исходе.
- `sweepHunt(save, day, ctx)` — «Зачистка»: награда за лучший урон по боссу дня без боя, тратит попытку (`HuntError('no_sweep')` —
  с этим боссом ещё не бились).
- Награда (`grant`): золото, гемы, опыт — в общий пул, карты случайных героев (`heroCards` — события `heroCard`), предмет — случайный
  указанной редкости (seed `huntSeed(save, day, 'loot')`).
- Ошибки: `HuntError` `hunt_locked` / `no_attempts` / `no_sweep` / `invalid_config`; пустой отряд — `GameRuleError`, как у этапа.
- Сохранение: необязательное `save.hunt = {day, used, best: {unit → урон}}` без смены версии. Попытки сбрасываются днём новее
  `hunt.day`; день назад (часы переведены) новых попыток не даёт.
- Экран: `HuntScene`; бой — `BattleScene` с `{mode: 'hunt'}` (счётчик урона `huntBattle.ts`, таймер «/ 00:45», баннер «Босс охоты»),
  после боя — снова `Hunt` с итогом (`{outcome}`), а не `Result`. Модель игрока: бой в первой сессии дня, дальше «Зачистка».

## 2д. Лавка — API ядра (`src/core/shop`)

Магазин за золото (docs/design/afk-gap.md, п. 9): 8 слотов, раз в день новый ассортимент, ручное обновление за гемы, запас в слоте.
Главная роль — сток золота; гемы — только за редкое (эпик, синяя карта героя, свиток, мешок золота). Контекст — `GAME.shop` (необязательное
поле `FullContext`: нет `data/shop.json` — Лавки нет); функции берут `ShopContext` (экран — `shopCtx()` из `src/game/shopEntry.ts`).
- Ассортимент: `rollShop(save, day, refresh, ctx)` — по слоту товар по весам среди доступных (`fromStage` пройден, есть предметы
  редкости), затем конкретный предмет или герой карты (kind heroCard: случайный из пула Таверны). seed — `shopSeed` = createdAt + день + номер обновления
  (`lootSeed('shop', …)`), на слот ровно 2 случайных числа. Слот — снимок (`ShopSlot`: good, kind, itemId?, hero?, count, currency,
  rarity? (карта героя), price, stock, bought): правка `data/shop.json` не меняет выставленное. Цена в золоте и наборы опыта/золота ×(1 + chapterGrowth × глава)
  (`shopMultiplier`, глава последнего пройденного этапа), округление до 2 значащих цифр (`niceNumber`).
- `ensureShop(save, day, ctx)` — новый день → новый ассортимент, `refreshes` и `boughtToday` обнуляются; тот же день — тот же объект;
  день раньше сохранённого (часы назад) — без изменений (Лавка ждёт своего дня; переводом часов лишний ассортимент не получить).
- `shopStatus(save, day, ctx)` → `{unlocked, day, slots [ShopSlot + index, left, soldOut, dayLimited, affordable], refreshes,
  nextRefreshCost (null — лимит), refreshesLeft}` — не меняет save.
- `refreshShop(save, day, ctx)` — цена `refresh.gemCosts[n]` (0, 20, 40, 80, 100; последняя повторяется), не больше `maxPerDay` (5);
  `buyShopSlot(save, day, index, ctx)` → `{save, grant}`: предмет в инвентарь, карта героя — новым экземпляром (`grant.heroInstanceId`), опыт в пул, свитки/золото в валюту;
  лимит товара в день `perDay` (свиток — 1) считается по `boughtToday` через обновления. Ошибки — `ShopError` (`shop_locked`,
  `refresh_limit`, `not_enough_gold`, `not_enough_gems`, `sold_out`, `day_limit`, `unknown_slot`, `unavailable`), тексты — по-русски.
- Открытие — `data/unlocks.json → shop` (`ch2_s1`), `shopUnlocked`. Сохранение: `save.shop?` (`ShopStateSchema`, без смены версии).
- Экран — `ShopScene`; плитка на главной — `shopTile` (одна строка в HomeScene), зелёная точка — бесплатное обновление ещё не взято.
  Модель игрока — `Sim.shop()` в `scripts/lib/player-model.ts` (`--no-shop` — без неё). Тесты — `tests/shop.test.ts`.

---

## 3. Сохранение

- Формат — `SaveStateSchema` (`src/core/save/schema.ts`), `SAVE_VERSION = 7`; ключ localStorage `chronoworld.save.v1` (ключ не менялся).
- **v4 (карточки героев)**: `heroes[] = {id, templateId, rarity, level, locked?, isNew?}`, `resources.heroExp` (пул опыта),
  `currency.scrolls`, `shards {шаблон: n}`, `summon {seq, total, sincePurple, firstTenDone, freeDay?, freeUsed?, welcomeGiven,
  discovered[]}`, `notices?` (одноразовые сообщения — `sanitizeSave` отдаёт в `warnings` и убирает). Миграция v3 → v4 —
  `src/core/heroes/migrate.ts` (заморожена, не читает `data/`): герой → сюжетная карточка по имени (Алан; Бран/Бэлла; Вика/Вик;
  Грета/Грег; Дорн), иначе — свободная по порядку, шестой и дальше — призывная карточка линии; уровень тот же (вторая профессия — 40 + ур.),
  редкость по пределу; `jobExp`, `bankedExp` и излишек уровней — в пул; +1 свиток и сообщение; `ch1_s5` пройден — подарок Таверны.
  Счётчик достижений `hero_max_job_level` → `hero_max_level`. id героев не меняются.
- **v5 (события и почта)**: `mail {seq, letters [{id m<n>, source?, from, title, body, day, rewards, read, claimed}], delivered[]}`,
  `events? {startDay, lastDay, loginDays, loginClaimed[], newbieTasks[], newbieMilestones[]}` (появляется при первом `touchEvents`).
  Миграция v4 → v5 (`MIGRATIONS[4]`) — пустая почта; письмо «Добро пожаловать» и старт событий — при первом открытии игры.
  Порядок ключей в схеме важен для `serialize(deserialize(x)) === serialize(x)` (инвариант фазз-теста): `mail` — сразу после `seenScenes`.
- **v6 (экспедиции)**: `bounties {active [экспедиции]}` — `save/migrate-expeditions.ts` (`MIGRATIONS[5]`).
- **v7 (герои v2)**: `heroes[].branch?` (id профессии ветки), `heroes[].branchChanges?`, `summon.sinceBlue?`, `pendingPicks?
  [{rarity, source}]` («Контракты героя»), осколков (`shards`) больше нет; добыча экспедиции — `heroCards {blue, purple}`, слот Лавки —
  `kind heroCard` + `hero`, `rarity`; награды писем — `heroCards?`, `heroPicks?`. Миграция — `src/core/heroes/migrate-v7.ts`
  (`MIGRATIONS[6]`, заморожена; раздел 2а и `docs/design/heroes-v2.md`, раздел 8.1). Следующий шаг — `MIGRATIONS[7]` отдельной функцией.
- `deserialize`: JSON → `MIGRATIONS[v]` по цепочке v → v+1 → zod → возврат неизвестных полей (`keepUnknownFields`, чтобы старая сборка
  не стёрла поля новой) → проверки целостности (дубли героев, неизвестные герои в отряде/предметах/поручениях). Версия новее сборки —
  `SaveError('newer_version')`, сохранение не затирается (только чтение).
- `seenUnlocks?` — показанные баннеры «Новая функция!» (без смены версии, **без default**: нет поля — сохранение старше
  `data/unlocks.json`, `sanitizeSave` → `initSeenUnlocks` отмечает показанным всё уже открытое, чтобы не вывалить пачку баннеров;
  тест `tests/unlocks.test.ts`). `newGame` ставит `[]`.
- Новое поле: если оно необязательное (`.optional()`/`.default()`) — версия не меняется (так добавлены `seenScenes`, `storyQueue`,
  `pendingChapterDone`, `revision`, `shop`, `bankedExp`, `hero.gender` — его `sanitizeSave` выводит по имени, неизвестное → м). Обязательное — `SAVE_VERSION + 1` и миграция в `MIGRATIONS`, тест в `tests/save.test.ts`.
- `sanitizeSave(save, ctx)` — подгоняет сохранение к текущему контенту: неизвестная карточка — экземпляр убирается вместе со ссылками,
  редкость/уровень вне правил шаблона — к правилам, чужая ветка или ветка ниже фиолетового — снимается, вторая копия карточки уходит из отряда, неизвестные предметы убираются; сообщения
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
  8 колонок, лист ≤ 2048 px. Реестр — `assets/sprites/sprites.json` (schema 2, только поля игры; доказательства конвейера —
  `sprites.provenance.json`, `tools/sprites_manifest.py`); `assets/sprites/fixes.json` — пропуск битых кадров (`skip`).
  В видеопамять лист идёт ужатым: только проигрываемые кадры по `bbox` анимации, плотно, с trim (`src/pipeline/sheetPack.ts`,
  `sprites.ts addPackedSheet`) — 0.6–1.3 МБ вместо 8–15; у кадра `frame.realWidth/realHeight` = клетка, `frame.width/height` — вырезка.
- **Лист карточки героя:** везде, где выбирается спрайт героя (`flow.ts heroSprite`, его зовут Герои, Герой, Отряд, Поручения, Башня,
  «Глава пройдена», диалоги; бой — `BattleScene squadDefs`): свой лист карточки (`visual.sprite` формы или шаблона — `knight_m`,
  `priest_f`…, листы по имени класса RO), если он есть в реестре; иначе `<visual.sprite класса>_f` / `_m` по полу карточки, если такой
  лист есть в `sprites.json`, иначе базовый лист
  (`pipeline/sprites.ts genderedSpriteId`). Базовые листы одного пола (`source.gender` в `sprites.provenance.json`): `acolyte`, `priest` — женские, остальные
  героические — мужские; так что женщина без `_f` выглядит мужским листом, мужчина-Аколит без `_m` — женским (терпимо до арта).
  Бюст в рамке (`portraitFrame.ts bustFor`): `hero_<база>_<m|f>_portrait.png` → бюст листа → портрет листа. Реестр для чистых
  помощников — `src/game/spriteRegistry.ts` (`hasSprite`; в Node/тестах пустой — варианты не находятся).
- **Масштаб:** все листы v2 на экране × `V2_SCALE` = 3.2 (`src/pipeline/sprites.ts`), дальше × `visual.scale` юнита. Legacy-листы
  (`assets/sprites.legacy.json`) — свой `scale`. Враги отражаются по горизонтали. Нет листа — плейсхолдер-силуэт по роли.
- **Тени** — `ambient.ts` (`SHADOW_TEX`), ширина по `bbox.idle` листа; в листах тени нет.
- **Свой вид навыка:** `skillVisuals.ts` (таблица) → `skillSigs.ts` (рецепты). У всех навыков героев свой вид (тест `tests/skill-visuals.test.ts`:
  нет двух одинаковых); новый навык героя — строка в `SKILL_VISUALS`. Кадры в бою — `scripts/skillfx-save.ts` + `scripts/skillfx-shots.mjs`.
  Удары и статусы пассивки рисуются по ней (событие `passive` → `UnitView.proc`), а не по последней атаке.
- **Эффекты навыков (общие правила):** `skillLook.ts` выводит стихию/снаряд/площадь из id и эффектов (`FX_OVERRIDE` — явные), `skillFx.ts` рисует их кодом;
  кадры RO — `assets/effects/effects.json` (`fx_hit`, `fx_arrow`, `fx_magic`, `fx_heal`, `fx_death`, `fx_shield`), карта навык → эффект —
  секция `skills` там же (явные роли `hit`, `buff`, `cast`, `ground`, `debuff` переопределяют соответствующие дефолты; семантика — в
  `assets/effects/README.md`; отдельного ключа `projectile` пока нет, полёт остаётся runtime-логикой); статичные `assets/fx/*` — запасные.
- **Значки навыков:** `assets/ui/icons/skill_<id навыка>.png` (если есть) → иконка RO `skill_<ro>.png` через `RO_SKILL_ICONS` в
  `skillLook.ts` (120 иконок RO первых и вторых профессий, родные 24×24, рисуются ×3 в рамке) → символ кодом. Поле `icon` навыка (id манифеста, например `icon_ult_mage` → `assets/ro/icons`) проверяется, но экранами не используется.
- **Фоны:** тема по порядку главы (1 луг, 2 топь, 3 склеп, дальше по кругу) и по полосе башни; рисуются кодом (`backdrops.ts`).
  Файл владельца `assets/backgrounds/bg_battle_ch<N>.(jpg|png|webp)` / `bg_map_ch<N>.*` подменяет нарисованный (N = номер темы 1–3).
- **UI:** скин кодом (`skin.ts`), файлы из `assets/manifest.json` (id → `file`/`atlas`/`frame`/`slice`) побеждают; сборка копирует только
  используемое (`scripts/lib/used-assets.ts`).

---

## 6. Тесты

- `tests/*.test.ts` — vitest (`npm test`): ядро боя, контент, кампания, прогрессия, сохранения, K-функции, чистые помощники UI (`game-*.test.ts`),
  фазз (`fuzz-*.test.ts`), главы (`chapters.test.ts` — выпущенные главы 1–3 точно, маршрут из 10 глав: order/заголовки, главы 8 и 10,
боссы, темы; Σhp/Σatk глав 2–3 без провалов, сила по бою глав 4+ по тренду), прохождение главы 1
  (`chapter1-playthrough.test.ts`), генераторы контента (`content-new.test.ts`). Общие помощники — `tests/helpers.ts`, `invariants.ts`, `formation.ts`, `fixtures/`.
- `tests/test_*.py` — проверки арт-пайплайна: `python3 -m unittest discover -s tests -p 'test_*.py'`.
- Производительность: `tests/sim.test.ts` («1000 боёв» по CPU-времени), `npm run perf` (браузер).
- **e2e** (`scripts/e2e.mjs`, `e2e-chapter1.mjs`) кликают по тексту кнопок в активной сцене через `window.__game` (только dev-сборка);
  `e2e-chapter1` проверяет, что кнопка не перекрыта другим объектом (иначе ошибка «перекрыт»), падает на ошибках консоли.
  Переименовали кнопку — поправьте подпись в скрипте. Подробно — `docs/content/e2e.md`, `docs/content/testing.md`.
- **Строй** (`tests/formation.test.ts` + `tests/formation.ts`): метрики центроида, кучи и левой трети на этапах ch1_s5…s10.

---

## 7. Баланс

- **Цели и итог баланса прогрессии (27.09)** — `docs/content/balance.md`: «Улучшить» каждые 1–2 боя в первые 30 мин, Таверна и первый
  ×10 на ch1_s5, первое вознесение в конце главы 1, глава 2 — дни 1–2, глава 3 — дни 3–5, стены на 1–2 сундука, поражения при 85–95%
  рекомендуемой мощи. Этапы 1–9 главы 1 — 100% побед перед первой попыткой; босс главы 1 — 75–88% в среднем по выдачам Таверны
  (`mob_mastering` mult 1.16, тест `chapter1-playthrough`).
- **Инструменты:** `npm run balance` (модель игрока с часами сессии, сводка «по часам» и «крючки»), `-- --fit-recommended`
  (рекомендуемая мощь), `npx tsx scripts/balance-fit.ts` (регулятор `mult` глав по окнам `progression.json` → balance).
- **Метод (как подбирали босса главы 1):** `npm run playthrough -- 0 3 --winrate 600` — новая игра, этапы по порядку, перед каждым этапом
  доля побед на 600 seed'ах текущим отрядом; меняли `mult` босса шагом 0.01–0.02 и смотрели кривую (карточки v4, отряд Алан 5 / Бран 4 /
  Вика 4: 0.81 → 97%, 0.83 → 91%, 0.84 → 83%, 0.85 → 74%, 0.86 → 57%, 0.90 → 4%).
  Кривая крутая — после любых правок боя, профессий, главы 1 — перемерить.
- **Главы 2–3:** `npm run playthrough -- <1|2> 3 --idle --winrate 200` — при 3 поражениях подряд забирает офлайн-сундук за 1 час и
  печатает, сколько часов сундука понадобилось; `mult` подобраны так, чтобы Σhp/Σatk этапов не падали (тест) и ожидание росло плавно.
- **Вся экономика:** `npm run balance` (14 дней модели игрока с башней, экипировкой, заданиями) → `balance.csv`, `docs/content/balance.md`.
  Трофеи сундука модель получает сама (через `actClaimOffline`/`actUseFastRewards`); сводка печатает предметы и копии героев по источникам.
- **Главы 7, 8, 10 (29.09, маршрут из 10 глав):** `npx tsx scripts/balance-smooth.ts --chapters chapter7,chapter8,chapter10 --base chapter6`
  (замер D → `--save-d`), затем `--load-d … --fit 7 --targets 280,332,404 --days 18` с лестницей глав 5–7 (`--start 1.0 --stairs 0.333,0.667
  --stair-share 0.6 --min-growth 1.2 --boss 1.1`), затем `--recommended --anchors … --a3 …`; уровни — `npm run balance -- --levels --days 18`.
  Итог (seed 1): босс гл. 7 — день 12, гл. 8 — день 15, гл. 10 — день 18. Полоса уровней с ch8_s1 — красные ×5; у босс-этапов 7/8/10
  рекомендуемая мощь — по эталонным отрядам (модель берёт их с первой попытки). Подробно — `docs/content/balance.md`, раздел «Маршрут из 10 глав».
- Таблицы и цифры — `docs/content/campaign.md`. Рецепт — `docs/CONTENT_RECIPES.md` «Баланс главы».

---

## 8. Арт-пайплайн

- **Как приходит арт:** владелец (или его агент-художник по промтам `docs/SPRITE_SPEC.md`, `docs/UI_ART_PROMPT.txt`, `docs/ART_EXTRACT_RO.md`,
  `docs/FX_NEEDED.md`) кладёт файлы в `main` коммитом/PR. Что нужно — issues #17–#26 и `docs/ART_NEEDED.md`. Оркестратор регулярно
  (плановая проверка) делает `git fetch && git merge origin/main` в рабочую ветку и подключает новое.
- **Спрайты:** лист + запись в `assets/sprites/sprites.json` и `sprites.provenance.json` (обычно пишет `tools/build_sprites_v2.py`; старые листы `assets/ro` →
  `python3 tools/build_sprites_v2.py --from-v1`; правки прозрачности — `--alpha-fixes`); проверка `python3 tools/check_sprites.py`
  и python-тесты. Игра и сборка подхватывают реестр сами; юниту/профессии — `visual.sprite = <id>`.
- **Клиент scRO (29.09):** `raw/ro/` — файлы клиента побайтно, `raw/ro-build/` — готовые листы, манифест и рендер SPR/ACT
  (`raw/ro-build/tools/build_sheets.py`, пути `ROOT/RAW/OUT` в начале файла — поправить на свои). Подключено 43 листа монстров
  (34 юнитам, 9 — глава 9 заранее) и NPC Кафры, см. `docs/RO_SCRO_IMPORT.md` и статус в `docs/ART_REQUEST_CHAPTERS.md`.
  Крупные классы сетки: `boss_xl` 296×296 и `boss_xxl` 340×376 (по 6 колонок; колонки берутся из класса —
  `normalizeV2`), `npc` — листы NPC для спикеров сюжета (`portrait: "npc_<имя>"` в `data/story`, лист попадает в dist через
  `scripts/lib/used-assets.ts`). Бюджет `check_sprites.py` (3 МБ доставляемых спрайтов) после импорта превышен — 4.1 МБ.
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
- **Жёсткие числа в тестах:** `tests/chapters.test.ts` (выпущенные главы 1–3, ступени роста 70/80 у глав 8/10), `chapter1-playthrough.test.ts`, `formation.test.ts`
  (этапы главы 1) — новая глава или переделка главы 1 требуют осознанно обновить ожидания и перемерить баланс.
- **Поменяли zod-схему** — `npm run content:schema`, иначе content:check: «устарел».
- **Лист больше 2048 px** — на части телефонов не загрузится; content:check — ошибка для v2.
- **id листов ≠ id профессий** (исторически): Маг → `magician`, Волшебник → `mage`, Лучник → `archer_first`, Охотник → `archer`.
- **Тест «1000 боёв»** меряет CPU-время и сравнивает с эталоном; при перегрузке контейнера возможен сбой — перезапустить, не ослаблять.
- **Фон и музыка — по теме главы, не по месту** (`theme` в `data/campaign`, иначе тема слота `chapterTheme`): Гласт Хейм (гл. 8) —
  бывший фон/звук главы 3 («склеп»), Нифльхейм (гл. 10) — бывшей главы 7. Файл фона — `bg_battle_ch<N>.jpg`, N — номер главы маршрута
  темы (`THEME_FILE` в `backdrops.ts`). Новая тема — `CHAPTER_THEMES` + рисунок + `THEME_FILE` + `SOUND_THEME` (рецепт 6, п. 10).
- **Номер главы — `order`, не индекс:** `content.chapters[i]` — место в списке (навигация карты), «Глава N»/«N-K»/`minChapter` — `order`.
  Пока главы 9 нет, это разные числа для главы 10.
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
| экспедиции (раньше доска поручений) | expeditions (K9; id функции, счётчика и ключ сохранения — `bounties`) |
| пресеты отряда, авторасстановка | presets / formation (K8) |
| фронт / тыл | слоты 0–1 / 2–4 |
| K1…K10, P1…P12, T1-xx…T5-xx, BUG-xxx | функции из GDD, пакеты FIXLIST, номера багов тестировщиков, сводный баг-лог |
| Герои: Алан м, Бран м, Вика ж (старт), Грета ж, Дорн м (рекруты) | сюжетные карточки `data/heroes/{alan,bran,vika,greta,dorn}.json`, `progression.json → heroes.start / recruits` |
| герой, шаблон, экземпляр, копия, ветка, редкость (зелёный…красный), вознесение, корм, карта героя, «Контракт героя», Таверна, пул опыта, «Улучшить» | hero, template, instance, copy, branch, rarity, ascend/merge, fodder, hero card drop, hero pick, summon (tavern), `resources.heroExp`, level up |
