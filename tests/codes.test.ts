import { describe, expect, it } from 'vitest';
import { deserialize, newGame, normalizeCode, parseCodesConfig, redeemCode, serialize } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { withLabCodes } from '../src/core/codes/lab';

const ctx = loadFullContext();
const cfg = ctx.codes!;

describe('коды (Настройки → Коды, data/codes.json)', () => {
  it('production-контент содержит только одноразовый подарок без перевода часов', () => {
    expect(cfg.codes).toEqual([
      { code: 'helloworld', once: true, gems: 300, hours: 0, scrolls: 0, gold: 0 },
      { code: 'extasy', once: true, gems: 0, hours: 0, scrolls: 20, gold: 0 },
      { code: 'greedisgood', once: true, gems: 0, hours: 0, scrolls: 0, gold: 500_000 },
    ]);
  });

  it('extasy — один раз +20 свитков призыва', () => {
    const s0 = newGame(ctx, 0);
    const r = redeemCode(s0, 'Extasy', cfg);
    expect(r.ok && r.save.currency.scrolls).toBe(s0.currency.scrolls + 20);
    expect(r.ok && r.save.currency.gems).toBe(s0.currency.gems);
    expect(redeemCode(r.ok ? r.save : s0, 'extasy', cfg)).toEqual({ ok: false, reason: 'used' });
  });

  it('greedisgood — один раз +500 000 золота', () => {
    const s0 = newGame(ctx, 0);
    const r = redeemCode(s0, 'GreedIsGood', cfg);
    expect(r.ok && r.save.resources.gold).toBe(s0.resources.gold + 500_000);
    expect(redeemCode(r.ok ? r.save : s0, 'greedisgood', cfg)).toEqual({ ok: false, reason: 'used' });
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

  it('тестовые 300/12 недоступны обычному API даже при переданном тестовом конфиге', () => {
    const s = newGame(ctx, 0);
    for (const code of ['300', '12']) {
      expect(redeemCode(s, code, cfg)).toEqual({ ok: false, reason: 'unknown' });
      expect(redeemCode(s, code, withLabCodes(cfg))).toEqual({ ok: false, reason: 'unknown' });
    }
  });

  it('300 — многоразовый только в явно включённой песочнице', () => {
    let s = newGame(ctx, 0);
    const g0 = s.currency.gems;
    for (let i = 0; i < 3; i++) {
      const r = redeemCode(s, '300', withLabCodes(cfg), { allowLab: true });
      expect(r.ok).toBe(true);
      if (r.ok) s = r.save;
    }
    expect(s.currency.gems).toBe(g0 + 900);
    expect(s.codesUsed).toBeUndefined();
  });

  it('12 — перевод часов только в явно включённой песочнице', () => {
    const s0 = newGame(ctx, 0);
    const r = redeemCode(s0, '12', withLabCodes(cfg), { allowLab: true });
    expect(r.ok && r.hours).toBe(12);
    expect(r.ok && r.save.currency.gems).toBe(s0.currency.gems);
    expect(redeemCode(r.ok ? r.save : s0, '12', withLabCodes(cfg), { allowLab: true }).ok).toBe(true);
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
