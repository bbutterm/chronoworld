# chronoworld

Игровые PNG-спрайтшиты: [`assets/ro/sheets/`](assets/ro/sheets/) — 12 героев, 8 рядовых врагов и 6 боссов. [Манифест кадров и длительностей](assets/ro/manifest.json) · [инструкция по подключению](assets/ro/README.md).

Дополнительно: [боевые кадры 320×320 / боссы 480×480](assets/ro/stills/), [12 вырезок-портретов 256×256](assets/ro/portraits/), [6 иконок ульт 128×128](assets/ro/icons/). [UI-атлас и компоненты](assets/ui/) — 15 PNG: полосы, слоты, кнопки, плашки исхода; [9-slice параметры](assets/ui/manifest.json), [лицензия CC0](assets/ui/KENNEY_LICENSE.txt).

[Каталог задач графики фаз 0–2](art-research/README.md) включает ещё не готовые фоны, FX и прочие иконки; наличие строки в каталоге **не** означает наличие PNG. [Листы v2](assets/sprites/sprites.json) включают Новичка (`novice`): [лист](assets/sprites/heroes/novice.png) и [портрет](assets/sprites/portraits/novice.png). Для него исходный `cast` совпадает с `idle`, а `death` содержит один исходный кадр, удержанный в четырёх ячейках; это явно отмечено в манифесте. Репозиторий пока не содержит игровой код, поэтому подключение и проверка FPS в игре ещё не выполнялись.
