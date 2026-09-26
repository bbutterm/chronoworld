import Phaser from 'phaser';
import { actEquip, actUnequip, heroSlots, SLOTS, type HeroState, type Slot } from '../../core';
import { GAME } from '../content';
import { diffText, equipBlocker, inventoryRows, itemStatsText, RARITY_COLORS, RARITY_NAMES, SLOT_NAMES, statDiff, type InventoryRow } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, screen } from '../screen';
import { commit, session } from '../session';
import { button, text, toast } from '../ui';

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
  page?: number;
}

const ROW_H = 150;

export class InventoryScene extends Phaser.Scene {
  constructor() {
    super('Inventory');
  }

  create(data: InventoryData = {}): void {
    const save = session.save;
    const hero = data.heroId ? save.heroes.find((h) => h.id === data.heroId) : undefined;
    if (hero && data.slot) this.picker(hero, data.slot, data.page ?? 0);
    else this.all(data.filter ?? null, data.page ?? 0);
  }

  // ---------- выбор предмета для слота героя ----------

  private picker(hero: HeroState, slot: Slot, page: number): void {
    screen(this, `${SLOT_NAMES[slot]}: ${hero.name}`, 'Heroes', { to: 'Hero', data: { heroId: hero.id } });
    const save = session.save;
    const cur = heroSlots(save, hero.id, GAME)[slot];
    const top = CONTENT_TOP;

    card(this, GAME_W / 2, top + 100, 1040, 200, true);
    text(this, 70, top + 45, 'Надето сейчас', 28, '#6a4a2a').setOrigin(0, 0.5);
    if (cur) {
      text(this, 70, top + 100, cur.def.name, 40, RARITY_COLORS[cur.def.rarity], { fontStyle: 'bold', stroke: '#2a1a0a', strokeThickness: 6 }).setOrigin(0, 0.5);
      text(this, 70, top + 155, `${RARITY_NAMES[cur.def.rarity]} · ${itemStatsText(cur.def.stats)}`, 28, '#4a3520').setOrigin(0, 0.5);
      button(this, 870, top + 100, 260, 110, 'k:buttonLong_beige', 'Снять', () => {
        commit(actUnequip(session.save, cur.instance.id));
        this.backToHero(hero.id, `${hero.name}: снят предмет «${cur.def.name}»`);
      }, 38);
    } else {
      text(this, 70, top + 110, 'Слот пуст', 36, '#6a4a2a', { fontStyle: 'bold' }).setOrigin(0, 0.5);
    }

    const rows = inventoryRows(save, GAME, slot).filter((r) => r.instance.id !== cur?.instance.id);
    const listTop = top + 230;
    text(this, GAME_W / 2, listTop, rows.length ? 'Выберите предмет' : '', 32, '#ffe9a8');
    if (!rows.length) {
      text(this, GAME_W / 2, listTop + 150, `Других предметов для слота «${SLOT_NAMES[slot]}» нет.\nОни выпадают за победы на этапах кампании.`, 32, '#e0cfb0', {
        wordWrap: { width: 900 },
        lineSpacing: 8,
      });
      return;
    }
    this.paged(rows, listTop + 40, page, (p) => this.scene.restart({ heroId: hero.id, slot, page: p }), (row, y) => {
      const blocker = equipBlocker(row, hero, GAME);
      const diff = row.def ? statDiff(cur?.def.stats, row.def.stats) : [];
      const sum = diff.reduce((s, d) => s + d.delta, 0);
      const owner = row.wornBy ? `  · сейчас у: ${row.wornBy}` : '';
      this.itemRow(row, y, blocker ?? diffText(diff) + owner, blocker ? '#ff9a8a' : sum > 0 ? '#7dff8f' : sum < 0 ? '#ff9a8a' : '#e0cfb0');
      const other = row.instance.equippedBy !== null;
      const b = button(this, 880, y, 250, 110, blocker ? 'k:buttonLong_grey' : other ? 'ui_btn_secondary' : 'ui_btn_primary', other ? 'Забрать' : 'Надеть', () =>
        this.equip(hero, row, blocker),
      36);
      if (blocker) b.container.setAlpha(0.6);
    });
  }

  private equip(hero: HeroState, row: InventoryRow, blocker: string | null): void {
    if (blocker) {
      toast(this, `Нельзя надеть: ${blocker}`, '#ffb4a0');
      return;
    }
    try {
      // Предмет на другом герое: сначала снять с него (как «забрать» в AFK Arena).
      let save = session.save;
      if (row.instance.equippedBy !== null && row.instance.equippedBy !== hero.id) save = actUnequip(save, row.instance.id);
      commit(actEquip(save, hero.id, row.instance.id, GAME));
      this.backToHero(hero.id, `${hero.name}: надет «${row.def?.name ?? row.instance.itemId}»${row.wornBy ? ` (снят с ${row.wornBy})` : ''}`);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
    }
  }

  private backToHero(heroId: string, message: string): void {
    this.scene.start('Hero', { heroId });
    const s = this.scene.get('Hero');
    s.events.once(Phaser.Scenes.Events.CREATE, () => toast(s, message, '#9fe0a6', 3000));
  }

  // ---------- весь инвентарь ----------

  private all(filter: Slot | null, page: number): void {
    screen(this, 'Инвентарь', 'Heroes', { to: 'Heroes' });
    const top = CONTENT_TOP;
    const tabs: (Slot | null)[] = [null, ...SLOTS];
    const w = 1040 / tabs.length;
    tabs.forEach((t, i) => {
      const on = t === filter;
      button(this, 20 + w * (i + 0.5), top + 50, w - 12, 96, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t ? SLOT_NAMES[t] : 'Все', () => {
        if (!on) this.scene.restart({ filter: t });
      }, 30);
    });

    const rows = inventoryRows(session.save, GAME, filter ?? undefined);
    const total = session.save.inventory.items.length;
    text(this, GAME_W / 2, top + 135, `Предметов: ${rows.length}${filter ? ` из ${total}` : ''}`, 30, '#e0cfb0');
    if (!rows.length) {
      text(this, GAME_W / 2, top + 400, 'Пока пусто.\nПредметы выпадают за победы на этапах кампании:\nпервое прохождение — гарантированно.', 34, '#e0cfb0', {
        wordWrap: { width: 900 },
        lineSpacing: 10,
      });
      return;
    }
    this.paged(rows, top + 175, page, (p) => this.scene.restart({ filter, page: p }), (row, y) => {
      this.itemRow(row, y, row.wornBy ? `надет: ${row.wornBy}` : 'свободен', row.wornBy ? '#9fe0a6' : '#b8bcc8');
      if (row.instance.equippedBy) {
        const heroId = row.instance.equippedBy;
        button(this, 880, y, 250, 100, 'k:buttonLong_beige', 'К герою', () => this.scene.start('Hero', { heroId }), 32);
      }
    });
  }

  // ---------- общее ----------

  /** Строки страницами (прокрутки нет — кнопки ‹ ›). */
  private paged(rows: InventoryRow[], top: number, page: number, go: (p: number) => void, draw: (row: InventoryRow, y: number) => void): void {
    const pagerH = 110;
    const per = Math.max(1, Math.floor((CONTENT_BOTTOM - top - pagerH) / ROW_H));
    const pages = Math.ceil(rows.length / per);
    const p = Phaser.Math.Clamp(page, 0, pages - 1);
    rows.slice(p * per, (p + 1) * per).forEach((r, i) => draw(r, top + ROW_H * (i + 0.5)));
    if (pages <= 1) return;
    const y = CONTENT_BOTTOM - pagerH / 2;
    const prev = button(this, GAME_W / 2 - 250, y, 150, 96, 'k:buttonSquare_beige', '‹', () => go(p - 1), 48);
    const next = button(this, GAME_W / 2 + 250, y, 150, 96, 'k:buttonSquare_beige', '›', () => go(p + 1), 48);
    text(this, GAME_W / 2, y, `${p + 1} / ${pages}`, 36, '#ffffff', { fontStyle: 'bold' });
    if (p === 0) prev.container.setAlpha(0.35).disableInteractive();
    if (p === pages - 1) next.container.setAlpha(0.35).disableInteractive();
  }

  /** Строка предмета: полоса редкости, имя цветом редкости, слот и статы, пояснение справа снизу. */
  private itemRow(row: InventoryRow, y: number, note: string, noteColor: string): void {
    card(this, GAME_W / 2, y, 1040, ROW_H - 12);
    const def = row.def;
    const color = def ? RARITY_COLORS[def.rarity] : '#9a9aa0';
    this.add.rectangle(48, y, 12, ROW_H - 44, Phaser.Display.Color.HexStringToColor(color).color);
    text(this, 75, y - 40, def?.name ?? `${row.instance.itemId} (нет в игре)`, 34, color, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setOrigin(0, 0.5);
    text(this, 75, y + 2, def ? `${RARITY_NAMES[def.rarity]} · ${SLOT_NAMES[def.slot]} · ${itemStatsText(def.stats)}` : 'статов не даёт', 28, '#ffffff', {
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0, 0.5);
    text(this, 75, y + 42, note, 28, noteColor, { stroke: '#000000', strokeThickness: 4 }).setOrigin(0, 0.5);
  }
}
