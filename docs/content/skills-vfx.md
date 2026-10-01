# Вид навыков в бою: аудит и что сделано

Сгенерировано по данным (`data/heroes`, `data/skills`), таблице `src/game/skillVisuals.ts` и иконкам `RO_SKILL_ICONS`
(`src/game/skillLook.ts`). Кадры каждого навыка в бою — `npx tsx scripts/skillfx-save.ts > squads.json`, затем
`node scripts/skillfx-shots.mjs squads.json <папка>` (8 отрядов: 12 героев в базовой форме и в обеих ветках).
Заказ арта на замену процедурных эффектов — `docs/ART_REQUEST_SKILLS.md`.

## Как устроено

- `src/game/skillVisuals.ts` (без Phaser) — навык → `sig` (рецепт целиком: каст, снаряд, площадь, попадания по времени),
  `hit` (своё попадание на цель), `aura` (свой бафф/щит/лечение на цели), `proc` (вспышка пассивки на кастере), `tint`.
- `src/game/skillSigs.ts` — рецепты (`playSignature`, `playAura`, `playProc`) из примитивов `SkillFx` (пул картинок,
  общие эмиттеры, время боя; новых листов нет, 10 новых текстур кодом: нота, сокол, капкан, колба, сердце, клинок, щит,
  святой крест, перо, сковорода).
- `BattleScene`: `skillVisual` — рецепт навыка (цифры урона/лечения встают под удар каждого снаряда через `hitPlan`);
  события `status`/`buff`/`heal` — аура навыка вместо общего столба искр; событие `passive` — вспышка и «навык момента»
  (удары и статусы пассивки рисуются по ней, а не по последней атаке).
- «Уменьшить анимацию»: как и раньше, убираются только тряска, вспышка экрана и следы; частиц вдвое меньше.
- Иконки: 120 иконок RO (родные 24×24, `tools/extract_ro_skill_icons.py`) в нашей рамке, целым кратным (×3); было 32 по 128×128.
  Без иконки RO — только «Удар сковородой» (своего навыка в RO нет): символ сковороды кодом.
- Полоса каста и подписи: название навыка из данных (русское); у каста полоса и подпись цвета стихии, у активного —
  подпись над героем, у пассивки — фиолетовая подпись при первом срабатывании за бой. Длинные названия («Владение двуручным
  мечом», «Спиральный пронзатель») помещаются: подписи прижимаются к краю экрана (`FloatLayer.headline`).

## Итог

| | до | после |
| --- | --- | --- |
| навыков героев (уникальных, база + обе ветки) | 119 | 119 |
| активных со своим видом | 23 из 81 | 81 из 81 |
| пассивок со своей вспышкой/аурой | 0 из 38 (только подпись + общий эффект) | 38 из 38 |
| с иконкой RO | 31 | 118 (без RO — 1: «Удар сковородой», символ кодом) |
| групп одинаково выглядящих навыков | 14 | 0 (тест `tests/skill-visuals.test.ts`) |

## Ульты героев (01.10)

36 ульт форм (`data/skills/ult_*.json`, `docs/design/battle-decisions.md` §1) — на энергии, событие `ult`: затемнение и
баннер с названием (`UltPresenter`), подготовка у кастера и вспышка удара (`bigCue`), дальше — вид навыка:

- 20 ульт — на атласе своего навыка RO (`effects.json → skills.ult_*`: роли cast / ground / hit / buff / debuff как у
  обычной формы этого навыка), лечение — общий `fx_heal` (EF_HEAL); белый список — `tests/effects-ro-origin.test.ts`.
- В `skillVisuals.ts` у каждой ульты свой рецепт (`sig` того же навыка RO или `hit`/`aura`) и свой цвет — тест «два навыка
  героев не выглядят одинаково» считает ульты вместе с навыками форм; площадь стрел, молний и метели — `skillLook.ts`
  FX_OVERRIDE (Ливень стрел, Владыка Вермилиона, Великая снежная буря — OWN_BY_LOOK).
- 01.10, вторая партия сырья клиента: ещё 11 ульт на своих эффектах RO — Удар Асуры (буквы 阿修羅覇凰拳 + лучи), Владыка
  Вермилиона (`lord.str` + `windhit`), Стена огня (`firewall1/2.str` на пяти клетках), Брандиш (`brandish.str`, на рыцаре
  `brandish2.str`), Соколиный шквал (спрайт сокола `매`), Мёртвая хватка (`cconfine`), Служу тебе (ноты песни), Дождь
  зелий (`빨간포션.str`), Морская сфера (спрайт Marine Sphere), Разрыв чар (`spell.str`), Потоп (корона ring_blue).
  И частые навыки: Удар Асуры монаха, Удар и Атака сокола, Метеоритный удар (серпы purpleslash), Небесный удар
  (`earthhit.str`), Святилище (`sanctuary.str`), Магический жезл (`매직로드.str`), Трясина (`quagmire.str` по клеткам),
  Проникающий удар (спрайт `침투경_`). Атласы `fx_job_*` (грузятся только боем с этим навыком), сборка —
  `raw/ro-build/tools/fx/build_ro_fx.py` (рендер STR/SPR/«3D» roBrowser без EffectViewer), подробно —
  `docs/RO_EFFECTS_EXTRACT.md`, «Сделано 01.10». Сокол RO заменяет процедурную птицу в рецептах `blitzBeat` / `falconAssault`.
- Свои звуки навыков RO (`skillVisuals.ts → SKILL_SOUNDS`, файлы `assets/audio/skl_*`) — вместо общего звука стихии: Асура,
  Вермилион, Стена огня, Брандиш, сокол, Хватка, Вулкан стрел, Служу тебе, Святилище, Жезл, Трясина, Проникающий и
  Метеоритный удар, Стальное тело, Мощный удар, Спиральный пронзатель, Закат ассасина, Поцелуй удачи.
- Без своего атласа (в клиенте эффекта нет): Морозная шутка, Песчаная завеса, Взрыв ки, Вулкан стрел (только звук), Ливень
  стрел (общий EF_HIT2) — процедурный вид, без чужой картинки.
- Иконки — RO (`RO_SKILL_ICONS`), 10 новых из клиента (Брандиш, Вулкан стрел, Служу тебе, Хватка, Морская сфера, Стена
  огня, Владыка Вермилиона, Разрыв чар, Потоп, Взрыв ки).
- Полоска энергии героя (над фигурой и на портрете «УЛЬТА») растёт плавно: энергия героя копится и от времени
  (`UnitDef.energy.perSecond`), сцена досчитывает её между событиями лога.

## Только оригинальные эффекты RO (30.09, вечер)

Жалоба владельца: «Маммонит — это большой мешок над головой, почему у тебя он другой? Мы что, зря оригинальные скилы
из RO тянули». 29.09 атласы раздавали «по похожести»: Маммониту — блеск Кражи, Удару Асуры — взрыв Клеймора, Стальному
телу — столб Защиты крестоносца, Лекс Этерне и Разоружению — круг Развеивания, Импозицио — сферу Двуручной спешки и т.д.
Правило теперь: атлас RO — только навыку, чей это эффект в клиенте (roBrowser `SkillEffect.js`: effectId, hitEffectId,
снаряд, эффект на земле…), монстрам — эффекты монстровых навыков клиента NPC_* по смыслу. Без своего атласа — прежний
процедурный эффект (`skillVisuals.ts`), без чужой картинки.

- Снято 54 подстановки: 20 у героев (19 навыков: Маммонит, Удар Асуры, Стальное тело, Мощный удар, Метеоритный удар,
  Удар тележкой мастера, Небесный удар, Ледяная стрела ×2, Ядовитый нож — попадание, Ассумптио, Импозицио, Лекс Этерна,
  Магнус — земля, Разоружение, Снять доспех, Ангелус, Удар молота, Огненная бутыль, Ядовитый взрыв) и 34 у монстров (31 навык).
- Подключён 31 атлас, который владелец уже снял из своего клиента scRO (`raw/ro-build/effects` части 1, 4, 5;
  `docs/RO_SCRO_EFFECTS.md`) и который 30.09 ещё не был в игре: Маммонит (EF_COIN 10 — торговец с мешком денег, монеты),
  Ледяная стрела (`ef_coldbolt`), Провокация, Концентрация, Ангелус, Удар молота, Импозицио, Магнус (крест с ангелами),
  Лекс Этерна, Кирие, Ассумптио, Магнификат, Мрачный клык, Ядовитый взрыв, Парирование и Автозащита (один эффект 336),
  Громкий голос, Стена безопасности, Самопожертвование, Разоружение, Снять доспех, Капкан, Поглощение души, Адреналин,
  Контратака, Огненная бутыль; монстрам — яд NPC_POISON, щит NPC_DEFENDER, NPC_KEEPING, звёзды NPC_STUNATTACK,
  NPC_DARKSTRIKE, землетрясение NPC_EARTHQUAKE (`fx_npc_*`). Листы больше 8 МБ (w×h×4) уменьшены ×0.7, `scale` подобран
  по размеру клетки (попадание ≈ 300–420 единиц, площадь ≈ 560), светящиеся — `add`, спрайты (трещины, огонь бутыли,
  иконки оружия/доспеха, звёзды) — `normal`. Кадры в бою проверены `scripts/skillfx-atlas.mjs` на 390×844.
- Итог: 109 навыков с атласом, у героев — 60 из 119 навыков (все со своим эффектом RO); 73 атласа.
- Сторож: `tests/effects-ro-origin.test.ts` — белый список «навык → навык RO → id эффектов клиента»; атлас с чужим
  `source.roEffectId` роняет тест.
- Что ещё извлечь (ульты Асуры, Стального тела, Удара тележкой мастера, Метеоритного удара, попадания стихий 51/52/147…) —
  `docs/RO_EFFECTS_EXTRACT.md`.

Атлас → навыки (актуально):

- `fx_job_acolyte_angelus` (RO 41) — Ангелус `job_acolyte_angelus` (buff)
- `fx_job_acolyte_blessing` (RO 42) — Благословение `job_acolyte_blessing` (buff); Благословение Изиды `mob4_isis_blessing` (buff)
- `fx_job_acolyte_holy_light` (RO 152) — Магнус Экзорцизмус `job_priest_magnus_exorcismus` (hit); Святой свет `job_acolyte_holy_light` (hit)
- `fx_job_acolyte_increase_agi` (RO 37) — Повышение ловкости `job_acolyte_increase_agi` (buff); Свистать всех наверх `mob6_bosun_all_hands` (buff)
- `fx_job_acolyte_signum_crucis` (RO 40) — Знак креста `job_acolyte_signum_crucis` (debuff)
- `fx_job_alchemist_demonstration` (RO sprite 데몬스트레이션) — Огненная бутыль `job_alchemist_demonstration` (ground)
- `fx_job_archer_improve_concentration` (RO 153) — Концентрация `job_archer_improve_concentration` (buff)
- `fx_job_assassin_grimtooth` (RO 132) — Мрачный клык `job_assassin_grimtooth` (hit)
- `fx_job_assassin_sonic_blow` (RO 143) — Звуковой удар `job_assassin_sonic_blow` (hit)
- `fx_job_assassin_venom_splasher` (RO 129) — Ядовитый взрыв `job_assassin_venom_splasher` (hit)
- `fx_job_blacksmith_adrenaline_rush` (RO str_adrenaline) — Выброс адреналина `job_blacksmith_adrenaline_rush` (buff)
- `fx_job_blacksmith_hammer_fall` (RO 102) — Удар молота `job_blacksmith_hammer_fall` (ground)
- `fx_job_blacksmith_weapon_perfection` (RO 103) — Совершенство оружия `job_blacksmith_weapon_perfection` (buff)
- `fx_job_crusader_defender` (RO 222) — Защита `job_crusader_defender` (buff)
- `fx_job_crusader_devotion` (RO 251) — Самопожертвование `job_crusader_devotion` (buff)
- `fx_job_crusader_grand_cross` (RO 226) — Великий крест `job_crusader_grand_cross` (ground)
- `fx_job_crusader_holy_cross` (RO 245) — Святой крест `job_crusader_holy_cross` (hit)
- `fx_job_crusader_shield_charge` (RO 246) — Удар щитом `job_crusader_shield_charge` (hit)
- `fx_job_hunter_ankle_snare` (RO ef_trap_01) — Капкан `job_hunter_ankle_snare` (ground)
- `fx_job_hunter_claymore_trap` (RO 107) — Клеймор `job_hunter_claymore_trap` (hit)
- `fx_job_hunter_sandman` (RO 139) — Сонная ловушка `job_hunter_sandman` (debuff)
- `fx_job_knight_auto_counter` (RO str_autocounter) — Контратака `job_knight_auto_counter` (cast)
- `fx_job_knight_bowling_bash` (RO 149) — Боулинг Баш `job_knight_bowling_bash` (cast)
- `fx_job_knight_parrying` (RO 336) — Автозащита `job_crusader_auto_guard` (buff); Парирование `job_knight_parrying` (buff)
- `fx_job_knight_two_hand_quicken` (RO 130) — Двуручная спешка `job_knight_two_hand_quicken` (buff)
- `fx_job_mage_cold_bolt` (RO ef_coldbolt) — Ледяная стрела `job_mage_cold_bolt` (hit)
- `fx_job_mage_fire_ball_projectile` (RO 24) — Огненный шар `job_mage_fire_ball` (projectile)
- `fx_job_mage_fire_bolt` (RO 49) — Лисий огонь `mob5_horong_foxfire` (hit); Метеоритный дождь `job_wizard_meteor_storm` (hit); Метеоритный дождь `mob7_boss_meteor_storm` (hit); Огненная стрела `job_mage_fire_bolt` (hit); Огненный шар `job_mage_fire_ball` (hit); Огненный шторм `mage_firestorm` (hit)
- `fx_job_mage_frost_diver` (RO 28) — Кольцо мороза `job_wizard_frost_nova` (hit); Ледяной удар `job_mage_frost_diver` (hit)
- `fx_job_mage_frost_diver_spikes` (RO 27) — Ледяной удар `job_mage_frost_diver` (projectile)
- `fx_job_mage_safety_wall` (RO 315) — Стена безопасности `job_mage_safety_wall` (buff)
- `fx_job_mage_thunderstorm` (RO 30) — Гроза `job_mage_thunderstorm` (hit)
- `fx_job_merchant_cart_revolution` (RO 170) — Удар тележкой `job_merchant_cart_revolution` (hit)
- `fx_job_merchant_crazy_uproar` (RO 311) — Громкий голос `job_merchant_crazy_uproar` (buff)
- `fx_job_merchant_mammonite` (RO 10) — Маммонит `job_merchant_mammonite` (hit)
- `fx_job_priest_assumptio` (RO 440) — Ассумптио `job_priest_assumptio` (buff)
- `fx_job_priest_impositio_manus` (RO 84) — Импозицио Манус `job_priest_impositio_manus` (buff)
- `fx_job_priest_kyrie_eleison` (RO 112) — Кирие Элейсон `job_priest_kyrie_eleison` (buff)
- `fx_job_priest_lex_aeterna` (RO 85) — Лекс Этерна `job_priest_lex_aeterna` (debuff)
- `fx_job_priest_magnificat` (RO 76) — Магнификат `job_priest_magnificat` (buff)
- `fx_job_priest_magnus_exorcismus` (RO 113) — Магнус Экзорцизмус `job_priest_magnus_exorcismus` (ground)
- `fx_job_rogue_strip_armor` (RO 271) — Снять доспех `job_rogue_strip_armor` (debuff)
- `fx_job_rogue_strip_weapon` (RO 269) — Разоружение `job_rogue_strip_weapon` (debuff)
- `fx_job_sage_dispell` (RO 235) — Развеивание `job_sage_dispell` (debuff)
- `fx_job_sage_earth_spike` (RO 79) — Земляной шип `job_sage_earth_spike` (hit)
- `fx_job_swordman_magnum_break` (RO 17) — Магнум Брейк `job_swordman_magnum_break` (cast)
- `fx_job_swordman_provoke` (RO 67) — Провокация `job_swordman_provoke` (debuff)
- `fx_job_thief_envenom` (RO 20) — Отравление `job_thief_envenom` (hit); Отравленное оружие `job_assassin_enchant_poison` (debuff)
- `fx_job_thief_steal` (RO 18) — Грабёж `job_rogue_gank` (hit); Кража `job_thief_steal` (hit)
- `fx_job_thief_venom_knife_projectile` (RO 600) — Ядовитый нож `job_thief_venom_knife` (projectile)
- `fx_job_wizard_jupitel_thunder_projectile` (RO 94) — Гром Юпитера `job_wizard_jupitel_thunder` (projectile)
- `fx_job_wizard_jupitel_thunder_target` (RO 93) — Гром Юпитера `job_wizard_jupitel_thunder` (hit)
- `fx_job_wizard_meteor_storm` (RO 92) — Метеоритный дождь `job_wizard_meteor_storm` (ground); Метеоритный дождь `mob7_boss_meteor_storm` (ground)
- `fx_job_wizard_soul_drain` (RO 217) — Поглощение души `job_wizard_soul_drain` (cast)
- `fx_job_wizard_storm_gust` (RO 89) — Снежная буря `job_wizard_storm_gust` (ground)
- `fx_npc_dark_strike` (RO 451) — Мёртвая волна `mob3_boss_nova` (hit)
- `fx_npc_defender` (RO 213) — Бестелесность `maze_ghostring_fade` (buff); Боевая шкура `orc_high_war_hide` (buff); Завод пружины `alde_keeper_winding` (buff); Корневая броня `mob_tank_guard` (buff); Крылья-щит `alde_owl_baron_wings` (buff); Лунная вуаль `mob5_boss_moon_veil` (buff); Моховая кора `mob2_tank_mire` (buff); Панцирь `mob6_tank_shell` (buff); Пелены вечности `mob4_boss_wrappings` (buff); Песчаная стена `mob4_sandman_sand_wall` (buff); Печать Мунэ `mob5_munak_talisman` (buff); Покров тьмы `mob7_boss_bell_ward` (buff); Проклятый доспех `mob3_tank_guard` (buff); Стена щитов `guard_shield_wall` (buff); Твёрдая скорлупа `sewer_bug_egg_shell` (buff); Твёрдый кокон `mob_pupa_harden` (buff); Торг `maze_baphomet_bargain` (buff); Щит моста `mob7_bridge_warden_ward` (buff)
- `fx_npc_earthquake` (RO sprite 어스퀘이크) — Землетрясение `mob_boss1_quake` (ground)
- `fx_npc_keeping` (RO 214) — Желейная броня `mob_mastering_jelly_armor` (buff)
- `fx_npc_poison` (RO 192) — Бросок гремучей `maze_side_winder_venom` (hit); Гнилой укус `mob2_melee_bite` (hit); Гнилые споры `mob2_boss_rot_spores` (hit); Жало скорпиона `mob4_scorpion_sting` (hit); Кислый плевок `sewer_plankton_spit` (hit); Могильный укус `orc_zombie_grave_bite` (hit); Отравленная стрела `mob2_ranged_poison_arrow` (hit); Проклятие `mob_boss2_curse` (hit); Ядовитая слизь `mob_poporing_goo` (hit)
- `fx_npc_stun_attack` (RO 194) — Захлоп крышки `alde_mimic_snap` (hit); Петля висельника `mob7_tank_noose` (hit); Печать по тылу `maze_scribe_seal` (hit); Пинок кузнечика `mob_rocker_kick` (hit); Проклятый таран `mob3_elite_cleave` (hit); Прыжок цзянши `mob5_bongun_hop` (hit); Сокрушение `mob_elite_smash` (hit); Стрелки-клинки `alde_keeper_hands` (hit); Удар маятника `alde_clock_pendulum` (hit); Удар предка `orc_skeleton_ancestor_blow` (hit); Хватка стебля `maze_stem_worm_grip` (hit); Хватка щупалец `mob6_elite_tentacles` (hit); Цепи тьмы `mob7_boss_dark_chains` (hit); Якорь за борт `mob6_bosun_anchor` (hit)
- `fx_shield` (RO 169) — Энергетический покров `job_mage_energy_coat` (buff)
- `fx_swordman_bash` (RO 16) — Баш `swordman_bash` (cast)
- `fx_swordman_endure` (RO 11) — Стойкость `swordman_endure` (buff)

## Атласы RO в бою (29.09)

Кадры RO (`assets/effects`, 42 атласа) привязаны к навыкам в `assets/effects/effects.json → skills`: 113 навыков, 128 привязок
(было 35 навыков), все 36 атласов навыков `fx_job_*` / `fx_swordman_*` играют в бою (было 28; тест
`tests/animated-fx.test.ts` не даст оставить атлас без навыка). Роли: `hit`, `buff`, `debuff`, `cast`, `ground` и новая
`projectile` — атлас летит от кастера к цели, кадры по кругу (`skillSigs.ts flyAtlas`, вид полёта — `FLY_LOOK`). Атлас
дополняет рецепт навыка (процедурный снаряд уступает атласу, искры и кольца рецепта остаются); без загруженного атласа —
прежний вид. Как подключить новый — `docs/CONTENT_RECIPES.md`, раздел 12а.

Порядок подключения: ульты героев и боссов/мини-боссов, затем частые навыки монстров (разрезы, яды, удары), баффы и щиты.
Семь атласов владельца из `art/ro-effects-bulk`: Огненный шар и Лисий огонь (`fx_job_mage_fire_ball_projectile` летит),
Ледяная стрела и Ледяной клинок (осколок `frost_diver_release` падает/летит острием вперёд), Гром Юпитера (шар молний летит,
`jupitel_thunder_target` — на цели), Кислотный террор, Кислотный всплеск и Огненная бутыль (колба кувыркается по дуге),
Ядовитый нож (нож), Град стрел (пучок стрел падает на каждую цель), Вулкан (земля). Кража (`fx_job_thief_steal`) — блеск
на цели у Кражи, Грабежа, Маммонита и Монетного дождя.

Атлас → навыки на 29.09 (история; «новое» — привязано 29.09; аудит 30.09 и правило «только свой эффект RO» многое сняли — актуальный список в разделе выше):

- `fx_job_acolyte_blessing` — Ассумптио `job_priest_assumptio` (buff, новое); Благословение `job_acolyte_blessing` (buff); Благословение Изиды `mob4_isis_blessing` (buff, новое)
- `fx_job_acolyte_holy_light` — Лунный зов `mob5_boss_moon_call` (hit, новое); Магнус Экзорцизмус `job_priest_magnus_exorcismus` (hit, новое); Святой свет `job_acolyte_holy_light` (hit)
- `fx_job_acolyte_increase_agi` — Повышение ловкости `job_acolyte_increase_agi` (buff); Свистать всех наверх `mob6_bosun_all_hands` (buff, новое)
- `fx_job_acolyte_signum_crucis` — Знак креста `job_acolyte_signum_crucis` (debuff); Проклятие договора `maze_baphomet_curse` (debuff, новое)
- `fx_job_alchemist_acid_terror_projectile` — Кислотный всплеск `job_alchemist_acid_bomb` (projectile, новое); Кислотный террор `job_alchemist_acid_terror` (projectile, новое); Огненная бутыль `job_alchemist_demonstration` (projectile, новое)
- `fx_job_archer_arrow_shower_source` — Дождь стрел `job_archer_arrow_shower` (projectile, новое)
- `fx_job_assassin_sonic_blow` — Абордажный крюк `mob6_boss_boarding_hook` (hit, новое); Звуковой удар `job_assassin_sonic_blow` (hit); Коса управителя `mob_lord_of_death_scythe` (hit, новое); Коса хранителя `maze_baphomet_scythe` (hit, новое); Кровавый нож `mob7_fast_bloody_knife` (hit, новое); Мрачный клык `job_assassin_grimtooth` (hit, новое); Призрачная коса `mob7_melee_ghost_scythe` (hit, новое); Проклятый таран `mob3_elite_cleave` (hit); Прыжок `assassin_leap` (hit); Размах `warrior_cleave` (hit); Рассечь `mob3_melee_rend` (hit); Ржавая сабля `mob6_melee_rusty_saber` (hit, новое); Рубящий топор `orc_warrior_axe_rend` (hit, новое); Серпы богомола `maze_mantis_scythes` (hit, новое); Спиральный пронзатель `job_knight_spiral_pierce` (hit, новое); Стрелки-клинки `alde_keeper_hands` (hit, новое); Удар в спину `job_rogue_back_stab` (hit, новое); Хватка шакала `mob4_verit_maul` (hit, новое)
- `fx_job_blacksmith_weapon_perfection` — Совершенство оружия `job_blacksmith_weapon_perfection` (buff)
- `fx_job_crusader_defender` — Ангелус `job_acolyte_angelus` (buff, новое); Желейная броня `mob_mastering_jelly_armor` (buff, новое); Защита `job_crusader_defender` (buff); Панцирь `mob6_tank_shell` (buff, новое); Пелены вечности `mob4_boss_wrappings` (buff, новое); Печать Мунэ `mob5_munak_talisman` (buff, новое); Стальное тело `job_monk_steel_body` (buff, новое); Стена щитов `guard_shield_wall` (buff, новое)
- `fx_job_crusader_grand_cross` — Великий крест `job_crusader_grand_cross` (ground); Магнус Экзорцизмус `job_priest_magnus_exorcismus` (ground, новое); Суд фараона `mob4_boss_ult` (ground, новое)
- `fx_job_crusader_holy_cross` — Святой крест `job_crusader_holy_cross` (hit)
- `fx_job_crusader_shield_charge` — Атака с разбега `job_knight_charge_attack` (hit, новое); Лунный прыжок `mob_eclipse_moon_leap` (hit, новое); Сокрушение `mob_elite_smash` (hit, новое); Удар предка `orc_skeleton_ancestor_blow` (hit, новое); Удар щитом `job_crusader_shield_charge` (hit); Якорь за борт `mob6_bosun_anchor` (hit, новое)
- `fx_job_hunter_claymore_trap` — Залп призрачных пушек `mob6_boss_ghost_cannons` (hit, новое); Клеймор `job_hunter_claymore_trap` (hit); Удар Асуры `job_monk_asura_strike` (hit, новое)
- `fx_job_hunter_sandman` — Гнилые споры `mob2_boss_rot_spores` (debuff, новое); Сонная ловушка `job_hunter_sandman` (debuff)
- `fx_job_knight_bowling_bash` — Боулинг Баш `job_knight_bowling_bash` (cast)
- `fx_job_knight_two_hand_quicken` — Боевая шкура `orc_high_war_hide` (buff, новое); Двуручная спешка `job_knight_two_hand_quicken` (buff); Импозицио Манус `job_priest_impositio_manus` (buff, новое); Мощный удар `job_blacksmith_power_thrust` (buff, новое)
- `fx_job_mage_fire_ball_projectile` — Лисий огонь `mob5_horong_foxfire` (projectile, новое); Огненный шар `job_mage_fire_ball` (projectile, новое)
- `fx_job_mage_fire_bolt` — Лисий огонь `mob5_horong_foxfire` (hit, новое); Метеоритный дождь `job_wizard_meteor_storm` (hit, новое); Метеоритный дождь `mob7_boss_meteor_storm` (hit, новое); Огненная бутыль `job_alchemist_demonstration` (hit, новое); Огненная стрела `job_mage_fire_bolt` (hit); Огненный шар `job_mage_fire_ball` (hit); Огненный шторм `mage_firestorm` (hit, новое)
- `fx_job_mage_frost_diver` — Кольцо мороза `job_wizard_frost_nova` (hit, новое); Ледяная стрела `job_mage_cold_bolt` (hit, новое); Ледяной удар `job_mage_frost_diver` (hit)
- `fx_job_mage_frost_diver_release` — Ледяная стрела `job_mage_cold_bolt` (projectile, новое); Ледяной удар `job_mage_frost_diver` (projectile, новое)
- `fx_job_mage_thunderstorm` — Гроза `job_mage_thunderstorm` (hit)
- `fx_job_merchant_cart_revolution` — Метеоритный удар `job_assassin_meteor_assault` (hit, новое); Удар молота `job_blacksmith_hammer_fall` (hit, новое); Удар тележкой `job_merchant_cart_revolution` (hit); Удар тележкой мастера `job_blacksmith_cart_termination` (hit, новое)
- `fx_job_sage_dispell` — Лекс Этерна `job_priest_lex_aeterna` (debuff, новое); Мёртвая волна `mob3_boss_nova` (debuff, новое); Обратный ход `alde_keeper_rewind` (debuff, новое); Печать по тылу `maze_scribe_seal` (debuff, новое); Печать упокоения `mob5_munak_elder_seal` (debuff, новое); Проклятие `mob_boss2_curse` (debuff, новое); Проклятие мумии `mob4_mummy_curse` (debuff, новое); Развеивание `job_sage_dispell` (debuff); Разоружение `job_rogue_strip_weapon` (debuff, новое); Снять доспех `job_rogue_strip_armor` (debuff, новое); Суд фараона `mob4_boss_ult` (debuff, новое); Цепи тьмы `mob7_boss_dark_chains` (debuff, новое)
- `fx_job_sage_earth_spike` — Землетрясение `mob_boss1_quake` (hit, новое); Земляной шип `job_sage_earth_spike` (hit); Небесный удар `job_sage_heavens_drive` (hit, новое)
- `fx_job_sage_heavens_drive` — Землетрясение `mob_boss1_quake` (ground, новое); Небесный удар `job_sage_heavens_drive` (ground); Подъём предков `orc_lord_ancestors_rise` (ground, новое)
- `fx_job_sage_volcano_ground` — Вулкан `job_sage_volcano` (ground)
- `fx_job_swordman_magnum_break` — Магнум Брейк `job_swordman_magnum_break` (cast)
- `fx_job_thief_envenom` — Бросок гремучей `maze_side_winder_venom` (hit, новое); Гнилой укус `mob2_melee_bite` (hit, новое); Гнилые споры `mob2_boss_rot_spores` (hit, новое); Жало скорпиона `mob4_scorpion_sting` (hit, новое); Кислый плевок `sewer_plankton_spit` (hit, новое); Могильный укус `orc_zombie_grave_bite` (hit, новое); Отравление `job_thief_envenom` (hit); Отравленная стрела `mob2_ranged_poison_arrow` (hit); Проклятие `mob_boss2_curse` (hit, новое); Ядовитая слизь `mob_poporing_goo` (hit); Ядовитый взрыв `job_assassin_venom_splasher` (hit, новое); Ядовитый нож `job_thief_venom_knife` (hit, новое)
- `fx_job_thief_steal` — Грабёж `job_rogue_gank` (hit, новое); Кража `job_thief_steal` (hit, новое); Маммонит `job_merchant_mammonite` (hit, новое); Монетный дождь `sewer_golden_bug_coin_rain` (hit, новое)
- `fx_job_thief_venom_knife_projectile` — Ядовитый нож `job_thief_venom_knife` (projectile, новое)
- `fx_job_wizard_jupitel_thunder_projectile` — Гром Юпитера `job_wizard_jupitel_thunder` (projectile, новое)
- `fx_job_wizard_jupitel_thunder_target` — Гром Юпитера `job_wizard_jupitel_thunder` (hit, новое)
- `fx_job_wizard_meteor_storm` — Метеоритный дождь `job_wizard_meteor_storm` (ground); Метеоритный дождь `mob7_boss_meteor_storm` (ground, новое)
- `fx_job_wizard_storm_gust` — Марш мёртвых `mob_lord_of_death_march` (ground, новое); Снежная буря `job_wizard_storm_gust` (ground)
- `fx_swordman_bash` — Баш `swordman_bash` (cast)
- `fx_swordman_endure` — Барабан войны `orc_lady_war_drum` (buff, новое); Вой бродяги `maze_vagabond_wolf_howl` (buff, новое); Смотр войска `mob_lord_of_death_review` (buff, новое); Стойкость `swordman_endure` (buff)

## Аудит атласов RO в бою (30.09)

Жалоба владельца (телефон): «часть эффектов не адаптирована, например у мага ледяные штуки». Проверены все 113 привязок
атласов к навыкам (42 листа, 36 атласов навыков) в настоящем бою на 390×844: `scripts/skillfx-atlas.mjs` проигрывает каждый
навык отдельно теми же путями, что BattleScene (cast — на кастере, projectile — от кастера к цели и обратно, справа налево,
hit/debuff — на цели в момент попадания, buff — на союзнике, ground — по площади), 4–6 кадров по времени; плюс серии в
живых боях героев (`skillfx-shots.mjs`, 8 отрядов, все 36 форм) и монстров (`scripts/skillfx-mobs.ts` подбирает этапы,
где монстры применяют навыки с атласом, — 24 боя; `SHOTS_SIDES=B`).

    npx tsx scripts/skillfx-save.ts > /tmp/squads.json
    SHOTS_PORT=5491 node scripts/skillfx-atlas.mjs /tmp/squads.json /tmp/fx [id навыка…]
    npx tsx scripts/skillfx-mobs.ts > /tmp/mobs.json
    SHOTS_SIDES=B SHOTS_ATLAS=1 SHOTS_SIZE=390x844 node scripts/skillfx-shots.mjs /tmp/mobs.json /tmp/fx-mobs

### Что было не так (по категориям)

1. Масштаб — главная причина «неадаптированности». Роль рисовала атлас размером роли: попадание — квадрат 63 единицы
   (140 × 0.45) при клетке 226–442 px, да ещё с прозрачностью 0.5. Ледяной кристалл Frost Diver, святой крест, взрыв
   тележки, Звуковой удар, Клеймор на цели были бледной точкой 20–30 px на экране телефона; каст Баша/Боулинг Баша и дебаффы
   (220) — наоборот, крупнее фигуры. Теперь у атласа свой масштаб `effects.json → scale` (единиц игры на пиксель клетки;
   фигуры RO — ×3.2), кадр непрозрачный. Попадание ≈ 200–330 единиц, бафф ≈ 250–300 в высоту, площадь до ≈ 580.
2. Смешивание. Кадры RO сняты аддитивно на чёрном (альфа = яркость), а рисовались NORMAL: свечение тускнело, на светлой
   брусчатке — серая муть. Теперь `blend: add` (как в клиенте RO) у всех светящихся, `normal` — у твёрдых (камни, нож,
   кристалл льда на цели). Чёрного/пурпурного фона у кадров нет (проверено скриптом: ни одного тёмного непрозрачного пикселя).
3. Лёд мага. Ледяная стрела: осколок-снаряд был 46 единиц в ширину и почти невидим, летел белой палкой — теперь ×1.5, ADD,
   холодный оттенок, остриём к цели в обе стороны; кристалл на цели от ног, а не в воздухе. Frost Diver: в RO — дорожка
   ледяных шипов по земле к цели, а у нас летел тот же осколок, что у Ледяной стрелы, — теперь шипы вырастают из земли один
   за другим от мага к цели (`fx_job_mage_frost_diver_spikes`, тот же лист, `FLY_LOOK.ground`), затем кристалл. Снежная буря
   была пересвечена и закрывала цифры — scale 1.6, alpha 0.65. Кольцо мороза — кристалл на цели в масштабе.
4. Ориентация. Щит Удара щитом и метеор в кадрах прилетают справа сверху: у героя слева щит летел к нему, а не от него —
   `from: right`, кадр отражается, если кастер слева (FloatLayer.flash, fromX). Огненный шар, осколок льда — поворот по
   направлению проверен в обе стороны (прямой и обратный прогон).
5. Точка привязки. Центр кадра попадания был на уровне ног или ниже (взрыв под полоской ОЗ): anchor пересчитан по центру масс
   кадров — центр эффекта на 50–90 единиц над ногами (тело). Земляной шип стоял в воздухе — anchor у основания камня и
   рост из земли (`rise`).
6. Эффект не того навыка. Иероглиф 滅 Звукового удара висел на 17 навыках (разрезы монстров, косы, Удар в спину, Спиральный
   пронзатель) — оставлен только Звуковому удару; летящий щит — только Удару щитом (не якорь, прыжок, удар предка, Атака
   с разбега); снег Бури — не на «Марше мёртвых». У этих навыков вернулся их процедурный удар (`skillVisuals.ts`).
7. Негодные кадры (атлас отключён, `effects.json → rejected`, «нужен арт»): Небесный удар (плоская бежевая стена камней на
   пол-экрана), колба Кислотного террора/всплеска/бутыли (бледное полупрозрачное пятно), Град стрел (веер стрел из точки —
   розовая «звезда»), Вулкан (плоская розовая «корона» без огня). У всех — прежний процедурный эффект.
8. Скорость кадров — в норме (12 fps клиента), Земляной шип ускорен до 32 мс (камень выскакивает). Дублей «атлас + старый
   процедурный снаряд» нет (shot/flyAtlas рисуют одно из двух); искры и кольца рецептов остаются намеренно.

Память и производительность: те же листы (добавлена только вторая запись на лист осколка льда), бой грузит только атласы
навыков своих юнитов (`battleFxIds`), отклонённые атласы не грузятся. Тест `tests/animated-fx.test.ts` проверяет у каждого
атласа навыка scale/blend в пределах и ширину на экране ≤ 1080, отклонённые — не привязаны.

### Навык → что видно → проблема (было) → сейчас

| навык | атлас (роль) | что видно сейчас | проблема (было) |
| --- | --- | --- | --- |
| Ледяная стрела `job_mage_cold_bolt` | осколок (projectile) + кристалл (hit) | ледяной осколок остриём вперёд, кристалл со вспышкой на теле | осколок-палка 46 ед., кристалл-точка, NORMAL |
| Ледяной удар (Frost Diver) `job_mage_frost_diver` | шипы по земле (projectile) + кристалл (hit) | шипы вырастают дорожкой к цели, кристалл | летел осколок как у Ледяной стрелы, кристалл-точка |
| Кольцо мороза `job_wizard_frost_nova` | кристалл (hit) | кристалл на каждой цели | точка |
| Снежная буря `job_wizard_storm_gust` | буря (ground) | метель по площади целей | пересвечена, закрывала цифры |
| Огненная стрела `job_mage_fire_bolt` | взрыв (hit) | огненная вспышка на теле | мелко, у ног |
| Огненный шар `job_mage_fire_ball` / Лисий огонь `mob5_horong_foxfire` | шар (projectile) + взрыв (hit) | шар хвостом назад в обе стороны, взрыв | шар NORMAL, тусклый |
| Метеоритный дождь `job_wizard_meteor_storm`, `mob7_boss_meteor_storm` | метеор (ground) + взрыв (hit) | метеор падает со стороны кастера | всегда справа |
| Гроза `job_mage_thunderstorm` | молнии (hit) | молнии на целях | мелко, тускло |
| Гром Юпитера `job_wizard_jupitel_thunder` | шар (projectile) + разряд (hit) | шар молний, разряд на цели | разряд 50 px — не виден |
| Святой свет `job_acolyte_holy_light`, Магнус (hit), Лунный зов | крест (hit) | белый крест-вспышка на теле | точка |
| Святой крест `job_crusader_holy_cross` | крест (hit) | крест света на цели | 63 ед. при клетке 442 |
| Великий крест `job_crusader_grand_cross`, Магнус (ground), Суд фараона | крест (ground) | крест по земле под крестоносцем | на светлой земле бледный (ADD) — см. «нужен арт» |
| Благословение, Ассумптио, Благословение Изиды | искры (buff) | золотые искры на союзнике | тускло |
| Повышение ловкости, «Свистать всех наверх» | AGI UP (buff) | надпись и полосы | — (масштаб) |
| Знак креста, Проклятие договора | крест (debuff) | крест на враге | крупнее фигуры |
| Защита, Ангелус, Стальное тело, щиты монстров (8) | столб (buff) | белый столб на союзнике | — (масштаб, ADD) |
| Совершенство оружия | меч (buff) | меч и дуги | — |
| Двуручная спешка, Импозицио, Мощный удар, Боевая шкура | сфера (buff) | оранжевая сфера на теле | сфера у ног |
| Стойкость, Вой, Барабан, Смотр войска | руна 忍 (buff) | руна на теле | — |
| Баш `swordman_bash`, Боулинг Баш, Магнум Брейк | каст (cast) | вспышка/кольцо на кастере | каст 190 ед. — крупнее фигуры/ниже ног |
| Звуковой удар `job_assassin_sonic_blow` | разрез 滅 (hit) | разрезы и иероглиф на цели | точка; иероглиф на 17 чужих навыках |
| Мрачный клык, Удар в спину, Спиральный пронзатель, косы и разрезы монстров (17) | — | свой процедурный удар | иероглиф Звукового удара — не их эффект |
| Удар щитом `job_crusader_shield_charge` | щит (hit) | щит влетает от кастера, взрыв | летел к кастеру у героя слева |
| Атака с разбега, Якорь, Лунный прыжок, Сокрушение, Удар предка | — | свой процедурный удар | чужой летящий щит |
| Удар тележкой, Удар молота, тележка мастера, Метеоритный удар | взрыв (hit) | взрыв на теле | точка |
| Клеймор, Удар Асуры, Залп пушек | взрыв (hit) | оранжевый взрыв | точка |
| Сонная ловушка, Гнилые споры | облако (debuff) | зелёное облако на враге | — |
| Отравление и яды (12) | искры (hit) | фиолетовые искры | — |
| Ядовитый нож `job_thief_venom_knife` | нож (projectile) | нож кувыркается | — |
| Кража, Грабёж, Маммонит, Монетный дождь | блеск (hit) | блеск на цели | — |
| Развеивание, Лекс Этерна, печати и проклятия (12) | руна (debuff) | синяя руна и знаки | — |
| Земляной шип, Небесный удар (hit), Землетрясение (hit) | камень (hit) | камень вырастает из земли | висел в воздухе, NORMAL-полупрозрачный |
| Небесный удар, Землетрясение, Подъём предков (ground) | — (отклонён) | процедурные шипы | плоская стена камней на пол-экрана |
| Вулкан `job_sage_volcano` | — (отклонён) | процедурный вулкан | розовая плоская «корона» |
| Кислотный террор/всплеск, Огненная бутыль (projectile) | — (отклонён) | процедурная колба | бледное пятно |
| Град стрел `job_archer_arrow_shower` | — (отклонён) | процедурные стрелы | розовая «звезда» из стрел |
| Марш мёртвых `mob_lord_of_death_march` | — | процедурный удар | снег Бури на тёмном марше |

До/после (кадры 390×844): scratchpad `fxaudit/cmp` — Ледяная стрела (обе стороны), Frost Diver, Кольцо мороза, Снежная
буря, Святой крест, Удар тележкой, Удар щитом, Небесный удар, Святой свет.

### Нужен арт (заказ владельцу)

- Небесный удар / Землетрясение: ряд земляных шипов, вырастающих из земли (кадры роста), ~160×170 px на шип или ряд 512×256.
- Кислотный террор: плотная колба 32–48 px, 3–4 кадра кувырка (не альфа по яркости).
- Град стрел: пучок стрел, падающих сверху, или стрелы, вонзившиеся в землю, 128×128.
- Вулкан: огненный круг/лава на земле, 256×128, 12–20 кадров.
- Великий крест: на светлых фонах аддитивный крест бледный — нужен вариант с плотным ядром (или тёмный ореол).
- Земляной шип: захват полупрозрачный (альфа по яркости) — камень просвечивает; нужен непрозрачный камень.

## Зрелищность боя (29.09)

- Ульта монстра/босса (событие `ult`) и «большой» навык героя (`SkillVisual.big` в `skillVisuals.ts` — самый крупный
  активный навык каждой из 36 форм, тест `tests/battle-spectacle.test.ts`): аура подготовки у кастера ≈ 0,3 с (искры
  стягиваются, кольцо под ногами — `playCharge`), в момент удара — лёгкая встряска 160 мс и белая вспышка экрана 10%,
  кольцо на каждой цели (`playBigImpact`). Встряска не чаще раза в 450 мс (`SHAKE_GAP_MS`).
- Крупный удар (≥ 25% ОЗ цели или удар ульты) — золотая звезда-вспышка «крита» за цифрой (`playCrit`, ≈ 0,3 с).
- Бафф и щит на союзнике — три искорки мерцают над головой, ниже полосок (`playTwinkle`, ≈ 0,7 с); щит с листом RO
  (роль `buff`) — лист вместо общего щита.
- Смерть босса — вспышка экрана, встряска, золотые кольца и искры (`playBossDeath`), fx_death крупнее и пауза «hit stop»
  100 мс: часы боя, твины и анимации фигур замирают (`BattleScene.hitStop`, снимается на «Пропустить» и выходе из боя).
- «Уменьшить анимацию» (Настройки): без встряски, вспышек экрана и hit stop, частиц вдвое меньше; ауры и атласы остаются.

## Что выглядело одинаково (до)

- пассивки ["status"]: Стойкость (`swordman_endure`), Парирование (`job_knight_parrying`), Совиный глаз (`job_archer_owls_eye`), Глаз стервятника (`job_archer_vultures_eye`), Гроза зверей (`job_hunter_beast_bane`), Поэма Браги (`job_bard_poem_of_bragi`), Уклонение (`job_thief_improve_dodge`), Мастерство катара (`job_assassin_katar_mastery`), Плагиат (`job_rogue_plagiarism`), Громкий голос (`job_merchant_crazy_uproar`), Наценка (`job_merchant_overcharge`), Владение двуручным мечом (`job_knight_two_hand_mastery`), Авто-Берсерк (`job_swordman_auto_berserk`), Двуручная спешка (`job_knight_two_hand_quicken`), Восстановление SP (`job_mage_sp_recovery`), Усиление магии (`job_wizard_mystical_amplification`), Свободное чтение (`job_sage_free_cast`), Выброс адреналина (`job_blacksmith_adrenaline_rush`), Божья защита (`job_acolyte_divine_protection`), Магнификат (`job_priest_magnificat`), Призыв сфер (`job_monk_call_spirits`), Железный кулак (`job_monk_iron_hand`), Отравленное оружие (`job_assassin_enchant_poison`)
- пассивки ["heal"]: Восстановление ОЗ (`job_swordman_hp_recovery`), Яблоко Идун (`job_bard_apple_of_idun`), Метание зелья (`job_alchemist_potion_pitcher`), Поглощение души (`job_wizard_soul_drain`)
- общая площадь «ring» по стихии: Боулинг Баш (`job_knight_bowling_bash`), Налёт (`job_rogue_raid`)
- пассивки ["damage"]: Контратака (`job_knight_auto_counter`), Стальной сокол (`job_hunter_steel_crow`), Двойная атака (`job_thief_double_attack`)
- общий: вспышка на кастере + общий бафф/щит: Самопожертвование (`job_crusader_devotion`), Повышение ловкости (`job_acolyte_increase_agi`), Импозицио Манус (`job_priest_impositio_manus`), Исцеление (`job_acolyte_heal`), Благословение (`job_acolyte_blessing`), Кирие Элейсон (`job_priest_kyrie_eleison`), Ассумптио (`job_priest_assumptio`)
- пассивки ["shield"]: Вера (`job_crusader_faith`), Автозащита (`job_crusader_auto_guard`), Химическая защита (`job_alchemist_chemical_protection`), Энергетический покров (`job_mage_energy_coat`), Магический жезл (`job_sage_magic_rod`), Тележка (`job_merchant_pushcart`), Закалка (`job_blacksmith_tempering`)
- общий: вспышка на кастере + общий бафф/щит: Защита (`job_crusader_defender`), Мощный удар (`job_blacksmith_power_thrust`), Стена безопасности (`job_mage_safety_wall`), Поцелуй удачи (`job_dancer_fortune_kiss`), Совершенство оружия (`job_blacksmith_weapon_perfection`), Ангелус (`job_acolyte_angelus`)
- общий снаряд «arrow» по стихии: Удар сокола (`job_hunter_blitz_beat`), Атака сокола (`job_hunter_falcon_assault`), Музыкальный удар (`job_bard_musical_strike`), Удар тележкой мастера (`job_blacksmith_cart_termination`), Удар щитом (`job_crusader_shield_charge`), Капкан (`job_hunter_ankle_snare`), Бросок стрелы (`job_dancer_slinging_arrow`)
- общий: вспышка на кастере + общий бафф/щит: Закат ассасина (`job_bard_assassin_cross`), Концентрация (`job_archer_improve_concentration`), Стальное тело (`job_monk_steel_body`)
- общий: обычный удар оружия: Звуковой удар (`job_assassin_sonic_blow`), Разоружение (`job_rogue_strip_weapon`), Удар сковородой (`job_merchant_frying_pan`), Атака с разбега (`job_knight_charge_attack`), Спиральный пронзатель (`job_knight_spiral_pierce`), Тройная атака (`job_monk_triple_attack`), Проникающий удар (`job_monk_investigate`), Хватка клинка (`job_monk_blade_stop`), Удар в спину (`job_rogue_back_stab`)
- общий снаряд «fireball» по стихии: Огненный шар (`job_mage_fire_ball`), Огненная бутыль (`job_alchemist_demonstration`)
- общий: вспышка стихии + удар оружия: Трясина (`job_wizard_quagmire`), Крик (`job_bard_scream`), Не забывай меня (`job_dancer_dont_forget_me`), Знак креста (`job_acolyte_signum_crucis`), Лекс Этерна (`job_priest_lex_aeterna`), Удар Асуры (`job_monk_asura_strike`)
- общая площадь «arrows» по стихии: Клеймор (`job_hunter_claymore_trap`), Сонная ловушка (`job_hunter_sandman`), Снять доспех (`job_rogue_strip_armor`)
- общий снаряд «poison» по стихии: Кислотный террор (`job_alchemist_acid_terror`), Ядовитый нож (`job_thief_venom_knife`)

## По героям и формам

Колонки: ур. — уровень открытия; «было» — вид до правки; «стало» — запись в `skillVisuals.ts`; иконка.

### Алан (`alan`)

**база (Мечник)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Баш `swordman_bash` | активный | свой удар (SKILL_HIT); RO | удар `bash`: красный крест-разрез, звёзды | RO `sm_bash` |
| 10 | Стойкость `swordman_endure` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `endure`, вспышка `flash`: оранжевое кольцо и искры вверх | RO `sm_endure` |
| 30 | Восстановление ОЗ `job_swordman_hp_recovery` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `regen`, вспышка `flash`: малый столб лечения, зелёное кольцо | RO `sm_recovery` |
| 50 | Провокация `job_swordman_provoke` | активный | свой (SIGNATURE); RO | рецепт `provoke`: красный крик-кольцо, «!» над целью | RO `sm_provoke` |

**Рыцарь**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Боулинг Баш `job_knight_bowling_bash` | активный | общая площадь «ring» по стихии; символ кодом | рецепт `bowlingBash`: широкий размах, цели отлетают кеглями по очереди | RO `kn_bowlingbash` |
| 10 | Провокация `job_swordman_provoke` | активный | свой (SIGNATURE); RO | рецепт `provoke`: красный крик-кольцо, «!» над целью | RO `sm_provoke` |
| 30 | Контратака `job_knight_auto_counter` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | удар `counter`, вспышка `flash`: встречный крест-разрез сталью | RO `kn_autocounter` |
| 50 | Парирование `job_knight_parrying` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `parry`, вспышка `flash`: два клинка скрещиваются перед телом, искра | RO `lk_parrying` |

**Крестоносец**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Самопожертвование `job_crusader_devotion` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `devotion`, аура `devotion`: золотая цепь света к союзнику, золотой пузырь | RO `cr_devotion` |
| 10 | Вера `job_crusader_faith` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `faith`, вспышка `flash`: золотой крест над головой, пузырь | RO `cr_trust` |
| 30 | Автозащита `job_crusader_auto_guard` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `autoGuard`, вспышка `flash`: щит вспыхивает перед телом | RO `cr_autoguard` |
| 50 | Защита `job_crusader_defender` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `defender`, аура `bulwark`: большой щит у кастера, щиты над союзниками | RO `cr_defender` |

### Бран (`bran`)

**база (Лучник)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Двойной выстрел `job_archer_double_strafe` | активный | явный arrow (FX_OVERRIDE); RO | свой снаряд/площадь (skillLook): две золотые светящиеся стрелы | RO `ac_double` |
| 10 | Совиный глаз `job_archer_owls_eye` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `owl`, вспышка `flash`: зелёный блик над головой | RO `ac_owl` |
| 30 | Глаз стервятника `job_archer_vultures_eye` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `vulture`, вспышка `flash`: янтарный блик и штрих | RO `ac_vulture` |
| 50 | Заряженная стрела `job_archer_charge_arrow` | активный | свой удар (SKILL_HIT) + снаряд arrow; RO | удар `knock`, свой снаряд/площадь (skillLook): крупная голубая стрела, полосы отброса | RO `ac_chargearrow` |

**Охотник**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Удар сокола `job_hunter_blitz_beat` | активный | общий снаряд «arrow» по стихии; символ кодом | рецепт `blitzBeat`: сокол пикирует на цели по очереди, перья | RO `ht_blitzbeat` |
| 10 | Гроза зверей `job_hunter_beast_bane` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `beast`, вспышка `flash`: оранжевые когти | RO `ht_beastbane` |
| 30 | Стальной сокол `job_hunter_steel_crow` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | удар `peck`, вспышка `falcon`: сокол к цели, когти, перья | RO `ht_steelcrow` |
| 50 | Атака сокола `job_hunter_falcon_assault` | активный | общий снаряд «arrow» по стихии; символ кодом | рецепт `falconAssault`: сокол крупно пикирует с золотым шлейфом | RO `sn_falconassault` |

**Бард**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Музыкальный удар `job_bard_musical_strike` | активный | общий снаряд «arrow» по стихии; символ кодом | рецепт `musicalStrike`: ноты волной к цели, кольцо нот | RO `ba_musicalstrike` |
| 10 | Поэма Браги `job_bard_poem_of_bragi` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `bragi`, вспышка `notes`: голубые ноты вверх над союзниками | RO `ba_poembragi` |
| 30 | Яблоко Идун `job_bard_apple_of_idun` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `idun`, вспышка `notes`: зелёные ноты над целью лечения | RO `ba_appleidun` |
| 50 | Закат ассасина `job_bard_assassin_cross` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `assassinCross`, аура `song`: кольцо красных нот, ноты над союзниками | RO `ba_assassincross` |

### Дорн (`dorn`)

**база (Вор)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Кража `job_thief_steal` | активный | свой удар (SKILL_HIT); RO | удар `steal`: укол, монетка летит к вору | RO `tf_steal` |
| 10 | Уклонение `job_thief_improve_dodge` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `dodge`, вспышка `flash`: голубые остаточные полосы по бокам | RO `tf_miss` |
| 30 | Двойная атака `job_thief_double_attack` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | удар `double`, вспышка `flash`: два быстрых укола | RO `tf_double` |
| 50 | Песок в глаза `job_thief_sand_attack` | активный | свой удар (SKILL_HIT); RO | удар `sand`: облако песка у лица | RO `tf_sprinklesand` |

**Ассасин**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Звуковой удар `job_assassin_sonic_blow` | активный | общий: обычный удар оружия; символ кодом | рецепт `sonicBlow`: шквал тонких фиолетовых разрезов | RO `as_sonicblow` |
| 10 | Мастерство катара `job_assassin_katar_mastery` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `katar`, вспышка `flash`: фиолетовый блеск катара | RO `as_katar` |
| 30 | Двойная атака `job_thief_double_attack` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | удар `double`, вспышка `flash`: два быстрых укола | RO `tf_double` |
| 50 | Метеоритный удар `job_assassin_meteor_assault` | активный | общая площадь «ring» по стихии; символ кодом | рецепт `meteorAssault`: тёмная вспышка, фиолетовые взрывы у фронта | RO `asc_meteorassault` |

**Разбойник**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Налёт `job_rogue_raid` | активный | общая площадь «ring» по стихии; символ кодом | рецепт `raid`: выход из тёмного дыма, разрезы по фронту | RO `rg_raid` |
| 10 | Плагиат `job_rogue_plagiarism` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `plagiarism`, вспышка `flash`: фиолетовые искры стягиваются к телу | RO `rg_plagiarism` |
| 30 | Уклонение `job_thief_improve_dodge` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `dodge`, вспышка `flash`: голубые остаточные полосы по бокам | RO `tf_miss` |
| 50 | Разоружение `job_rogue_strip_weapon` | активный | общий: обычный удар оружия; символ кодом | рецепт `stripWeapon`: клинок цели кувырком отлетает | RO `rg_stripweapon` |

### Грета (`greta`)

**база (Торговец)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Маммонит `job_merchant_mammonite` | активный | свой удар (SKILL_HIT); RO | удар `coins`: золотое кольцо и россыпь монет | RO `mc_mammonite` |
| 10 | Громкий голос `job_merchant_crazy_uproar` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `uproar`, вспышка `shout`: оранжевый крик-кольцо | RO `mc_loud` |
| 30 | Удар сковородой `job_merchant_frying_pan` | активный | общий: обычный удар оружия; символ кодом | рецепт `fryingPan`: сковорода сверху, «бонг», звёзды | код: `pan` |
| 50 | Наценка `job_merchant_overcharge` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `overcharge`, вспышка `flash`: монеты над головой | RO `mc_overcharge` |

**Кузнец**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Удар сковородой `job_merchant_frying_pan` | активный | общий: обычный удар оружия; символ кодом | рецепт `fryingPan`: сковорода сверху, «бонг», звёзды | код: `pan` |
| 10 | Мощный удар `job_blacksmith_power_thrust` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | аура `fury`: красное пламя вокруг | RO `bs_overthrust` |
| 30 | Удар молота `job_blacksmith_hammer_fall` | активный | свой удар (SKILL_HIT); символ кодом | рецепт `hammerFall`: ударная волна по земле, звёзды, пыль | RO `bs_hammerfall` |
| 50 | Удар тележкой мастера `job_blacksmith_cart_termination` | активный | общий снаряд «arrow» по стихии; символ кодом | рецепт `cartTermination`: полосы, монеты, тяжёлый удар | RO `ws_carttermination` |

**Алхимик**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Метание зелья `job_alchemist_potion_pitcher` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `potion`, вспышка `potion`: красная колба по дуге к союзнику | RO `am_potionpitcher` |
| 10 | Химическая защита `job_alchemist_chemical_protection` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `chemical`, вспышка `flash`: жёлто-зелёный пузырь | RO `am_cp_armor` |
| 30 | Удар сковородой `job_merchant_frying_pan` | активный | общий: обычный удар оружия; символ кодом | рецепт `fryingPan`: сковорода сверху, «бонг», звёзды | код: `pan` |
| 50 | Белые зелья `job_alchemist_slim_potion` | активный | общая площадь «sanctuary» по стихии; символ кодом | рецепт `slimPotion`: белые колбы к каждому союзнику | RO `cr_slimpitcher` |

### Ирис (`iris`)

**база (Мечник)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Магнум Брейк `job_swordman_magnum_break` | активный | свой (SIGNATURE); RO | рецепт `magnum`: огненное кольцо, языки пламени | RO `sm_magnum` |
| 10 | Владение двуручным мечом `job_knight_two_hand_mastery` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `bladeGlint`, вспышка `flash`: блеск клинка над головой | RO `sm_twohand` |
| 30 | Баш `swordman_bash` | активный | свой удар (SKILL_HIT); RO | удар `bash`: красный крест-разрез, звёзды | RO `sm_bash` |
| 50 | Авто-Берсерк `job_swordman_auto_berserk` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `rage`, вспышка `flash`: красное пламя вокруг | RO `sm_autoberserk` |

**Рыцарь**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Атака с разбега `job_knight_charge_attack` | активный | общий: обычный удар оружия; символ кодом | рецепт `chargeAttack`: полосы скорости, удар навылет, пыль | RO `kn_chargeatk` |
| 10 | Двуручная спешка `job_knight_two_hand_quicken` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `quicken`, вспышка `flash`: жёлтые полосы скорости вверх | RO `kn_twohandquicken` |
| 30 | Владение двуручным мечом `job_knight_two_hand_mastery` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `bladeGlint`, вспышка `flash`: блеск клинка над головой | RO `sm_twohand` |
| 50 | Спиральный пронзатель `job_knight_spiral_pierce` | активный | общий: обычный удар оружия; символ кодом | рецепт `spiralPierce`: кольца-«бур» к цели, золотой удар навылет | RO `lk_spiralpierce` |

**Крестоносец**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Святой крест `job_crusader_holy_cross` | активный | общий: вспышка стихии + удар оружия; символ кодом | рецепт `holyCross`: золотой крест на цели, крестовый разрез | RO `cr_holycross` |
| 10 | Удар щитом `job_crusader_shield_charge` | активный | общий снаряд «arrow» по стихии; символ кодом | рецепт `shieldCharge`: щит летит в цель, звёзды | RO `cr_shieldcharge` |
| 30 | Вера `job_crusader_faith` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `faith`, вспышка `flash`: золотой крест над головой, пузырь | RO `cr_trust` |
| 50 | Великий крест `job_crusader_grand_cross` | активный | явный holy (FX_OVERRIDE); символ кодом | рецепт `grandCross`: огромный крест света от кастера, багровые столбы на целях | RO `cr_grandcross` |

### Кай (`kai`)

**база (Маг)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Огненная стрела `job_mage_fire_bolt` | активный | свой (огненная стрела); RO | свой снаряд/площадь (skillLook): огненные стрелы с неба (было) | RO `mg_firebolt` |
| 10 | Восстановление SP `job_mage_sp_recovery` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `mana`, вспышка `flash`: синие искры вверх | RO `mg_srecovery` |
| 30 | Огненный шар `job_mage_fire_ball` | активный | общий снаряд «fireball» по стихии; символ кодом | рецепт `fireBall`: огненный шар, крупный взрыв | RO `mg_fireball` |
| 50 | Гроза `job_mage_thunderstorm` | активный | явный lightning (FX_OVERRIDE); RO | свой снаряд/площадь (skillLook): молнии по целям (было) | RO `mg_thunderstorm` |

**Волшебник**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Гром Юпитера `job_wizard_jupitel_thunder` | активный | явный lightning (FX_OVERRIDE); символ кодом | рецепт `jupitel`: шар молний, разряды, отброс | RO `wz_jupitel` |
| 10 | Усиление магии `job_wizard_mystical_amplification` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `amplify`, вспышка `flash`: фиолетовый круг под ногами | RO `hw_magicpower` |
| 30 | Поглощение души `job_wizard_soul_drain` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `soulDrain`, вспышка `soulDrain`: фиолетовые искры стягиваются к магу | RO `hw_souldrain` |
| 50 | Метеоритный дождь `job_wizard_meteor_storm` | активный | явный meteor (FX_OVERRIDE); символ кодом | рецепт `meteorStorm`: метеоры с неба, кратеры с пылью | RO `wz_meteor` |

**Мудрец**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Земляной шип `job_sage_earth_spike` | активный | явный rock (FX_OVERRIDE); символ кодом | свой снаряд/площадь (skillLook): каменные шипы (было) | RO `wz_earthspike` |
| 10 | Свободное чтение `job_sage_free_cast` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `freeCast`, вспышка `flash`: бирюзовый круг | RO `sa_freecast` |
| 30 | Огненный шар `job_mage_fire_ball` | активный | общий снаряд «fireball» по стихии; символ кодом | рецепт `fireBall`: огненный шар, крупный взрыв | RO `mg_fireball` |
| 50 | Небесный удар `job_sage_heavens_drive` | активный | общая площадь «quake» по стихии; символ кодом | рецепт `heavensDrive`: ряды земляных шипов разом | RO `wz_heavendrive` |

### Лира (`lira`)

**база (Маг)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Ледяная стрела `job_mage_cold_bolt` | активный | общий снаряд «ice» по стихии; символ кодом | рецепт `coldBolt`: ледяные копья с неба по очереди | RO `mg_coldbolt` |
| 10 | Энергетический покров `job_mage_energy_coat` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `energyCoat`, вспышка `flash`: сине-фиолетовый пузырь | RO `mg_energycoat` |
| 30 | Ледяной удар `job_mage_frost_diver` | активный | свой удар (SKILL_HIT) + снаряд ice; RO | удар `ice`, свой снаряд/площадь (skillLook): ледяной осколок, веер льда (было) | RO `mg_frostdiver` |
| 50 | Стена безопасности `job_mage_safety_wall` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | аура `safetyWall`: розовые столбы света вокруг союзника | RO `mg_safetywall` |

**Волшебник**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Кольцо мороза `job_wizard_frost_nova` | активный | общая площадь «blizzard» по стихии; символ кодом | рецепт `frostNova`: ледяное кольцо от мага, иглы льда под врагами | RO `wz_frostnova` |
| 10 | Трясина `job_wizard_quagmire` | активный | общий: вспышка стихии + удар оружия; символ кодом | рецепт `quagmire`: бурые лужи трясины, пузыри | RO `wz_quagmire` |
| 30 | Ледяной удар `job_mage_frost_diver` | активный | свой удар (SKILL_HIT) + снаряд ice; RO | удар `ice`, свой снаряд/площадь (skillLook): ледяной осколок, веер льда (было) | RO `mg_frostdiver` |
| 50 | Снежная буря `job_wizard_storm_gust` | активный | явный blizzard (FX_OVERRIDE); символ кодом | свой снаряд/площадь (skillLook): метель из ледяных осколков (было) | RO `wz_stormgust` |

**Мудрец**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Развеивание `job_sage_dispell` | активный | общий снаряд «arcane» по стихии; символ кодом | рецепт `dispell`: кольцо сжимается, осколки чар | RO `sa_dispell` |
| 10 | Магический жезл `job_sage_magic_rod` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `magicRod`, вспышка `flash`: фиолетовый вихрь к телу | RO `sa_magicrod` |
| 30 | Стена безопасности `job_mage_safety_wall` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | аура `safetyWall`: розовые столбы света вокруг союзника | RO `mg_safetywall` |
| 50 | Вулкан `job_sage_volcano` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `volcano`, аура `volcano`: огненный круг, пламя, огонь у союзников | RO `sa_volcano` |

### Мэйлин (`meilin`)

**база (Лучник)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Дождь стрел `job_archer_arrow_shower` | активный | явный arrows (FX_OVERRIDE); RO | свой снаряд/площадь (skillLook): дождь стрел сверху | RO `ac_shower` |
| 10 | Концентрация `job_archer_improve_concentration` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | аура `focus`: кольца стягиваются к лучнику | RO `ac_concentration` |
| 30 | Заряженная стрела `job_archer_charge_arrow` | активный | свой удар (SKILL_HIT) + снаряд arrow; RO | удар `knock`, свой снаряд/площадь (skillLook): крупная голубая стрела, полосы отброса | RO `ac_chargearrow` |
| 50 | Глаз стервятника `job_archer_vultures_eye` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `vulture`, вспышка `flash`: янтарный блик и штрих | RO `ac_vulture` |

**Охотник**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Капкан `job_hunter_ankle_snare` | активный | общий снаряд «arrow» по стихии; символ кодом | рецепт `ankleSnare`: железные челюсти захлопываются у ног | RO `ht_anklesnare` |
| 10 | Концентрация `job_archer_improve_concentration` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | аура `focus`: кольца стягиваются к лучнику | RO `ac_concentration` |
| 30 | Клеймор `job_hunter_claymore_trap` | активный | общая площадь «arrows» по стихии; символ кодом | рецепт `claymore`: ловушки под фронтом, взрывы по очереди | RO `ht_claymoretrap` |
| 50 | Сонная ловушка `job_hunter_sandman` | активный | общая площадь «arrows» по стихии; символ кодом | рецепт `sandman`: сиреневые облака сна у голов | RO `ht_sandman` |

**Танцовщица**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Бросок стрелы `job_dancer_slinging_arrow` | активный | общий снаряд «arrow» по стихии; символ кодом | рецепт `slingingArrow`: розовая стрела, сердечки на цели | RO `dc_throwarrow` |
| 10 | Крик `job_bard_scream` | активный | общий: вспышка стихии + удар оружия; символ кодом | рецепт `scream`: звуковые волны через поле | RO `dc_scream` |
| 30 | Не забывай меня `job_dancer_dont_forget_me` | активный | общий: вспышка стихии + удар оружия; символ кодом | рецепт `dontForgetMe`: фиолетовые круги под врагами, падающие ноты | RO `dc_dontforgetme` |
| 50 | Поцелуй удачи `job_dancer_fortune_kiss` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `fortuneKiss`, аура `kiss`: сердечки над союзниками | RO `dc_fortunekiss` |

### Отто (`otto`)

**база (Торговец)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Удар тележкой `job_merchant_cart_revolution` | активный | свой (SIGNATURE); RO | рецепт `cart`: размах тележкой, пыль | RO `mc_cartrevolution` |
| 10 | Тележка `job_merchant_pushcart` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `pushcart`, вспышка `flash`: бурый пузырь и пыль | RO `mc_pushcart` |
| 30 | Маммонит `job_merchant_mammonite` | активный | свой удар (SKILL_HIT); RO | удар `coins`: золотое кольцо и россыпь монет | RO `mc_mammonite` |
| 50 | Громкий голос `job_merchant_crazy_uproar` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `uproar`, вспышка `shout`: оранжевый крик-кольцо | RO `mc_loud` |

**Кузнец**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Удар молота `job_blacksmith_hammer_fall` | активный | свой удар (SKILL_HIT); символ кодом | рецепт `hammerFall`: ударная волна по земле, звёзды, пыль | RO `bs_hammerfall` |
| 10 | Закалка `job_blacksmith_tempering` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `temper`, вспышка `flash`: оранжевые искры, кольцо | RO `bs_iron` |
| 30 | Выброс адреналина `job_blacksmith_adrenaline_rush` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `adrenaline`, вспышка `flash`: красные полосы вверх | RO `bs_adrenaline` |
| 50 | Совершенство оружия `job_blacksmith_weapon_perfection` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `weaponPerfection`, аура `forge`: сноп искр горна | RO `bs_weaponperfect` |

**Алхимик**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Кислотный террор `job_alchemist_acid_terror` | активный | общий снаряд «poison» по стихии; символ кодом | рецепт `acidTerror`: колба по дуге, шипящая кислота | RO `am_acidterror` |
| 10 | Огненная бутыль `job_alchemist_demonstration` | активный | общий снаряд «fireball» по стихии; символ кодом | рецепт `demonstration`: колба, взрыв огня, пламя | RO `am_demonstration` |
| 30 | Маммонит `job_merchant_mammonite` | активный | свой удар (SKILL_HIT); RO | удар `coins`: золотое кольцо и россыпь монет | RO `mc_mammonite` |
| 50 | Кислотный всплеск `job_alchemist_acid_bomb` | активный | общая площадь «cloud» по стихии; символ кодом | рецепт `acidBomb`: колбы градом, всплески кислоты | RO `cr_aciddemonstration` |

### Тео (`teo`)

**база (Аколит)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Святой свет `job_acolyte_holy_light` | активный | явный beam (FX_OVERRIDE); RO | свой снаряд/площадь (skillLook): луч и столб света (было) | RO `al_holylight` |
| 10 | Повышение ловкости `job_acolyte_increase_agi` | активный | общий: вспышка на кастере + общий бафф/щит; RO | аура `agi`: голубой столб, перья | RO `al_incagi` |
| 30 | Знак креста `job_acolyte_signum_crucis` | активный | общий: вспышка стихии + удар оружия; символ кодом | рецепт `signumCrucis`: золотой крест над каждым врагом | RO `al_crucis` |
| 50 | Божья защита `job_acolyte_divine_protection` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `divine`, вспышка `flash`: малый крест, кольцо | RO `al_dp` |

**Жрец**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Импозицио Манус `job_priest_impositio_manus` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `impositio`, аура `impositio`: меч света опускается на союзника | RO `pr_impositio` |
| 10 | Магнификат `job_priest_magnificat` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `magnificat`, вспышка `flash`: бело-голубые искры, нимб | RO `pr_magnificat` |
| 30 | Магнус Экзорцизмус `job_priest_magnus_exorcismus` | активный | явный holy (FX_OVERRIDE); символ кодом | рецепт `magnus`: кресты на земле и столбы света | RO `pr_magnus` |
| 50 | Лекс Этерна `job_priest_lex_aeterna` | активный | общий: вспышка стихии + удар оружия; символ кодом | рецепт `lexAeterna`: алый рунный круг на груди | RO `pr_lexaeterna` |

**Монах**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Тройная атака `job_monk_triple_attack` | активный | общий: обычный удар оружия; символ кодом | рецепт `tripleAttack`: три удара с огненными кольцами | RO `mo_tripleattack` |
| 10 | Призыв сфер `job_monk_call_spirits` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `spheres`, вспышка `spheres`: пять сфер кружат вокруг | RO `mo_callspirits` |
| 30 | Проникающий удар `job_monk_investigate` | активный | общий: обычный удар оружия; символ кодом | рецепт `investigate`: голубая волна насквозь | RO `mo_investigate` |
| 50 | Удар Асуры `job_monk_asura_strike` | активный | общий: вспышка стихии + удар оружия; символ кодом | рецепт `asura`: сферы в кулак, огромный золотой взрыв | RO `mo_extremityfist` |

### Вика (`vika`)

**база (Аколит)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Исцеление `job_acolyte_heal` | активный | общий: вспышка на кастере + общий бафф/щит; RO | свой снаряд/площадь (skillLook): бело-зелёный столб (было) | RO `al_heal` |
| 5 | Божья защита `job_acolyte_divine_protection` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `divine`, вспышка `flash`: малый крест, кольцо | RO `al_dp` |
| 10 | Благословение `job_acolyte_blessing` | активный | общий: вспышка на кастере + общий бафф/щит; RO | аура `blessing`: золотой столб, крест над головой | RO `al_blessing` |
| 50 | Ангелус `job_acolyte_angelus` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `angelus`, аура `angelus`: нимб над головами, перья | RO `al_angelus` |

**Жрец**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Исцеление `job_acolyte_heal` | активный | общий: вспышка на кастере + общий бафф/щит; RO | свой снаряд/площадь (skillLook): бело-зелёный столб (было) | RO `al_heal` |
| 10 | Кирие Элейсон `job_priest_kyrie_eleison` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | аура `kyrie`: двойной пузырь, крестики | RO `pr_kyrie` |
| 30 | Святилище `job_priest_sanctuary` | активный | явный sanctuary (FX_OVERRIDE); RO | свой снаряд/площадь (skillLook): круги святилища (было) | RO `pr_sanctuary` |
| 50 | Ассумптио `job_priest_assumptio` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | рецепт `assumptio`, аура `assumptio`: розово-золотая сфера, перья | RO `hp_assumptio` |

**Монах**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Хватка клинка `job_monk_blade_stop` | активный | общий: обычный удар оружия; символ кодом | рецепт `bladeStop`: две ладони-дуги схлопываются | RO `mo_bladestop` |
| 10 | Железный кулак `job_monk_iron_hand` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | аура `ironHand`, вспышка `flash`: оранжевое кольцо у кулака | RO `mo_ironhand` |
| 30 | Божья защита `job_acolyte_divine_protection` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `divine`, вспышка `flash`: малый крест, кольцо | RO `al_dp` |
| 50 | Стальное тело `job_monk_steel_body` | активный | общий: вспышка на кастере + общий бафф/щит; символ кодом | аура `steelBody`: серебряный пузырь, металлический блеск | RO `mo_steelbody` |

### Зара (`zara`)

**база (Вор)**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Отравление `job_thief_envenom` | активный | свой удар (SKILL_HIT); RO | удар `envenom`: разрез и зелёный всплеск яда | RO `tf_poison` |
| 10 | Двойная атака `job_thief_double_attack` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | удар `double`, вспышка `flash`: два быстрых укола | RO `tf_double` |
| 30 | Ядовитый нож `job_thief_venom_knife` | активный | общий снаряд «poison» по стихии; символ кодом | рецепт `venomKnife`: кинжал с зелёным следом, всплеск яда | RO `as_venomknife` |
| 50 | Уклонение `job_thief_improve_dodge` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; RO | аура `dodge`, вспышка `flash`: голубые остаточные полосы по бокам | RO `tf_miss` |

**Ассасин**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Мрачный клык `job_assassin_grimtooth` | активный | общий снаряд «dark» по стихии; символ кодом | рецепт `grimtooth`: тёмные шипы из-под земли, когти | RO `as_grimtooth` |
| 10 | Отравленное оружие `job_assassin_enchant_poison` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | вспышка `venomEdge`: зелёный блеск клинка, клякса яда на цели | RO `as_enchantpoison` |
| 30 | Ядовитый нож `job_thief_venom_knife` | активный | общий снаряд «poison» по стихии; символ кодом | рецепт `venomKnife`: кинжал с зелёным следом, всплеск яда | RO `as_venomknife` |
| 50 | Ядовитый взрыв `job_assassin_venom_splasher` | активный | общий: вспышка стихии + удар оружия; символ кодом | рецепт `venomSplasher`: большой зелёный взрыв яда | RO `as_splasher` |

**Разбойник**

| ур. | навык | тип | было | стало | иконка |
| --- | --- | --- | --- | --- | --- |
| 1 | Удар в спину `job_rogue_back_stab` | активный | общий: обычный удар оружия; символ кодом | рецепт `backStab`: дым за спиной, глубокий красный укол | RO `rg_backstap` |
| 10 | Грабёж `job_rogue_gank` | пассивка | пассивка: только подпись + общий эффект статуса/лечения/щита; символ кодом | удар `gank`, вспышка `flash`: удар и монетки к разбойнику | RO `rg_snatcher` |
| 30 | Песок в глаза `job_thief_sand_attack` | активный | свой удар (SKILL_HIT); RO | удар `sand`: облако песка у лица | RO `tf_sprinklesand` |
| 50 | Снять доспех `job_rogue_strip_armor` | активный | общая площадь «arrows» по стихии; символ кодом | рецепт `stripArmor`: щит над целью разлетается осколками | RO `rg_striparmor` |

## Монстры (без изменений)

Ульты и навыки монстров остались как были; своё у 14 из 32. Иконки — символ кодом (видны только в баннере ульты босса).

| навык | вид |
| --- | --- |
| Залп `archer_volley` | общий снаряд `arrow` по стихии |
| Прыжок `assassin_leap` | удар `leap` |
| Стена щитов `guard_shield_wall` | общий (вспышка стихии / удар / бафф) |
| Огненный шторм `mage_firestorm` | общая площадь `ring` по стихии |
| Гнилые споры `mob2_boss_rot_spores` | общая площадь `cloud` по стихии |
| Хватка утопленника `mob2_elite_frenzy` | общий (вспышка стихии / удар / бафф) |
| Грязевой плюх `mob2_fast_mud_splash` | удар `mud` |
| Гнилой укус `mob2_melee_bite` | удар `bite` |
| Отравленная стрела `mob2_ranged_poison_arrow` | общий снаряд `poison` по стихии |
| Моховая кора `mob2_tank_mire` | общий (вспышка стихии / удар / бафф) |
| Мёртвая волна `mob3_boss_nova` | общая площадь `cloud` по стихии |
| Проклятый таран `mob3_elite_cleave` | удар `smash` |
| Пикирование `mob3_fast_haunt` | удар `leap` |
| Рассечь `mob3_melee_rend` | общий (вспышка стихии / удар / бафф) |
| Залп тьмы `mob3_ranged_volley` | общий снаряд `arrow` по стихии |
| Землетрясение `mob_boss1_quake` | общая площадь `quake` по стихии |
| Проклятие `mob_boss2_curse` | общая площадь `cloud` по стихии |
| Лунный прыжок `mob_eclipse_moon_leap` | удар `leap` |
| Сокрушение `mob_elite_smash` | удар `smash` |
| Бросок `mob_fast_lunge` | удар `leap` |
| Кроличий прыжок `mob_lunatic_leap` | удар `leap` |
| Хватка корней `mob_mandragora_roots` | рецепт `roots` |
| Желейная броня `mob_mastering_jelly_armor` | общий (вспышка стихии / удар / бафф) |
| Гнев короля `mob_mastering_kings_wrath` | общий (вспышка стихии / удар / бафф) |
| Королевский прыжок `mob_mastering_royal_bounce` | рецепт `bounce` |
| Липкий плюх `mob_mastering_sticky_slam` | удар `bounce` |
| Ядовитая слизь `mob_poporing_goo` | удар `goo` |
| Пинок кузнечика `mob_rocker_kick` | удар `kick` |
| Корневая броня `mob_tank_guard` | общий (вспышка стихии / удар / бафф) |
| Оглушающая трель `mob_vocal_song` | общая площадь `arrows` по стихии |
| Молитва `priest_blessing` | общая площадь `sanctuary` по стихии |
| Размах `warrior_cleave` | общая площадь `ring` по стихии |

### Монстры маршрута из 10 глав (29.09)

Новые монстры слотов 2, 3, 7 и Владыка мёртвых (гл. 10). Свой удар — у навыков, где общий вид по стихии не передаёт смысл;
остальные (лечение, щиты, баффы, площадные удары по всем, плевок и выстрелы) — общий вид по стихии и эффектам.

| навык | вид |
| --- | --- |
| Цап-хап `sewer_thief_bug_snatch` | удар `steal` (кража) |
| Жвалы-кусачки `sewer_bug_male_rush`, Приданое для кладки `sewer_bug_leader_clutch`, Укус из-под свода `sewer_familiar_bite` | удар `bite` |
| Крысиный наскок `sewer_tarou_pounce` | удар `leap` |
| Монетный дождь `sewer_golden_bug_coin_rain` | общая площадь (огонь, ожог) + удар `coins` |
| Рубящий топор `orc_warrior_axe_rend`, Удар предка `orc_skeleton_ancestor_blow` | удар `smash` (как Проклятый таран) |
| Могильный укус `orc_zombie_grave_bite` | удар `bite`, зелёный |
| Стальное жало `orc_chonchon_dive` | удар `leap` (как Пикирование) |
| Рёв вождя `orc_hero_chief_roar` | удар `knock` |
| Подъём предков `orc_lord_ancestors_rise` | удар `roots` — хватка из-под земли |
| Удар маятника `alde_clock_pendulum` | удар `knock` |
| Стрелки-клинки `alde_keeper_hands` | удар `double` |
| Захлоп крышки `alde_mimic_snap` | удар `bite` |
| Налёт с потолка `alde_owl_baron_swoop`, Ночное пике `alde_owl_duke_dive` | удар `peck` |
| Пыльный вихрь `alde_punk_gust` | удар `sand` |
| Коса управителя `mob_lord_of_death_scythe` | удар `smash`, холодный голубой |

## Что ещё общее / нужно от владельца

- Монстры: общий вид по стихии у 18 навыков (список выше) — очередь следующего пакета.
- Все эффекты героев — процедурные (кодом). Листы кадров от художника заменят их поверх (заказ — `docs/ART_REQUEST_SKILLS.md`), это улучшение, а не блокер.
- Иконка «Удара сковородой» — символ кодом; нужна пиксельная 24×24 в духе RO (`docs/ART_REQUEST_HEROES.md`, «Иконки навыков»).
