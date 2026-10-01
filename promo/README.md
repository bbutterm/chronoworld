# Промо: видео, скриншоты, предпросмотр Mini App

Готовое:
- `video/chronoworld_promo_30s.mp4` — ролик 30 с, 1080×1920, 30 fps, H.264 (yuv420p, faststart) + AAC; для Telegram, TikTok, Reels.
- `shots/*.jpg` — кадры игры 1080×1920 для ролика: ульты (Удар Асуры — каст и удар, Владыка Вермилиона), боссы глав,
  MVP-охота, интерфейс (главная, карточка героя, таверна, снаряжение с картой MVP, карта главы), сюжет (диалог, вечер в
  таверне, летопись); `battle_break.jpg` и `tower_cards.jpg` — для предпросмотра Mini App.
- `preview/NN_*.jpg` — 8 картинок предпросмотра Mini App (BotFather → Configure Mini App → Preview media): 1080×1920, во
  весь кадр, ≤ 1 МБ, подпись сверху в стиле ролика.
- `branches/*.jpg` — ветки героев: `all_heroes.jpg` (12 героев × 3 формы) и слайд на каждого героя.

## Сценарий ролика (вторая версия, 01.10)

Все кадры — во весь экран без полос: `kb()` в `video.html` держит картинку у краёв кадра, высокие кадры боя (1080×2338)
обрезаются в `select.py` по «живой» области (без тёмного верха и низа), экраны интерфейса сняты сразу в 1080×1920.

1. 0–3 с — хук: логотип CHRONOWORLD с ударом и вспышкой на фоне Бафомета, «Мир Ragnarok оживает», «idle-RPG прямо в Telegram».
2. 3.0–4.4 с — «УЛЬТА ПО КАСАНИЮ»: касание портрета, иероглифы 阿修羅覇凰拳 над Викой, наезд камеры; плашка «Вика · Удар Асуры».
3. 4.4–6.4 с — удар Асуры: белая вспышка, тряска, искры, звук Асуры и тяжёлый удар.
4. 6.4–8.6 с — «РЕШАЙ САМ!»: Владыка Вермилиона Кая — молнии по всему полю врага.
5. 8.6–12.2 с — «БОССЫ ГЛАВ»: Орк-лорд (глава 3), Бафомет (глава 9), Владыка мёртвых (глава 10) — появление босса в бою (плашка «Босс главы»).
6. 12.2–14.2 с — «MVP-ОХОТА»: Дракула и Фараон, диагональный разрез.
7. 14.2–21.2 с — интерфейс по 1,4 с: «Твой лагерь» (главная), «12 героев · 24 ветки» (карточка Вики-монаха с ультой),
   «Призыв в таверне», «Карты MVP» (снаряжение +7 с картой Бафомета), «10 глав по миру RO» (карта главы).
8. 21.2–25.4 с — история: «Сюжет на 10 глав» (диалог с портретом), «Вечера в таверне», «Летопись».
9. 25.4–30 с — логотип, «Играй в Telegram», «бесплатно · бои идут, даже когда ты офлайн», кнопка «Играть» с касанием, затемнение.

Звук: «Backattack!!» (`assets/audio/music_battle_desert.ogg`, тема пирамид Моррока — самый плотный и быстрый трек игры по
огибающей громкости и частоте атак) с 5,19 с трека: тихое вступление идёт под логотип, удар барабанов — на касании ульты
(3,0 с), с ~17 с трек плотнее. Звуки RO: свуш `swing` на каждой смене сцены, `crit` на логотипе, `skl_asura` и
`charge_break` на Асуре, `skl_lord_of_vermilion` на Вермилионе, `hit_blunt` на боссах, `summon_epic` в таверне, `level_up` на финальном
логотипе, `ui_tap` на кнопке. Громкость выровнена (loudnorm −14 LUFS), затухание с 28 с.

## Предпросмотр Mini App (`preview/`)

1. `01_ult.jpg` — «Ульта по касанию»: удар Асуры.
2. `02_boss.jpg` — «Боссы глав»: заряд босса сбит — «Сбито!».
3. `03_heroes.jpg` — «12 героев · 24 ветки»: все формы героев.
4. `04_mvp.jpg` — «MVP-охота»: Дракула, карты Дракулы и Фараона.
5. `05_tower.jpg` — «Башня-рогалик»: карты RO.
6. `06_story.jpg` — «Сюжет и таверна»: вечер в таверне.
7. `07_home.jpg` — «Твой лагерь»: главная с отрядом.
8. `08_play.jpg` — логотип, «Играй в Telegram — бесплатно», кнопка «Играть».

## Как пересобрать

Из корня репозитория (нужны `node_modules` проекта; Playwright — глобальный, `npm root -g`, Chromium в
`PLAYWRIGHT_BROWSERS_PATH`; `playwright install` не запускать). ffmpeg — `pip install imageio-ffmpeg`.

```sh
mkdir -p promo/.work
PROMO_AUDIT=1 npx tsx promo/src/saves.ts > promo/.work/saves.json  # сохранения ядром (отряды ульт, снаряжение с картами MVP)
npx tsx scripts/tower-shots-save.ts > promo/.work/tower-saves.json  # сохранения Башни
PROMO_VIEW=405x720 node promo/src/shoot.mjs ui            # интерфейс, этапы с боссами, MVP, сюжет — сразу 1080×1920
PROMO_SQUADS=asura PROMO_TAP_ONLY=asura PROMO_ULT_K=1 PROMO_ULT_ONLY=asura PROMO_NO_CHARGE=1 PROMO_ULT_OFFS=950,1400 node promo/src/shoot.mjs battle
PROMO_SQUADS=storm PROMO_TAG=_lov PROMO_TAP_ONLY=vermillion PROMO_ULT_K=1 PROMO_ULT_ONLY=vermillion PROMO_NO_CHARGE=1 PROMO_ULT_OFFS=800,1100 node promo/src/shoot.mjs battle
for st in ch3_s10 ch9_s18 ch10_s18; do PROMO_SQUADS=storm PROMO_STAGE=$st PROMO_TAG=_${st}_1400 PROMO_INTRO_AT=1400 PROMO_MAX=1 PROMO_ULT_K=0 node promo/src/shoot.mjs battle; done
python3 promo/src/select.py                               # отбор кадров → shots/*.jpg (≤ 400 КБ), умная обрезка
python3 -m http.server 5255 --bind 127.0.0.1 &            # не нужен: render.mjs и preview.mjs поднимают его сами
node promo/src/render.mjs                                 # 900 кадров → video/chronoworld_promo_30s.mp4
node promo/src/preview.mjs                                # предпросмотр Mini App → preview/*.jpg
```

Съёмка боя медленная (каждый кадр — секунды в программном WebGL): запускать в фоне. Порты: 5251 (`PROMO_PORT`, vite для
съёмки), 5252 (ветки), 5255 (рендер, статический сервер python — vite отдавал 500), 5256 (предпросмотр).
`PROMO_ULT_K` — сколько раз снимать одну ульту, `PROMO_ULT_OFFS` — мс после начала ульты, `PROMO_ULT_ONLY` — регэксп
навыка, `PROMO_MAX` — предел кадров на бой, `PROMO_TAP_ONLY` — касаться только этой ульты (без наложения чужих), `PROMO_NO_CHARGE` — без кадров заряда, `PROMO_STAGE` / `PROMO_INTRO_AT` / `PROMO_TAG` — этап, момент кадра появления, суффикс имени, `PROMO_MVPS=mvp_dracula,…`, `PROMO_STORY=ch9_intro,…` (сцены диалога).
Чёрный кадр (пустой буфер WebGL) `shoot.mjs` снимает заново.

Проверка всех 36 ульт героев: отряды `AUDIT` (`squads.ts`, 8 отрядов — все формы),
`PROMO_SQUADS=audit1,…,audit8 PROMO_ULT_K=1 PROMO_ULT_OFFS=500,900 node promo/src/shoot.mjs battle`.

Файлы `src/`:
- `squads.ts` — отряды для съёмки и проверки ульт; `saves.ts` — сохранения; `probe.ts` — подбор боя.
- `shoot.mjs` — скриншоты игры: кнопки тестировщика спрятаны (`?tester=0`), подсказки обучения отмечены показанными,
  бой — кадр за кадром (`game.step`), ульты касаются сразу, «сбивающие» ждут заряда босса; MVP дня — сдвигом часов игры.
- `branches.html` / `branches.mjs` — слайды веток из `data/heroes`, `data/jobs`, `data/skills` и листов `assets/sprites`.
- `video.html` — ролик как функция времени: `seek(t)` (без CSS-анимаций и таймеров — кадры детерминированы); `window.CUTS` —
  смены сцен (по ним render.mjs кладёт свуши). Просмотр: `python3 -m http.server 5255` и
  `http://127.0.0.1:5255/promo/src/video.html?play=1`, один кадр — `?t=11.2`.
- `render.mjs` — съёмка кадров и кодирование; `render.mjs 0.7,11.2,27.5` — отдельные кадры в `.work/preview`.
- `preview.html` / `preview.mjs` — картинки предпросмотра Mini App (`?n=1…8`).
- `select.py` — какой кадр идёт в какой файл `shots/`; `contact.py` — контактный лист для просмотра.
- `fonts/` — Russo One и Rubik (Google Fonts, SIL OFL), кириллица и латиница.
