import { describe, expect, it } from 'vitest';
import { deserialize, newGame, normalizeCode, parseCodesConfig, redeemCode, serialize } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';

const ctx = loadFullContext();
const cfg = ctx.codes!;

describe('коды (Настройки → Коды, data/codes.json)', () => {
  it('в data/codes.json — helloworld (раз, +300), 300 (многоразовый, +300), 12 (многоразовый, +12 ч)', () => {
    expect(cfg.codes).toEqual([
      { code: 'helloworld', once: true, gems: 300, hours: 0 },
      { code: '300', once: false, gems: 300, hours: 0 },
      { code: '12', once: false, gems: 0, hours: 12 },
    ]);
  });

  it('ввод без учёта регистра и пробелов по краям', () => {
    expect(normalizeCode('  HelloWorld ')).toBe('helloworld');
  });

  it('helloworld — один раз +300 алмазов, повтор — «уже введён», сохранение не меняется', () => {
    const s0 = newGame(ctx, 0);
    const r1 = redeemCode(s0, 'Helloworld', cfg);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.save.currency.gems).toBe(s0.currency.gems + 300);
    expect(r1.save.codesUsed).toEqual(['helloworld']);
    const r2 = redeemCode(r1.save, 'HELLOWORLD', cfg);
    expect(r2).toEqual({ ok: false, reason: 'used' });
    // Отметка переживает сохранение и загрузку.
    const back = deserialize(serialize(r1.save));
    expect(redeemCode(back, 'helloworld', cfg)).toEqual({ ok: false, reason: 'used' });
  });

  it('300 — многоразовый: +300 каждый раз, в codesUsed не пишется', () => {
    let s = newGame(ctx, 0);
    const g0 = s.currency.gems;
    for (let i = 0; i < 3; i++) {
      const r = redeemCode(s, '300', cfg);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.save;
    }
    expect(s.currency.gems).toBe(g0 + 900);
    expect(s.codesUsed).toBeUndefined();
  });

  it('12 — многоразовый: 12 часов вперёд (часы двигает интерфейс), алмазы не меняются', () => {
    const s0 = newGame(ctx, 0);
    const r = redeemCode(s0, '12', cfg);
    expect(r.ok && r.hours).toBe(12);
    expect(r.ok && r.save.currency.gems).toBe(s0.currency.gems);
    expect(redeemCode(r.ok ? r.save : s0, '12', cfg).ok).toBe(true);
  });

  it('неизвестный и пустой код — отказ', () => {
    const s0 = newGame(ctx, 0);
    expect(redeemCode(s0, 'abc', cfg)).toEqual({ ok: false, reason: 'unknown' });
    expect(redeemCode(s0, '   ', cfg)).toEqual({ ok: false, reason: 'empty' });
  });

  it('схема: повтор кода и код без награды — ошибки', () => {
    expect(() => parseCodesConfig({ codes: [{ code: 'a', once: true, gems: 1 }, { code: 'a', once: false, gems: 2 }] })).toThrow();
    expect(() => parseCodesConfig({ codes: [{ code: 'b', once: true }] })).toThrow();
    expect(() => parseCodesConfig({ codes: [{ code: 'Big', once: true, gems: 1 }] })).toThrow();
  });
});
