import Phaser from 'phaser';
import { actEquip, actUnequip, heroName, heroSlots, SLOTS, type HeroState, type Slot } from '../../core';
import { GAME } from '../content';
import { diffText, equipBlocker, inventoryRows, itemStatsText, RARITY_COLORS, RARITY_NAMES, SLOT_NAMES, statDiff, type InventoryRow } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, emptyCard, screen } from '../screen';
import { commit, session } from '../session';
import { button, ellipsize, ScrollArea, text, toast } from '../ui';
import { C, FS, OUTLINE, TINT, TOUCH } from '../theme';
import { itemCell } from '../itemIcons';
import { staggerIn } from '../juice';
import { markHint } from '../hints';
import { sfx } from '../audio';

/**
 * K6. Инвентарь.
 * - Без героя: все предметы (фильтр по слоту), кто что носит.
 * - С героем и слотом (из карточки героя): выбор предмета для слота — разница статов с надетым,
 *   ограничение по профессии, «Надеть» / «Снять».
 */
export interface InventoryData {
  heroId?: string;
  slot?: Slot;
  /** Фильтр общего списка (без героя). */
  filter?: Slot | null;
}

const ROW_H = 160;
/** Ячейка иконки предмета слева в строке и начало текста справа от неё. */
const CELL = 112;
const CELL_X = 38 + CELL / 2;
const TEXT_X = CELL_X + CELL / 2 + 20;
/** Ширина текста строки: до кнопки справа (её левый край ≈ 755) и во всю строку, если кнопки нет. */
const TEXT_W = 740 - TEXT_X;
const TEXT_W_FULL = 1020 - TEXT_X;
/** Сколько строк сверх видимых держать построенными выше и ниже окна прокрутки. */
const ROW_BUFFER = 3;

/** Строка списка: предмет и сколько таких же свободных в стопке (T4-11). */
interface StackRow extends InventoryRow {
  count: number;
}

/**
 * T4-11: одинаковые свободные предметы — одной строкой «×N» (надетые — по одному: у каждого свой герой).
 * Порядок — как у inventoryRows (первое появление предмета).
 */
export function stackRows(rows: InventoryRow[]): StackRow[] {
  const out: StackRow[] = [];
  const free = new Map<string, StackRow>();
  for (const r of rows) {
    if (r.instance.equippedBy !== null) {
      out.push({ ...r, count: 1 });
      continue;
    }
    const same = free.get(r.instance.itemId);
    if (same) same.count++;
    else {
      const row = { ...r, count: 1 };
      free.set(r.instance.itemId, row);
      out.push(row);
    }
  }
  return out;
}

export class InventoryScene extends Phaser.Scene {
  constructor() {
    super('Inventory');
  }

  create(data: InventoryData = {}): void {
    const save = session.save;
    const hero = data.heroId ? save.heroes.find((h) => h.id === data.heroId) : undefined;
    if (hero && data.slot) this.picker(hero, data.slot);
    else this.all(data.filter ?? null);
  }

  // ---------- выбор предмета для слота героя ----------

  private picker(hero: HeroState, slot: Slot): void {
    screen(this, `${SLOT_NAMES[slot]}: ${heroName(hero, GAME)}`, 'Heroes', { to: 'Hero', data: { heroId: hero.id } });
    const save = session.save;
    const cur = heroSlots(save, hero.id, GAME)[slot];
    const top = CONTENT_TOP;

    card(this, GAME_W / 2, top + 100, 1040, 200, true);
    text(this, TEXT_X, top + 45, 'Надето сейчас', FS.small, C.inkMuted).setOrigin(0, 0.5);
    if (cur) {
      itemCell(this, CELL_X, top + 110, CELL, slot, Phaser.Display.Color.HexStringToColor(RARITY_COLORS[cur.def.rarity]).color, cur.instance.itemId);
      ellipsize(text(this, TEXT_X, top + 100, cur.def.name, FS.h2, RARITY_COLORS[cur.def.rarity], { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5), TEXT_W);
      ellipsize(text(this, TEXT_X, top + 155, `${RARITY_NAMES[cur.def.rarity]} · ${itemStatsText(cur.def.stats)}`, FS.small, C.ink).setOrigin(0, 0.5), TEXT_W);
      button(this, 880, top + 100, 250, 110, 'k:buttonLong_beige', 'Снять', () => {
        commit(actUnequip(session.save, cur.instance.id));
        this.backToHero(hero.id, `${heroName(hero, GAME)}: снят предмет «${cur.def.name}»`);
      }, FS.h3);
    } else {
      for (const o of itemCell(this, CELL_X, top + 110, CELL, slot, TINT.frame)) (o as Phaser.GameObjects.Image).setAlpha(0.35);
      text(this, TEXT_X, top + 110, 'Слот пуст', FS.h3, C.inkMuted, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    }

    const rows = stackRows(inventoryRows(save, GAME, slot).filter((r) => r.instance.id !== cur?.instance.id));
    const listTop = top + 230;
    text(this, GAME_W / 2, listTop, rows.length ? 'Выберите предмет' : '', FS.body, C.title);
    if (!rows.length) {
      emptyCard(this, listTop + 230, `Других предметов для слота «${SLOT_NAMES[slot]}» нет.\nОни выпадают за победы на этапах кампании.`, 'bag', {
        label: 'В кампанию',
        onClick: () => this.scene.start('Campaign'),
      });
      return;
    }
    this.list(rows, listTop + 40, (row, y, a) => {
      const blocker = equipBlocker(row, hero, GAME);
      const diff = row.def ? statDiff(cur?.def.stats, row.def.stats) : [];
      const sum = diff.reduce((s, d) => s + d.delta, 0);
      const owner = row.wornBy ? `  · сейчас у: ${row.wornBy}` : '';
      this.itemRow(row, y, blocker ?? diffText(diff) + owner, blocker ? C.danger : sum > 0 ? C.positive : sum < 0 ? C.danger : C.muted);
      const other = row.instance.equippedBy !== null;
      const b = button(this, 880, y, 250, 110, blocker ? 'k:buttonLong_grey' : other ? 'ui_btn_secondary' : 'ui_btn_primary', other ? 'Забрать' : 'Надеть', a.tap(() =>
        this.equip(hero, row, blocker),
      ), FS.h3);
      a.add(b.container);
      if (blocker) b.container.setAlpha(0.6);
    });
  }

  private equip(hero: HeroState, row: InventoryRow, blocker: string | null): void {
    if (blocker) {
      toast(this, `Нельзя надеть: ${blocker}`, C.error);
      return;
    }
    try {
      // Предмет на другом герое: сначала снять с него (как «забрать» в AFK Arena).
      let save = session.save;
      if (row.instance.equippedBy !== null && row.instance.equippedBy !== hero.id) save = actUnequip(save, row.instance.id);
      commit(actEquip(save, hero.id, row.instance.id, GAME));
      markHint('equip_gear');
      this.backToHero(hero.id, `${heroName(hero, GAME)}: надет «${row.def?.name ?? row.instance.itemId}»${row.wornBy ? ` (снят с ${row.wornBy})` : ''}`);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private backToHero(heroId: string, message: string): void {
    sfx('equip');
    this.scene.start('Hero', { heroId });
    const s = this.scene.get('Hero');
    s.events.once(Phaser.Scenes.Events.CREATE, () => toast(s, message, C.success, 3000));
  }

  // ---------- весь инвентарь ----------

  private all(filter: Slot | null): void {
    screen(this, 'Инвентарь', 'Heroes', { to: 'Heroes' });
    const top = CONTENT_TOP;
    const tabs: (Slot | null)[] = [null, ...SLOTS];
    const w = 1040 / tabs.length;
    tabs.forEach((t, i) => {
      const on = t === filter;
      button(this, 20 + w * (i + 0.5), top + 50, w - 12, TOUCH, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t ? SLOT_NAMES[t] : 'Все', () => {
        if (!on) this.scene.restart({ filter: t });
      }, FS.body);
    });

    const flat = inventoryRows(session.save, GAME, filter ?? undefined);
    const rows = stackRows(flat);
    const total = session.save.inventory.items.length;
    const free = flat.filter((r) => r.instance.equippedBy === null).length;
    // T3-11: в списке героев на кнопке — свободные предметы; здесь видно и все, и свободные.
    text(this, GAME_W / 2, top + 135, `Предметов: ${flat.length}${filter ? ` из ${total}` : ''} · свободно: ${free}`, FS.body, C.muted);
    if (!rows.length) {
      emptyCard(
        this,
        top + 480,
        filter
          ? `Предметов для слота «${SLOT_NAMES[filter]}» пока нет.\nПопробуйте вкладку «Все» или пройдите ещё этапы кампании.`
          : 'Пока пусто.\nПредметы выпадают за победы на этапах кампании:\nпервое прохождение — гарантированно.',
        'bag',
        { label: 'В кампанию', onClick: () => this.scene.start('Campaign') },
      );
      return;
    }
    this.list(rows, top + 175, (row, y, a) => {
      this.itemRow(row, y, row.wornBy ? `надет: ${row.wornBy}` : 'свободен', row.wornBy ? C.success : C.dim, row.instance.equippedBy ? TEXT_W : TEXT_W_FULL);
      if (row.instance.equippedBy) {
        const heroId = row.instance.equippedBy;
        a.add(button(this, 880, y, 250, 100, 'k:buttonLong_beige', 'К герою', a.tap(() => this.scene.start('Hero', { heroId })), FS.body).container);
      }
    });
  }

  // ---------- общее ----------

  /**
   * Строки списком с прокруткой пальцем. T4-11: строятся только видимые строки (плюс запас ROW_BUFFER);
   * при прокрутке ушедшие из окна уничтожаются, новые достраиваются — 3000 предметов открываются так же быстро, как 30.
   */
  private list(rows: StackRow[], top: number, draw: (row: StackRow, y: number, area: ScrollArea) => void): void {
    const bottom = CONTENT_BOTTOM + 10;
    const area = (this.area = new ScrollArea(this, top, bottom));
    area.setContentHeight(ROW_H * rows.length + 10);
    const built = new Map<number, Phaser.GameObjects.GameObject[]>();
    let lastOffset = NaN;
    const sync = () => {
      const off = area.offset;
      if (off === lastOffset) return;
      lastOffset = off;
      const from = Math.max(0, Math.floor(off / ROW_H) - ROW_BUFFER);
      const to = Math.min(rows.length - 1, Math.ceil((off + bottom - top) / ROW_H) + ROW_BUFFER);
      for (const [i, objs] of built) {
        if (i >= from && i <= to) continue;
        for (const o of objs) o.destroy();
        built.delete(i);
      }
      for (let i = from; i <= to; i++) {
        if (built.has(i)) continue;
        const before = new Set(area.content.list);
        draw(rows[i], ROW_H * (i + 0.5), area);
        built.set(i, area.content.list.filter((o) => !before.has(o)));
      }
    };
    sync();
    // Первые видимые строки «выезжают» при первом открытии инвентаря за сессию (дальше строятся без анимации).
    staggerIn(this, 'Inventory', [...built.values()]);
    this.events.on(Phaser.Scenes.Events.UPDATE, sync);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, sync));
  }

  private area!: ScrollArea;

  /** Строка предмета: полоса редкости, имя цветом редкости, слот и статы, пояснение справа снизу. */
  private itemRow(row: StackRow, y: number, note: string, noteColor: string, textW = TEXT_W): void {
    const a = this.area;
    a.add(card(this, GAME_W / 2, y, 1040, ROW_H - 12));
    const def = row.def;
    const color = def ? RARITY_COLORS[def.rarity] : C.disabled;
    // T3-27: ячейка с иконкой слота цветом редкости вместо цветной полоски; стопка — «×N» в углу ячейки.
    for (const o of itemCell(this, CELL_X, y, CELL, def?.slot ?? null, Phaser.Display.Color.HexStringToColor(color).color, row.instance.itemId)) a.add(o);
    if (row.count > 1) a.add(text(this, CELL_X + CELL / 2 - 6, y + CELL / 2 - 4, `×${row.count}`, FS.caption, C.text, { fontStyle: 'bold', ...OUTLINE }).setOrigin(1, 1));
    const name = def?.name ?? `${row.instance.itemId} (нет в игре)`;
    a.add(ellipsize(text(this, TEXT_X, y - 44, name, FS.h3, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5), textW));
    a.add(
      ellipsize(
        text(this, TEXT_X, y, def ? `${RARITY_NAMES[def.rarity]} · ${SLOT_NAMES[def.slot]} · ${itemStatsText(def.stats)}` : 'статов не даёт', FS.small, C.text, {
          stroke: C.stroke,
          strokeThickness: 4,
        }).setOrigin(0, 0.5),
        textW,
      ),
    );
    a.add(ellipsize(text(this, TEXT_X, y + 44, note, FS.small, noteColor, { stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5), textW));
  }
}
