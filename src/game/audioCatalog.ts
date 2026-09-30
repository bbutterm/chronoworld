/**
 * Каталог звуков игры (issue #26, docs/design/audio.md): все звуковые события, их категория, громкость в миксе,
 * ограничения частоты и имя файла (assets/audio/<id>.ogg|m4a|mp3). Звуки RO собирает tools/ro_audio.py (таблица «id → файл
 * клиента» — там; варианты <id>_v2, <id>_v3… чередуются). Нет файла — заглушка из кода (audioSynth.ts).
 * Без Phaser и DOM — проверяется в тестах.
 */

/**
 * Категория громкости: музыка, звуки игры (награды, прогресс), звуки боя, интерфейс (нажатия).
 * Громкость «Звуки» — sfx, battle и ui; «Звуки боя» (вкл/выкл, та же кнопка в бою) — только battle.
 */
export type AudioCategory = 'music' | 'sfx' | 'battle' | 'ui';

/**
 * Важность звука боя для ограничителя плотности (audioCore.ts, BattleMix): minor — обычные удары, взмахи, выстрелы,
 * звуки атаки монстров, баффы (режутся первыми); skill — навыки, лечение, оглушение (свой запас); major — ульта,
 * смерти, босс (всегда звучат и на миг заглушают удары вокруг).
 */
export type BattleTier = 'minor' | 'skill' | 'major';

export interface SfxDef {
  cat: 'sfx' | 'battle' | 'ui';
  /** Громкость в миксе, 0…1 (умножается на громкость категории). */
  gain: number;
  /** Не чаще одного раза за столько мс (одинаковые удары в одном кадре — один звук). */
  gap: number;
  /** Не больше стольких копий этого звука одновременно. */
  voices: number;
  /** Приглушить музыку на время звука (победа, повышение уровня, призыв редкого героя). */
  duck?: boolean;
  /** Звук боя: важность для ограничителя плотности. */
  tier?: BattleTier;
  /** Что это (для документа и отладки). */
  desc: string;
}

const ui = (desc: string, gain = 0.5, gap = 40, voices = 2): SfxDef => ({ cat: 'ui', gain, gap, voices, desc });
const fx = (desc: string, gain = 0.6, gap = 50, voices = 3): SfxDef => ({ cat: 'sfx', gain, gap, voices, desc });
const sting = (desc: string, gain = 0.8): SfxDef => ({ cat: 'sfx', gain, gap: 400, voices: 1, duck: true, desc });
/**
 * Звук боя (шина «Звуки боя»). Громкости — после жалобы «в бою звука слишком много» (docs/design/audio.md, «Плотность
 * звуков боя»): обычные удары и звуки монстров на −6 дБ к прежним, навыки на −3 дБ, ульта, смерти и босс — как были.
 */
const bt = (desc: string, tier: BattleTier, gain: number, gap: number, voices: number): SfxDef => ({ cat: 'battle', gain, gap, voices, tier, desc });
const bsting = (desc: string, gain: number): SfxDef => ({ cat: 'battle', gain, gap: 400, voices: 1, duck: true, tier: 'major', desc });

/** Все звуки (id = имя файла без расширения в assets/audio/). */
export const SFX = {
  // ---------- интерфейс ----------
  ui_tap: ui('нажатие кнопки', 0.4, 30),
  ui_tab: ui('переключение вкладки нижней панели', 0.45),
  ui_back: ui('«Назад», закрыть окно', 0.4),
  ui_open: ui('открылось окно (настройки, подтверждение)', 0.45, 80, 1),
  ui_toggle: ui('переключатель в настройках', 0.4),
  ui_error: ui('нельзя: действие недоступно, ошибка', 0.45, 250, 1),
  ui_notify: ui('тост об успехе', 0.35, 300, 1),
  // ---------- награды и прогресс ----------
  claim: fx('забрать награду (кнопка «Забрать»)', 0.6, 150, 1),
  coin: fx('монета долетела до кошелька (серия — с повышением тона)', 0.3, 45, 4),
  gem: fx('гем долетел до кошелька', 0.35, 60, 3),
  chest_open: fx('открыть сундук офлайн-наград', 0.7, 400, 1),
  quest_done: fx('задание / достижение выполнено', 0.6, 300, 1),
  unlock: fx('открылась новая функция или глава', 0.6, 400, 1),
  equip: fx('надеть предмет', 0.5, 80, 2),
  refine_success: fx('заточка удалась (кузнец RO: bs_refinesuccess)', 0.6, 300, 1),
  refine_fail: fx('заточка: вещь сломалась (кузнец RO: bs_refinefailed)', 0.65, 300, 1),
  level_up: sting('повышение уровня героя (арпеджио)', 0.7),
  job_change: sting('смена профессии (фанфара, как в RO)', 0.8),
  rarity_up: sting('повышение звёзд / редкости, слияние героев', 0.75),
  // ---------- таверна (призыв героев) ----------
  summon_pull: fx('призыв: свиток брошен, вихрь', 0.6, 200, 1),
  summon_tension: fx('призыв: нарастание перед открытием (длиннее у редких)', 0.55, 200, 1),
  summon_common: fx('открыт обычный герой', 0.55, 90, 2),
  summon_rare: fx('открыт редкий герой', 0.65, 150, 1),
  summon_epic: sting('открыт эпический герой', 0.75),
  summon_legendary: sting('открыт легендарный герой (самый громкий момент в меню)', 0.85),
  // ---------- бой: удары (minor — режутся ограничителем плотности первыми; было 0.3–0.5, стало вдвое тише) ----------
  swing: bt('взмах мечом (рывок, промах)', 'minor', 0.15, 90, 1),
  swing_dagger: bt('взмах кинжалом / катаром', 'minor', 0.15, 90, 1),
  swing_blunt: bt('взмах булавой / топором', 'minor', 0.15, 90, 1),
  hit_sword: bt('удар мечом', 'minor', 0.25, 70, 2),
  hit_dagger: bt('удар кинжалом / катаром', 'minor', 0.23, 70, 2),
  hit_blunt: bt('удар булавой / топором / кулаком', 'minor', 0.25, 70, 2),
  hit_arrow: bt('попадание стрелы', 'minor', 0.23, 70, 2),
  hit_claw: bt('удар монстра (укус, шлепок поринга)', 'minor', 0.23, 70, 2),
  hit_magic: bt('попадание магией', 'minor', 0.23, 70, 2),
  crit: bt('сильный удар (ульта, «крит»)', 'skill', 0.5, 120, 1),
  bow_shot: bt('выстрел из лука', 'minor', 0.18, 90, 1),
  // ---------- бой: навыки по стихиям (skill; −3 дБ) ----------
  cast_start: bt('начало каста (гул заклинания)', 'minor', 0.2, 200, 1),
  cast_fire: bt('огненный навык', 'skill', 0.4, 120, 1),
  cast_ice: bt('ледяной / водный навык', 'skill', 0.4, 120, 1),
  cast_wind: bt('молния / ветер', 'skill', 0.4, 120, 1),
  cast_earth: bt('земля (камни, землетрясение)', 'skill', 0.4, 120, 1),
  cast_holy: bt('святой навык (Holy Light, Magnus)', 'skill', 0.4, 120, 1),
  cast_dark: bt('тёмный навык', 'skill', 0.4, 120, 1),
  cast_poison: bt('яд, кислота', 'skill', 0.36, 120, 1),
  cast_neutral: bt('нейтральная магия (Soul Strike, Napalm Beat)', 'skill', 0.36, 120, 1),
  ult: bt('ульта: всплеск силы перед ударом', 'major', 0.7, 300, 1),
  heal: bt('лечение (как Heal в RO)', 'skill', 0.36, 150, 1),
  buff: bt('бафф союзнику (Blessing, Increase AGI)', 'minor', 0.3, 200, 1),
  debuff: bt('ослабление врага', 'minor', 0.28, 200, 1),
  shield: bt('щит', 'minor', 0.3, 200, 1),
  stun: bt('оглушение («птички» над головой)', 'skill', 0.36, 200, 1),
  death_monster: bt('смерть монстра («пуф» поринга)', 'major', 0.45, 80, 3),
  death_hero: bt('герой пал', 'major', 0.6, 150, 2),
  boss_intro: bsting('баннер босса: барабаны и рог', 0.85),
  boss_death: bsting('босс побеждён', 0.85),
  // ---------- сюжет ----------
  bell_chime: fx('колокольчик Греты звенит в реплике сюжета (светлый короткий звон)', 0.45, 1500, 1),
  // ---------- итоги ----------
  battle_start: bt('начало боя (рог)', 'major', 0.55, 500, 1),
  victory: sting('победа (джингл)', 0.85),
  defeat: sting('поражение (джингл)', 0.8),
} as const satisfies Record<string, SfxDef>;

export type SfxId = keyof typeof SFX;
export const SFX_IDS = Object.keys(SFX) as SfxId[];

/** Музыка и фоновые звуки: зацикленные дорожки. */
export interface TrackDef {
  /** Громкость в миксе, 0…1. */
  gain: number;
  /** Файлы владельца, которые подходят этой дорожке, по порядку: своя, затем общая (battle_swamp → battle). */
  files: string[];
  desc: string;
  /** Предложение из клиента RO (название из bgm/; номер сверить с data/mp3nametable.txt). */
  ro?: string;
}

/**
 * Музыка. Файлы — треки RO из raw/ro-build/audio (music.json, docs/RO_SCRO_IMPORT.md шаг 6): assets/audio/<файл>.ogg
 * (Opus) + .m4a (AAC), −16 LUFS, до 1.45 МБ; играют потоком (audio.ts, docs/TASK_MUSIC_STREAMING.md). ro — какой трек
 * клиента RO (raw/ro/bgm/NN.mp3) у дорожки. Один трек на две дорожки — один файл: вторая дорожка берёт его вторым в files
 * (бой канализации и лабиринта — файл карты, бой Башни — файл экрана Башни), в сборке он один.
 * gain: меню и карты 0.42, бои 0.36 (−1.5 и −1.9 дБ к прежним 0.5 / 0.45) — плотная музыка RO не перекрывает удары
 * и нажатия (замер: музыка ≈ −16 дБ RMS в файле, удары RO ≈ −12 дБ RMS за 400 мс; итог в миксе — удары на ~9 дБ громче).
 * Файла нет или он не играет — заглушка (audioSynth.ts; новые темы — как прежняя тема слота, MUSIC_ALIAS).
 */
export const MUSIC = {
  title: { gain: 0.42, files: ['music_title'], desc: 'экран входа / заставка (на будущее: сцены входа пока нет)', ro: '01.mp3 Title (экран логина RO)' },
  home: { gain: 0.42, files: ['music_home'], desc: 'главная (лагерь героев), спокойно', ro: '08.mp3 Theme of Prontera (prontera)' },
  tavern: { gain: 0.42, files: ['music_tavern', 'music_home'], desc: 'таверна: призыв героев, весело', ro: '26.mp3 Everlasting Wanderers (izlude; название проверить)' },
  tower: { gain: 0.42, files: ['music_tower'], desc: 'экран Башни испытаний', ro: '21.mp3 Through the Tower (gef_dun00–01, башня Геффена)' },
  battle_tower: { gain: 0.36, files: ['music_battle_tower', 'music_tower'], desc: 'бой в Башне (без своего файла — та же тема Башни, не перезапускается)', ro: '21.mp3 Through the Tower' },
  map_meadow: { gain: 0.42, files: ['music_map_meadow', 'music_map'], desc: 'карта главы 1 (поля Пронтеры)', ro: '12.mp3 Streamside (prt_fild08)' },
  battle_meadow: { gain: 0.36, files: ['music_battle_meadow', 'music_battle'], desc: 'бой в главе 1', ro: '05.mp3 Tread on the Ground (prt_fild00/02/03)' },
  map_sewer: { gain: 0.42, files: ['music_map_sewer', 'music_map'], desc: 'карта главы 2 (канализация Пронтеры)', ro: '19.mp3 Under the Ground (prt_sewb1–4)' },
  battle_sewer: { gain: 0.36, files: ['music_battle_sewer', 'music_map_sewer', 'music_battle'], desc: 'бой в главе 2 (без своего файла — тот же трек, что на карте)', ro: '19.mp3 Under the Ground' },
  map_orc: { gain: 0.42, files: ['music_map_orc', 'music_map'], desc: 'карта главы 3 (орочья деревня)', ro: '35.mp3 TeMPoison (gef_fild10, in_orcs01)' },
  battle_orc: { gain: 0.36, files: ['music_battle_orc', 'music_battle'], desc: 'бой в главе 3', ro: '48.mp3 Help Yourself (orcsdun01–02)' },
  map_desert: { gain: 0.42, files: ['music_map_desert', 'music_map'], desc: 'карта главы 4 (пустыня Сограт, Моррок)', ro: '11.mp3 Theme of Morroc (morocc)' },
  battle_desert: { gain: 0.36, files: ['music_battle_desert', 'music_battle'], desc: 'бой в главе 4', ro: '22.mp3 Backattack!! (moc_pryd01–06)' },
  map_grove: { gain: 0.42, files: ['music_map_grove', 'music_map'], desc: 'карта главы 5 (лес Пайона)', ro: '14.mp3 Theme of Payon (payon)' },
  battle_grove: { gain: 0.36, files: ['music_battle_grove', 'music_battle'], desc: 'бой в главе 5', ro: '20.mp3 Ancient Groover (pay_dun00–02)' },
  map_shipwreck: { gain: 0.42, files: ['music_map_shipwreck', 'music_map'], desc: 'карта главы 6 (корабль, Альберта)', ro: '15.mp3 Theme of Alberta (alberta)' },
  battle_shipwreck: { gain: 0.36, files: ['music_battle_shipwreck', 'music_battle'], desc: 'бой в главе 6', ro: '17.mp3 Treasure Hunter (treasure01–02)' },
  map_clocktower: { gain: 0.42, files: ['music_map_clocktower', 'music_map'], desc: 'карта главы 7 (Альдебаран, часовая башня)', ro: '39.mp3 Theme of Al de Baran (aldebaran)' },
  battle_clocktower: { gain: 0.36, files: ['music_battle_clocktower', 'music_battle'], desc: 'бой в главе 7', ro: '60.mp3 Aeon (c_tower1–4)' },
  map_crypt: { gain: 0.42, files: ['music_map_crypt', 'music_map'], desc: 'карта главы 8 (Гласт Хейм)', ro: '42.mp3 (glast_01; название проверить)' },
  battle_crypt: { gain: 0.36, files: ['music_battle_crypt', 'music_battle'], desc: 'бой в главе 8', ro: '40.mp3 Fear… (gl_church, gl_prison)' },
  map_labyrinth: { gain: 0.42, files: ['music_map_labyrinth', 'music_map'], desc: 'карта главы 9 (Лабиринтный лес)', ro: '16.mp3 Labyrinth (prt_maze01–03)' },
  // Своя боевая тема (RL «Музыка»): тёмный лесной данж RO — 47.mp3 из pay_dun03–04 (в игре больше нигде не звучит).
  battle_labyrinth: { gain: 0.36, files: ['music_battle_labyrinth', 'music_battle'], desc: 'бой в главе 9 (Лабиринтный лес)', ro: '47.mp3 (pay_dun03–04; название проверить)' },
  map_niflheim: { gain: 0.42, files: ['music_map_niflheim', 'music_map'], desc: 'карта главы 10 (Нифльхейм)', ro: '84.mp3 (niflheim; название проверить)' },
  battle_niflheim: { gain: 0.36, files: ['music_battle_niflheim', 'music_battle'], desc: 'бой в главе 10', ro: '85.mp3 (nif_fild01–02; название проверить)' },
  // Проклятые топи — только ярус Башни; бои Башни играют battle_tower, эти дорожки — запас для яруса без своей музыки.
  map_swamp: { gain: 0.42, files: ['music_map_swamp', 'music_map'], desc: 'топи (ярус Башни)' },
  battle_swamp: { gain: 0.36, files: ['music_battle_swamp', 'music_battle'], desc: 'бой в топях (ярус Башни)' },
  boss: { gain: 0.42, files: ['music_boss'], desc: 'бой с боссом главы (все главы)', ro: '06.mp3 Risk Your Life (mag_dun01–02)' },
} as const satisfies Record<string, TrackDef>;

export type MusicId = keyof typeof MUSIC;
export const MUSIC_IDS = Object.keys(MUSIC) as MusicId[];

export const AMBIENCE = {
  amb_meadow: { gain: 0.35, files: ['amb_meadow'], desc: 'луг: ветер, птицы' },
  amb_swamp: { gain: 0.35, files: ['amb_swamp'], desc: 'топь: бульканье, лягушки' },
  amb_crypt: { gain: 0.35, files: ['amb_crypt'], desc: 'склеп: капли, гул' },
  amb_desert: { gain: 0.35, files: ['amb_desert'], desc: 'пустыня: порывы ветра, шорох песка, свист' },
  amb_grove: { gain: 0.35, files: ['amb_grove'], desc: 'ночной лес Пайона: сверчки, стук бамбуковых фонарей, далёкий колокольчик' },
  amb_shipwreck: { gain: 0.35, files: ['amb_shipwreck'], desc: 'затонувший корабль: гул глубины, скрип дерева, капли, пузырьки, редкий корабельный колокол' },
  amb_niflheim: { gain: 0.35, files: ['amb_niflheim'], desc: 'Нифльхейм: завывание ветра, далёкий погребальный звон' },
} as const satisfies Record<string, TrackDef>;

export type AmbienceId = keyof typeof AMBIENCE;
export const AMBIENCE_IDS = Object.keys(AMBIENCE) as AmbienceId[];

/** Порядок редкости для призыва (таверна): чем выше, тем длиннее нарастание и громче открытие. */
export const SUMMON_REVEAL = {
  common: 'summon_common',
  rare: 'summon_rare',
  epic: 'summon_epic',
  legendary: 'summon_legendary',
} as const satisfies Record<string, SfxId>;

/** Длительность нарастания перед открытием, мс (редкий герой — дольше «барабанная дробь»). */
export const SUMMON_TENSION_MS: Record<keyof typeof SUMMON_REVEAL, number> = { common: 0, rare: 500, epic: 900, legendary: 1400 };

/** Имя файла владельца для звука: id как есть (ui_tap.ogg, hit_sword.ogg…). */
export const sfxFile = (id: SfxId): string => id;
