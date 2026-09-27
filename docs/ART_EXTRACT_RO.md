# Графика из Ragnarok Online для главы 1 — что извлечь

Цель: закрыть главу 1 «Зелёные луга» настоящей графикой RO (права на арт — у владельца, см. `assets/ro/README.md`).
Формат сдачи — как уже принято в репозитории: спрайты — лист v2 (`docs/SPRITE_SPEC.md`, `assets/sprites/sprites.json`),
эффекты — ленты кадров (`assets/effects/README.md`, `effects.json`), иконки — PNG в `assets/ui/icons/`.

Где искать в клиенте / roBrowser (пути GRF, корейские папки как в клиенте):

| Что | Путь в data.grf | Таблица соответствий в roBrowserLegacy |
| --- | --- | --- |
| Монстры (.spr/.act) | `data/sprite/몬스터/<имя>.spr` | `DB/Monsters/MonsterTable.js` (id → имя спрайта) |
| Иконки навыков | `data/texture/유저인터페이스/item/<skill>.bmp` | `DB/Skills/SkillInfo.js` (id → имя навыка/иконки) |
| Иконки предметов | `data/texture/유저인터페이스/item/<res>.bmp`, крупные — `.../collection/<res>.bmp` | `DB/Items/ItemTable.js` (`identifiedResourceName`) |
| Иконки статусов (баффы) | `data/texture/effect/*.tga` | `DB/Status/StatusInfo.js` (SI_* → иконка) |
| Эффекты навыков | через EffectViewer, как в PR #3 | `DB/Effects/EffectTable.js` (EF_* → кадры) |

Имена файлов ниже — ориентир по таблицам roBrowser; точное имя сверять там (особенно у эффектов).

**Уже есть в старом формате.** `assets/ro/sheets` (v1, ×2–7 в клетках 320/480 px) — без сети конвертируется в v2:
`python tools/build_sprites_v2.py --from-v1` (`tools/ro_v1_to_v2.py`: снимает целочисленное увеличение и тень RO,
восстанавливает точку ACT по эллипсу тени, кадры, не влезающие в клетку при ×1, пропускает). Так получены шесть вторых
профессий, Raydric, Mimic, Gargoyle, Dark Priest, Mistress, Osiris, Moonlight Flower, Drake, Dark Lord. Из рендерера
(`fetch_sprites_v2.py`) их стоит перерендерить, когда будет сеть: у героев v1 нет ходьбы/каста, у всех — точные якоря.

---

## 1. Монстры (спрайты v2, класс monster/boss)

Сейчас в главе: Поринг (есть), Дропс и Попоринг (перекрашенный поринг — лучше свои спрайты), Ожившая ива (есть),
босс — Мастеринг (Золотой жук-вор и Герой орков — MVP RO, в главах 1–3 не появляются, только в поздней Башне). Нужно для полноценной главы — поля Пронтеры/Пайона:

| Приоритет | Монстр RO | ID | Спрайт (`data/sprite/몬스터/`) | Роль в главе |
| --- | --- | --- | --- | --- |
| 1 | Drops | 1113 | `drops` | этапы 3–7, заменить перекраску |
| 1 | Poporing | 1031 | `poporing` | этапы 4–9 (яд), заменить перекраску |
| 1 | Fabre | 1007 | `fabre` | этапы 1–3, слабейший враг (гусеница) |
| 1 | Lunatic | 1063 | `lunatic` | этапы 2–5, быстрый кролик |
| 1 | Mandragora | 1020 | `mandragora` | **дальний враг** (неподвижное растение, бьёт издалека) — в главе сейчас нет дальних |
| 1 | Rocker | 1052 | `rocker` | этапы 5–8, кузнечик |
| 1 | **Mastering** (мини-босс) | 1090 | `mastering` | **босс главы 1** — огромный поринг, идеально к лугу |
| 2 | Pupa | 1008 | `pupa` | «танк»-кокон (почти не бьёт, много HP) |
| 2 | Chonchon | 1011 | `chonchon` | быстрая муха, этапы 3–6 |
| 2 | Spore | 1014 | `spore` | гриб, этапы 6–9 (лесная часть) |
| 2 | Roda Frog | 1012 | `roda_frog` | лягушка у ручья (этап «Лесной ручей») |
| 2 | Eclipse (мини-босс) | 1093 | `eclipse` | альтернативный босс / редкий этап |
| 2 | Vocal (мини-босс) | 1088 | `vocal` | элита этапа 8–9 вместо Золотого жука |
| 3 | Savage Babe | 1167 | `savage_babe` | кабанёнок, лес |
| 3 | Hornet | 1004 | `hornet` | оса |
| 3 | Creamy | 1018 | `creamy` | бабочка (дальний/магический) |
| 3 | Smokie, Yoyo | 1056, 1057 | `smokie`, `yoyo` | лесные зверьки для ч. 1–2 |

Герой орков (`orc_hero`, 1087) — босс этажа 60+ Башни; боссы глав 2–3 — мини-боссы (Древняя ива, Верховный жрец),
MVP RO (Golden Thief Bug, Бафомет, Тёмный лорд, Осирис, Дрейк, Лунный цветок, Мистресс) — только Башня с 40 этажа.

### 1.1. Монстры и мини-боссы глав 2–3 — что запросить (замена временных листов)

Владелец: «переборщил с эпичностью монстров» — в ранних главах только монстры своего уровня и мини-боссы, как стартовые
поля и подземелья RO. Пока своих листов нет, главы 2–3 стоят на временных (перекраска + `scale`, см.
`docs/content/campaign.md`, «Главы 2–3»). Что извлечь, чтобы заменить временные листы (id листа — как предложено для
`assets/sprites/sprites.json`; юнит менять не нужно, только `visual.sprite` и убрать `tint`/`scale`):

| Приоритет | Монстр RO | ID | Спрайт (`data/sprite/몬스터/`) | Кого заменит (сейчас) |
| --- | --- | --- | --- | --- |
| 1 | **Elder Willow** (Древняя ива) | 1033 | `elder_willow` | босс главы 2 `mob2_boss` (лист Ивы ×1.6 + tint) |
| 1 | **Toad** (мини-босс, жаба) | 1089 | `toad` | элита топей `mob2_elite` Утопленник (Зомби ×1.2) или второй мини-босс топей |
| 1 | Thief Bug (обычный жук) | 1051 | `thief_bug` | `mob2_fast` Болотный кузнечик (Рокер ×0.55) — «Болотный жук» с нормальным листом |
| 1 | Roda Frog / Thara Frog | 1012 / 1034 | `roda_frog`, `thara_frog` | монстры топей вместо Болотного зомби `mob2_melee` |
| 1 | **Dullahan** (безголовый рыцарь) | 1504 | `dullahan` | кандидат в босса главы 3 `mob3_boss` («Рыцарь-призрак»; сейчас Тёмный жрец ×1.5) |
| 1 | **Khalitzburg** (рыцарь-скелет) | 1132 | `khalitzburg` | элита/мини-босс Гласт Хейма, «Рыцарь у моста» |
| 1 | Ghoul | 1036 | `ghoul` | Костяной зомби `mob3_melee` (сейчас Зомби + tint) |
| 2 | **Vagabond Wolf** (мини-босс) | 1092 | `vagabond_wolf` | мини-босс Башни (болотный ярус, этажи 20/25; сейчас Попоринг-великан) |
| 2 | **Evil Druid** | 1117 | `evil_druid` | «Верховный жрец»/некромант главы 3 или мини-босс Башни 40+ |
| 2 | Hydra | 1068 | `hydra` | неподвижный дальний враг топей (вместо Скелета-лучника топей) |
| 2 | Wraith, Whisper | 1192, 1179 | `wraith`, `whisper` | призраки главы 3 |
| 3 | Mummy | 1041 | `mummy` | танк склепа (разнообразие к Рейдрику) |

Листы MVP (`elite` Golden Thief Bug 1086, `boss1` Orc Hero 1087, `boss2` Baphomet 1039, `dark_lord` 1272, `osiris`,
`drake`, `moonlight_flower`, `mistress`) в главах 1–3 не использовать — тест `tests/chapters.test.ts` это проверяет.

Анимации монстра и босса в текущей schema 2 — по `SPRITE_SPEC.md`: idle, walk,
attack, hurt, death. Cast для боссов пока не предусмотрен текущим реестром;
не подменять его повтором атаки без отдельной смены схемы.

---

## 2. Иконки навыков (128×128 PNG → `assets/ui/icons/skill_<id>.png`)

Имена в RO — id навыка в нижнем регистре (как в `SkillInfo.js`).

| Профессия | Навык в игре | Навык RO | Иконка RO |
| --- | --- | --- | --- |
| Новичок | Первая помощь | First Aid | `nv_firstaid` |
| Мечник | Удар мечом | Bash | `sm_bash` |
| Мечник | Стойкость | Endure | `sm_endure` |
| Мечник | Магнум брейк | Magnum Break | `sm_magnum` |
| Мечник | Восстановление HP | Increase HP Recovery | `sm_recovery` |
| Мечник | Провокация | Provoke | `sm_provoke` |
| Вор | Отравление | Envenom | `tf_poison` |
| Вор | Уклонение | Improve Dodge | `tf_miss` |
| Вор | Кража | Steal | `tf_steal` |
| Вор | Двойная атака | Double Attack | `tf_double` |
| Вор | Песок в глаза | Sand Attack | `tf_sprinklesand` |
| Лучник | Двойной выстрел | Double Strafe | `ac_double` |
| Лучник | Совиный глаз | Owl's Eye | `ac_owl` |
| Лучник | Дождь стрел | Arrow Shower | `ac_shower` |
| Лучник | Глаз стервятника | Vulture's Eye | `ac_vulture` |
| Лучник | Отталкивающая стрела | Charge Arrow | `ac_chargearrow` |
| Маг | Огненная стрела | Fire Bolt | `mg_firebolt` |
| Маг | Восстановление SP | Increase SP Recovery | `mg_srecovery` |
| Маг | Ледяной удар | Frost Diver | `mg_frostdiver` |
| Маг | Энергетический покров | Energy Coat | `mg_energycoat` |
| Маг | Гроза | Thunderstorm | `mg_thunderstorm` |
| Аколит | Исцеление | Heal | `al_heal` |
| Аколит | Божья защита | Divine Protection | `al_dp` |
| Аколит | Благословение | Blessing | `al_blessing` |
| Аколит | Святой свет | Holy Light | `al_holylight` |
| Аколит | Ускорение | Increase AGI | `al_incagi` |
| Аколит | Святилище | Sanctuary | `pr_sanctuary` |
| Торговец | Маммонит | Mammonite | `mc_mammonite` |
| Торговец | Тележка | Pushcart | `mc_pushcart` |
| Торговец | Удар тележкой | Cart Revolution | `mc_cartrevolution` |
| Торговец | Громкий голос | Crazy Uproar | `mc_loud` |
| Торговец | Наценка | Overcharge | `mc_overcharge` |

Вторые профессии (Рыцарь, Жрец, Волшебник и т. д.) — тем же способом по `SkillInfo.js`, когда дойдём до главы 2.

---

## 3. Иконки предметов (все названия — реальные предметы RO)

Маленькая иконка `item/<res>.bmp` (24×24, увеличить до 96×96 nearest) → `assets/ui/icons/item_<id>.png`;
по желанию крупная картинка `collection/<res>.bmp` для карточки предмета.

| Слот | Предметы в игре (id → предмет RO) |
| --- | --- |
| Оружие (13) | knife → Knife, dagger → Dagger, sword → Sword, bow → Bow, rod → Rod, gladius → Gladius, composite_bow → Composite Bow, staff → Staff, mace → Mace, claymore → Claymore, arbalest → Arbalest, katar → Katar, wizardry_staff → Wizardry Staff |
| Доспех (6) | cotton_shirt → Cotton Shirt, adventurers_suit → Adventurer's Suit, chain_mail → Chain Mail, silk_robe → Silk Robe, full_plate → Full Plate, saint_robe → Saint's Robe |
| Шлем (5) | bandana → Bandana, cap → Cap, helm → Helm, biretta → Biretta, crown → Crown |
| Обувь (5) | sandals → Sandals, shoes → Shoes, boots → Boots, greaves → Greaves, sleipnir → Sleipnir |

Плюс для наград: Zeny (золото), Jellopy (выпадает с порингов — красиво на экране итогов), Red Potion.

---

## 4. Иконки статусов (баффы/дебаффы, `data/texture/effect/`, по `StatusInfo.js`)

| Статус в игре | SI_* в RO |
| --- | --- |
| Благословение | SI_BLESSING |
| Ускорение | SI_INC_AGI |
| Стойкость | SI_ENDURE |
| Провокация | SI_PROVOKE |
| Энергетический покров | SI_ENERGYCOAT |
| Яд | SI_POISON |
| Оглушение | SI_STUN |
| Заморозка (Ледяной удар) | SI_FREEZE |
| Божья защита / Ассумптио / Кирие | SI_ASSUMPTIO, SI_KYRIE (для глав 2+) |

---

## 5. Эффекты навыков (EffectViewer, как 6 базовых в PR #3)

Имена EF_* — ориентир, сверить по `EffectTable.js`. Для главы 1 достаточно первых профессий:

| Навык | Эффект RO |
| --- | --- |
| Удар мечом | EF_BASH |
| Магнум брейк | EF_MAGNUMBREAK |
| Провокация | EF_PROVOKE |
| Стойкость | EF_ENDURE |
| Огненная стрела | EF_FIREBOLT (снаряд) + попадание огнём |
| Ледяной удар | EF_FROSTDIVER (+ EF_FROZEN на цели) |
| Гроза | EF_THUNDERSTORM |
| Святой свет | EF_HOLYLIGHT |
| Благословение | EF_BLESSING |
| Ускорение | EF_INCAGILITY |
| Святилище | EF_SANCTUARY |
| Двойной выстрел | EF_DOUBLESTRAFE (или 2 × стрела) |
| Дождь стрел | EF_ARROWSHOWER |
| Отравление | EF_ENVENOM / EF_POISONHIT |
| Кража | EF_STEAL |
| Песок в глаза | EF_SANDATTACK |
| Маммонит | EF_MAMMONITE (монеты) |
| Удар тележкой | EF_CARTREVOLUTION |
| Первая помощь | EF_FIRSTAID |
| Прыжок поринга / Ядовитая слизь | EF_HIT2 / EF_POISONHIT |
| Смерть босса | EF_DEVIL (уже есть) + крупнее |

Привязка к навыкам — в `assets/effects/effects.json` → `skills`: `{"swordman_bash": {"hit": "fx_bash"}}`.

---

## 6. Прочее для главы 1

- Портреты монстров для экрана этапа — игра вырезает из кадра idle, отдельно не нужны.
- Звуки (из `data/wav/`): удар `_hit_sword.wav`/`_hit_dagger.wav`, магия, лечение `_heal_effect.wav`, смерть поринга,
  победа/поражение; музыка — поле Пронтеры (`bgm/12.mp3` — «Streamside») для луга, босс — отдельная тема. Звука в игре пока нет:
  когда файлы появятся, подключу.
