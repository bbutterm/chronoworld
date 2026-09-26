# Chronoworld — подбор графики по фазам 0–2

**Статус: рабочие PNG персонажей и врагов находятся в [`assets/ro/`](../assets/ro/); здесь каталог всего объёма.** [Полный перечень: 146 позиций](catalog.csv) · [JSON](catalog.json). Фаза 0 — 39, фаза 1 — 30, фаза 2 — 77. 26 боевых анимационных листов, 26 отдельных боевых кадров, 12 вырезок-портретов и 6 иконок начальных ульт изготовлены и проверены. Истина о готовых файлах и покадровой раскладке — [`assets/ro/manifest.json`](../assets/ro/manifest.json), **не** исследовательский статус в CSV. Для фоновых сцен, UI, FX и большинства иных иконок в CSV всё ещё только кандидаты.

## Герои — исходники готовых листов RO

| Этап | Роль Chronoworld | Класс RO | Job ID | Проверенный кадр |
|---|---|---|---:|---|
| 0 | Страж | Crusader | 14 | [PNG](https://assets.latam-tools.com.br/image?job=14&action=0&frame=0&gender=male&head=1) |
| 0 | Воин | Knight | 7 | [PNG](https://assets.latam-tools.com.br/image?job=7&action=0&frame=0&gender=male&head=1) |
| 0 | Ассасин | Assassin | 12 | [PNG](https://assets.latam-tools.com.br/image?job=12&action=0&frame=0&gender=male&head=1) |
| 0 | Лучник | Hunter | 11 | [PNG](https://assets.latam-tools.com.br/image?job=11&action=0&frame=0&gender=male&head=1) |
| 0 | Маг | Wizard | 9 | [PNG](https://assets.latam-tools.com.br/image?job=9&action=0&frame=0&gender=male&head=1) |
| 0 | Жрица | Priest ♀ | 8 | [PNG](https://assets.latam-tools.com.br/image?job=8&action=0&frame=0&gender=female&head=1) |
| 2 | Кузнец | Blacksmith | 10 | [PNG](https://assets.latam-tools.com.br/image?job=10&action=0&frame=0&gender=male&head=1) |
| 2 | Монах | Monk | 15 | [PNG](https://assets.latam-tools.com.br/image?job=15&action=0&frame=0&gender=male&head=1) |
| 2 | Мудрец | Sage | 16 | [PNG](https://assets.latam-tools.com.br/image?job=16&action=0&frame=0&gender=male&head=1) |
| 2 | Плут | Rogue | 17 | [PNG](https://assets.latam-tools.com.br/image?job=17&action=0&frame=0&gender=male&head=1) |
| 2 | Алхимик | Alchemist | 18 | [PNG](https://assets.latam-tools.com.br/image?job=18&action=0&frame=0&gender=male&head=1) |
| 2 | Бард | Bard | 19 | [PNG](https://assets.latam-tools.com.br/image?job=19&action=0&frame=0&gender=male&head=1) |

Это **двенадцать разных силуэтов**, а не recolor. Ссылки в таблице ведут к исходным референсам `action=0`; готовые PNG собраны из восточного направления и пяти настоящих последовательностей кадров на героя. `hero_*_portrait.png` — пиксельная вырезка из оригинального спрайта, не отдельно нарисованный портрет. Оружие/экипировка по умолчанию не добавлены.

## Враги и боссы — исходники готовых листов RO

| Этап | Роль/глава | Монстр (Monster ID) | Проверенный кадр |
|---|---|---|---|
| 1 | Ближний | Orc Warrior (1023) | [PNG](https://assets.latam-tools.com.br/image?job=1023&action=0&frame=0) |
| 1 | Дальний | Archer Skeleton (1016) | [PNG](https://assets.latam-tools.com.br/image?job=1016&action=0&frame=0) |
| 1 | Танк | Elder Willow (1033) | [PNG](https://assets.latam-tools.com.br/image?job=1033&action=0&frame=0) |
| 1 | Быстрый | Poring (1002) | [PNG](https://assets.latam-tools.com.br/image?job=1002&action=0&frame=0) |
| 1 | Босс гл. 1 | Mistress (1059) | [PNG](https://assets.latam-tools.com.br/image?job=1059&action=0&frame=0) |
| 1 | Босс гл. 2 | Osiris (1038) | [PNG](https://assets.latam-tools.com.br/image?job=1038&action=0&frame=0) |
| 1 | Босс гл. 3 | Baphomet (1039) | [PNG](https://assets.latam-tools.com.br/image?job=1039&action=0&frame=0) |
| 2 | Бронированный | Raydric (1163) | [PNG](https://assets.latam-tools.com.br/image?job=1163&action=0&frame=0) |
| 2 | Засада | Mimic (1191) | [PNG](https://assets.latam-tools.com.br/image?job=1191&action=0&frame=0) |
| 2 | Летающий | Gargoyle (1253) | [PNG](https://assets.latam-tools.com.br/image?job=1253&action=0&frame=0) |
| 2 | Заклинатель | Dark Priest (1198) | [PNG](https://assets.latam-tools.com.br/image?job=1198&action=0&frame=0) |
| 2 | Босс гл. 4 | Moonlight Flower (1150) | [PNG](https://assets.latam-tools.com.br/image?job=1150&action=0&frame=0) |
| 2 | Босс гл. 5 | Drake (1112) | [PNG](https://assets.latam-tools.com.br/image?job=1112&action=0&frame=0) |
| 2 | Босс гл. 6 | Dark Lord (1272) | [PNG](https://assets.latam-tools.com.br/image?job=1272&action=0&frame=0) |

ID взяты из [rAthena `mmo.hpp`](https://github.com/rathena/rathena/blob/e985006171d2eb320ee512a653f4c83aea3d81b6/src/common/mmo.hpp) и [mob_db.yml](https://github.com/rathena/rathena/blob/e985006171d2eb320ee512a653f4c83aea3d81b6/db/re/mob_db.yml). Отнесение монстра к роли/главе — **арт-предложение**; его скорость, размер, поведение и тайминги этим не подтверждаются. Источник ссылок — [ragassets](https://github.com/adsonpleal/ragassets/tree/0fe80c790358edc5a41a280df36080d9654cae3c), публичный hobby-сервер без SLA; **не подключать его как runtime-зависимость**.

## Остальной объём каталога

- **Ульты/навыки:** шесть стартовых иконок сохранены и проверены как RGBA PNG 128×128. Для 24 пассивок механики не описаны: случайный значок не выдаётся за выбранный навык.
- **Фон арены, 6 фонов глав, лагерь, вертикальная карта:** подходящие CC0-тайлы — [Kenney Roguelike/RPG](https://kenney.nl/assets/roguelike-rpg-pack), [Kenney Cartography](https://kenney.nl/assets/cartography-pack), [Tiny Town](https://kenney.nl/assets/tiny-town). Ни один тайлсет не является готовым фоном 1080×1920/4000; нужно собрать сцену с местом под UI. На 1080×1920 арена начинается с `y=640`.
- **HP/энергия/слоты/кнопки/панели/итоги/рамки:** [Kenney UI Pack RPG Expansion](https://kenney.nl/assets/ui-pack-rpg-expansion), [Fantasy UI Borders](https://kenney.nl/assets/fantasy-ui-borders) (CC0). Цвета, русские надписи, состояния и 9-slice создаются/валидируются отдельно. Не обещать готовые точные спрайты по странице пака.
- **FX, сундук, маркеры/навигация, иконки ролей/статусов/ресурсов/экипировки:** [Ninja Adventure](https://pixel-boy.itch.io/ninja-adventure-asset-pack), [Kenney Particle Pack](https://kenney.nl/assets/particle-pack), [Kenney Game Icons](https://kenney.nl/assets/game-icons) (CC0 по страницам). Файлы внутри архивов и конкретные шесть FX/три состояния сундука ещё нужно просмотреть поштучно.
- **Фракции A/B/C:** только временные идентификаторы, названия и символы не даны. **Шрифт урона:** `ui_damage_font.ttf` — исключение из формата PNG; нужен отдельно лицензированный TTF/OTF с кириллицей, цвет лечения задаётся кодом.

### Права и критерий готовности

Пользователь сообщил, что обладает правом загрузить оригинальную графику RO в этот репозиторий. Лицензии [renderer](https://github.com/adsonpleal/ragassets) и [серверного кода rAthena](https://github.com/rathena/rathena) сами по себе прав на GRF/SPR/ACT не передают. PNG в `assets/ro/` — именно производные оригинальной RO-графики, а не CC0. Проверены декодирование, RGBA, реальные кадры, прозрачность, размеры, контактные листы; игровой runtime/FPS пока не проверен. Статусы CSV означают первоначальную стадию поиска; готовность брать только из манифеста.

Имена нормализованы до `hero_<id>_battle.png`, `hero_<id>_portrait.png`, `enemy_<id>.png`, `bg_<id>.png`, `ui_<id>.png`, `fx_<id>.png` — разделители в примере были неодинаковыми. `source_url` — ссылка на исследовательский источник, а не команда автоматической загрузки.
