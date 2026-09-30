/**
 * Логика звука без Web Audio и Phaser (проверяется в тестах): настройки громкости в localStorage,
 * ограничитель частоты и числа одновременных звуков, выбор музыки и фона по экрану, причины паузы.
 */
import { SFX, type AmbienceId, type AudioCategory, type BattleTier, type MusicId, type SfxId } from './audioCatalog';

// ---------- настройки ----------

/** Настройка, не прогресс — отдельный ключ localStorage (как скорость боя и FPS). */
export const AUDIO_KEY = 'chronoworld.audio';

export interface AudioSettings {
  /** Громкость музыки, 0…1. */
  music: number;
  /** Громкость звуков (бой, награды, интерфейс), 0…1. */
  sfx: number;
  /** «Без звука»: всё молчит, громкости запоминаются. */
  muted: boolean;
  /**
   * «Звуки боя»: false — в бою молчат удары, навыки и смерти (музыка боя и интерфейс звучат). Одна и та же настройка —
   * строка в Настройках и значок динамика в верхней панели боя (кампания, Башня, Охота).
   */
  battleSfx: boolean;
}

export const DEFAULT_AUDIO: Readonly<AudioSettings> = { music: 0.5, sfx: 0.75, muted: false, battleSfx: true };

/** Шаги громкости в настройках (кнопка по кругу): 0 — выключено. */
export const VOLUME_STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

const clamp01 = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def);

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const store = (s?: KV | null): KV | null => {
  if (s !== undefined) return s;
  try {
    return (globalThis.localStorage as KV | undefined) ?? null;
  } catch {
    return null;
  }
};

/** Прочитать настройки звука; мусор и отсутствие хранилища — значения по умолчанию. */
export function loadAudioSettings(storage?: KV | null): AudioSettings {
  try {
    const raw = store(storage)?.getItem(AUDIO_KEY);
    if (!raw) return { ...DEFAULT_AUDIO };
    const v = JSON.parse(raw) as Partial<AudioSettings> | null;
    if (!v || typeof v !== 'object') return { ...DEFAULT_AUDIO };
    return { music: clamp01(v.music, DEFAULT_AUDIO.music), sfx: clamp01(v.sfx, DEFAULT_AUDIO.sfx), muted: v.muted === true, battleSfx: v.battleSfx !== false };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

/** Запомнить настройки (ошибка хранилища не мешает игре). */
export function saveAudioSettings(s: AudioSettings, storage?: KV | null): void {
  try {
    store(storage)?.setItem(AUDIO_KEY, JSON.stringify({ music: s.music, sfx: s.sfx, muted: s.muted, battleSfx: s.battleSfx }));
  } catch {
    // Не запомнили — не страшно.
  }
}

/** Следующий шаг громкости по кругу (0 → 25 → 50 → 75 → 100 → 0 %); промежуточное значение — к ближайшему большему. */
export function nextVolume(v: number): number {
  const next = VOLUME_STEPS.find((s) => s > v + 1e-6);
  return next ?? VOLUME_STEPS[0];
}

/** Подпись громкости на кнопке настроек. */
export const volumeLabel = (v: number): string => (v <= 0 ? 'Выкл' : `${Math.round(v * 100)}%`);

/** Итоговая громкость категории с учётом «Без звука» и «Звуков боя» (интерфейс чуть тише звуков). */
export function categoryVolume(cat: AudioCategory, s: AudioSettings): number {
  if (s.muted) return 0;
  if (cat === 'music') return s.music;
  if (cat === 'battle') return s.battleSfx ? s.sfx : 0;
  return cat === 'ui' ? s.sfx * 0.8 : s.sfx;
}

/** Подпись и тост кнопки «Звуки боя» (Настройки и значок в бою). */
export const battleSfxLabel = (s: Pick<AudioSettings, 'battleSfx'>): string => (s.battleSfx ? 'Вкл' : 'Выкл');
export const battleSfxToast = (s: Pick<AudioSettings, 'battleSfx'>): string => (s.battleSfx ? 'Звуки боя включены' : 'Звуки боя выключены');

// ---------- ограничитель ----------

/** Не больше стольких звуков одновременно (на телефоне больше — каша и нагрузка). */
export const MAX_VOICES = 10;

interface Voice {
  id: string;
  end: number;
}

/**
 * Решает, играть ли звук: не чаще `gap` мс для одного id, не больше `voices` копий одного id и MAX_VOICES всего.
 * Когда места нет, более важный звук (стингер, удар по боссу) вытесняет самый старый; обычный — пропускается.
 * now — мс (performance.now или время аудио), dur — длительность звука, мс.
 */
export class SfxLimiter {
  private readonly last = new Map<string, number>();
  private active: Voice[] = [];

  constructor(private readonly maxVoices = MAX_VOICES) {}

  /** Сколько звуков сейчас звучит (после очистки закончившихся). */
  playing(now: number): number {
    this.active = this.active.filter((v) => v.end > now);
    return this.active.length;
  }

  /** true — звук можно играть (и он учтён). */
  tryPlay(id: string, now: number, dur: number, rule: { gap: number; voices: number; priority?: boolean }): boolean {
    const last = this.last.get(id);
    if (last !== undefined && now - last < rule.gap) return false;
    this.playing(now);
    const same = this.active.filter((v) => v.id === id);
    if (same.length >= rule.voices) {
      if (!rule.priority) return false;
      this.active.splice(this.active.indexOf(same[0]), 1);
    }
    if (this.active.length >= this.maxVoices) {
      if (!rule.priority) return false;
      this.active.shift();
    }
    this.active.push({ id, end: now + dur });
    this.last.set(id, now);
    return true;
  }

  reset(): void {
    this.last.clear();
    this.active = [];
  }
}

/** Правило ограничителя для звука из каталога (tier — только у звуков боя). */
export const ruleOf = (id: SfxId): SoundRule => {
  const d = SFX[id] as { gap: number; voices: number; duck?: boolean; tier?: BattleTier };
  return { gap: d.gap, voices: d.voices, priority: 'duck' in d || d.tier === 'major', tier: d.tier, always: 'duck' in d };
};

export interface SoundRule {
  gap: number;
  voices: number;
  /** Вытесняет старые звуки, когда голосов нет. */
  priority?: boolean;
  /** Звук боя: важность для ограничителя плотности (BattleMix). */
  tier?: BattleTier;
  /** Стингер (баннер и смерть босса): плотность его не режет вовсе. */
  always?: boolean;
}

/**
 * Плотность звуков боя (жалоба «в бою звука слишком много», docs/design/audio.md): считает звуки боя по реальному
 * времени (на 2x бой вдвое быстрее, а звуков в секунду — столько же, сколько на 1x).
 * - minor (удары, взмахи, выстрелы, атаки монстров, баффы): не больше MINOR_PER_WINDOW за окно WINDOW_MS и
 *   MINOR_PER_SEC за секунду; в пределах MAJOR_SHADOW_MS от ульты / смерти / босса — тишина (важное слышно чисто);
 * - skill (навыки, лечение, оглушение, «крит» ульты): не больше SKILL_PER_WINDOW за окно и SKILL_PER_SEC за секунду;
 * - major (ульта, смерти, рог начала): не больше MAJOR_PER_WINDOW за окно (три смерти от одной ульты — два звука),
 *   ударами не вытесняются; стингеры босса (always) — всегда.
 * Время может идти не по порядку (звук планируется с задержкой до кадра удара) — окна симметричные.
 */
export const BATTLE_DENSITY = {
  WINDOW_MS: 100,
  MINOR_PER_WINDOW: 1,
  MINOR_PER_SEC: 4,
  SKILL_PER_WINDOW: 1,
  SKILL_PER_SEC: 2,
  MAJOR_PER_WINDOW: 2,
  MAJOR_SHADOW_MS: 120,
} as const;

export class BattleMix {
  private readonly played: Record<BattleTier, number[]> = { minor: [], skill: [], major: [] };

  constructor(private readonly d: typeof BATTLE_DENSITY = BATTLE_DENSITY) {}

  /** Есть ли звук этой важности ближе half мс к now. */
  private near(list: number[], now: number, half: number): boolean {
    return list.some((t) => Math.abs(t - now) < half);
  }

  /** Если добавить now, в любом окне длиной span будет не больше limit звуков (время может идти не по порядку). */
  private fits(list: number[], now: number, span: number, limit: number): boolean {
    const near = list.filter((t) => t > now - span && t < now + span);
    near.push(now);
    near.sort((a, b) => a - b);
    for (let i = 0, j = 0; i < near.length && near[i] <= now; i++) {
      while (j < near.length && near[j] - near[i] < span) j++;
      if (j - i > limit) return false;
    }
    return true;
  }

  /** Можно ли сыграть звук боя этой важности в момент now (мс), не записывая его. */
  allows(tier: BattleTier, now: number, always = false): boolean {
    const d = this.d;
    if (always) return true;
    if (tier === 'major') return this.fits(this.played.major, now, d.WINDOW_MS, d.MAJOR_PER_WINDOW);
    if (tier === 'minor') {
      if (this.near(this.played.major, now, d.MAJOR_SHADOW_MS)) return false;
      return this.fits(this.played.minor, now, d.WINDOW_MS, d.MINOR_PER_WINDOW) && this.fits(this.played.minor, now, 1000, d.MINOR_PER_SEC);
    }
    return this.fits(this.played.skill, now, d.WINDOW_MS, d.SKILL_PER_WINDOW) && this.fits(this.played.skill, now, 1000, d.SKILL_PER_SEC);
  }

  /** Записать сыгранный звук. */
  add(tier: BattleTier, now: number): void {
    const list = this.played[tier];
    list.push(now);
    // Старше 2 с (с запасом на задержки) — не нужны.
    if (list.length > 64) this.played[tier] = list.filter((t) => t > now - 2000);
  }

  reset(): void {
    this.played.minor = [];
    this.played.skill = [];
    this.played.major = [];
  }
}

/**
 * Ограничитель движка: частота и голоса (SfxLimiter) + плотность звуков боя (BattleMix). Один и тот же класс —
 * в AudioEngine и в замере плотности (tests/battle-audio-density.test.ts), чтобы цифры в документе были честными.
 */
export class SoundGate {
  readonly limiter: SfxLimiter;
  readonly mix: BattleMix;

  constructor(maxVoices = MAX_VOICES, density: typeof BATTLE_DENSITY = BATTLE_DENSITY) {
    this.limiter = new SfxLimiter(maxVoices);
    this.mix = new BattleMix(density);
  }

  tryPlay(id: string, now: number, dur: number, rule: SoundRule): boolean {
    if (rule.tier && !this.mix.allows(rule.tier, now, rule.always)) return false;
    if (!this.limiter.tryPlay(id, now, dur, rule)) return false;
    if (rule.tier) this.mix.add(rule.tier, now);
    return true;
  }
}

/**
 * Серия монет «звенит» вверх: каждая следующая в пределах окна — на полутон выше (до октавы), как в AFK-играх.
 * Возвращает множитель скорости воспроизведения.
 */
export class PitchStreak {
  private count = 0;
  private last = -Infinity;

  constructor(
    private readonly window = 400,
    private readonly maxSteps = 12,
  ) {}

  next(now: number): number {
    this.count = now - this.last < this.window ? Math.min(this.maxSteps, this.count + 1) : 0;
    this.last = now;
    return Math.pow(2, this.count / 12);
  }
}

// ---------- пауза ----------

/** Почему звук сейчас выключен (вкладка скрыта, Telegram свёрнут, телефон повёрнут). Пусто — звучит. */
export class MuteReasons {
  private readonly set = new Set<string>();

  get active(): boolean {
    return this.set.size > 0;
  }

  /** Возвращает true, если состояние (звучит / молчит) изменилось. */
  toggle(reason: string, on: boolean): boolean {
    const was = this.active;
    if (on) this.set.add(reason);
    else this.set.delete(reason);
    return was !== this.active;
  }
}

// ---------- музыка по экрану ----------

/**
 * Звуковая тема главы (как тема фона, CHAPTER_THEMES): у каждой — своя музыка карты и боя (MUSIC map_<тема>, battle_<тема>).
 * Фон (amb_*) — свой у семи старых тем; новые слоты берут подходящий: канализация — топь (вода, капли), орки — луг
 * (ветер, птицы), часовая башня — склеп (гул), лабиринт — ночной лес. В RO своих фоновых звуков у карт нет.
 */
export type Theme = 'meadow' | 'sewer' | 'orc' | 'desert' | 'grove' | 'shipwreck' | 'clocktower' | 'crypt' | 'labyrinth' | 'niflheim' | 'swamp';
export const THEMES: readonly Theme[] = ['meadow', 'sewer', 'orc', 'desert', 'grove', 'shipwreck', 'clocktower', 'crypt', 'labyrinth', 'niflheim', 'swamp'];

export const THEME_AMBIENCE: Record<Theme, AmbienceId> = {
  meadow: 'amb_meadow',
  sewer: 'amb_swamp',
  orc: 'amb_meadow',
  desert: 'amb_desert',
  grove: 'amb_grove',
  shipwreck: 'amb_shipwreck',
  clocktower: 'amb_crypt',
  crypt: 'amb_crypt',
  labyrinth: 'amb_grove',
  niflheim: 'amb_niflheim',
  swamp: 'amb_swamp',
};

/** Что играет на экране: музыка (null — оставить текущую) и фон (null — без фона, undefined — оставить). */
export interface SceneSound {
  music: MusicId | null;
  ambience?: AmbienceId | null;
}

/**
 * Музыка экрана по ключу сцены. theme — тема главы/яруса (для кампании и боя), boss — бой с боссом.
 * Экраны меню (герои, задания, инвентарь…) не меняют музыку: играет то, что было (обычно тема лагеря).
 */
export function sceneSound(key: string, o: { theme?: Theme; boss?: boolean; tower?: boolean } = {}): SceneSound {
  const theme = o.theme ?? 'meadow';
  switch (key) {
    case 'Home':
    case 'Adventure':
      return { music: 'home', ambience: null };
    case 'Tavern':
      return { music: 'tavern', ambience: null };
    case 'Campaign':
    case 'Stage':
    // «Глава пройдена»: тема босса (бой главы) сменяется музыкой карты пройденной главы.
    case 'ChapterDone':
      return { music: `map_${theme}`, ambience: null };
    case 'Battle':
      // Башня: своя тема во всех боях (фон — по ярусу); босс главы — общая тема босса.
      return { music: o.tower ? 'battle_tower' : o.boss ? 'boss' : `battle_${theme}`, ambience: THEME_AMBIENCE[theme] };
    case 'Tower':
      return { music: 'tower', ambience: null };
    case 'Title':
      return { music: 'title', ambience: null };
    case 'Result':
      // Итоги: боевая музыка стихает под джингл победы/поражения, фон боя уходит.
      return { music: null, ambience: null };
    default:
      return { music: null };
  }
}

// ---------- сюжет ----------

/**
 * Колокольчик Греты звенит в реплике: «Колокольчик звенит…», «колокольчик и тот, чёрный, звенят» (в пределах одного
 * предложения), «Я позвоню», «Грета звонит», «Звени, малыш» (Вестник с украденным колокольчиком). «Колокольчик молчит…
 * любой звон» — не звенит. Диалог играет bell_chime при показе такой строки.
 */
const CHIME_RE = /колокольчик[^.!?…]*звен|грета звонит|^я позвоню|^звени, малыш/i;
export const lineChimes = (text: string): boolean => CHIME_RE.test(text);
