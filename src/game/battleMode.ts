/**
 * Режим ульт в бою (docs/design/battle-decisions.md §1): «Авто» — ульты героев сами, иначе — касанием портрета.
 * Настройка, не прогресс — живёт в localStorage (как скорость боя). По умолчанию — «Авто»: «Сил хватает» на экране этапа
 * считается с ультами, а новичок, не знающий про касание портретов, проигрывал без них (отзыв владельца, этап 4-6:
 * тот же отряд — 40/40 в авто и 2/40 без ульт). Ручной режим — кнопкой «Авто» в бою, выбор запоминается.
 */
const AUTO_KEY = 'chronoworld.battleAutoUlt';
const HINT_KEY = 'chronoworld.hint.manualUlt';
const CHARGE_HINT_KEY = 'chronoworld.hint.bossCharge';

function load(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function store(key: string, v: string): void {
  try {
    globalThis.localStorage?.setItem(key, v);
  } catch {
    // Не запомнили — не страшно.
  }
}

export const battleMode = { auto: load(AUTO_KEY) !== '0' };

export function setBattleAuto(on: boolean): void {
  battleMode.auto = on;
  store(AUTO_KEY, on ? '1' : '0');
}

/** Подсказка «коснитесь портрета» — один раз (до первого касания). */
export const ultHint = {
  get done(): boolean {
    return load(HINT_KEY) === '1';
  },
  mark(): void {
    store(HINT_KEY, '1');
  },
};

/** Подсказка «заряд босса — сбейте ультой» — первые несколько раз. */
export const chargeHint = {
  get count(): number {
    return Number(load(CHARGE_HINT_KEY)) || 0;
  },
  mark(): void {
    store(CHARGE_HINT_KEY, String(this.count + 1));
  },
};

/** Следующий тик симуляции строго после времени показа t (ввод действует с него — прошлое лога не меняется). */
export function nextTick(t: number, tick: number): number {
  return Math.round((Math.floor(t / tick + 1e-6) + 1) * tick * 1000) / 1000;
}
