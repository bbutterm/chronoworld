# Что извлечь из клиента Ragnarok Online (data.grf и папка BGM)

Задача владельца (29.09): «Вещи — вещами из Рагнарока, урон — как в Рагнароке, звуки — оригинальные локаций; нужен список
всего, что извлечь». Владелец сам вынимает файлы из клиента и кладёт в репозиторий; всё дальнейшее (разбор .spr/.act,
листы v2, иконки, шрифт урона, подключение звука) — работа агентов, см. конец раздела 1 и раздел 8.

Список собран по `data/units` рабочей ветки и веткам глав 2, 3, 7, 8/10 (`sewer_*`, `orc_*`, `alde_*`, `mob_lord_of_death`),
`data/items`, `data/story`, `src/game/audioCatalog.ts`. Имена файлов сверены: монстры — rAthena `mob_db.yml` + таблица спрайтов
roBrowser `DB/Monsters/MonsterTable.js`; предметы — `idnum2itemresnametable.txt` клиента (копия в репозитории zackdreaver/ROenglishRE);
музыка — `data/mp3nametable.txt` той же копии + iRO Wiki «BGM Files»; звуки — `DB/Effects/EffectTable.js`,
`DB/Items/WeaponHitSoundTable.js`, `WeaponSoundTable.js`; цифры урона — `Renderer/Effects/Damage.js` roBrowser.
Где имя не подтверждено двумя источниками — стоит пометка **проверить**.

Прежний документ по главе 1 — `docs/ART_EXTRACT_RO.md` (иконки навыков уже извлечены, 120 шт.; эффекты навыков — там же).
Здесь — всё, что ещё нужно.

---

## 1. Как извлекать и куда класть

### Инструмент

1. **GRF Editor** (Tokeiburu, Windows) — рекомендуемый: открывает `data.grf`, `rdata.grf`, показывает превью .spr/.act,
   ищет по имени, извлекает выделенное с сохранением путей. Кодировку поставить «Korean (949)» — тогда папки видны по-корейски.
2. Альтернативы: GRF Builder, grftool / `grfcl` (командная строка), Python-пакет `grf` / `pygrf`; на Linux — `grf-extractor`.
   Любой, который сохраняет файлы как есть (побайтно), подходит.
3. Музыка лежит **не в GRF**, а в папке клиента `BGM\` (`BGM\08.mp3` …). Таблица «карта → трек» — `data\mp3nametable.txt` внутри GRF
   (её тоже приложить — у разных клиентов номера могут чуть отличаться).
4. Если в клиенте несколько GRF (`data.grf`, `rdata.grf`, `sdata.grf`) — искать во всех; новые клиенты держат часть файлов в
   папке `data\` рядом с GRF (распакованные патчи). Приоритет как у клиента: папка `data\` → `rdata.grf` → `data.grf`.

### Что брать

| Тип | Где в GRF | Что копировать |
| --- | --- | --- |
| Монстры | `data\sprite\몬스터\<имя>.spr` + `.act` | всегда **пару** .spr и .act с одним именем |
| NPC | `data\sprite\npc\<имя>.spr` + `.act` | пару |
| Цифры урона | `data\sprite\이팩트\숫자.spr` + `.act`, `msg.spr`, `bluemsg.spr` (+ `.act`) | см. раздел 5 |
| Иконки предметов | `data\texture\유저인터페이스\item\<resname>.bmp` | 24×24, прозрачность — пурпурный #FF00FF |
| Картинки предметов | `data\texture\유저인터페이스\collection\<resname>.bmp` | крупная картинка в окне описания (~75×100) |
| Иллюстрации NPC | `data\texture\유저인터페이스\illust\<имя>.bmp` | «катины» (бюст NPC в диалоге) |
| Звуки | `data\wav\*.wav`, `data\wav\effect\*.wav` | как есть, имена с пробелами не переименовывать |
| Музыка | папка клиента `BGM\NN.mp3` | как есть |
| Таблица музыки | `data\mp3nametable.txt` | для сверки номеров |

### Корейские пути (EUC-KR / CP949)

Внутри GRF имена хранятся байтами CP949. Программа без корейской локали показывает те же байты как Latin-1 — получается
«кракозябра». Это **одно и то же имя**, годится любой вид:

| Папка | По-корейски | Байты CP949 | Вид без корейской локали |
| --- | --- | --- | --- |
| монстры | `data\sprite\몬스터\` | b8 f3 bd ba c5 cd | `data\sprite\¸ó½ºÅÍ\` |
| эффекты | `data\sprite\이팩트\` | c0 cc c6 d1 c6 ae | `data\sprite\ÀÌÆÑÆ®\` |
| цифры урона | `이팩트\숫자.spr` | bc fd c0 da | `ÀÌÆÑÆ®\¼ýÀÚ.spr` |
| интерфейс | `data\texture\유저인터페이스\` | c0 af c0 fa c0 ce c5 cd c6 e4 c0 cc bd ba | `data\texture\À¯ÀúÀÎÅÍÆäÀÌ½º\` |
| предметы на земле | `data\sprite\아이템\` | be c6 c0 cc c5 db | `data\sprite\¾ÆÀÌÅÛ\` |

Имена иконок предметов тоже корейские (resname): например Red Potion — `빨간포션.bmp` = `»¡°£Æ÷¼Ç.bmp`. В таблице раздела 4
даны оба вида.

### Папка приёма в репозитории

Соглашения для сырья из клиента в репозитории пока нет: листы собирались удалённым рендером (`tools/fetch_sprites_v2.py`,
кэш вне Git), сырое аудио в `docs/ART_EXTRACT_RO.md` предлагалось класть в `art-research/audio_raw/` (папка не создана).
Предлагаю одну папку **`raw/ro/`** (корень репозитория; в сборку не попадает — `scripts/lib/used-assets.ts` берёт только `assets/`):

```
raw/ro/sprite/monster/<имя>.spr, .act      ← data\sprite\몬스터\
raw/ro/sprite/npc/<имя>.spr, .act          ← data\sprite\npc\
raw/ro/sprite/effect/숫자.spr, msg.spr …   ← data\sprite\이팩트\ (цифры урона)
raw/ro/texture/item/<resname>.bmp          ← data\texture\유저인터페이스\item\
raw/ro/texture/collection/<resname>.bmp    ← data\texture\유저인터페이스\collection\
raw/ro/texture/illust/<имя>.bmp            ← data\texture\유저인터페이스\illust\
raw/ro/wav/<имя>.wav                       ← data\wav\
raw/ro/wav/effect/<имя>.wav                ← data\wav\effect\
raw/ro/bgm/NN.mp3                          ← BGM\
raw/ro/mp3nametable.txt                    ← data\mp3nametable.txt
```

Корейские папки заменены латиницей; имена **файлов** оставить как в клиенте (в любом из двух видов — корейском или «кракозябрах»).
Вес: .spr/.act — 10–300 КБ на монстра, иконки — ~2 КБ, .wav — 5–100 КБ, трек BGM — 2–6 МБ. Музыка (20+ треков ≈ 80 МБ) —
лучше архивом во вложение GitHub release/issue, а не в Git; агент нарежет петли и положит в `assets/audio/` уже сжатые (до 1.5 МБ).

### Что сделаем мы (не владелец)

- **Конвертера .spr/.act в листы v2 в репозитории нет.** `tools/build_sprites_v2.py` строит листы из PNG/APNG, которые
  `tools/fetch_sprites_v2.py` скачивает с удалённого рендера (ragassets / latam-tools); `ORIGINAL_RO_PROOF` там — лишь хэши
  двух скачанных .spr/.act. Нужен свой разбор: SPR (палитра 256 цветов + RGBA-кадры), ACT (действия × 8 направлений, слои,
  якоря, задержки кадров, **имена звуков событий**) → кадры направления 6 без тени → лист по `docs/SPRITE_SPEC.md` → запись
  в `sprites.json`. Это задача агента (`tools/ro_spr_act.py` + ветка `--from-raw` в `build_sprites_v2.py`).
- BMP-иконки: убрать пурпурный фон → PNG → `assets/ui/icons/item_<наш id>.png`.
- Цифры урона, музыка, звуки — разделы 5–7.

---

## 2. Монстры и боссы

Легенда: **есть** — лист уже в `assets/sprites/sprites.json`, извлекать не нужно (кроме случая «перегнать своим конвертером»).
**Нужен** — сейчас юнит стоит на чужом листе с `visual.tint`/`scale` («заплатка»). Приоритет: P1 — боссы и мини-боссы глав,
P2 — рядовые новых глав, P3 — разнообразие/мелочь, P4 — только Башня. Имя спрайта — как в клиенте (регистр в GRF не важен,
класть в нижнем регистре). Номер — rAthena `mob_db`.

> Главы — по маршруту: 1 Поля Пронтеры, 2 Канализация, 3 Орки, 4 Моррок/Сограт, 5 Пайон, 6 корабль, 7 Альдебаран,
> 8 Гласт Хейм, 9 Лабиринтный лес, 10 Нифльхейм. В рабочей ветке пока 7 глав (2 — «Проклятые топи», 3 — «Костяные чертоги»,
> 7 — Нифльхейм); новые главы 2/3/7/8/10 лежат в ветках агентов, главы 9 ещё нет ни в одной ветке — её состав ниже предложен.

### Глава 1. Поля Пронтеры (`chapter1`)

| Наш юнит | Имя | Монстр RO | mob_db | Файл `data\sprite\몬스터\` | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `mob_marin` | Марин | Marin | 1242 | `marin.spr/.act` | нужен (сейчас Поринг + tint) | P2 |
| `mob_pupa` | Пупа | Pupa | 1008 | `pupa.spr/.act` | нужен (сейчас Фабр + tint) | P2 |
| `mob_fast` | Поринг | Poring | 1002 | `poring` | есть (`fast`) | — |
| `mob_drops` | Дропс | Drops | 1113 | `drops` | есть | — |
| `mob_poporing` | Попоринг | Poporing | 1031 | `poporing` | есть | — |
| `mob_fabre` | Фабр | Fabre | 1007 | `fabre` | есть | — |
| `mob_lunatic` | Люнатик | Lunatic | 1063 | `lunatic` | есть | — |
| `mob_mandragora` | Мандрагора | Mandragora | 1020 | `mandragora` | есть | — |
| `mob_rocker` | Рокер | Rocker | 1052 | `rocker` | есть | — |
| `mob_tank` | Ожившая ива | Willow | 1010 | `wilow` (одна «l») | есть (`tank`) | — |
| `mob_mastering` | Мастеринг (босс) | Mastering | 1090 | `mastering` | есть | — |

В `docs/ART_REQUEST_CHAPTERS.md` у Пупы ошибочно стоит номер 1031 (это Попоринг) — верно **1008**.

### Глава 2. Канализация Пронтеры (`prt_sewb1–4`; ветка `worktree-agent-a4788815cfe50012f`)

| Наш юнит | Имя | Монстр RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `sewer_golden_bug` | Золотой жук-вор (босс) | Golden Thief Bug | 1086 | `golden_bug` | есть (`elite`) | — |
| `sewer_bug_leader` | Вожак жуков (мини-босс, выдуманный) | за основу Thief Bug Male | 1054 | `thief_bug_male` (тот же лист, крупнее и темнее) | нужен (сейчас Золотой жук + tint) | P1 |
| `sewer_bug_male` | Жук-вор самец | Thief Bug Male | 1054 | `thief_bug_male` | нужен | P2 |
| `sewer_bug_female` | Жук-вор самка (лекарь) | Thief Bug Female | 1053 | `thief_bug_female` | нужен | P2 |
| `sewer_thief_bug` | Жук-вор | Thief Bug | 1051 | `thief_bug_larva` по таблице roBrowser; **проверить**, в части клиентов есть и `thief_bug` — взять оба, если найдутся | нужен | P2 |
| `sewer_bug_egg` | Яйцо жука-вора | Thief Bug Egg | 1048 | `thief_bug_egg` | нужен | P2 |
| `sewer_plankton` | Планктон | Plankton | 1161 | `plankton` | нужен | P2 |
| `sewer_tarou` | Тару | Tarou | 1175 | `tarou` | нужен | P2 |
| `sewer_familiar` | Фамилиар | Familiar | 1005 | `farmiliar` (так в клиенте, с «r») | нужен | P2 |

### Глава 3. Орки (`gef_fild10`, `orcsdun01–02`; ветка `worktree-agent-a5e8b1d67ec8ab439`)

| Наш юнит | Имя | Монстр RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `orc_lord` | Орк-лорд (босс) | Orc Lord | 1190 | `orc_lord` | нужен (сейчас Герой орков + tint ×1.4) | P1 |
| `orc_hero` | Герой орков (мини-босс) | Orc Hero | 1087 | `ork_hero` | есть (`boss1`) | — |
| `orc_warrior` | Орк-воин | Orc Warrior | 1023 | `ork_warrior` (через «k») | нужен (сейчас Зомби + tint) | P2 |
| `orc_high` | Высший орк | High Orc | 1213 | `high_orc` | нужен | P2 |
| `orc_archer` | Орк-лучник | Orc Archer | 1189 | `orc_archer` | нужен | P2 |
| `orc_lady` | Орчиха / Шаман Угра | Orc Lady | 1273 | `orc_lady` | нужен | P2 |
| `orc_skeleton` | Орк-скелет | Orc Skeleton | 1152 | `orc_skeleton` | нужен | P2 |
| `orc_zombie` | Орк-зомби | Orc Zombie | 1153 | `orc_zombie` | нужен | P2 |
| `orc_chonchon` | Стальной чончон | Steel Chonchon | 1042 | `steel_chocho` (так в клиенте) | нужен | P3 |

### Глава 4. Моррок и Сограт (`chapter4`)

| Наш юнит | Имя | Монстр RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `mob4_ancient_mummy` | Древняя мумия (мини-босс) | Ancient Mummy | 1297 | `ancient_mummy` | нужен (сейчас Мумия + tint ×1.45) | P1 |
| `mob4_boss` | Осирис (босс) | Osiris | 1038 | `osiris` | есть | — |
| `mob4_melee` … `mob4_support` | Мумия, Песчаник, Мардук, Скорпион, Верит, Изида | Mummy 1041, Sandman 1165, Marduk 1140, Scorpion 1001, Verit 1032, Isis 1029 | | `mummy`, `sand_man`, `marduk`, `scorpion`, `vorit`, `isis` | есть все | — |
| (по желанию) | Фараон — MVP пирамиды | Pharaoh | 1157 | `pharaoh` | нет в игре | P4 |

### Глава 5. Пайон (`chapter5`)

| Наш юнит | Имя | Основа RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `mob5_munak_elder` | Настоятель Мунэ (мини-босс, выдуманный) | Munak | 1026 | `munak` | лист `munak` **есть**, извлекать нечего; своего монстра в RO нет — остаётся перекраска или перерисовка художником | — |
| `mob5_boss` | Лунный цветок | Moonlight Flower | 1150 | `moonlight` | есть | — |
| остальные `mob5_*` | Бонгун, Мунэ, Хоронг, Смоки, Девятихвостая, Сохи | 1188, 1026, 1129, 1056, 1180, 1170 | | `bon_gun`, `munak`, `horong`, `smokie`, `nine_tail`, `sohee` | есть все | — |

### Глава 6. Затонувший корабль (`chapter6`)

| Наш юнит | Имя | Основа RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `mob6_bosun` | Боцман-призрак (мини-босс, выдуманный) | Pirate Skeleton | 1071 | `pirate_skel` | лист **есть**; своего монстра нет — перекраска | — |
| `mob6_boss` | Дрейк | Drake | 1112 | `drake` | есть | — |
| остальные `mob6_*` | Скелет-пират, Кукре, Марс, Сворд-фиш, Гидра, Обеон | 1071, 1070, 1144, 1069, 1068, 1044 | | `pirate_skel`, `kukre`, `marse`, `sword_fish`, `hydra`, `obeaune` | есть все | — |
| (по желанию) | Пенгомена — ещё один моряк-монстр | Penomena | 1216 | `penomena` | нет в игре | P3 |

### Глава 7. Альдебаран и Часовая башня (`c_tower1–4`; ветка `worktree-agent-ae1cf48296df17144`)

| Наш юнит | Имя | Монстр RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `alde_keeper` | Смотритель часовой башни (босс) | Clock Tower Manager | 1270 | `c_tower_manager` | нужен (сейчас Песчаник + tint) | P1 |
| `alde_owl_baron` | Совиный барон (мини-босс) | Owl Baron | 1295 | `owl_baron` | нужен (сейчас Гаргулья + tint) | P1 |
| `alde_owl_duke` | Совиный герцог | Owl Duke | 1320 | `owl_duke` | нужен | P2 |
| `alde_alarm` | Будильник | Alarm | 1193 | `alarm` | нужен | P2 |
| `alde_clock` | Часы | Clock | 1269 | `clock` | нужен | P2 |
| `alde_rideword` | Райдворд | Rideword | 1195 | `rideword` | нужен | P2 |
| `alde_punk` | Панк | Punk | 1199 | `punk` | нужен | P2 |
| `alde_elder` | Старейшина (лекарь) | Elder | 1377 | `elder` | нужен (сейчас лист героя Волшебника + tint) | P2 |
| `alde_mimic` | Мимик | Mimic | 1191 | `mimic` | есть | — |

### Глава 8. Гласт Хейм (ветка `worktree-agent-a39952374bc57751d`: юниты `mob3_*` + финал `mob7_boss`)

| Наш юнит | Имя | Монстр RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `mob3_knight` | Рыцарь бездны (мини-босс) | Abysmal Knight | 1219 | `knight_of_abyss` | нужен (сейчас Рейдрик + tint ×1.3) | P1 |
| `mob3_boss` | Верховный жрец (выдуманный) | за основу Evil Druid | 1117 | `evil_druid` | нужен (сейчас Тёмный жрец + tint ×1.5); вариант — оставить Тёмного жреца | P1 |
| `mob3_melee` | Костяной зомби | Ghoul | 1036 | `ghoul` | нужен (сейчас Зомби + tint) | P2 |
| `mob7_boss` | Тёмный лорд (финал главы) | Dark Lord | 1272 | `dark_lord` | есть | — |
| `mob3_tank`, `mob3_ranged`, `mob3_fast`, `mob3_elite` | Рейдрик, Тёмный жрец, Гаргулья, Мимик | 1163, 1198, 1253, 1191 | | `raydric`, `dark_priest`, `gargoyle`, `mimic` | есть | — |
| (по желанию, разнообразие ГХ) | Халицбург | Khalitzburg | 1132 | `khalitzburg` | нет в игре | P3 |
| (по желанию) | Кровавый рыцарь | Bloody Knight | 1268 | `bloody_knight` | нет | P3 |
| (по желанию) | Рейдрик-лучник | Raydric Archer | 1276 | `raydric_archer` | нет | P3 |
| (по желанию) | Призрак, Шёпот | Wraith 1192, Whisper 1179 | | `wraith`, `whisper` | нет | P3 |
| (по желанию) | Скелет-узник, Зомби-узник | 1196, 1197 | | `skel_prisoner`, `zombie_prisoner` | нет | P3 |

### Глава 9. Лабиринтный лес — Бафомет и свита (`prt_maze01–03`; главы ещё нет — состав предложен по спавнам rAthena)

| Роль | Монстр RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- |
| босс | Baphomet | 1039 | `baphomet` | есть (`boss2`) | — |
| свита босса | Baphomet Jr. | 1101 | `baphomet_` (с подчёркиванием в конце) | нужен | P1 |
| мини-босс | Ghostring | 1120 | `ghostring` | нужен | P1 |
| мини-босс | Vagabond Wolf | 1092 | `vagabond_wolf` | нужен (и для Башни, см. ниже) | P1 |
| мини-босс (уже юнит `mob_eclipse`) | Eclipse | 1093 | `eclipse` | нужен (сейчас Люнатик + tint) | P2 |
| мини-босс (уже юнит `mob_vocal`) | Vocal | 1088 | `vocal` | нужен (сейчас Рокер + tint) | P2 |
| рядовой | Hunter Fly | 1035 | `hunter_fly` | нужен | P2 |
| рядовой | Side Winder | 1037 | `side_winder` | нужен | P2 |
| рядовой | Mantis | 1139 | `mantis` | нужен | P2 |
| рядовой | Stem Worm | 1215 | `stem_worm` | нужен | P2 |
| элита | Killer Mantis | 1294 | `killer_mantis` | нужен | P3 |
| элита | Deviruchi (в лабиринте не водится, но это «бесёнок» Бафомета) | 1109 | `deviruchi` | нужен | P3 |
| (по желанию) | Sasquatch, Leib Olmai | 1243, 1306 | `sasquatch`, `leib_olmai` | нет | P3 |

### Глава 10. Нифльхейм (юниты `mob7_*` + финал `mob_lord_of_death`)

| Наш юнит | Имя | Монстр RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `mob_lord_of_death` | Владыка мёртвых (босс) | **Lord of the Dead** — настоящий MVP Нифльхейма | 1373 | `lord_of_death` | нужен (сейчас Дуллахан + tint ×1.6) | P1 |
| `mob7_bridge_warden` | Страж моста Гьёлль (мини-босс, выдуманный) | за основу Bloody Knight | 1268 | `bloody_knight` | нужен (сейчас Дуллахан + tint); вариант — оставить перекраску Дуллахана | P2 |
| `mob7_melee` … `mob7_support` | Дуллахан, Гиббет, Банши, Кровавый убийца, Лоли Рури, Квив | 1504, 1503, 1867, 1507, 1505, 1508 | | `dullahan`, `gibbet`, `banshee`, `bloody_murderer`, `loli_ruri`, `quve` | есть все | — |
| (по желанию) | Дисгайз, Люд, Хайрозоист | 1506, 1509, 1510 | | `disguise`, `lude`, `hylozoist` | нет в игре | P3 |

### Башня и старые юниты (главы «Проклятые топи» уходят из кампании, но их юниты остаются в `data/tower.json`)

| Наш юнит | Имя | Монстр RO | mob_db | Файл | Статус | P |
| --- | --- | --- | --- | --- | --- | --- |
| `mob2_boss` | Древняя ива | Elder Willow | 1033 | `elder_wilow` (одна «l») | нужен (Ива + tint ×1.6) | P4 |
| `mob2_elite` | Утопленник | взять Ghoul (глава 8) | 1036 | `ghoul` | общий лист с главой 8 | P4 |
| `mob2_fast` | Болотный кузнечик | взять Thief Bug (глава 2) | 1051 | см. главу 2 | общий лист | P4 |
| `mob2_giant` | Попоринг-великан | своего в RO нет; или Vagabond Wolf (гл. 9) | — | — | оставить перекраску | — |
| `mob2_melee`, `mob2_tank`, `mob2_ranged` | Болотный зомби, Трясинная ива, Скелет-лучник топей | Zombie / Willow / Archer Skeleton | | листы есть, только tint | — | — |
| (по желанию) | Жаба, Тара-лягушка, Рода-лягушка | Toad 1089, Thara Frog 1034, Roda Frog 1012 | | `toad`, `thara_frog`, `roda_frog` | нет | P4 |

Итого монстров: **обязательных пар .spr+.act — 43** (P1 — 11, P2 — 28, P3 — 3, P4 — 1; лист `thief_bug_male` общий у самца и Вожака), по желанию ещё **16**.
Уже есть листы у 47 монстров и боссов — их не извлекать. По желанию (P4): перегнать и их из оригинальных .spr/.act своим
конвертером (точные якоря, у всех одинаковый источник, имена звуков из .act).

---

## 3. Герои и NPC: портреты и спрайты для сюжета

Как сейчас: портрет говорящего — поле `portrait` в `data/story/*.json`: `unit:<id>` — лист юнита, иначе id профессии (лист героя
этой профессии), иначе id листа как есть; нет листа — вместо лица иконка (`src/game/storyView.ts → portraitSprite`,
`content:check` пишет предупреждение «портрет спикера … не найден»). Бюст берётся из кадра idle, отдельный портрет не обязателен.

| Спикер (глава) | Сейчас | Что взять из клиента | Файл | P |
| --- | --- | --- | --- | --- |
| **Кафра** (гл. 7, ветка Альдебарана) | `kafra` — листа нет → иконка | спрайт Кафры + иллюстрация | `data\sprite\npc\4_f_kafra1.spr/.act` (NPC 117; есть `4_f_kafra2…7`); иллюстрация `data\texture\유저인터페이스\illust\kafra_01.bmp` (**проверить** номер: в скриптах `cutin "kafra_01"`…`"kafra_09"`) | P1 |
| Архивариус Одо (гл. 7) | лист героя Мудреца | библиотекарь / старый мудрец | `data\sprite\npc\1_m_librarymaster.spr/.act` (NPC 57) или `2_m_sage_old` (743) | P2 |
| Сержант Бертольд (гл. 2) | лист Мечника | солдат Пронтеры | `8w_soldier` (**проверить** имя) или `4_m_cru_sold` (413) | P2 |
| Трактирщик Бруно (гл. 1) | лист Торговца | трактирщик | `1_m_innkeeper` (53) | P2 |
| Отто (гл. 2) | лист Торговца | торговец | `1_m_merchant` (58) | P3 |
| Шаман Угра (гл. 3) | лист `orc_lady` (раздел 2) | NPC-орчиха | `4_orclady` (431) — только если нужен отличный от монстра вид | P3 |
| Серый капюшон (гл. 1, 7, 8, 10) | Тёмный жрец (`dark_priest`) | тёмный жрец-NPC | `4_m_darkpriest` (10097, **проверить**) — по желанию | P3 |
| Хель (гл. 10) | Банши (`mob7_ranged`) | в RO нет | — | — |
| Капитан Гаррет, Ирис, Кай, Лира, Зара, Мэйлин, Тео, Грета, Дорн | листы героев (`npc_garret`, профессии) | не нужно | — | — |

Итого NPC: 1 обязательная пара + 1 иллюстрация, 6 пар по желанию. Спрайт NPC в RO — одна-две анимации (стоит/говорит), поэтому
мы сделаем из него только портрет и стойку, без боевого листа.

---

## 4. Предметы

### Как рисуются иконки сейчас

`src/game/itemIcons.ts` (`itemIconKey`, `itemCell`): иконки **нарисованы кодом** — белый силуэт по слоту и id (клинок, лук, посох,
топор, кастет, скрипка, доспех, шлем, сапоги), который красится `setTint` цветом редкости; одинаковые силуэты у всех мечей.
«Благословенная руда» — тоже рисунок кодом (`oreIconKey`). Награды (`src/game/rewardsView.ts → rewardIcon`): золото и гемы —
`ui_icon_gold` / `ui_icon_gem`, свиток, опыт и предмет — значки скина с оттенком. Экраны: Инвентарь, Лавка, Итоги, Охота,
Летопись, сундук (`chestView.ts`).

Что заменится: для каждого предмета — `assets/ui/icons/item_<наш id>.png` (иконка RO 24×24, игра увеличит целым кратным, как
иконки навыков), в окне описания — картинка `collection` (~75×100). Цвет редкости уходит в рамку ячейки (иконку RO не красить) —
правка кода.

Путь иконки: `data\texture\유저인터페이스\item\<resname>.bmp`; картинка: `data\texture\유저인터페이스\collection\<resname>.bmp`
(те же имена). resname — из `idnum2itemresnametable.txt`. В колонке «вид без локали» — то же имя «кракозябрами».

### Оружие (`data/items/weapon.json`)

| Наш id | Имя | Предмет RO | item_db | resname (.bmp) | вид без локали |
| --- | --- | --- | --- | --- | --- |
| `knife` | Нож | Knife | 1201 | 나이프 | ³ªÀÌÇÁ |
| `dagger` | Кинжал | Dagger | 1213 | 대거 | ´ë°Å |
| `sword` | Меч | Sword | 1101 | 소드 | ¼Òµå |
| `bow` | Лук | Bow | 1701 | 보우 | º¸¿ì |
| `rod` | Жезл | Rod | 1601 | 롯드 | ·Ôµå |
| `axe` | Топор | Axe | 1301 | 액스 | ¾×½º |
| `gladius` | Гладиус | Gladius | 1219 | 그라디우스 | ±×¶óµð¿ì½º |
| `composite_bow` | Составной лук | Composite Bow | 1704 | 컴포지트보우 | ÄÄÆ÷ÁöÆ®º¸¿ì |
| `staff` | Посох | Staff | 1607 | 스태프 | ½ºÅÂÇÁ |
| `mace` | Булава | Mace | 1504 | 메이스 | ¸ÞÀÌ½º |
| `knuckle` | Кастет | Waghnak | 1801 | 바그낙 | ¹Ù±×³« |
| `violin` | Скрипка | Violin | 1901 | 바이올린 | ¹ÙÀÌ¿Ã¸° |
| `claymore` | Клеймор | Claymore | 1163 | 크레이모어 | Å©·¹ÀÌ¸ð¾î |
| `arbalest` | Арбалет | Arbalest | 1713 | 알바레스트 | ¾Ë¹Ù·¹½ºÆ® |
| `katar` | Катар | Katar | 1252 | 카타르 | Ä«Å¸¸£ |
| `wizardry_staff` | Посох чародея | Wizardry Staff | 1473 | 위자드리스태프 | À§ÀÚµå¸®½ºÅÂÇÁ |
| `battle_axe` | Боевой топор | Battle Axe | 1351 | 배틀액스 | ¹èÆ²¾×½º |
| `sograt_scimitar` | Ятаган Сограта | Scimitar | 1113 | 시미터 | ½Ã¹ÌÅÍ |
| `moonlight_dagger` | Кинжал лунного света | Moonlight Dagger | 1234 | 월광검 | ¿ù±¤°Ë |
| `pirate_saber` | Сабля пирата | Saber | 1126 | 세이버 | ¼¼ÀÌ¹ö |
| `bloody_axe` | Кровавый топор | Bloody Axe | 1363 | 블러드액스 | ºí·¯µå¾×½º |
| `keeper_hammer` (ветка гл. 8/10) | Молот смотрителя | War Hammer (**проверить** выбор; вариант — Needle of Alarm 1095 `시계바늘`) | 1354 | 워해머 | ¿öÇØ¸Ó |
| `abyss_blade` (ветка гл. 8/10) | Клинок бездны | Muramasa (**проверить** выбор) | 1164 | 무라마사 | ¹«¶ó¸¶»ç |

### Доспехи (`armor.json`)

| Наш id | Имя | Предмет RO | item_db | resname | вид без локали |
| --- | --- | --- | --- | --- | --- |
| `cotton_shirt` | Хлопковая рубаха | Cotton Shirt | 2301 | 코튼셔츠 | ÄÚÆ°¼ÅÃ÷ |
| `adventurers_suit` | Костюм искателя | Adventurer's Suit | 2305 | 어드밴쳐슈츠 | ¾îµå¹êÃÄ½´Ã÷ |
| `chain_mail` | Кольчуга | Chain Mail | 2314 | 메일 | ¸ÞÀÏ |
| `silk_robe` | Шёлковая мантия | Silk Robe | 2321 | 실크로브 | ½ÇÅ©·Îºê |
| `full_plate` | Латы | Full Plate | 2316 | 플레이트 | ÇÃ·¹ÀÌÆ® |
| `saint_robe` | Одеяние святого | Saint's Robe | 2325 | 세인트로브 | ¼¼ÀÎÆ®·Îºê |
| `isis_mantle` | Мантия Изиды | Mantle (**проверить** выбор) | 2307 | 맨틀 | ¸ÇÆ² |
| `ninja_suit` | Костюм ниндзя | Ninja Suit | 2337 | 닌자슈츠 | ´ÑÀÚ½´Ã÷ |
| `captain_coat` | Камзол капитана | Coat (**проверить** выбор) | 2309 | 롱코트 | ·ÕÄÚÆ® |
| `dark_lord_robe` | Мантия Тёмного лорда | Robe of Casting (**проверить**; вариант Diabolus Robe 2374 `디아볼루스로브`) | 2343 | 캐스팅의로브 | Ä³½ºÆÃÀÇ·Îºê |
| `clockwork_mail` (ветка) | Кольчуга часовщика | Glittering Jacket (**проверить** выбор) | 2319 | 글리터링클로스 | ±Û¸®ÅÍ¸µÅ¬·Î½º |
| `valkyrie_armor` (ветка) | Доспех валькирии | Valkyrie Armor | 2357 | 발키리의갑옷 | ¹ßÅ°¸®ÀÇ°©¿Ê |

### Шлемы (`helmet.json`)

| Наш id | Имя | Предмет RO | item_db | resname | вид без локали |
| --- | --- | --- | --- | --- | --- |
| `bandana` | Бандана | Bandana | 2211 | 두건 | µÎ°Ç |
| `cap` | Шапка | Cap | 2226 | 캡 | Ä¸ |
| `helm` | Шлем | Helm | 2228 | 헬름 | Çï¸§ |
| `biretta` | Бирета | Biretta | 2216 | 비레타 | ºñ·¹Å¸ |
| `crown` | Корона | Crown | 2235 | 크라운 | Å©¶ó¿î |
| `pharaoh_headdress` | Убор фараона | Sphinx Hat | 5053 | 스핑크스모자 | ½ºÇÎÅ©½º¸ðÀÚ |
| `kitsune_mask` | Маска кицунэ | Kitsune Mask | 5069 | 여우가면 | ¿©¿ì°¡¸é |
| `pirate_bandana` | Пиратская бандана | Pirate Bandana | 2287 | 해적두건 | ÇØÀûµÎ°Ç |
| `helm_of_darkness` | Шлем Тьмы | Bone Helm (**проверить** выбор) | 5017 | 본헬름 | º»Çï¸§ |
| `alarm_mask` (ветка) | Маска Будильника | Alarm Mask | 5086 | 알람가면 | ¾Ë¶÷°¡¸é |
| `gjoll_helm` (ветка) | Шлем стража Гьёлль | Gemmed Sallet (**проверить** выбор) | 2230 | 쥬얼헬름 | Áê¾óÇï¸§ |

### Обувь (`boots.json`)

| Наш id | Имя | Предмет RO | item_db | resname | вид без локали |
| --- | --- | --- | --- | --- | --- |
| `sandals` | Сандалии | Sandals | 2401 | 샌들 | »÷µé |
| `shoes` | Башмаки | Shoes | 2403 | 슈즈 | ½´Áî |
| `boots` | Сапоги | Boots | 2405 | 부츠 | ºÎÃ÷ |
| `greaves` | Поножи | Greaves | 2411 | 그리브 | ±×¸®ºê |
| `sleipnir` | Слейпнир | Sleipnir | 2410 | 슬레이프니르 | ½½·¹ÀÌÇÁ´Ï¸£ |
| `desert_sandals` | Сандалии пустыни | High Fashion Sandals (**проверить** выбор) | 2422 | 고급샌들 | °í±Þ»÷µé |
| `geta` | Гэта | Tengu's Geta (**проверить**: у 22145 resname латиницей `TenguShoes`, есть не во всех клиентах; запасной — Fricco's Shoes 2417 `프리코슈즈`) | 22145 | TenguShoes | TenguShoes |
| `sea_boots` | Сапоги морского волка | Tidal Shoes | 2424 | 타이달슈즈 | Å¸ÀÌ´Þ½´Áî |
| `valkyrie_boots` | Сапоги валькирии | Valkyrie Shoes | 2421 | 발키리의슈즈 | ¹ßÅ°¸®ÀÇ½´Áî |
| `owl_boots` (ветка) | Сапоги совы | White Wing Boots (**проверить** выбор) | 2479 | 흰날개의부츠 | Èò³¯°³ÀÇºÎÃ÷ |
| `sentry_greaves` (ветка) | Поножи ночного караула | Iron Boots (resname совпадает с Greaves — **нужна другая**; вариант Black Leather Boots 2425 `검은가죽부츠`) | 2425 | 검은가죽부츠 | °ËÀº°¡Á×ºÎÃ÷ |

### Ресурсы, валюты, награды (`data/drops.json`, `shop.json`, `rewardsView.ts`)

| Что в игре | Предмет RO | item_db | resname | вид без локали |
| --- | --- | --- | --- | --- |
| Золото (`gold`) | Bag of Gold Coins (или Zeny-иконка UI — **проверить**, в RO у зени нет предмета) | 670 | 금전주머니 | ±ÝÀüÁÖ¸Ó´Ï |
| Гемы (`gems`) | 1carat Diamond | 730 | 투명한보석 | Åõ¸íÇÑº¸¼® |
| Свиток призыва (`scrolls`) | Worn Out Scroll | 618 | 낡은두루마리 | ³°ÀºµÎ·ç¸¶¸® |
| Опыт героев (`heroExp`, наборы опыта в Лавке) | Battle Manual | 12208 | 전투교범 | ÀüÅõ±³¹ü |
| Благословенная руда (заточка без поломки) | Enriched Oridecon | 7620 | 축오리 | Ãà¿À¸® |
| Сундук трофеев / сундук офлайн-наград | Treasure Box | 7444 | 보물상자 | º¸¹°»óÀÚ |
| (запасной сундук) | Old Blue Box | 603 | 오래된파란상자 | ¿À·¡µÈÆÄ¶õ»óÀÚ |
| Карты героев (`heroCard`) | Old Card Album | 616 | 낡은카드첩 | ³°ÀºÄ«µåÃ¸ |
| Джеллопи на экране итогов (глава 1) | Jellopy | 909 | 젤로피 | Á©·ÎÇÇ |
| Лечебное зелье (расходник, если появится) | Red Potion | 501 | 빨간포션 | »¡°£Æ÷¼Ç |

Итого предметов: **57 экипировки** (49 в рабочей ветке + 8 в ветке глав 8/10) и **10 ресурсов** = 67 иконок `item\` и 67 картинок
`collection\` (у ресурсов картинка по желанию). У 13 позиций выбор предмета RO — предложение, помечено «проверить»: наш предмет
выдуман, владелец может выбрать другой похожий.

---

## 5. Цифры урона и боевой текст как в RO

Как сейчас: `src/game/numberFont.ts` строит растровый шрифт из обычного шрифта с обводкой; `BattleScene.popNumber` пишет
«−123», «−456!» (удар ульты — крупная золотая), «(30)» — поглощено щитом, «+45» зелёным — лечение, «щит +20». В ядре
**нет промахов и критов** (`src/core/battle.ts`) — «Miss» и настоящий крит без правки правил показать нечем.

Как в RO (roBrowser `Renderer/Effects/Damage.js`, клиентская схема «DT_Default»):

| Файл клиента | Что внутри | Как используется |
| --- | --- | --- |
| `data\sprite\이팩트\숫자.spr` + `숫자.act` (`ÀÌÆÑÆ®\¼ýÀÚ.spr`) | кадры 0–9 — белые цифры (в новых клиентах ещё 10 = K, 11 = M) | цвет задаёт клиент умножением: белый — урон по монстру, **красный** — урон по игроку, **жёлтый** — крит и комбо, **зелёный** — лечение, синий — SP |
| `data\sprite\이팩트\msg.spr` (+ `.act`, если есть) | 6 кадров: 0 «Miss», 1 «Guard», 2 «Crit», 3 **фон крита**, 4 фон «Lucky», 5 «Lucky» | «Miss» вместо цифры; при крите за жёлтой цифрой рисуется кадр 3 |
| `data\sprite\이팩트\bluemsg.spr` (+ `.act`) | те же 6 кадров в синем цвете | комбо-удары, синий фон крита |
| по желанию: `NewNumber.spr`, `NewNumber_MSG.spr`, `NewNumber_BMSG.spr`, `Han.spr`, `Han_MSG.spr`, `Han_BMSG.spr` (+ `.act`) в той же папке | новые «скины урона» кRO 2022+ | есть не во всех клиентах |

«В рамочке», вероятнее всего, — **фон крита** (кадр 3 `msg.spr`): рваная красно-оранжевая «звезда-вспышка» за жёлтыми цифрами
критического удара. Варианты, как это сделать у нас (решить владельцу):

1. Фон крита — за крупной цифрой удара ульты (сейчас она золотая с «!»): без правки ядра, похоже на RO.
2. Настоящий крит и промах в бою: шанс крита/уклонения в `src/core/battle.ts` + события → «Crit» с рамкой и «Miss» из `msg.spr`.
   Это правка баланса и детерминированного ядра — отдельная задача.
3. «Рамка» как постоянная подложка всех цифр — в RO такого нет; если владелец имел в виду именно это, нужен пример (скриншот).

Цифры RO — без знаков: минус, плюс, скобки и слово «щит» шрифт не содержит; урон пишем без «−», лечение — зелёным без «+»
(или «+» рисуем кодом), щит — голубым числом.

Итого: **6 файлов** (3 пары .spr/.act), по желанию ещё 12.

---

## 6. Музыка локаций

Номера — по `data\mp3nametable.txt` (строки `<карта>.rsw#bgm\\NN.mp3#`) копии клиента kRO; названия — iRO Wiki «BGM Files» и
треклист SoundTeMP. Внимание: нумерация альбома после трека 30 **не совпадает** с номерами файлов (альбомный «Theme of Al de Baran»
— №38, файл — `39.mp3`), поэтому названия ниже — по номерам **файлов**. В игре сейчас: `MUSIC` в `src/game/audioCatalog.ts`
(главная, таверна, карта и бой для 7 тем, босс) и фоны `amb_*`; файлы владельца — `assets/audio/music_<id>.ogg|m4a|mp3`.

### Главы маршрута

| Глава | Карты RO | Файл | Название | Для чего у нас | Уверенность |
| --- | --- | --- | --- | --- | --- |
| 1 Поля Пронтеры | `prt_fild01/05/06/08` | `BGM\12.mp3` | Streamside | карта главы (`map_meadow`) | да |
| 1 | `prt_fild00/02/03/04/07` | `BGM\05.mp3` | Tread on the Ground | бой главы (`battle_meadow`) | да |
| 2 Канализация | `prt_sewb1–4` | `BGM\19.mp3` | Under the Ground | карта и бой (новая тема) | да |
| 3 Орки | `gef_fild10`, `in_orcs01` (орочья деревня) | `BGM\35.mp3` | TeMPoison | карта (новая тема) | да (номер), название — iRO Wiki |
| 3 | `orcsdun01–02` | `BGM\48.mp3` | Help Yourself | бой (новая тема) | да |
| 4 Моррок/Сограт | `morocc` | `BGM\11.mp3` | Theme of Morroc | карта (`map_desert`) | да |
| 4 | `moc_pryd01–06` | `BGM\22.mp3` | Backattack!! | бой (`battle_desert`) | да |
| 4 (по желанию) | `moc_fild01/04–07` / `moc_fild08–19` / `in_sphinx1` | `24.mp3` / `37.mp3` / `38.mp3` | Desert / TeMPorsche / Hamatan | запасные | да |
| 5 Пайон | `payon`, `pay_arche` | `BGM\14.mp3` | Theme of Payon | карта (`map_grove`) | да |
| 5 | `pay_dun00–02` | `BGM\20.mp3` | Ancient Groover | бой (`battle_grove`) | да |
| 5 (по желанию) | `pay_fild01–04,08` / `pay_fild05–07,09` / `pay_dun03–04` | `03.mp3` / `36.mp3` / `47.mp3` | Peaceful Forest / Nano East / Welcome Mr. Hwang | запасные | да |
| 6 Корабль | `alberta` | `BGM\15.mp3` | Theme of Alberta | карта (`map_shipwreck`) | да |
| 6 | `treasure01–02` | `BGM\17.mp3` | Treasure Hunter | бой (`battle_shipwreck`) | да |
| 6 (по желанию) | `alb2trea` (поле у корабля) | `BGM\52.mp3` | **проверить** название (по альбому — «Ready») | — | номер да, название нет |
| 7 Альдебаран | `aldebaran` | `BGM\39.mp3` | Theme of Al de Baran | карта (новая тема) | да |
| 7 | `c_tower1–4` | `BGM\60.mp3` | Aeon | бой (новая тема) | да |
| 7 (по желанию) | `alde_dun01–04` (подвал башни) | `BGM\61.mp3` | Zingaro | бой босса главы | да |
| 8 Гласт Хейм | `glast_01`, `gl_dun01–02`, `gl_step`, `gl_in01` | `BGM\42.mp3` | **проверить**: Curse'n Pain или Morning Gloomy | карта (`map_crypt`) | номер да, название нет |
| 8 | `gl_church`, `gl_chyard`, `gl_prison`, `gl_prison1` | `BGM\40.mp3` | Fear… | бой (`battle_crypt`) | да |
| 8 (по желанию) | `gl_cas01–02` / `gl_knt01–02` / `gl_sew01–04` | `43.mp3` / `44.mp3` / `48.mp3` | (**проверить** 43) / TeMP It Up / Help Yourself | запасные | 44 и 48 — да |
| 9 Лабиринтный лес | `prt_maze01–03` | `BGM\16.mp3` | Labyrinth | карта и бой (новая тема) | да |
| 10 Нифльхейм | `niflheim` | `BGM\84.mp3` | Christmas in the 13th Month (**проверить**) | карта (`map_niflheim`) | номер да |
| 10 | `nif_fild01–02` (Гьёлль) | `BGM\85.mp3` | Dancing Christmas in the 13th Month (**проверить**) | бой (`battle_niflheim`) | номер да |

### Общие экраны

| Экран | Предложение | Файл | Название | Уверенность |
| --- | --- | --- | --- | --- |
| Экран входа, заставка | экран логина RO | `BGM\01.mp3` | Title | да |
| Главный экран / город (`home`) | `prontera`, `prt_in` | `BGM\08.mp3` | Theme of Prontera | да |
| Таверна (`tavern`) | `izlude` (весёлый порт) или Альберта | `BGM\26.mp3` | Everlasting Wanderers (**проверить** название) | номер да |
| Башня | `gef_dun00–01` (башня Геффена) | `BGM\21.mp3` | Through the Tower | да |
| Бой с боссом (`boss`) | `mag_dun01–02` | `BGM\06.mp3` | Risk Your Life | да; вариант — `18.mp3` Time Up!! (PvP) |
| Охота на босса / экспедиции (по желанию) | `pvp_n_1-1`, залы смены профессии | `BGM\02.mp3` | Gambler of Highway | да |
| Победа / поражение | в RO нет джинглов; победа над боссом — звук `effect\st_mvp.wav` (раздел 7), обычные итоги — синтез | — | — | — |

Итого: **23 трека обязательно** (01, 05, 06, 08, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 26, 35, 39, 40, 42, 48, 60, 84, 85 — трек 26 можно не брать,
если таверне отдать 15), **по желанию 12** (02, 03, 18, 24, 36, 37, 38, 43, 44, 47, 52, 61). Плюс `data\mp3nametable.txt` для сверки.

Фоны глав (`amb_*`: ветер, капли, прибой) — в RO отдельных фоновых звуков карт нет (кроме звуков объектов карты, `data\wav\` —
водопад, огонь; имена берутся из `.rsw` карты). Оставляем синтез; по желанию — позже.

---

## 7. Звуки

Файлы — `data\wav\` (удары, лечение, уровень, звуки монстров) и `data\wav\effect\` (навыки). Колонка «id у нас» — звук из
`SFX` в `src/game/audioCatalog.ts` (файл владельца `assets/audio/<id>.ogg`), точки проигрывания — `src/game/battleAudio.ts`
(бой), `juice.ts` (награды, сундук), `InventoryScene.ts` (заточка), `ResultScene.ts` (итоги), `sceneAudio.ts` (начало боя).

### Удары и выстрелы (подтверждено `WeaponHitSoundTable.js` / `WeaponSoundTable.js`)

| id у нас | Файл клиента | Примечание |
| --- | --- | --- |
| `hit_sword` | `data\wav\_hit_sword.wav` | меч, двуручник |
| `hit_dagger` | `data\wav\_hit_sword.wav` (у RO кинжал звучит как меч) | в старых клиентах `_hit_dagger.wav`, в новых `_hit_short_sword.wav` — **проверить**, взять что есть |
| `hit_blunt` | `data\wav\_hit_mace.wav`, `_hit_axe.wav` | булава/катар/скрипка — mace, топор — axe |
| `hit_arrow` | `data\wav\_hit_arrow.wav` | |
| `hit_claw` (удар монстра) | `data\wav\_hit_fist1.wav` … `_hit_fist4.wav`, `_enemy_hit_normal1.wav` | кулак/когти |
| (посох) | `data\wav\_hit_rod.wav` | для магов вместо `hit_blunt` |
| (копьё, по желанию) | `data\wav\_hit_spear.wav` | |
| `swing` | `data\wav\attack_sword.wav`, `attack_short_sword.wav`, `attack_twohand_sword.wav`, `attack_axe.wav`, `attack_mace.wav`, `attack_rod.wav`, `attack_katar.wav`, `attack_fist.wav` | взмах по типу оружия |
| `bow_shot` | `data\wav\attack_bow1.wav`, `attack_bow2.wav` | |
| `crit` | `data\wav\effect\ef_hit5.wav` или `ef_hit6.wav` (удары навыков EF_HIT3–6) | выбрать на слух — **проверить** |
| `hit_magic` | `data\wav\effect\ef_hit2.wav` | |

### Навыки (подтверждено `EffectTable.js`; всё в `data\wav\effect\`)

| id у нас / навык | Файлы |
| --- | --- |
| `cast_start` (начало каста) | `ef_beginspell.wav` |
| `cast_fire` — Fire Bolt / Fire Ball / Fire Wall | `ef_firearrow1.wav` … (номера по числу стрел, взять все `ef_firearrow*.wav`), `ef_firehit.wav`, `ef_fireball.wav`, `ef_firewall.wav` |
| `cast_ice` — Cold Bolt / Frost Diver / Storm Gust | `ef_icearrow*.wav` (все), `ef_frostdiver.wav`, `ef_frostdiver2.wav`, `wizard_stormgust.wav` |
| `cast_wind` — Thunderstorm / Jupitel | `magician_thunderstorm.wav`, `ef_thunderstorm.wav`, `hunter_shockwavetrap.wav` |
| `cast_earth` — Earth Spike / Heaven's Drive / землетрясение | `wizard_earthspike.wav`, `earth_quake.wav`, `black_hammerfall.wav` |
| `cast_holy` — Magnus / Holy Cross / Grand Cross | `priest_magnus.wav`, `cru_holy cross.wav`, `cru_grand cross.wav` (с пробелом); Holy Light — **проверить** (в таблице эффектов звука нет) |
| `cast_neutral` — Soul Strike / Napalm Beat | `ef_soulstrike.wav`, `ef_napalmbeat.wav` |
| `cast_poison` — Envenom / Venom Dust | `ef_poisonattack.wav`, `thief_invenom.wav`, `assasin_enchantpoison.wav`, `assasin_poisonreact.wav`, `assasin_venomsplasher.wav` |
| `cast_dark` — тёмные навыки монстров | `ef_soulstrike.wav` (Dark Strike в RO звучит так же) + по желанию `wizard_fire_ivy.wav` (Lord of Vermilion), `wizard_meteor.wav` (Meteor Storm — Тёмный лорд) |
| `ult` (всплеск перед ультой) | `ef_magnumbreak.wav` или `ef_bash.wav` |
| `heal` | `data\wav\_heal_effect.wav` (не в `effect\`) |
| `buff` — Blessing / Increase AGI / Angelus | `ef_blessing.wav`, `ef_incagility.wav`, `ef_angelus.wav` |
| `debuff` — Decrease AGI / Lex Aeterna | `ef_decagility.wav`, `priest_lexaeterna.wav` |
| `shield` — Kyrie Eleison / щиты | `priest_kyrie_eleison_a.wav`, `kyrie_guard.wav` |
| `stun` | в таблице эффектов нет явного — **проверить** (кандидат `data\wav\_blind.wav` или звук `ef_hit3.wav`) |
| навыки мечника | `ef_bash.wav` (Bash), `ef_magnumbreak.wav` (Magnum Break, Cart Revolution), `swordman_provoke.wav`, `ef_endure.wav`, `knight_twohandquicken.wav`, `knight_autocounter.wav`, `knight_brandish_spear.wav` |
| навыки вора / ассасина / разбойника | `ef_steal.wav`, `assasin_sonicblow.wav`, `assasin_cloaking.wav`, `rog_back stap.wav` (с пробелом, так в клиенте), `rog_steal coin.wav`, `rog_intimidate.wav` |
| навыки лучника / охотника / барда | `ac_concentration.wav`, `hunter_blitzbeat.wav`, `hun_anklesnare.wav`, `hunter_claymoretrap.wav`, `hunter_sandman.wav`, `hunter_freezingtrap.wav` |
| навыки аколита / жреца | `acolyte_cure.wav`, `ef_signum.wav`, `priest_sanctuary.wav`, `priest_magnificat.wav`, `priest_gloria.wav`, `priest_impositio.wav`, `priest_resurrection.wav`, `priest_recovery.wav`, `priest_suffragium.wav`, `priest_aspersio.wav` |
| навыки торговца / кузнеца / алхимика | `ef_coin2.wav` (Mammonite), `black_adrenalinerush_a.wav`, `black_overthrust.wav`, `black_weapon_perfection.wav`, `black_maximize_power_sword_bic.wav`, `p_success.wav`, `p_failed.wav` |
| навыки мудреца | `sage_magic rod.wav`, `sage_spell breake.wav` (с пробелами) |

Какой навык игры = какой навык RO — таблица `RO_SKILL_ICONS` в `src/game/skillLook.ts` (по ней же подключим звук навыка).

### Прогресс, награды, интерфейс

| id у нас | Файл клиента | Примечание |
| --- | --- | --- |
| `level_up` | `data\wav\levelup.wav` | эффект «ангел» при повышении уровня (EF_ANGEL) |
| `job_change` | `data\wav\levelup.wav` | в RO отдельного звука смены профессии нет — **проверить** (EF_ANGEL2 job level) |
| `boss_death` | `data\wav\effect\st_mvp.wav` | фанфара «MVP» — узнаваемый звук победы над боссом |
| заточка успех / поломка (нужны **новые** id, сейчас играют `equip`+`coin` и `hit_blunt`+`ui_error`) | `effect\bs_refinesuccess.wav`, `effect\bs_refinefailed.wav` | звуки кузнеца-рефайнера RO |
| `coin` | `effect\ef_coin2.wav` | звон монет (Mammonite) |
| `summon_rare` / `summon_epic` / `summon_legendary` / `rarity_up` | `effect\drop_blue.wav`, `drop_purple.wav`, `drop_yellow.wav`, `drop_red.wav`, `drop_green.wav`, `drop_pink.wav` | звуки выпадения редких вещей по цвету |
| `unlock`, переходы между главами | `effect\ef_portal.wav`, `ef_teleportation.wav`, `ef_readyportal.wav` | телепорт/портал |
| `ui_tap` | `data\wav\버튼소리.wav` (`¹öÆ°¼Ò¸®.wav`, «звук кнопки») | **проверить** имя |
| `equip`, `chest_open`, `claim`, `quest_done`, `battle_start`, `boss_intro`, `victory`, `defeat`, `summon_pull`, `summon_tension`, `ui_*` кроме tap, `bell_chime`, `death_hero` | в RO прямых аналогов нет или имя не установлено | остаются синтез/стоки; `death_hero` — **проверить** звук смерти персонажа в `data\wav\` |

### Звуки монстров (по желанию, P3)

У каждого монстра в `.act` записаны имена его звуков (атака, удар по нему, смерть, шаг): обычно `data\wav\<спрайт>_attack.wav`,
`<спрайт>_damage.wav`, `<спрайт>_die.wav`, `<спрайт>_move.wav`, `<спрайт>_stand.wav`, но бывают отступления (корейские имена,
общие файлы). Надёжный путь: сначала выложить .spr/.act (раздел 2) — наш конвертер выпишет точный список `.wav`, который
понадобится, — и тогда извлечь именно их. Или приложить всю папку `data\wav\` архивом (без Git). Сейчас в игре один общий
звук смерти монстра (`death_monster`) — свои звуки монстров потребуют правки кода.

Итого звуков: **~75 файлов** в таблицах выше (удары 16, навыки ~50, прогресс и интерфейс ~12); звуки монстров — после разбора .act.

---

## 8. Сводка

| Раздел | Обязательно | По желанию |
| --- | --- | --- |
| 2. Монстры (.spr + .act) | 43 пары = 86 файлов | 16 пар; перегнать 47 готовых |
| 3. NPC | 1 пара + 1 иллюстрация = 3 файла | 6 пар |
| 4. Предметы (.bmp) | 67 иконок + 67 картинок collection = 134 файла | — |
| 5. Цифры урона | 3 пары = 6 файлов | 12 файлов новых скинов |
| 6. Музыка (.mp3) | 23 трека + mp3nametable.txt | 12 треков |
| 7. Звуки (.wav) | ~75 файлов | звуки монстров |

### Коротко для владельца (простой текст)

```
Что вынуть из клиента RO и куда положить. Полный список с именами файлов — docs/RO_EXTRACT_LIST.md.

Инструмент: GRF Editor (Windows), открыть data.grf (и rdata.grf, если есть), кодировка Korean 949. Файлы класть в репозиторий в папку raw/ro/ с подпапками как в документе (sprite/monster, sprite/npc, sprite/effect, texture/item, texture/collection, texture/illust, wav, wav/effect, bgm). Имена файлов не менять — корейские или «кракозябры» одинаково годятся. Музыку (папка BGM клиента, это не GRF) лучше архивом во вложение, а не в Git.

Порядок:
1. Цифры урона: из data\sprite\이팩트\ файлы 숫자.spr, 숫자.act, msg.spr, bluemsg.spr (и их .act, если есть). Это 6 файлов — сразу видно в каждом бою.
2. Боссы и мини-боссы (пары .spr и .act из data\sprite\몬스터\): orc_lord, c_tower_manager, owl_baron, ancient_mummy, knight_of_abyss, evil_druid, lord_of_death, baphomet_, ghostring, vagabond_wolf, thief_bug_male.
3. Иконки всех предметов: data\texture\유저인터페이스\item\ и collection\ — 67 имён из таблицы раздела 4.
4. Музыка: BGM 01, 05, 06, 08, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 26, 35, 39, 40, 42, 48, 60, 84, 85 и файл data\mp3nametable.txt.
5. Звуки: из data\wav\ файлы _hit_*.wav, attack_*.wav, _heal_effect.wav, levelup.wav; из data\wav\effect\ — список раздела 7 (ef_*, priest_*, wizard_*, bs_refine*, st_mvp и т.д.).
6. Рядовые монстры новых глав: канализация (thief_bug_larva, thief_bug_egg, thief_bug_female, farmiliar, plankton, tarou), орки (ork_warrior, high_orc, orc_archer, orc_lady, orc_skeleton, orc_zombie, steel_chocho), Альдебаран (alarm, clock, elder, owl_duke, punk, rideword), Лабиринт (hunter_fly, side_winder, mantis, stem_worm, killer_mantis, deviruchi, eclipse, vocal), Гласт Хейм ghoul, Нифльхейм bloody_knight, глава 1 marin и pupa, Башня elder_wilow.
7. NPC: data\sprite\npc\4_f_kafra1.spr и .act и иллюстрация Кафры data\texture\유저인터페이스\illust\kafra_01.bmp.

Всё остальное (разбор spr/act в наши листы, иконки, шрифт урона, нарезка музыки) делаем мы. Один вопрос к вам: «цифры в рамочке» — это вспышка за критическим ударом, как в RO? Если да — покажем её на ударе ульты; настоящие криты и «Miss» потребуют изменить правила боя.
```

## Дозаказ (29.09, после главы 9)

Четыре вещи главы 9 пока показывают чужие иконки RO (копии файлов): извлечь свои из `data\texture\유저인터페이스\item\` и
`collection\` и положить поверх `assets/ui/icons/item_<id>.png` / `assets/ui/collection/item_<id>.png` (resname — по
idnum2itemresnametable, «проверить»):
1. `crescent_scythe` — Серповидная коса → Crescent Scythe (1305). Сейчас копия `abyss_blade`.
2. `majestic_goat` — Величественный козёл → Majestic Goat (5160). Сейчас копия `crown`.
3. `pact_robe` — Мантия договора → любая тёмная мантия RO (например Robe of Cast, 2334 — выбор владельца). Сейчас копия `dark_lord_robe`.
4. `maze_boots` — Сапоги лабиринта → любые сапоги RO (например Boots, 2405 — уже есть; или Tidal Shoes). Сейчас копия `owl_boots`.

Лист `whisper` (Шёпот, юнит `maze_whisper`) извлечён (`raw/ro-build/assets/sprites/…/whisper.png`), но ещё не зарегистрирован
в `sprites.json` — юнит пока на заплатке `banshee`.
