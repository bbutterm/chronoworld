/**
 * Тексты подсказок первого входа (firstTips.ts) — без Phaser, проверяются тестом tests/first-tips.test.ts.
 */

export type TipId = 'tip_tower' | 'tip_hunt' | 'tip_evening' | 'tip_expedition' | 'tip_boss_charge';

export interface TipDef {
  /** Ключ спикера из data/story (имя и портрет — как в сюжете). */
  speaker: 'garret' | 'greta' | 'bruno';
  text: string;
}

/** Две строки рядом с портретом на 390 px (~36 знаков в строке; ui-polish-research §3 п. 4). */
export const TIP_MAX = 70;

/**
 * Реплики: две короткие фразы голосом персонажа — одна мысль, без «нажмите», «чтобы» и пересказа правил
 * (правила — в «i» экрана). Показываются один раз, при первом входе в режим.
 */
export const TIPS: Record<TipId, TipDef> = {
  tip_tower: {
    speaker: 'garret',
    text: 'Башня каждый раз другая. Павшие не встанут до конца забега.',
  },
  tip_hunt: {
    speaker: 'garret',
    text: 'Бей MVP его слабой стихией — вдвое больнее. Две попытки в день.',
  },
  tip_evening: {
    speaker: 'bruno',
    text: 'Слушай внимательно: ответишь по душе — герой станет ближе.',
  },
  tip_expedition: {
    speaker: 'greta',
    text: 'Ой, в пути что-то стряслось! Нужный класс справится наверняка.',
  },
  tip_boss_charge: {
    speaker: 'garret',
    text: 'Красная полоса — босс копит удар! Ульта с молнией его собьёт.',
  },
};

/**
 * Одна строка баннера «Новая функция!» (unlockBanner.ts): первая фраза описания из data/unlocks.json без точки
 * в конце — подпись, а не абзац правил. Остальное описание — на экране самой функции.
 */
export function unlockTagline(description: string): string {
  const s = description.trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  let first = (m ? m[1] : s).trim();
  // Длинная фраза с перечислением после двоеточия («Каждый день новый товар: снаряжение, опыт…») — только до него.
  const colon = first.indexOf(':');
  if (first.length > 60 && colon > 10) first = first.slice(0, colon);
  return first.endsWith('.') ? first.slice(0, -1) : first;
}
