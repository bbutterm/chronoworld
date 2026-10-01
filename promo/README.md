# Промо: видео и скриншоты

Готовое:
- `video/chronoworld_promo_30s.mp4` — ролик 30 с, 1080×1920, 30 fps, H.264 (yuv420p, faststart) + AAC; для Telegram, TikTok, Reels.
- `shots/*.jpg` — кадры игры 1080×1920 (бой и ульты, заряд босса и «Сбито!», MVP-охота, Башня, таверна, герои).
- `branches/*.jpg` — ветки героев: `all_heroes.jpg` (12 героев × 3 формы) и слайд на каждого героя (первая профессия →
  две ветки, портреты и фигуры RO, ульта каждой формы).

## Сценарий ролика

1. 0–3 с — хук: логотип CHRONOWORLD с ударом и вспышкой, «Мир Ragnarok оживает», «idle-RPG прямо в Telegram».
2. 3–9 с — «Ульта по касанию — решай сам!»: три ульты (Великая снежная буря, Великий Магнус, Удар Асуры), плашки героя и ульты.
3. 9–13 с — «Босс заряжает удар!» (красная пульсация, наезд) → вспышка, тряска, «СБИТО!» и звук удара.
4. 13–17 с — сетка 12 героев, затем слайды веток (Алан, Вика, Кай), «24 ветки профессий».
5. 17–21 с — «MVP-охота» (Дракула и Бафомет, сплит), затем «Башня-рогалик» с картами RO веером.
6. 21–25 с — вечера в таверне: «Герои, за которых переживаешь».
7. 25–30 с — логотип, «Играй в Telegram», кнопка «Играть» с касанием, затемнение.

Музыка — «Risk Your Life» (`assets/audio/music_boss.ogg`, с 7.4 с), удары `charge_break` и `crit`, затухание с 27.5 с.

## Как пересобрать

Из корня репозитория (нужны `node_modules` проекта; Playwright — глобальный, `npm root -g`, Chromium в
`PLAYWRIGHT_BROWSERS_PATH`; `playwright install` не запускать). ffmpeg — `pip install imageio-ffmpeg`.

```sh
mkdir -p promo/.work
npx tsx promo/src/saves.ts > promo/.work/saves.json                 # сохранения ядром (12 героев, отряды ульт)
npx tsx scripts/tower-shots-save.ts > promo/.work/tower-saves.json  # сохранения Башни
PROMO_VIEW=405x720 node promo/src/shoot.mjs screens tower  # экраны 1080×1920 (главная, герои, таверна, Башня)
node promo/src/shoot.mjs battle hunt                       # бои 390×844 → 1080×2338 (ульты, заряд, «Сбито!», MVP)
node promo/src/branches.mjs                                # слайды веток героев
python3 promo/src/select.py                                # отбор кадров → shots/*.jpg (≤ 400 КБ), branches/*.jpg
node promo/src/render.mjs                                  # 900 кадров → video/chronoworld_promo_30s.mp4
```

Съёмка боя медленная (каждый кадр — секунды в программном WebGL): запускать в фоне. Порты vite: 5251 (`PROMO_PORT`),
5252 (ветки), 5255 (рендер). `PROMO_SQUADS=storm`, `PROMO_MVPS=mvp_dracula,…`, `PROMO_MAX=10` — сузить съёмку.

Файлы `src/`:
- `squads.ts` — отряды для съёмки; `saves.ts` — сохранения; `probe.ts` — подбор боя (победа, заряды, число ульт).
- `shoot.mjs` — скриншоты игры: кнопки тестировщика спрятаны (`?tester=0`), подсказки обучения отмечены показанными,
  бой — кадр за кадром (`game.step`), ульты касаются сразу, «сбивающие» ждут заряда босса; MVP дня — сдвигом часов игры.
- `branches.html` / `branches.mjs` — слайды веток из `data/heroes`, `data/jobs`, `data/skills` и листов `assets/sprites`.
- `video.html` — ролик как функция времени: `seek(t)` (без CSS-анимаций и таймеров — кадры детерминированы).
  Просмотр: `http://localhost:5173/promo/src/video.html?play=1` при запущенном `npm run dev`, один кадр — `?t=11.2`.
- `render.mjs` — съёмка кадров и кодирование; `render.mjs 0.7,11.2,27.5` — отдельные кадры в `.work/preview`.
- `select.py` — какой кадр идёт в какой файл `shots/`; `contact.py` — контактный лист для просмотра.
- `fonts/` — Russo One и Rubik (Google Fonts, SIL OFL), кириллица и латиница.
