/**
 * Логика звука без Web Audio и Phaser (проверяется в тестах): настройки громкости в localStorage,
 * ограничитель частоты и числа одновременных звуков, выбор музыки и фона по экрану, причины паузы.
 */
import { SFX, type AmbienceId, type AudioCategory, type MusicId, type SfxId } from './audioCatalog';

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
}

export const DEFAULT_AUDIO: Readonly<AudioSettings> = { music: 0.5, sfx: 0.75, muted: false };

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
    return { music: clamp01(v.music, DEFAULT_AUDIO.music), sfx: clamp01(v.sfx, DEFAULT_AUDIO.sfx), muted: v.muted === true };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}

/** Запомнить настройки (ошибка хранилища не мешает игре). */
export function saveAudioSettings(s: AudioSettings, storage?: KV | null): void {
  try {
    store(storage)?.setItem(AUDIO_KEY, JSON.stringify({ music: s.music, sfx: s.sfx, muted: s.muted }));
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

/** Итоговая громкость категории с учётом «Без звука» (интерфейс чуть тише звуков боя). */
export function categoryVolume(cat: AudioCategory, s: AudioSettings): number {
  if (s.muted) return 0;
  if (cat === 'music') return s.music;
  return cat === 'ui' ? s.sfx * 0.8 : s.sfx;
}

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

/** Правило ограничителя для звука из каталога. */
export const ruleOf = (id: SfxId) => ({ gap: SFX[id].gap, voices: SFX[id].voices, priority: 'duck' in SFX[id] });

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

/** Звуковая тема главы (у каждой темы фона — своя: музыка карты, музыка боя, фон). */
export type Theme = 'meadow' | 'swamp' | 'crypt' | 'desert' | 'grove' | 'shipwreck' | 'niflheim';
export const THEMES: readonly Theme[] = ['meadow', 'swamp', 'crypt', 'desert', 'grove', 'shipwreck', 'niflheim'];

/** Что играет на экране: музыка (null — оставить текущую) и фон (null — без фона, undefined — оставить). */
export interface SceneSound {
  music: MusicId | null;
  ambience?: AmbienceId | null;
}

/**
 * Музыка экрана по ключу сцены. theme — тема главы/яруса (для кампании и боя), boss — бой с боссом.
 * Экраны меню (герои, задания, инвентарь…) не меняют музыку: играет то, что было (обычно тема лагеря).
 */
export function sceneSound(key: string, o: { theme?: Theme; boss?: boolean } = {}): SceneSound {
  const theme = o.theme ?? 'meadow';
  switch (key) {
    case 'Home':
    case 'Adventure':
      return { music: 'home', ambience: null };
    case 'Tavern':
      return { music: 'tavern', ambience: null };
    case 'Campaign':
    case 'Stage':
      return { music: `map_${theme}`, ambience: null };
    case 'Battle':
      return { music: o.boss ? 'boss' : `battle_${theme}`, ambience: `amb_${theme}` };
    case 'Tower':
      return { music: 'map_crypt', ambience: null };
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
