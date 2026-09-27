/**
 * Каталог звуков игры (issue #26, docs/design/audio.md): все звуковые события, их категория, громкость в миксе,
 * ограничения частоты и имя файла, которым владелец может заменить заглушку (assets/audio/<id>.ogg|m4a|mp3).
 * Без Phaser и DOM — проверяется в тестах. Заглушки синтезируются кодом (audioSynth.ts).
 */

/** Категория громкости: музыка, звуки игры (бой, награды), интерфейс (нажатия). Громкость «Звуки» — sfx и ui. */
export type AudioCategory = 'music' | 'sfx' | 'ui';

export interface SfxDef {
  cat: 'sfx' | 'ui';
  /** Громкость в миксе, 0…1 (умножается на громкость категории). */
  gain: number;
  /** Не чаще одного раза за столько мс (одинаковые удары в одном кадре — один звук). */
  gap: number;
  /** Не больше стольких копий этого звука одновременно. */
  voices: number;
  /** Приглушить музыку на время звука (победа, повышение уровня, призыв редкого героя). */
  duck?: boolean;
  /** Что это (для документа и отладки). */
  desc: string;
}

const ui = (desc: string, gain = 0.5, gap = 40, voices = 2): SfxDef => ({ cat: 'ui', gain, gap, voices, desc });
const fx = (desc: string, gain = 0.6, gap = 50, voices = 3): SfxDef => ({ cat: 'sfx', gain, gap, voices, desc });
const sting = (desc: string, gain = 0.8): SfxDef => ({ cat: 'sfx', gain, gap: 400, voices: 1, duck: true, desc });

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
  // ---------- бой: удары ----------
  swing: fx('взмах оружием (рывок, промах)', 0.3, 60, 2),
  hit_sword: fx('удар мечом', 0.5, 45, 3),
  hit_dagger: fx('удар кинжалом / катаром', 0.45, 45, 3),
  hit_blunt: fx('удар булавой / топором / кулаком', 0.5, 45, 3),
  hit_arrow: fx('попадание стрелы', 0.45, 45, 3),
  hit_claw: fx('удар монстра (укус, шлепок поринга)', 0.45, 45, 3),
  hit_magic: fx('попадание магией', 0.45, 45, 3),
  crit: fx('сильный удар (ульта, «крит»)', 0.65, 90, 2),
  bow_shot: fx('выстрел из лука', 0.35, 60, 2),
  // ---------- бой: навыки по стихиям ----------
  cast_start: fx('начало каста (гул заклинания)', 0.3, 120, 2),
  cast_fire: fx('огненный навык', 0.55, 90, 2),
  cast_ice: fx('ледяной / водный навык', 0.55, 90, 2),
  cast_wind: fx('молния / ветер', 0.55, 90, 2),
  cast_earth: fx('земля (камни, землетрясение)', 0.55, 90, 2),
  cast_holy: fx('святой навык (Holy Light, Magnus)', 0.55, 90, 2),
  cast_dark: fx('тёмный навык', 0.55, 90, 2),
  cast_poison: fx('яд, кислота', 0.5, 90, 2),
  cast_neutral: fx('нейтральная магия (Soul Strike, Napalm Beat)', 0.5, 90, 2),
  ult: fx('ульта: всплеск силы перед ударом', 0.7, 300, 1),
  heal: fx('лечение (как Heal в RO)', 0.5, 90, 2),
  buff: fx('бафф союзнику (Blessing, Increase AGI)', 0.45, 120, 2),
  debuff: fx('ослабление врага', 0.4, 120, 2),
  shield: fx('щит', 0.45, 120, 2),
  stun: fx('оглушение («птички» над головой)', 0.45, 150, 2),
  death_monster: fx('смерть монстра («пуф» поринга)', 0.55, 80, 3),
  death_hero: fx('герой пал', 0.6, 150, 2),
  boss_intro: sting('баннер босса: барабаны и рог', 0.85),
  boss_death: sting('босс побеждён', 0.85),
  // ---------- итоги ----------
  battle_start: fx('начало боя (рог)', 0.55, 500, 1),
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

export const MUSIC = {
  home: { gain: 0.5, files: ['music_home'], desc: 'главная (лагерь героев), спокойно', ro: 'Theme of Prontera (город)' },
  tavern: { gain: 0.5, files: ['music_tavern', 'music_home'], desc: 'таверна: призыв героев, весело', ro: 'тема таверны / Alberta' },
  map_meadow: { gain: 0.5, files: ['music_map_meadow', 'music_map'], desc: 'карта главы 1 (луга)', ro: 'Streamside (поле Пронтеры, bgm/12.mp3)' },
  map_swamp: { gain: 0.5, files: ['music_map_swamp', 'music_map'], desc: 'карта главы 2 (топи)', ro: 'тема болот / полей Пайона' },
  map_crypt: { gain: 0.5, files: ['music_map_crypt', 'music_map'], desc: 'карта главы 3 (склеп)', ro: 'тема Глаз-Хейма / подземелий' },
  battle_meadow: { gain: 0.45, files: ['music_battle_meadow', 'music_battle'], desc: 'бой в главе 1', ro: 'поле Пронтеры (быстрее) или своя боевая' },
  battle_swamp: { gain: 0.45, files: ['music_battle_swamp', 'music_battle'], desc: 'бой в главе 2' },
  battle_crypt: { gain: 0.45, files: ['music_battle_crypt', 'music_battle'], desc: 'бой в главе 3 и в башне' },
  boss: { gain: 0.5, files: ['music_boss'], desc: 'бой с боссом главы', ro: 'тема MVP-босса' },
} as const satisfies Record<string, TrackDef>;

export type MusicId = keyof typeof MUSIC;
export const MUSIC_IDS = Object.keys(MUSIC) as MusicId[];

export const AMBIENCE = {
  amb_meadow: { gain: 0.35, files: ['amb_meadow'], desc: 'луг: ветер, птицы' },
  amb_swamp: { gain: 0.35, files: ['amb_swamp'], desc: 'топь: бульканье, лягушки' },
  amb_crypt: { gain: 0.35, files: ['amb_crypt'], desc: 'склеп: капли, гул' },
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
