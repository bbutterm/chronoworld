// Аудит 11.10 (пакет «кампания и этап»): список героев на «Этапе» виден двумя полными рядами, одна полоса под полем,
// заголовок главы без повтора номера, совет «стены», единые «Авто»/«Пресеты», подсказки не теряют текст.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMBAT, newGame, type SaveState } from '../src/core';
import { loadFullContext } from '../scripts/lib/content-node';
import { chapterTitle } from '../src/game/chapterTitle';
import { wallAdvice } from '../src/game/flow';
import { fieldSlots, formationBodyRows, fullRosterRows, minSlotGap, PREP, prepFooterY, slotBand, stagePrepLayout } from '../src/game/prepLayout';
import { computeView } from '../src/game/viewLayout';
import { LEADING, S, T } from '../src/game/theme';

const SRC = (f: string) => readFileSync(join(import.meta.dirname, '..', 'src', 'game', f), 'utf8');
const ctx = loadFullContext();
const CONTENT_TOP = 170;
/** Отступы Telegram на телефоне владельца (CSS px): шапка и кнопки сверху, «домашняя полоска» снизу. */
const TG = { top: 105, right: 0, bottom: 34, left: 0 };

describe('«Этап»: список героев и поле', () => {
  const L = stagePrepLayout();

  for (const [name, w, h, insets] of [
    ['360×740', 360, 740, undefined],
    ['390×844', 390, 844, undefined],
    ['460×1000', 460, 1000, undefined],
    ['460×1000 в Telegram', 460, 1000, TG],
  ] as const) {
    it(`${name}: без прокрутки видно не меньше двух полных рядов героев`, () => {
      const v = computeView(w, h, 2, insets ?? { top: 0, right: 0, bottom: 0, left: 0 }, 2, true);
      // Низ окна прокрутки — как в StageScene: «В бой» (prepFooterY) минус 120.
      expect(fullRosterRows(L.rosterTop, prepFooterY(v) - 120)).toBeGreaterThanOrEqual(2);
      // «В бой» целиком в безопасной области.
      expect(prepFooterY(v) + 144 / 2).toBeLessThanOrEqual(v.safeBottom);
    });
  }

  it('«В бой» не ниже поля интерфейса и не выше прежнего места', () => {
    expect(prepFooterY({ uiHeight: 1920, safeBottom: 1920 })).toBe(1810);
    expect(prepFooterY({ uiHeight: 1803, safeBottom: 1803 })).toBe(1693);
    expect(prepFooterY({ uiHeight: 1920, safeBottom: 2134 })).toBe(2024);
  });

  it('поле этапа и «Отряда»: слоты 160 в своей полосе и не налезают', () => {
    for (const [field, xs] of [
      [L.field, { back: 150, front: 386 }],
      [{ top: CONTENT_TOP, bottom: CONTENT_TOP + 620 }, { back: 330, front: 690 }],
    ] as const) {
      const slots = fieldSlots(COMBAT.field.slotsA, slotBand(field), xs, PREP.slotH);
      expect(minSlotGap(slots, PREP.slotH)).toBeGreaterThanOrEqual(0);
      for (const s of slots) {
        expect(s.y - PREP.slotH / 2).toBeGreaterThanOrEqual(field.top + PREP.headH - 1);
        expect(s.y + PREP.slotH / 2).toBeLessThanOrEqual(field.bottom);
      }
    }
  });

  it('одна полоса под полем вмещает заметку «Авто» в две строки, предупреждение и угрозу', () => {
    const noteH = 2 * Math.ceil(T.body * 1.2) + 2 * S.xs;
    expect(L.band.y - noteH / 2).toBeGreaterThanOrEqual(L.field.bottom);
    expect(L.band.y + noteH / 2).toBeLessThanOrEqual(L.rosterHeadY - 88 / 2);
    // Та же строка, что у редактора (squadEditor tipY = formationBodyRows(...).warningY).
    expect(L.band.y).toBe(formationBodyRows(L.field.bottom).warningY);
    expect(L.band.adviceY + 2 * (T.caption - 6) * LEADING.caption).toBeLessThanOrEqual(L.band.y + L.band.zoneH / 2);
  });

  it('StageScene: строка редактора главнее совета стены, совет главнее угрозы; «Авто»/«Пресеты» — из редактора', () => {
    const stage = SRC('scenes/StageScene.ts');
    expect(stage).toMatch(/busy \? 'none' : this\.wall \? 'wall' : this\.threat \? 'threat' : 'none'/);
    expect(stage).toMatch(/rosterHead: \{/);
    expect(stage).not.toMatch(/'Пресеты', \(\) =>/);
    // Шанс карты героя — словом в чипе, касание наград — тост с пояснением.
    expect(stage).toMatch(/value: `карта \$\{dropValue\(p\)\}`/);
    expect(stage).toMatch(/Награда за первую победу/);
  });
});

describe('«Кампания»: заголовок главы', () => {
  it('без префикса «Глава N.»; номер — только в строке ниже', () => {
    expect(chapterTitle('Глава 6. Затонувший корабль')).toBe('Затонувший корабль');
    expect(chapterTitle('Затонувший корабль')).toBe('Затонувший корабль');
    for (const ch of ctx.content.chapters) {
      const title = chapterTitle(ch.name);
      expect(title).not.toMatch(/^Глава/);
      // 760 ед. шрифтом T.title (60) — около 25 знаков; самое длинное имя без номера — с запасом.
      expect(title.length).toBeLessThanOrEqual(24);
    }
    expect(SRC('scenes/CampaignScene.ts')).toMatch(/chapterTitle\(chapter\.name\)/);
  });

  it('до первой победы точки других вкладок не спорят с «В бой»', () => {
    const camp = SRC('scenes/CampaignScene.ts');
    expect(camp).toMatch(/if \(session\.save\.campaign\.cleared\.length > 0\) return;/);
    expect(camp).toMatch(/o\.name\.startsWith\('navBadge_'\) && o\.name !== 'navBadge_Campaign'/);
  });
});

describe('совет стены (wallAdvice)', () => {
  const late = ctx.content.stages.find((s) => s.chapter === ctx.content.chapters[5].id)!;
  const day = '2026-10-11';
  const t0 = Date.UTC(2026, 9, 11, 9);

  it('мощи хватает — совета нет', () => {
    const save = newGame(ctx, t0);
    const first = ctx.content.stages[0];
    const advice = wallAdvice(save, first.id, ctx, t0, day);
    // Первый этап новичок проходит стартовым отрядом: стены нет.
    expect(advice).toBeNull();
  });

  it('новичок перед поздней главой: совет есть, коротко и без несуществующих действий', () => {
    const save = newGame(ctx, t0);
    const advice = wallAdvice(save, late.id, ctx, t0, day);
    expect(advice).not.toBeNull();
    expect(advice!.text.length).toBeLessThanOrEqual(110);
    expect([null, 'Heroes', 'Kitchen', 'Adventure', 'Campaign']).toContain(advice!.action);
  });

  it('запас опыта на уровни — сначала «Улучшить»', () => {
    const save: SaveState = newGame(ctx, t0);
    const rich = { ...save, resources: { ...save.resources, heroExp: 10_000_000, gold: 10_000_000 } };
    const advice = wallAdvice(rich, late.id, ctx, t0, day);
    expect(advice?.action).toBe('Heroes');
    expect(advice?.text).toContain('Улучшить');
  });

  it('сундук копит — говорит, через сколько он наполнится', () => {
    const save: SaveState = newGame(ctx, t0);
    const cleared = { ...save, campaign: { ...save.campaign, cleared: [ctx.content.stages[0].id] } };
    const advice = wallAdvice(cleared, late.id, ctx, t0 + 60_000, day);
    expect(advice).not.toBeNull();
    expect(advice!.text).toMatch(/Сундук (наполнится через|полон)/);
  });
});

describe('подсказки обучения: текст не теряется', () => {
  const ui = SRC('ui.ts');
  it('нет места рядом с целью — плашка в свободной полосе (placeBand), рамка и стрелка у цели', () => {
    expect(ui).toMatch(/const band = hintBand\(t, tgt/);
    expect(ui).toMatch(/setData\('hintMode', 'band'\)/);
  });
  it('плитки под маской прокрутки — не помеха плашке', () => {
    expect(ui).toMatch(/sceneObstacles\(clippedNodes\(scene\.children\.list, null\)/);
  });
});
