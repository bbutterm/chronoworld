import type { SaveState } from '../save/schema';
import type { CodeDef, CodesConfig } from './schema';

/** Ввод игрока → вид кода из data/codes.json: без пробелов по краям, нижний регистр («HelloWorld » → «helloworld»). */
export function normalizeCode(input: string): string {
  return input.trim().toLowerCase();
}

export type RedeemResult =
  | { ok: true; save: SaveState; code: CodeDef; gems: number; scrolls: number; gold: number; hours: number }
  | { ok: false; reason: 'empty' | 'unknown' | 'used' };

/**
 * Ввести код: алмазы и свитки — сразу на счёт, одноразовый — в save.codesUsed. Часы (hours) возвращаются вызывающему: игровые
 * часы двигает интерфейс. Неизвестный, пустой или уже введённый одноразовый код — ok: false, сохранение не меняется.
 */
export function redeemCode(save: SaveState, input: string, cfg: CodesConfig, opts: { allowLab?: boolean } = {}): RedeemResult {
  const key = normalizeCode(input);
  if (!key) return { ok: false, reason: 'empty' };
  const code = cfg.codes.find((c) => c.code === key);
  if (!code) return { ok: false, reason: 'unknown' };
  // Время и повторяемая валюта предназначены только для изолированной песочницы.
  // Передача такого конфига в обычный API сама по себе не включает тестовые награды.
  if ((!code.once || code.hours > 0) && !opts.allowLab) return { ok: false, reason: 'unknown' };
  const used = save.codesUsed ?? [];
  if (code.once && used.includes(code.code)) return { ok: false, reason: 'used' };
  const next: SaveState = {
    ...save,
    currency: { ...save.currency, gems: save.currency.gems + code.gems, scrolls: save.currency.scrolls + code.scrolls },
    resources: { ...save.resources, gold: save.resources.gold + code.gold },
    ...(code.once ? { codesUsed: [...used, code.code] } : {}),
  };
  return { ok: true, save: next, code, gems: code.gems, scrolls: code.scrolls, gold: code.gold, hours: code.hours };
}
