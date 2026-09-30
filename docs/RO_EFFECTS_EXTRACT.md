# Эффекты навыков из клиента RO — что есть и что извлечь (30.09)

Правило (жалоба владельца «Маммонит — это большой мешок над головой»): навык получает атлас RO, только если это ЕГО
эффект в клиенте RO. Прежние агенты подставляли атласы чужих навыков (Маммонит — Кража, Удар Асуры — Клеймор, Стальное
тело — Защита крестоносца, Лекс Этерна — Развеивание…). 30.09 снято 54 подстановки (20 у героев, 34 у монстров);
без своего атласа навык рисуется прежним процедурным эффектом (`src/game/skillVisuals.ts`), без чужой картинки.
Сторож — `tests/effects-ro-origin.test.ts`: белый список «навык игры → навык RO → id эффектов клиента»; атлас с другим
`source.roEffectId` роняет тест. Новая привязка — сначала строка в белый список.

Источники: roBrowserLegacy `src/DB/Skills/SkillEffect.js` (какие эффекты показывает навык: effectId, effectIdOnCaster,
hitEffectId, beforeHitEffectId — снаряд, successEffectId, groundEffectId), `src/DB/Effects/EffectTable.js` (из чего
эффект: STR — `data\texture\effect\<имя>.str` + текстуры рядом; SPR — `data\sprite\이팩트\<имя>.spr/.act`; 3D / 2D /
CYLINDER / QuadHorn / FUNC — рисуется кодом клиента из текстур `data\texture\effect\*.tga|bmp`, тогда брать эти текстуры
и снимать кадры EffectViewer), `src/DB/Effects/EffectConst.js` (имя EF_…), `src/DB/Skills/SkillConst.js` = id skill_db
rAthena. Звук — поле `wav` (`data\wav\<путь>.wav`). «Проверить» — roBrowser не описывает картинку, искать файл в GRF
по имени (как `adrenaline.str`, `autocounter.str` в части 5).

Как снимать и собирать — `raw/ro-build/tools/fx/README.md` (EffectViewer + локальный remote client из GRF scRO,
`capture_effect.mjs --str <файл>` для STR без записи в roBrowser, `build_spr_fx.py` для SPR), подключать — рецепт 12а
`docs/CONTENT_RECIPES.md`.

## Маммонит

MC_MAMMONITE (skill_db 42): `effectId: 10` → EF_COIN: STR `data\texture\effect\maemor.str` (упрощённая версия
`memor_min`), звук `data\wav\effect\ef_coin2.wav`, привязан к цели. В кадрах — торговец с большим мешком денег над
целью, вспышка и разлетающиеся монеты. Владелец уже снял его (`raw/ro-build/effects/p1`, `fx_job_merchant_mammonite`),
30.09 подключено: `effects.json → skills.job_merchant_mammonite = { hit: fx_job_merchant_mammonite }`.

## Что извлечь первым

Ульты героев без своего эффекта (по убыванию пользы):
1. Удар Асуры (Тео, монах) — MO_EXTREMITYFIST 271: 328 EF_BEGINASURA (текстуры `effect\asura1.tga`, `asura2.tga`,
   CYLINDER, тряска) + попадание 266 EF_TEIHIT1X (`effect\lens1.tga` ×24), звук `effect\mon_아수라 패황권.wav`. Код клиента — снять EffectViewer 328 и 266.
2. Стальное тело (Вика, монах) — MO_STEELBODY 268: 254 EF_STEELBODY (картинку roBrowser не рисует — проверить в GRF), звук `effect\mon_금강불괴.wav`.
3. Удар тележкой мастера (Грета, кузнец) — WS_CARTTERMINATION 485: 518 EF_CARTTER (нет в EffectViewer — проверить в GRF, например `cart*.str`).
4. Метеоритный удар (Дорн, ассасин) — ASC_METEORASSAULT 406: 409 EF_SOULBREAKER2 (3D `effect\purpleslash.tga`), звук `effect\메테오 어썰트.wav`.
5. Небесный удар (Кай, мудрец) — WZ_HEAVENDRIVE 91: 142 (код, QuadHorn — прежний захват отклонён) + попадание 147 EF_EARTHHIT: STR `earthhit.str` — снять 147 (то же попадание у Земляного шипа).
6. Вулкан (Лира, мудрец) — SA_VOLCANO 285: на кастере 225 EF_VOLCANO (проверить), на земле 239 EF_BOTTOM_VO (код; захват 239 бледный — отклонён).
7. Кислотный всплеск (Отто, алхимик) — CR_ACIDDEMONSTRATION 490: 537 EF_ACIDDEMON (FUNC; прошлый захват пустой — проверить в GRF).
8. Атака сокола (Бран, охотник) — SN_FALCONASSAULT 381: 387 EF_FALCONASSAULT (FUNC, сокол — спрайт `data\sprite\이팩트\…` проверить), звук `effect\hunter_blitzbeat.wav`.
9. Спиральный пронзатель (Ирис, рыцарь) — LK_SPIRALPIERCE 397: 339 EF_MAGNUM2 (код), звуки `permeter_attack.wav`, `effect\ef_magnumbreak.wav`.
10. Закат ассасина (Бран, бард) и Поцелуй удачи (Мэйлин, танцовщица) — 287 / 293: песни в roBrowser — FUNC + метка клетки 32×32; звуки есть. Проверить в GRF STR песен.
11. Песок в глаза (Дорн, вор) — TF_SPRINKLESAND 149: 310 EF_SPRINKLESAND (нет в EffectViewer — проверить в GRF).

Частые активные навыки без своего эффекта:
1. Попадания стихий — один раз на много навыков: 51 EF_COLDHIT (2D `effect\ice.tga`; Ледяная стрела, Снежная буря,
   Кольцо мороза), 52 EF_WINDHIT (STR `windhit1..3.str`; Гроза), 147 EF_EARTHHIT (STR `earthhit.str`; Земляной шип, Небесный удар), 122 EF_SONICBLOWHIT и 121 EF_SONICBLOW (Звуковой удар).
2. Святилище — PR_SANCTUARY 70: 83 EF_SANCTUARY STR `sanctuary.str` (снять 83; клетка 319 — узкая колонна, мало).
3. Магический жезл — SA_MAGICROD 276: 244 EF_MAGICROD STR `매직로드.str`.
4. Мощный удар — BS_OVERTHRUST 113: 128 EF_OVERTHRUST (картинка — код; проверить в GRF), звук `effect\black_overthrust.wav`.
5. Налёт — RG_RAID 214: 276 EF_TEIHIT3 (3D `effect\lens1.tga`); Удар в спину — RG_BACKSTAP 212: 275 (только звук `effect\rog_back stap.wav`).
6. Тройная атака — MO_TRIPLEATTACK 263: 329 (звуки ef_hit2/ef_hit4); Проникающий удар — MO_INVESTIGATE 266: 267 EF_CHIMTO (звук `effect\mon_침투경.wav`).
7. Удар сокола — HT_BLITZBEAT 129: 115 (сокол, проверить), звук `effect\hunter_blitzbeat.wav`.
8. Трясина — WZ_QUAGMIRE 92: 95 STR `quagmire.str` — захват был слишком бледным, переснять ярче/крупнее.
9. Усиление магии — HW_MAGICPOWER 366: 16 на касте (есть `fx_swordman_bash`) + `ef_magicpower` (проверить).
10. Химическая защита — AM_CP_ARMOR 236: 300; Метание зелья — AM_POTIONPITCHER 231: 299 EF_THROWITEM2; Кислотный
    террор — AM_ACIDTERROR 230: 298 (3D, иконка `유저인터페이스\item\염산병.bmp`; нынешний захват отклонён — бледный).
11. Крик — DC_SCREAM 326: 296 EF_TALK_SCREAM (FUNC — надпись над головой, проверить).

Уже извлечено, но не подключено (решение по виду): Трясина `fx_job_wizard_quagmire` (бледная), Святилище/Магнус на
земле (узкая колонна 40 px), Вулкан `fx_job_sage_volcano` (бледная «корона»), Дождь стрел `fx_job_archer_arrow_shower`
(1 кадр), снаряды Огненной стрелы и Frost Diver (`*_projectile`, у нас есть свои решения), ауры каста по стихиям
`fx_cast_*` (часть 3 — нужна правка кода castLoop), перезахват 30 листов из клиента scRO (часть 2, `replace`) — даст
более полные кадры тем же навыкам, но потребует новой подстройки scale.

## Все навыки героев (12 героев × 3 формы)

Формат: `id` Имя — навык RO (id skill_db). Что показывает клиент. Статус: есть (роль: атлас) / ИЗВЛЕЧЬ / не нужно
(пассивка — в RO картинки нет).

### Алан

Мечник (`swordman`):

- `swordman_bash` Баш — SM_BASH (skill_db id 5). начало каста 16 EF_BASH: CYLINDER, звук effect/ef_bash.wav; CYLINDER; попадание 1 EF_HIT2: 2D effect/lens1.tga, звук effect/ef_hit2.wav; 2D effect/lens2.tga; 2D effect/lens1.tga. Статус: есть — cast: `fx_swordman_bash`.
- `swordman_endure` Стойкость — SM_ENDURE (skill_db id 8). эффект 11 EF_ENDURE: 3D effect/endure.tga, звук effect/ef_endure.wav. Статус: есть — buff: `fx_swordman_endure`.
- `job_swordman_hp_recovery` Восстановление ОЗ — SM_RECOVERY (skill_db id 4). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_swordman_provoke` Провокация — SM_PROVOKE (skill_db id 6). при успехе 67 EF_PROVOKE: STR data\texture\effect\provoke.str, звук effect/swordman_provoke.wav. Статус: есть — debuff: `fx_job_swordman_provoke`.

Рыцарь (`knight`):

- `job_knight_bowling_bash` Боулинг Баш — KN_BOWLINGBASH (skill_db id 62). на кастере 149 EF_BOWLINGSELF: STR data\texture\effect\bowling.str, звук _enemy_hit_normal1.wav; попадание 1 EF_HIT2: 2D effect/lens1.tga, звук effect/ef_hit2.wav; 2D effect/lens2.tga; 2D effect/lens1.tga. Статус: есть — cast: `fx_job_knight_bowling_bash`.
- `job_swordman_provoke` Провокация — см. выше. Статус: есть — debuff: `fx_job_swordman_provoke`.
- `job_knight_auto_counter` Контратака — KN_AUTOCOUNTER (skill_db id 61). 131 EF_AUTOCOUNTER: STR data\texture\effect\autocounter.str, звук effect/knight_autocounter.wav. Статус: есть — cast: `fx_job_knight_auto_counter`.
- `job_knight_parrying` Парирование — LK_PARRYING (skill_db id 356). эффект 336 EF_GUARD: звук effect/kyrie_guard.wav; CYLINDER. Статус: есть — buff: `fx_job_knight_parrying`.

Крестоносец (`crusader`):

- `job_crusader_devotion` Самопожертвование — CR_DEVOTION (skill_db id 255). эффект 251 EF_DEVOTION: STR data\texture\effect\devotion.str. Статус: есть — buff: `fx_job_crusader_devotion`.
- `job_crusader_faith` Вера — CR_TRUST (skill_db id 248). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_crusader_auto_guard` Автозащита — CR_AUTOGUARD (skill_db id 249). эффект 336 EF_GUARD: звук effect/kyrie_guard.wav; CYLINDER. Статус: есть — buff: `fx_job_knight_parrying`.
- `job_crusader_defender` Защита — CR_DEFENDER (skill_db id 257). эффект 222 EF_DEFENDER: CYLINDER. Статус: есть — buff: `fx_job_crusader_defender`.


### Бран

Лучник (`archer`):

- `job_archer_double_strafe` Двойной выстрел — AC_DOUBLE (skill_db id 46). начало каста 16 EF_BASH (CYLINDER, звук effect/ef_bash.wav); стрела 'ef_arrow_projectile'; попадание 1 EF_HIT2 (2D effect/lens1.tga, звук effect/ef_hit2.wav). Статус: есть по правилу боя — стрела `fx_arrow`, попадание `fx_hit`; вспышку каста 16 можно дать атласом `fx_swordman_bash`.
- `job_archer_owls_eye` Совиный глаз — AC_OWL (skill_db id 43). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_archer_vultures_eye` Глаз стервятника — AC_VULTURE (skill_db id 44). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_archer_charge_arrow` Заряженная стрела — AC_CHARGEARROW (skill_db id 148). стрела 'ef_arrow_projectile' (без своей картинки). Статус: есть по правилу боя — `fx_arrow`.

Охотник (`hunter`):

- `job_hunter_blitz_beat` Удар сокола — HT_BLITZBEAT (skill_db id 129). эффект 115 EF_BLITZBEAT: звук effect/hunter_blitzbeat.wav. Статус: ИЗВЛЕЧЬ.
- `job_hunter_beast_bane` Гроза зверей — HT_BEASTBANE (skill_db id 126). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_hunter_steel_crow` Стальной сокол — HT_STEELCROW (skill_db id 128). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_hunter_falcon_assault` Атака сокола — SN_FALCONASSAULT (skill_db id 381). эффект 387 EF_FALCONASSAULT: звук effect/hunter_blitzbeat.wav; FUNC. Статус: ИЗВЛЕЧЬ.

Бард (`bard`):

- `job_bard_musical_strike` Музыкальный удар — BA_MUSICALSTRIKE (skill_db id 316). стрела 'ef_arrow_projectile' (без своей картинки). Статус: есть по правилу боя — `fx_arrow`.
- `job_bard_poem_of_bragi` Поэма Браги — BA_POEMBRAGI (skill_db id 321). эффект 288 EF_BOTTOM_POEMBRAGI: звук effect/브라기의 시.wav; на земле 288_ground : FUNC. Статус: ИЗВЛЕЧЬ.
- `job_bard_apple_of_idun` Яблоко Идун — BA_APPLEIDUN (skill_db id 322). эффект 289 EF_BOTTOM_APPLEIDUN: звук effect/이둔의 사과.wav; на земле 289_ground : FUNC. Статус: ИЗВЛЕЧЬ.
- `job_bard_assassin_cross` Закат ассасина — BA_ASSASSINCROSS (skill_db id 320). эффект 287 EF_BOTTOM_ASSASSINCROSS: звук effect/석양의 어쌔신.wav; на земле 287_ground : FUNC. Статус: ИЗВЛЕЧЬ.


### Дорн

Вор (`thief`):

- `job_thief_steal` Кража — TF_STEAL (skill_db id 50). при успехе 18 EF_STEAL: 3D effect/pok1.tga; звук effect/ef_steal.wav. Статус: есть — hit: `fx_job_thief_steal`.
- `job_thief_improve_dodge` Уклонение — TF_MISS (skill_db id 49). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_thief_double_attack` Двойная атака — TF_DOUBLE (skill_db id 48). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_thief_sand_attack` Песок в глаза — TF_SPRINKLESAND (skill_db id 149). эффект 310 EF_SPRINKLESAND — в EffectTable roBrowser нет, проверить. Статус: ИЗВЛЕЧЬ.

Ассасин (`assassin`):

- `job_assassin_sonic_blow` Звуковой удар — AS_SONICBLOW (skill_db id 136). на кастере 121 EF_SONICBLOW: 3D effect/ring2.bmp, звук effect/ef_stonecurse.wav; эффект 143 EF_SONICBLOW2: STR data\texture\effect\sonicblow.str; попадание 122 EF_SONICBLOWHIT: FUNC, звук effect/assasin_sonicblow.wav. Статус: есть — hit: `fx_job_assassin_sonic_blow`.
- `job_assassin_katar_mastery` Мастерство катара — AS_KATAR (skill_db id 134). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_thief_double_attack` Двойная атака — см. выше. Статус: не нужно.
- `job_assassin_meteor_assault` Метеоритный удар — ASC_METEORASSAULT (skill_db id 406). на кастере 409 EF_SOULBREAKER2: звук effect/메테오 어썰트.wav; 3D effect/purpleslash.tga. Статус: ИЗВЛЕЧЬ.

Разбойник (`rogue`):

- `job_rogue_raid` Налёт — RG_RAID (skill_db id 214). на кастере 276 EF_TEIHIT3: 3D effect/lens1.tga. Статус: ИЗВЛЕЧЬ.
- `job_rogue_plagiarism` Плагиат — RG_PLAGIARISM (skill_db id 225). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_thief_improve_dodge` Уклонение — см. выше. Статус: не нужно.
- `job_rogue_strip_weapon` Разоружение — RG_STRIPWEAPON (skill_db id 215). при успехе 269 EF_STRIPWEAPON: STR data\texture\effect\strip_weapon.str, звук effect/t_벽튕김.wav. Статус: есть — debuff: `fx_job_rogue_strip_weapon`.


### Грета

Торговец (`merchant`):

- `job_merchant_mammonite` Маммонит — MC_MAMMONITE (skill_db id 42). эффект 10 EF_COIN: STR data\texture\effect\maemor.str, звук effect/ef_coin2.wav. Статус: есть — hit: `fx_job_merchant_mammonite`.
- `job_merchant_crazy_uproar` Громкий голос — MC_LOUD (skill_db id 155). эффект 311 EF_LOUD: STR data\texture\effect\loud.str, звук effect/고성방가.wav. Статус: есть — buff: `fx_job_merchant_crazy_uproar`.
- `job_merchant_frying_pan` Удар сковородой — MC_FRYINGPAN. в RO такого навыка нет (придуманный навык, значок свой). Статус: не извлекать.
- `job_merchant_overcharge` Наценка — MC_OVERCHARGE (skill_db id 38). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.

Кузнец (`blacksmith`):

- `job_merchant_frying_pan` Удар сковородой — см. выше. Статус: не извлекать.
- `job_blacksmith_power_thrust` Мощный удар — BS_OVERTHRUST (skill_db id 113). эффект 128 EF_OVERTHRUST: звук effect/black_overthrust.wav. Статус: ИЗВЛЕЧЬ.
- `job_blacksmith_hammer_fall` Удар молота — BS_HAMMERFALL (skill_db id 110). эффект 102 EF_CRASHEARTH: STR data\texture\effect\crashearth.str, звук effect/black_hammerfall.wav; FUNC. Статус: есть — ground: `fx_job_blacksmith_hammer_fall`.
- `job_blacksmith_cart_termination` Удар тележкой мастера — WS_CARTTERMINATION (skill_db id 485). эффект 518 EF_CARTTER — в EffectTable roBrowser нет, проверить. Статус: ИЗВЛЕЧЬ.

Алхимик (`alchemist`):

- `job_alchemist_potion_pitcher` Метание зелья — AM_POTIONPITCHER (skill_db id 231). эффект 299 EF_THROWITEM2 — в EffectTable roBrowser нет, проверить. Статус: ИЗВЛЕЧЬ.
- `job_alchemist_chemical_protection` Химическая защита — AM_CP_ARMOR (skill_db id 236). эффект 300 EF_CHEMICALPROTECTION: звук apocalips_attack.wav. Статус: ИЗВЛЕЧЬ.
- `job_merchant_frying_pan` Удар сковородой — см. выше. Статус: не извлекать.
- `job_alchemist_slim_potion` Белые зелья — CR_SLIMPITCHER (skill_db id 478). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.


### Ирис

Мечник (`swordman`):

- `job_swordman_magnum_break` Магнум Брейк — SM_MAGNUM (skill_db id 7). на кастере 17 EF_MAGNUMBREAK: CYLINDER; CYLINDER, звук effect/ef_magnumbreak.wav; эффект quake_magnum  — в EffectTable roBrowser нет, проверить. Статус: есть — cast: `fx_job_swordman_magnum_break`.
- `job_knight_two_hand_mastery` Владение двуручным мечом — SM_TWOHAND (skill_db id 3). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `swordman_bash` Баш — см. выше. Статус: есть — cast: `fx_swordman_bash`.
- `job_swordman_auto_berserk` Авто-Берсерк — SM_AUTOBERSERK (skill_db id 146). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.

Рыцарь (`knight`):

- `job_knight_charge_attack` Атака с разбега — KN_CHARGEATK (skill_db id 1001). начало каста white_pulse  — в EffectTable roBrowser нет, проверить; попадание enemy_hit_normal1  — в EffectTable roBrowser нет, проверить. Статус: ИЗВЛЕЧЬ.
- `job_knight_two_hand_quicken` Двуручная спешка — KN_TWOHANDQUICKEN (skill_db id 60). эффект 130 EF_TWOHANDQUICKEN: STR data\texture\effect\twohand.str, звук effect/knight_twohandquicken.wav. Статус: есть — buff: `fx_job_knight_two_hand_quicken`.
- `job_knight_two_hand_mastery` Владение двуручным мечом — см. выше. Статус: не нужно.
- `job_knight_spiral_pierce` Спиральный пронзатель — LK_SPIRALPIERCE (skill_db id 397). начало каста 339_beforecast EF_MAGNUM2: FUNC; эффект 339 EF_MAGNUM2: звук permeter_attack.wav; звук effect/ef_magnumbreak.wav; попадание spear_hit_sound  — в EffectTable roBrowser нет, проверить. Статус: ИЗВЛЕЧЬ.

Крестоносец (`crusader`):

- `job_crusader_holy_cross` Святой крест — CR_HOLYCROSS (skill_db id 253). эффект 245 EF_HOLYCROSS: STR data\texture\effect\holy_cross.str, звук effect/cru_holy cross.wav. Статус: есть — hit: `fx_job_crusader_holy_cross`.
- `job_crusader_shield_charge` Удар щитом — CR_SHIELDCHARGE (skill_db id 250). эффект 246 EF_SHIELDCHARGE: STR data\texture\effect\shield_charge.str. Статус: есть — hit: `fx_job_crusader_shield_charge`.
- `job_crusader_faith` Вера — см. выше. Статус: не нужно.
- `job_crusader_grand_cross` Великий крест — CR_GRANDCROSS (skill_db id 254). эффект 226 EF_GRANDCROSS: CYLINDER; звук effect/cru_grand cross.wav. Статус: есть — ground: `fx_job_crusader_grand_cross`.


### Кай

Маг (`mage`):

- `job_mage_fire_bolt` Огненная стрела — MG_FIREBOLT (skill_db id 19). снаряд 'ef_firebolt' (3D-стрелы огня, проверить текстуру); попадание 49 EF_FIREHIT: STR data\texture\effect\firehit%d.str (1–3), звук effect/ef_firehit.wav. Статус: есть — hit: `fx_job_mage_fire_bolt`.
- `job_mage_sp_recovery` Восстановление SP — MG_SRECOVERY (skill_db id 9). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_mage_fire_ball` Огненный шар — MG_FIREBALL (skill_db id 17). снаряд 24 EF_FIREBALL: 3D; звук effect/ef_fireball.wav; попадание 49 EF_FIREHIT: STR data\texture\effect\firehit%d.str, звук effect/ef_firehit.wav. Статус: есть — hit: `fx_job_mage_fire_bolt`, projectile: `fx_job_mage_fire_ball_projectile`.
- `job_mage_thunderstorm` Гроза — MG_THUNDERSTORM (skill_db id 21). эффект 30 EF_THUNDERSTORM: STR data\texture\effect\thunderstorm.str, звук effect/magician_thunderstorm.wav; попадание 52 EF_WINDHIT: STR data\texture\effect\windhit%d.str, звук _hit_fist%d.wav. Статус: есть — hit: `fx_job_mage_thunderstorm`.

Волшебник (`wizard`):

- `job_wizard_jupitel_thunder` Гром Юпитера — WZ_JUPITEL (skill_db id 84). эффект 93 EF_YUFITEL: звук effect/hunter_shockwavetrap.wav; 3D effect/thunder_center.bmp; 3D; снаряд 94 EF_YUFITELHIT: 3D effect/thunder_pang.bmp; 3D. Статус: есть — projectile: `fx_job_wizard_jupitel_thunder_projectile`, hit: `fx_job_wizard_jupitel_thunder_target`.
- `job_wizard_mystical_amplification` Усиление магии — HW_MAGICPOWER (skill_db id 366). начало каста 16 EF_BASH: CYLINDER, звук effect/ef_bash.wav; CYLINDER; эффект ef_magicpower  — в EffectTable roBrowser нет, проверить. Статус: ИЗВЛЕЧЬ.
- `job_wizard_soul_drain` Поглощение души — HW_SOULDRAIN (skill_db id 364). на кастере 217 EF_ENERGYDRAIN: 3D; FUNC. Статус: есть — cast: `fx_job_wizard_soul_drain`.
- `job_wizard_meteor_storm` Метеоритный дождь — WZ_METEOR (skill_db id 83). эффект 92 EF_METEORSTORM: STR data\texture\effect\meteor%d.str, звук effect/wizard_meteor.wav; FUNC; попадание 49 EF_FIREHIT: STR data\texture\effect\firehit%d.str, звук effect/ef_firehit.wav. Статус: есть — ground: `fx_job_wizard_meteor_storm`, hit: `fx_job_mage_fire_bolt`.

Мудрец (`sage`):

- `job_sage_earth_spike` Земляной шип — WZ_EARTHSPIKE (skill_db id 90). эффект 79 EF_EARTHSPIKE: QuadHorn; звук effect/wizard_earthspike.wav; FUNC; попадание 147 EF_EARTHHIT: STR data\texture\effect\earthhit.str. Статус: есть — hit: `fx_job_sage_earth_spike`.
- `job_sage_free_cast` Свободное чтение — SA_FREECAST (skill_db id 278). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_mage_fire_ball` Огненный шар — см. выше. Статус: есть — hit: `fx_job_mage_fire_bolt`, projectile: `fx_job_mage_fire_ball_projectile`.
- `job_sage_heavens_drive` Небесный удар — WZ_HEAVENDRIVE (skill_db id 91). эффект 142 EF_HEAVENSDRIVE: FUNC; звук effect/wizard_earthspike.wav; попадание 147 EF_EARTHHIT: STR data\texture\effect\earthhit.str. Статус: ИЗВЛЕЧЬ.


### Лира

Маг (`mage`):

- `job_mage_cold_bolt` Ледяная стрела — MG_COLDBOLT (skill_db id 14). снаряд 'ef_coldbolt' (3D-сосульки, текстура data\texture\effect\ice.tga — проверить); попадание 51 EF_COLDHIT: 2D effect/ice.tga, звук _hit_fist%d.wav. Статус: есть — hit: `fx_job_mage_cold_bolt`.
- `job_mage_energy_coat` Энергетический покров — MG_ENERGYCOAT (skill_db id 157). эффект 169 EF_ENERGYCOAT: STR data\texture\effect\energycoat.str. Статус: есть — buff: `fx_shield`.
- `job_mage_frost_diver` Ледяной удар — MG_FROSTDIVER (skill_db id 15). выпуск 27 EF_FROSTDIVER: TRAIL; попадание 28 EF_FROSTDIVER2: STR data\texture\effect\freeze.str, звук effect/ef_frostdiver2.wav. Статус: есть — hit: `fx_job_mage_frost_diver`, projectile: `fx_job_mage_frost_diver_spikes`.
- `job_mage_safety_wall` Стена безопасности — MG_SAFETYWALL (skill_db id 12). юнит на земле 315 EF_GLASSWALL2: STR data\texture\effect\safetywall.str + CYLINDER, звук effect/ef_glasswall.wav. Статус: есть — buff: `fx_job_mage_safety_wall`.

Волшебник (`wizard`):

- `job_wizard_frost_nova` Кольцо мороза — WZ_FROSTNOVA (skill_db id 88). на кастере 28 EF_FROSTDIVER2: STR data\texture\effect\freeze.str, звук effect/ef_frostdiver2.wav; попадание 51 EF_COLDHIT: 2D effect/ice.tga, звук _hit_fist%d.wav. Статус: есть — hit: `fx_job_mage_frost_diver`.
- `job_wizard_quagmire` Трясина — WZ_QUAGMIRE (skill_db id 92). на земле 95 EF_QUAGMIRE: STR data\texture\effect\quagmire.str; звук effect/wizard_quagmire.wav. Статус: ИЗВЛЕЧЬ.
- `job_mage_frost_diver` Ледяной удар — см. выше. Статус: есть — hit: `fx_job_mage_frost_diver`, projectile: `fx_job_mage_frost_diver_spikes`.
- `job_wizard_storm_gust` Снежная буря — WZ_STORMGUST (skill_db id 89). эффект 89 EF_STORMGUST: STR data\texture\effect\stormgust.str, звук effect/wizard_stormgust.wav; попадание 51 EF_COLDHIT: 2D effect/ice.tga, звук _hit_fist%d.wav. Статус: есть — ground: `fx_job_wizard_storm_gust`.

Мудрец (`sage`):

- `job_sage_dispell` Развеивание — SA_DISPELL (skill_db id 289). при успехе 235 EF_DISPELL: STR data\texture\effect\디스펠.str. Статус: есть — debuff: `fx_job_sage_dispell`.
- `job_sage_magic_rod` Магический жезл — SA_MAGICROD (skill_db id 276). при успехе 244 EF_MAGICROD: STR data\texture\effect\매직로드.str, звук effect/sage_magic rod.wav. Статус: ИЗВЛЕЧЬ.
- `job_mage_safety_wall` Стена безопасности — см. выше. Статус: есть — buff: `fx_job_mage_safety_wall`.
- `job_sage_volcano` Вулкан — SA_VOLCANO (skill_db id 285). на кастере 225 EF_VOLCANO — в EffectTable roBrowser нет, проверить; на земле 239 EF_BOTTOM_VO: FUNC. Статус: ИЗВЛЕЧЬ.


### Мэйлин

Лучник (`archer`):

- `job_archer_arrow_shower` Дождь стрел — AC_SHOWER (skill_db id 47). 'ef_arrow_shower_projectile' — 3D-стрелы (текстура стрелы), попадание 1 EF_HIT2: 2D effect/lens1.tga, звук effect/ef_hit2.wav. Статус: ИЗВЛЕЧЬ.
- `job_archer_improve_concentration` Концентрация — AC_CONCENTRATION (skill_db id 45). эффект 153 EF_CONCENTRATION: STR data\texture\effect\concentration.str, звук effect/ac_concentration.wav. Статус: есть — buff: `fx_job_archer_improve_concentration`.
- `job_archer_charge_arrow` Заряженная стрела — см. выше. Статус: есть по правилу боя — `fx_arrow`.
- `job_archer_vultures_eye` Глаз стервятника — см. выше. Статус: не нужно.

Охотник (`hunter`):

- `job_hunter_ankle_snare` Капкан — HT_ANKLESNARE (skill_db id 117). юнит-ловушка: спрайт ловушки ef_trap_01 (data\sprite\이팩트\trap…, проверить имя), groundEffectId 'ef_anklesnare'. Статус: есть — ground: `fx_job_hunter_ankle_snare`.
- `job_archer_improve_concentration` Концентрация — см. выше. Статус: есть — buff: `fx_job_archer_improve_concentration`.
- `job_hunter_claymore_trap` Клеймор — HT_CLAYMORETRAP (skill_db id 123). попадание 107 EF_CLAYMORE: STR data\texture\effect\claymore.str, звук effect/hunter_claymoretrap.wav. Статус: есть — hit: `fx_job_hunter_claymore_trap`.
- `job_hunter_sandman` Сонная ловушка — HT_SANDMAN (skill_db id 119). попадание 139 EF_SANDMAN: STR data\texture\effect\sandman.str, звук effect/hunter_sandman.wav. Статус: есть — debuff: `fx_job_hunter_sandman`.

Танцовщица (`dancer`):

- `job_dancer_slinging_arrow` Бросок стрелы — DC_THROWARROW (skill_db id 324). стрела 'ef_arrow_projectile' (без своей картинки). Статус: есть по правилу боя — `fx_arrow`.
- `job_bard_scream` Крик — DC_SCREAM (skill_db id 326). начало каста 296 EF_TALK_SCREAM: FUNC. Статус: ИЗВЛЕЧЬ.
- `job_dancer_dont_forget_me` Не забывай меня — DC_DONTFORGETME (skill_db id 328). эффект 292 EF_BOTTOM_DONTFORGETME: звук effect/나를잊지말아요.wav; на земле 292_ground : FUNC. Статус: ИЗВЛЕЧЬ.
- `job_dancer_fortune_kiss` Поцелуй удачи — DC_FORTUNEKISS (skill_db id 329). эффект 293 EF_BOTTOM_FORTUNEKISS: звук effect/행운의.wav; на земле 293_ground : FUNC. Статус: ИЗВЛЕЧЬ.


### Отто

Торговец (`merchant`):

- `job_merchant_cart_revolution` Удар тележкой — MC_CARTREVOLUTION (skill_db id 153). начало каста 170 EF_CARTREVOLUTION: STR data\texture\effect\cartrevolution.str, звук effect/ef_magnumbreak.wav; попадание 170 EF_CARTREVOLUTION: STR data\texture\effect\cartrevolution.str, звук effect/ef_magnumbreak.wav. Статус: есть — hit: `fx_job_merchant_cart_revolution`.
- `job_merchant_pushcart` Тележка — MC_PUSHCART (skill_db id 39). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_merchant_mammonite` Маммонит — см. выше. Статус: есть — hit: `fx_job_merchant_mammonite`.
- `job_merchant_crazy_uproar` Громкий голос — см. выше. Статус: есть — buff: `fx_job_merchant_crazy_uproar`.

Кузнец (`blacksmith`):

- `job_blacksmith_hammer_fall` Удар молота — см. выше. Статус: есть — ground: `fx_job_blacksmith_hammer_fall`.
- `job_blacksmith_tempering` Закалка — BS_IRON (skill_db id 94). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_blacksmith_adrenaline_rush` Выброс адреналина — BS_ADRENALINE (skill_db id 111). 98 EF_HASTEUP: в roBrowser FUNC без картинки; в клиенте есть data\texture\effect\adrenaline.str; звуки effect/black_adrenalinerush_a.wav, _b.wav. Статус: есть — buff: `fx_job_blacksmith_adrenaline_rush`.
- `job_blacksmith_weapon_perfection` Совершенство оружия — BS_WEAPONPERFECT (skill_db id 112). эффект 103 EF_PERFECTION: STR data\texture\effect\weaponperfection.str, звук effect/black_weapon_perfection.wav. Статус: есть — buff: `fx_job_blacksmith_weapon_perfection`.

Алхимик (`alchemist`):

- `job_alchemist_acid_terror` Кислотный террор — AM_ACIDTERROR (skill_db id 230). снаряд 298 EF_THROWITEM: 3D 유저인터페이스/item/염산병.bmp. Статус: ИЗВЛЕЧЬ.
- `job_alchemist_demonstration` Огненная бутыль — AM_DEMONSTRATION (skill_db id 229). на земле 302 EF_DEMONSTRATION: SPR data\sprite\이팩트데몬스트레이션.spr/.act. Статус: есть — ground: `fx_job_alchemist_demonstration`.
- `job_merchant_mammonite` Маммонит — см. выше. Статус: есть — hit: `fx_job_merchant_mammonite`.
- `job_alchemist_acid_bomb` Кислотный всплеск — CR_ACIDDEMONSTRATION (skill_db id 490). эффект 537 EF_ACIDDEMON: FUNC. Статус: ИЗВЛЕЧЬ.


### Тео

Аколит (`acolyte`):

- `job_acolyte_holy_light` Святой свет — AL_HOLYLIGHT (skill_db id 156). эффект 152 EF_HOLYHIT: STR data\texture\effect\holyhit.str. Статус: есть — hit: `fx_job_acolyte_holy_light`.
- `job_acolyte_increase_agi` Повышение ловкости — AL_INCAGI (skill_db id 29). эффект 37 EF_INCAGILITY: 3D effect/ac_center2.tga; 3D effect/agi_up.bmp, звук effect/ef_incagility.wav. Статус: есть — buff: `fx_job_acolyte_increase_agi`.
- `job_acolyte_signum_crucis` Знак креста — AL_CRUCIS (skill_db id 32). эффект 40 EF_SIGNUM: STR data\texture\effect\cross.str, звук effect/ef_signum.wav. Статус: есть — debuff: `fx_job_acolyte_signum_crucis`.
- `job_acolyte_divine_protection` Божья защита — AL_DP (skill_db id 22). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.

Жрец (`priest`):

- `job_priest_impositio_manus` Импозицио Манус — PR_IMPOSITIO (skill_db id 66). эффект 84 EF_IMPOSITIO: STR data\texture\effect\impositio.str, звук effect/priest_impositio.wav. Статус: есть — buff: `fx_job_priest_impositio_manus`.
- `job_priest_magnificat` Магнификат — PR_MAGNIFICAT (skill_db id 74). эффект 76 EF_MAGNIFICAT: STR data\texture\effect\magnificat.str, звук effect/priest_magnificat.wav. Статус: есть — buff: `fx_job_priest_magnificat`.
- `job_priest_magnus_exorcismus` Магнус Экзорцизмус — PR_MAGNUS (skill_db id 79). эффект 113 EF_MAGNUS: STR data\texture\effect\magnus.str, звук effect/priest_magnus.wav; попадание 152 EF_HOLYHIT: STR data\texture\effect\holyhit.str; на земле 318 EF_BOTTOM_MAG: CYLINDER. Статус: есть — ground: `fx_job_priest_magnus_exorcismus`, hit: `fx_job_acolyte_holy_light`.
- `job_priest_lex_aeterna` Лекс Этерна — PR_LEXAETERNA (skill_db id 78). эффект 85 EF_LEXAETERNA: STR data\texture\effect\lexaeterna.str, звук effect/priest_lexaeterna.wav. Статус: есть — debuff: `fx_job_priest_lex_aeterna`.

Монах (`monk`):

- `job_monk_triple_attack` Тройная атака — MO_TRIPLEATTACK (skill_db id 263). эффект 329 EF_TRIPLEATTACK: звук effect/ef_hit2.wav; звук effect/ef_hit4.wav. Статус: ИЗВЛЕЧЬ.
- `job_monk_call_spirits` Призыв сфер — MO_CALLSPIRITS (skill_db id 261). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_monk_investigate` Проникающий удар — MO_INVESTIGATE (skill_db id 266). эффект 267 EF_CHIMTO: звук effect/mon_침투경.wav. Статус: ИЗВЛЕЧЬ.
- `job_monk_asura_strike` Удар Асуры — MO_EXTREMITYFIST (skill_db id 271). beginCast 12 EF_BEGINSPELL; эффект 328 EF_BEGINASURA: 3D/CYLINDER, текстуры data\texture\effect\asura1.tga, asura2.tga (+ тряска экрана); попадание 266 EF_TEIHIT1X: 3D effect/lens1.tga ×24, звук effect/mon_아수라 패황권.wav. Статус: ИЗВЛЕЧЬ — рисуется кодом: снять asura1.tga/asura2.tga + звук; кадры — запись EffectViewer 328 и 266.


### Вика

Аколит (`acolyte`):

- `job_acolyte_heal` Исцеление — AL_HEAL (skill_db id 28). 312 EF_HEAL: CYLINDER + 3D effect/pok3.tga, звук _heal_effect.wav; на цели 320 EF_HEAL3. Статус: есть по правилу боя — `fx_heal` (312).
- `job_acolyte_divine_protection` Божья защита — см. выше. Статус: не нужно.
- `job_acolyte_blessing` Благословение — AL_BLESSING (skill_db id 34). эффект 42 EF_BLESSING: SPR data\sprite\이팩트축복.spr/.act; 3D; 3D effect/pok2.tga, звук effect/ef_blessing.wav. Статус: есть — buff: `fx_job_acolyte_blessing`.
- `job_acolyte_angelus` Ангелус — AL_ANGELUS (skill_db id 33). эффект 41 EF_ANGELUS: STR data\texture\effect\angelus.str, звук effect/ef_angelus.wav. Статус: есть — buff: `fx_job_acolyte_angelus`.

Жрец (`priest`):

- `job_acolyte_heal` Исцеление — см. выше. Статус: есть по правилу боя — `fx_heal` (312).
- `job_priest_kyrie_eleison` Кирие Элейсон — PR_KYRIE (skill_db id 73). эффект 112 EF_KYRIE: STR data\texture\effect\kyrie.str, звук effect/priest_kyrie_eleison_a.wav. Статус: есть — buff: `fx_job_priest_kyrie_eleison`.
- `job_priest_sanctuary` Святилище — PR_SANCTUARY (skill_db id 70). эффект 83 EF_SANCTUARY: STR data\texture\effect\sanctuary.str, звук effect/priest_sanctuary.wav; на земле 319 EF_BOTTOM_SANC: CYLINDER. Статус: ИЗВЛЕЧЬ.
- `job_priest_assumptio` Ассумптио — HP_ASSUMPTIO (skill_db id 361). эффект 440 EF_ASSUMPTIO2: STR data\texture\effect\asum.str, звук effect/아숨프티오.wav. Статус: есть — buff: `fx_job_priest_assumptio`.

Монах (`monk`):

- `job_monk_blade_stop` Хватка клинка — MO_BLADESTOP (skill_db id 269). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_monk_iron_hand` Железный кулак — MO_IRONHAND (skill_db id 259). эффекта в RO нет (пассивка / без картинки). Статус: не нужно.
- `job_acolyte_divine_protection` Божья защита — см. выше. Статус: не нужно.
- `job_monk_steel_body` Стальное тело — MO_STEELBODY (skill_db id 268). эффект 254 EF_STEELBODY: звук effect/mon_금강불괴.wav; эффект quake  — в EffectTable roBrowser нет, проверить. Статус: ИЗВЛЕЧЬ.


### Зара

Вор (`thief`):

- `job_thief_envenom` Отравление — TF_POISON (skill_db id 52). попадание 20 EF_PATTACK: 3D effect/pok1.tga; звук effect/ef_detoxication.wav. Статус: есть — hit: `fx_job_thief_envenom`.
- `job_thief_double_attack` Двойная атака — см. выше. Статус: не нужно.
- `job_thief_venom_knife` Ядовитый нож — AS_VENOMKNIFE (skill_db id 1004). снаряд 600 EF_THROWITEM6: 3D 유저인터페이스/item/베넘나이프.bmp. Статус: есть — projectile: `fx_job_thief_venom_knife_projectile`.
- `job_thief_improve_dodge` Уклонение — см. выше. Статус: не нужно.

Ассасин (`assassin`):

- `job_assassin_grimtooth` Мрачный клык — AS_GRIMTOOTH (skill_db id 137). выпуск 123 EF_GRIMTOOTH: звук effect/ef_frostdiver.wav; TRAIL; попадание 132 EF_GRIMTOOTHATK: QuadHorn. Статус: есть — hit: `fx_job_assassin_grimtooth`.
- `job_assassin_enchant_poison` Отравленное оружие — AS_ENCHANTPOISON (skill_db id 138). эффект 20 EF_PATTACK: 3D effect/pok1.tga; звук effect/ef_detoxication.wav. Статус: есть — debuff: `fx_job_thief_envenom`.
- `job_thief_venom_knife` Ядовитый нож — см. выше. Статус: есть — projectile: `fx_job_thief_venom_knife_projectile`.
- `job_assassin_venom_splasher` Ядовитый взрыв — AS_SPLASHER (skill_db id 141). эффект 129 EF_SPLASHER: STR data\texture\effect\venomsplasher.str, звук effect/assasin_venomsplasher.wav. Статус: есть — hit: `fx_job_assassin_venom_splasher`.

Разбойник (`rogue`):

- `job_rogue_back_stab` Удар в спину — RG_BACKSTAP (skill_db id 212). попадание 275 EF_BACKSTAP: звук effect/rog_back stap.wav. Статус: ИЗВЛЕЧЬ.
- `job_rogue_gank` Грабёж — RG_SNATCHER (skill_db id 210). своего эффекта нет: при удаче клиент показывает эффект Кражи TF_STEAL 18 (EF_STEAL: 3D effect/pok1.tga, звук effect/ef_steal.wav). Статус: есть (fx_job_thief_steal).
- `job_thief_sand_attack` Песок в глаза — см. выше. Статус: ИЗВЛЕЧЬ.
- `job_rogue_strip_armor` Снять доспех — RG_STRIPARMOR (skill_db id 217). при успехе 271 EF_STRIPARMOR: STR data\texture\effect\strip_armor.str, звук effect/t_벽튕김.wav. Статус: есть — debuff: `fx_job_rogue_strip_armor`.


## Монстры и боссы

У монстров нет навыков RO — берём эффекты монстровых навыков клиента (NPC_*) того же смысла; навык игрока — только если
RO сам даёт его монстру (NPC_AGIUP = эффект AL_INCAGI, Тёмный лорд колдует WZ_METEOR). Id навыка — skill_db rAthena.

Уже подключено (атлас снят владельцем, часть 4/5):
- NPC_POISON (176): 192 EF_POISONATTACK, STR `poison.str` → `fx_npc_poison`: Гнилые споры, Гнилой укус, Отравленная стрела,
  Бросок гремучей, Жало скорпиона, Ядовитая слизь, Могильный укус, Кислый плевок, Проклятие (mob_boss2_curse).
- NPC_DEFENDER (205): 213 EF_DEFFENDER, STR `deffender.str` → `fx_npc_defender`: все «щит себе» монстров (Корневая
  броня, Стена щитов, Панцирь, Печать Мунэ, Пелены вечности, Боевая шкура, Крылья-щит, Бестелесность, Песчаная стена,
  Щит моста, Твёрдый кокон, Твёрдая скорлупа, Завод пружины, Торг, Лунная вуаль, Покров тьмы, Моховая кора, Доспех Рейдрика).
- NPC_KEEPING (201): 214 EF_KEEPING, STR `keeping.str` → `fx_npc_keeping`: Желейная броня.
- NPC_STUNATTACK (179): 194 EF_STUNATTACK, STR `stun.str` → `fx_npc_stun_attack`: удары с оглушением (Сокрушение, Печать
  по тылу, Цепи тьмы, Удар маятника, Стрелки-клинки, Захлоп крышки, Проклятый таран, Прыжок цзянши, Якорь за борт,
  Хватка щупалец, Петля висельника, Пинок кузнечика, Удар предка, Хватка стебля).
- NPC_DARKSTRIKE (340): 451 EF_SOULSTRIKE2 → `fx_npc_dark_strike`: Мёртвая волна.
- NPC_EARTHQUAKE (653): 666, SPR `data\sprite\이팩트\어스퀘이크.spr/.act`, звук `effect\earth_quake.wav` → `fx_npc_earthquake`: Землетрясение.
- NPC_FIREATTACK (186): попадание 49 EF_FIREHIT → `fx_job_mage_fire_bolt`: Огненный шторм, Лисий огонь.
- NPC_AGIUP (350) = AL_INCAGI 37 → `fx_job_acolyte_increase_agi`: Свистать всех наверх. AL_BLESSING 42: Благословение Изиды.
  WZ_METEOR 92 + 49: Метеоритный дождь Тёмного лорда.

Извлечь (эффект есть в клиенте, у нас процедурный):
1. NPC_CURSEATTACK (181): 196 — в EffectTable roBrowser нет, проверить в GRF (`curse*.str`). Для: Проклятие договора
   (Бафомет, босс), Проклятие мумии, Саван веков, Суд фараона (Осирис, ульта).
2. NPC_POWERUP (349): 456 EF_AGIUP (roBrowser — только звук `effect\mon_폭기.wav`; картинка — проверить). Для: Вой бродяги,
   Смотр войска (Владыка смерти), Барабан войны, Песнь сирены/Хоровод душ (часть «+атака»).
3. NPC_CRITICALWOUND (673): 677 STR `cwound.str`; NPC_WIDEBLEEDING (665): 669 STR `wideb.str`. Для кровотечений: Ржавая
   сабля, Кровавый нож, Хватка шакала, Серпы богомола, Ночное пике.
4. NPC_BLOODDRAIN (199): 216 (3D, код; вампир Дракула). Для: Поцелуй вампира, Кровавый пир.
5. NPC_STOP (342): 453 SPR `data\sprite\이팩트\스톱.spr/.act`. Для «сковать»: Печать упокоения (Мунэ), Хватка корней.
6. NPC_DARKBREATH (202): 212 SPR `darkbreath`. Для: Залп тьмы, Вопль банши, Плата за мост.
7. NPC_SILENCEATTACK (178): 193 STR `silence.str`; NPC_SLEEPATTACK (182): 197 STR `sleep.str`; NPC_PETRIFYATTACK (180):
   195 STR `stonecurse.str` — если появятся навыки немоты/сна/окаменения (Очарование девяти хвостов — сон/чары, проверить).
8. NPC_WATERATTACK (184) / NPC_WINDATTACK (187): попадания 51 / 52 — Водяной выстрел; NPC_MAGICALATTACK (192): 182 = наш `fx_magic`.
9. Боссы без аналога в RO (оставить процедурный или рисовать): Обратный ход (Смотритель), Залп призрачных пушек (Дрейк),
   Монетный дождь (Золотой жук), Лунный зов (Лунный цветок), Марш мёртвых (Владыка смерти).
