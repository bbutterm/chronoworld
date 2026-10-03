---
name: ro-extract
description: Полное извлечение ресурсов из GRF клиента Ragnarok Online и конвертация в форматы Chronoworld (листы спрайтов v2, эффекты, иконки, карты, иллюстрации, звук, музыка, таблицы). Использовать, когда просят «извлечь из грф», «вытащить из клиента RO», «сконвертировать ассеты RO в формат игры».
---

# Извлечение RO из GRF → форматы Chronoworld

Работаешь на машине владельца, где лежит клиент RO (права на арт — у владельца, `assets/ro/README.md`; репозиторий
приватный — ничего из клиента не публиковать). Цель — **выгрузить из GRF абсолютно всё**, а всё, что игра умеет
показывать или проигрывать, **сконвертировать в её форматы и разложить по её путям**, с манифестом и проверками.
Подключение к игре (правка `assets/sprites/sprites.json`, `data/`, `src/`) — отдельная задача, здесь только поставка.

Перед началом прочитай: `CLAUDE.md`, `docs/SPRITE_SPEC.md` (сетки), `docs/RO_SCRO_IMPORT.md` (как делали прошлый
импорт), `docs/RO_SCRO_EFFECTS.md` и `assets/effects/README.md` (эффекты), `docs/RO_EXTRACT_LIST.md` (соответствия),
`raw/ro-build/REPORT.md`. Готовые инструменты — `raw/ro-build/tools/` (GRF-ридер `grf.py`, рендер SPR/ACT `ro_spr_act.py`,
сборка листов `build_sheets.py`, UI `build_ui.py`, музыка `build_music.py`, эффекты `fx/`, проверки `qa_sheets.py`),
`tools/` (`check_sprites.py`, `sprites_manifest.py`, `extract_ro_skill_icons.py`, `ro_cards.py`, `ro_audio.py`,
`ro_effect_inventory.py`). В них зашит путь `/root/ro-client-extraction-2/...` — первым делом вынеси его в переменные
окружения `RO_CLIENT` (папка клиента) и `RO_WORK` (рабочая папка вне репозитория), не переписывая логику.

## 0. Входные данные и порядок архивов

- Клиент: папка с `data.grf`, `rdata.grf`, патч-GRF (имена из `DATA.INI` / `*.ini`), и «рассыпанная» папка `data/`.
- Приоритет как у клиента: порядок из `DATA.INI` (обычно патч → rdata → data), рассыпанные файлы `data/` — поверх.
  Каждый файл берётся из архива с наивысшим приоритетом; конфликты пиши в манифест (`overriddenBy`).
- Имена в GRF — CP949 (корейские папки). Внутри RO-путей держи оригинальные имена; для удобства — словарь папок
  в латиницу (`몬스터` → `monster`, `유저인터페이스` → `interface`, `아이템` → `item`, `인간족` → `human`, `몸통` → `body`,
  `머리통` → `head`, `방패` → `shield`, `이팩트` → `effect`, `npc` …) — тот же, что в `raw/ro/` прошлого импорта.
- GRF 0x200 (zlib) и 0x300; зашифрованные записи (DES) — `grf.py` уже умеет; что не читается — в отчёт, не пропускать молча.

## 1. Сырая выгрузка — всё без исключения (вне git)

`$RO_WORK/raw-full/<латинизированный путь>` — **каждый** файл всех GRF и `data/` байт в байт, плюс
`$RO_WORK/raw-full/manifest.csv`: `grfPath,archive,overriddenBy,size,sha256,path`. Это десятки ГБ — в репозиторий не
класть. Проверка: число файлов и сумма размеров = таблица GRF (без дублей по приоритету).

Таблицы клиента (`.lub`/`.lua`, `.txt`) — декомпилировать (`luadec`/`unluac`, где байт-код) и выгрузить в JSON в
`raw/ro-build/tables/` (это коммитится): `iteminfo`, `skillinfolist`/`skilldescript`, `jobname`/`jobidentity`,
`npcidentity` (id → имя спрайта монстра/NPC), `stateiconinfo`/`efstids` (статусы), `cardpostfixnameTable`,
`mp3nametable.txt` (карта → BGM), `mapnametable`, `accessoryid`/`spriterobename`, `weapontable`. Именно эти таблицы
дают соответствия «id → файл» для шагов ниже.

## 2. Конвертация в форматы игры

Общие правила (из `docs/SPRITE_SPEC.md`): родной масштаб ×1, без сглаживания и ресемплинга, без тени RO,
направление — восток (RO direction 6, у героев и монстров), точка ACT (0,0) — в `anchor` клетки во всех кадрах,
пустые клетки прозрачные, кадры не обрезать по bbox, лист ≤ 2048×2048, PNG RGBA (≤ 256 цветов — indexed с альфой),
затем `oxipng -o 4`. Ни одного lossy-пережатия спрайтов и иконок. Всё складывается в
`raw/ro-build/assets/` **зеркалом путей `assets/`** (тот же относительный путь, что будет в игре) + запись в манифест.

1. **Монстры и боссы — все из `npcidentity` с `.spr/.act` в `data/sprite/몬스터/`.** Лист v2 по `SPRITE_SPEC.md`:
   класс `monster` 240×224, anchor 100,120, 8 колонок, ряды idle 4 / walk 6 / attack 6 / hurt 3 / death 5;
   не влезает тело — следующий класс по порядку `boss` 256×256 (112,216) → `monster_xl` 272×330 (167,280, 6 кол.) →
   `boss_xl` 296×296 (96,218, 6 кол.) → `boss_xxl` 340×376 (170,300, 6 кол.). Выбирай самый маленький класс, где
   пропускаются только кадры эффектов (вспышки, снаряды), не тела; пропуски — в `samplingExceptions`. Кадры
   выбираются равномерно из ACT-действия (выборка как в `tools/check_sprites.py`); `hitFrames.attack` — из события
   `atk` ACT (иначе 3, `hitFrameSource: "default"`). Палитры-перекраски (`.pal`, `data/palette/`) — отдельные листы
   `<id>_<pal>` только если у монстра их несколько в клиенте. Путь: `sprites/monsters/<id>.png`, `sprites/bosses/`,
   `sprites/monsters_xl/`, `sprites/bosses_xl/`; портрет `sprites/portraits/<id>.png` 64×64 (голова и плечи из idle 0).
   id листа — имя спрайта RO в нижнем регистре (`orc_warrior`), при совпадении с уже существующим в
   `assets/sprites/sprites.json` id — тот же id (перерендер), а не новый.
2. **NPC — все спрайты `data/sprite/npc/`.** Класс `npc` 240×224, anchor 100,120, 8 колонок, 4 ряда (стойка юг,
   стойка восток, шаг юг, шаг восток; шагов нет — 2 ряда), `sprites/npcs/<имя>.png` + портрет
   `sprites/portraits/npc_<имя>.png` 64×64.
3. **Герои — все профессии из `jobname` (1-е, 2-е, транс, 3-и, экспанды), оба пола.** Класс `hero` 224×192,
   anchor 104,144, 8 колонок, 6 рядов: idle 4 (боевая стойка, не спиной), walk 8, attack 6 (с оружием), cast 6
   (casting; нет — attack 2), hurt 3, death 4. Собрать тело + голова (по умолчанию head 1 мужская / 1 женская,
   цвет волос 0) + оружие и щит из `weapontable` (оружие по классу, как в таблице раздела 4 `SPRITE_SPEC.md`).
   id: `<класс>` для базового пола (см. `docs/ART_EXTRACT_RO.md` §7: acolyte и priest — женские), вариант пола —
   `<id>_f` / `<id>_m`. Путь `sprites/heroes/<id>.png`, портрет `sprites/portraits/<id>.png` 64×64.
   Головы, причёски, головные уборы (`머리통`, `악세사리`) — в сырой выгрузке; отдельными листами не собирать.
4. **Эффекты — все `EF_*` из `EffectTable` (STR, SPR-эффекты, клиентские).** Рендер реальным движком, как в
   `docs/RO_SCRO_EFFECTS.md`: roBrowserLegacy EffectViewer в Electron/Xvfb, кадр за кадром на замороженных часах
   12 fps, seed 1, ресурсы — **только из этого клиента** через `raw/ro-build/tools/fx/ro_remote_client.py`; манекен
   скрыт. Масштаб 1.0417 экр. px на px спрайта (приведение к px RO); большие — холст 1600×1200, zoom 250.
   Формат — атлас как в `assets/effects/effects.json`: RGBA, одна рамка обрезки на все кадры, row-major, `cell`,
   `columns`, `frames`, `ms` 83.33, `loop`, `delayMs`, `anchor` (ноги цели в координатах клетки), `attach`
   (`target`/`caster`/`ground`), `blend: "normal"` (альфа = яркость аддитивного эффекта на чёрном; `add` — где нужно
   свечение), `source: { roEffectId, renderer, scale, seed, note }`. Лист ≤ 2048 и ≤ 8 МБ RGBA: лишние кадры
   прореживать равномерно, `ms` увеличивать, длительность та же (`thinned`). Путь `effects/fx_ro_<ef_name>.png`
   (имя `EF_*` в нижнем регистре). Пустые/с запечённым персонажем — статус `unusable` с причиной.
5. **Иконки навыков — все из `skillinfolist`.** `data/texture/유저인터페이스/item/<skill>.bmp` → родные 24×24 PNG RGBA
   (пурпурный #FF00FF → прозрачность), `ui/icons/skill_<skill_id_lower>.png`.
6. **Предметы — все из `iteminfo`.** Маленькая иконка → `ui/icons/item_<resname>.png` 24×24 (palette PNG,
   прозрачность по #FF00FF), коллекция `collection/<res>.bmp` → `ui/collection/item_<resname>.png` 75×100.
   Имя — `identifiedResourceName` в латинице; таблица id RO → файл — в манифест.
7. **Карты (card illustrations) — все `texture/유저인터페이스/cardbmp/*.bmp`.** Как `tools/ro_cards.py`: 300×400 →
   `ui/cards/<cardname>.webp` 180×240, WebP q85 (единственное допустимое lossy — так устроены текущие карты).
8. **Иллюстрации NPC — `texture/유저인터페이스/illust/*.bmp`.** `ui/illust/<имя>.png`, RGBA, исходный размер
   (как `kafra_01.png` 320×480), прозрачность по #FF00FF.
9. **Иконки статусов — все из `stateiconinfo`/`efstids` (`data/texture/effect/*.tga`).** `ui/icons/status_<si>.png`
   родной размер, RGBA.
10. **Цифры урона и надписи — `sprite/이팩트/` `numbers`, `msg`, `bluemsg` и т. п.** Атласы Phaser (JSON hash) как
    `raw/ro-build/assets/fx/damage/*.json`: `fx/damage/<имя>.png|.json`.
11. **Звуки — все `data/wav/**`.** Как `tools/ro_audio.py`: моно, 44.1 кГц, тишина в начале срезана, короткое
    затухание в конце, пик −1 dBFS, две копии `audio/ro/<путь без .wav>.ogg` (Vorbis q4) и `.m4a` (AAC 96k).
    Звуки монстров — дополнительно таблица «лист → attack/damage/die» из событий ACT в манифест (формат
    `data/monster_sounds.json`).
12. **Музыка — все `BGM/*.mp3`.** Как `raw/ro-build/tools/build_music.py`: −16 LUFS, true peak ≤ −1 dBTP, тишина по
    краям срезана, 3 мс фейды (шов петли без щелчка), Opus 40 кбит/с (32 для 22 кГц) `audio/music/bgm_NN.ogg` +
    AAC `bgm_NN.m4a`, каждый ≤ 1.45 МБ; `music.json` — номер, карты из `mp3nametable.txt`, громкость, битрейт.
13. **Фоны и мир.** Карты (`.rsw/.gnd/.gat`), модели `.rsm`, текстуры мира `data/texture/*` (кроме UI выше) в формат
    игры **не конвертируются** — у игры нарисованные фоны (`assets/backgrounds`). Они остаются в сырой выгрузке;
    дополнительно — превью-коллажи текстур по картам в `raw/ro-build/qa/world/` (для художника), без коммита
    исходников. Логин-экраны и загрузочные картинки (`texture/유저인터페이스/loading*.jpg`) → `backgrounds/ro/loading_NN.jpg`
    как есть.

## 3. Манифест поставки

`raw/ro-build/IMPORT_MANIFEST.json` (дописать, не терять прошлые записи): на каждый готовый файл —
`{ kind, id, file, target, sha256, sources: [grfPath…], status, note, units?, hitFrames?, hitFrameSource?,
samplingExceptions?, sourceSounds?, thinned? }`. `status`: `ready` | `ready_with_skipped_frames` | `needs_decision` |
`unusable` | `duplicate_of:<id>`. Фрагменты для подключения: `raw/ro-build/sprites.fragment.json` (записи
`sprites[]` schema 2 + классы), `raw/ro-build/effects.fragment.json` (`effects[]`), `raw/ro-build/audio/music.json`.
Поля-доказательства листов — только во фрагменте/`provenance`, не в будущий `sprites.json` (`tools/sprites_manifest.py`).

## 4. Проверки (обязательно, до коммита)

- Листы: правила `tools/check_sprites.py` (размер = колонки × клетка, число кадров в ряду, кадры не касаются края,
  низ idle = anchor.y ± 2, ≤ 2048, нет лишней полупрозрачности) — прогон `raw/ro-build/tools/qa_sheets.py` по всем
  новым листам; сверка с уже принятыми листами (`melee`, `fast`, `fabre`): якоря и пиксели совпадают.
- QA-картинки: `raw/ro-build/qa/contact_<kind>_NN.png` (по кадру каждой анимации, серый фон, ×2 nearest),
  `qa/gif/<id>.gif` (×2, крест якоря), эффекты — кадры 0/середина/последний на тёмном и светлом с юнитом ×1 у якоря.
- Звук: громкость и пики (`ffmpeg ebur128`/`astats`), шов петли музыки.
- Счёт: сколько найдено по таблицам vs сколько сконвертировано по каждому виду; всё несошедшееся — в отчёт.
- В репозитории — `npm run check` зелёный (поставка не трогает `assets/`, `data/`, `src/` — проверка должна быть как до).

## 5. Куда коммитить

- Ветка `art/ro-full-extract` от `main` (не рабочая ветка и не main). Коммитить: `raw/ro-build/assets/**`,
  фрагменты, манифест, `tables/`, `qa/` (сжатые PNG/GIF), обновлённые инструменты, отчёт. **Не коммитить**: GRF,
  сырую выгрузку, SPR/ACT/STR/WAV/MP3/BMP-оригиналы (кроме уже лежащих в `raw/ro/`), кэш рендера.
- Большие объёмы — частями по видам (монстры A–M, N–Z, эффекты партиями, звук, музыка), каждый коммит ≤ ~200 МБ.
  Если поставка в git выходит больше 2 ГБ — остановиться и спросить владельца (вариант: Git LFS или отдельный репозиторий).
- В конце каждого сообщения коммита — трейлеры из `CLAUDE.md`.

## 6. Отчёт

`raw/ro-build/REPORT.md` (дополнить разделом с датой): версия клиента и SHA-256 GRF, счёт по видам (найдено /
готово / пропущено / unusable), решения по классам листов, пропущенные кадры, нестандартные случаи, что требует
решения владельца, команды пересборки. Владельцу — краткое резюме простым текстом (без таблиц и markdown).
