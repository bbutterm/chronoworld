# Компактный лагерь и призыв — приёмка 05.10.2026

Пакет адаптирует Home и Tavern. На Telegram 360×640 с отступами сверху 136 и снизу 34 игровая ширина сохраняется 1080,
доступная высота 1410. Текст и цели не уменьшаются вместе с высотой экрана: входы и зал листаются между шапкой и
нижними действиями. Настройки и карточки призыва имеют отдельные маски и прокрутку. При resize сохраняются открытое
окно, карточки и сохранение; сцена не перезапускается ради раскладки. Другие сцены включаются отдельными пакетами.

В Home сохранены диорама, Таверна, Лавка, задания, достижения, события, почта, контракт, Летопись, Друзья и все
настройки. Системные иконки имеют непересекающиеся цели не меньше 44 CSS px. Settings header/footer закреплены;
длинные настройки доступны через прокрутку и Telegram Back закрывает окно, после чего оно снова открывается.

В Tavern закреплены ×1/×10 и подпись бесплатного призыва, а подарок и гарант находятся в прокручиваемом зале.
В адаптивном reveal десять карт размещены в три колонки; имя и метки сохраняют размер, последняя карта достигается
прокруткой. Карточка открывает настоящую HeroScene и возвращается в тот же результат. «Готово» передаёт `{}` при
restart, поэтому старый reveal не повторяется. Skip во время загрузки спрайтов дожидается карточек. Изменение
размера не вызывает новый призыв и не выдаёт подарок повторно. Правила, цена, вероятность и награды не изменены.

Переносимый helper: `scripts/night-city-compact-ui-qa.cjs`; использует общие fixtures/input/renderer checks из
`scripts/night-compact-ui-qa.cjs`. Он допускает только localhost и блокирует все внешние запросы и сетевые записи.
Состояние — публичный `newGame`, канонический UI fixture после 45 этапов, story/unlock seen helpers; это проверка
раскладки, а не свидетельство прохождения или баланса. Новые ресурсы, герои и статистика для призыва не подменяются:
подарок и 10 экземпляров выдаются настоящими core действиями.

```sh
URL=http://127.0.0.1:5511/ \
OUT=/tmp/chronoworld-city-qa \
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROME_EXECUTABLE_PATH=/path/to/chromium \
MODES=webgl1,canvas SIZES=360x640,390x844 \
node scripts/night-city-compact-ui-qa.cjs
```

DEV acceptance:4 полные цепочки,84 screenshots,0 page/console errors и 0 уничтоженных texture sources. Измерены
44 CSS px для ключевых действий и 12 CSS px для гарантии/таймера. В каждом case реальные входы Quests/Achievements,
поздние insets, settings scroll/resize/SDK Back, Rates/SDK Back, подарок,10 summons, последняя карта, два resize,
Hero/SDK Back, «Готово» и Home. Header/source/renderer heartbeat проверяются на каждом снимке.

Save строго идентичен до/после insets и resize. После открытия нового героя ожидается только `markHeroSeen` и
один `revision` от commit; награды и RNG не повторяются. Helper дожидается завершения modal shield и fade-in footer;
ранние попытки, не соблюдавшие эти условия, не засчитаны как PASS. Harness никогда не сериализует Phaser-граф.

Focused:43 tests в 4 файлах (city layout, compact viewport, существующие settings и tavern rules) PASS; typecheck
PASS. Собственный build PASS. Compiled acceptance: 2 цепочки (360 Canvas, 390 WebGL1), 42 snapshots, 0 errors/null frames, без compact=1.
Bundle SHA256: 3ae818220242f73428c307a05a5fbdf8e34932d51ee0973ac35e7d2fbbc2c2a6. Точные hashes — в manifest/report; root обязан
выполнить общий `npm run check` перед commit. В пакет не включены read-only зеркала core или Hero/Ascend владельца.
