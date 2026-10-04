import Phaser from 'phaser';
import {
  actEquip,
  actUnequip,
  cardDef,
  cardsForItem,
  insertCard,
  ownedCards,
  RARITIES,
  heroName,
  heroSlots,
  heroItemStats,
  needsBranch,
  refineConfig,
  blessedOre,
  refineBonus,
  refineBreakChance,
  refineModeCost,
  refineSafeAvailable,
  type RefineMode,
  refinedName,
  refinedStats,
  refineItem,
  refineLevel,
  refineUnlocked,
  salvagePlan,
  salvageProtection,
  salvageValue,
  salvageItems,
  lockItem,
  SLOTS,
  type CardRarity,
  type HeroState,
  type ItemDef,
  type ItemInstance,
  type Slot,
} from '../../core';
import { GAME } from '../content';
import { equipmentComparison, equipBlocker, formatNumber, heroSprite, inventoryRows, itemStatsText, RARITY_COLORS, RARITY_NAMES, SLOT_NAMES, STAT_KEYS, STAT_LABELS, type InventoryRow } from '../flow';
import { GAME_W } from '../layout';
import { bottomSheet, confirm, CONTENT_BOTTOM, CONTENT_TOP, contentBottom, cta, emptyCard, screen, type BottomSheet } from '../screen';
import { cardArtId, showCardArt } from '../cardArt';
import { commit, session } from '../session';
import { BTN, button, chip, ellipsize, icon, listRow, mixHex, plate, pressable, ScrollArea, segmented, stat, SURFACE, tag, text, toast, type Tone } from '../ui';
import { randomLine } from '../loreView';
import { itemLegend, itemModal } from '../loreView';
import { C, COLOR, COLOR_N, FAMILY, R, S, T, TOUCH } from '../theme';
import { itemCell, itemIconKey, itemTile, oreIcon } from '../itemIcons';
import { burst, juiceOn, staggerIn } from '../juice';
import { markHint } from '../hints';
import { sfx } from '../audio';
import { haptic } from '../haptics';
import { cardIcon, drawHeroCard, heroCardIcon, heroCardSize, rarityColor } from '../heroCard';
import { heroFace } from '../portraitFrame';
import type { HeroBack, HeroData } from './HeroScene';
import { heroCardsList, heroCardsTable, inventoryUi, RARITY_ORDER, type HeroCardsRow } from '../heroesView';

/**
 * K6. Инвентарь (в духе AFK Arena / RO).
 * - Без героя: сегмент «Снаряжение / Герои / Карты MVP». Снаряжение — сетка иконок 5 в ряд (рамка редкости, «+N»
 *   заточки, «×N» стопки, мини-портрет того, кто носит), фильтр — иконки слотов и «Свободные»; касание — лист снизу
 *   с подробностями: статы строками, одна главная кнопка («Надеть» / «Заточить») и одна вторичная.
 * - Заточка — свой лист: способ (сегмент «Обычная / Надёжная / Рудой»), прирост статов строками, риск поломки — чипом
 *   с процентом, одна кнопка «Заточить» с ценой.
 * - С героем и слотом (из карточки героя): надетый предмет сверху («Заточить», «Снять»), ниже — список других предметов
 *   слота с разницей статов и «Надеть» / «Забрать».
 */
export interface InventoryData {
  heroId?: string;
  slot?: Slot;
  /** Фильтр общего списка (без героя). */
  filter?: Slot | null;
  /** Куда вела «‹ Назад» карточки героя, из которой открыт слот, — вернуть ей же (MT-04). */
  heroBack?: HeroBack;
}

const TOP = CONTENT_TOP;
/** Поля экрана и ширина контента (§4.2). */
const LEFT = S.l;
const CW = GAME_W - 2 * S.l;
/** Сетка снаряжения: 5 в ряд. */
const COLS = 5;
const TILE = 168;
const GAP = (CW - COLS * TILE) / (COLS - 1);
const TILE_ROW = TILE + S.s;
/** Строка списка в выборе предмета для слота героя. */
const ROW_H = 256;
const CELL = 112;
/** Сколько строк сверх видимых держать построенными выше и ниже окна прокрутки. */
const ROW_BUFFER = 2;
/** Карточка «надето сейчас» (выбор для слота): с предметом / пусто; строка слота карты MVP. */
const CUR_H = 272;
const CUR_H_EMPTY = 184;
const CARD_ROW_H = 120;
/** «Карты героев», таблица: левый край столбцов редкостей, ширина столбца, центр столбца i (плашки сводки — над ними). */
const TBL_X0 = 400;
const TBL_CELL = (GAME_W - S.xs - TBL_X0) / 5;
const colX = (i: number) => TBL_X0 + TBL_CELL * (i + 0.5);

/** «30%» — шанс неудачи. */
const pct = (p: number) => `${Math.round(p * 100)}%`;
/** Тон риска неудачи: нет — зелёный, до 30% — жёлтый, выше — красный. */
export const riskTone = (p: number): Tone => (p <= 0 ? 'positive' : p <= 0.3 ? 'warning' : 'negative');
/** Подписи способов заточки (сегмент). */
export const REFINE_MODE_LABEL: Record<RefineMode, string> = { normal: 'Обычная', safe: 'Надёжная', ore: 'Рудой' };

/** Статы предмета с заточкой экземпляра. */
const statsOf = (def: ItemDef, instance: Pick<ItemInstance, 'refine'>) => refinedStats(def, refineLevel(instance), GAME);
/** Цвет редкости предмета (числом — для ячеек). */
const rarityNum = (def: ItemDef | undefined) => parseInt((def ? RARITY_COLORS[def.rarity] : COLOR.textTertiary).slice(1, 7), 16);

/** Способы заточки на шаге from: без риска — только обычная; иначе обычная, надёжная (если есть) и рудой. */
export function refineModes(from: number): RefineMode[] {
  if (refineBreakChance(from, GAME) <= 0) return ['normal'];
  return refineSafeAvailable(GAME) ? ['normal', 'safe', 'ore'] : ['normal', 'ore'];
}

/** Строка списка: предмет и сколько таких же свободных в стопке (T4-11). */
interface StackRow extends InventoryRow {
  count: number;
}

/**
 * T4-11: одинаковые свободные предметы — одной плиткой «×N» (надетые — по одному: у каждого свой герой).
 * Заточенные по-разному (+0 и +3) — разные. Порядок — как у inventoryRows (первое появление предмета).
 */
export function stackRows(rows: InventoryRow[]): StackRow[] {
  const out: StackRow[] = [];
  const free = new Map<string, StackRow>();
  for (const r of rows) {
    if (r.instance.equippedBy !== null) {
      out.push({ ...r, count: 1 });
      continue;
    }
    const key = `${r.instance.itemId}+${r.instance.refine ?? 0}+${r.instance.card ?? ''}+${!!r.instance.locked}`;
    const same = free.get(key);
    if (same) same.count++;
    else {
      const row = { ...r, count: 1 };
      free.set(key, row);
      out.push(row);
    }
  }
  return out;
}

/** Фильтр «только свободные» (переживает перезапуск сцены в пределах сессии). */
let freeOnly = false;
/** Последний выбранный способ заточки. */
let refineMode: RefineMode = 'normal';

export class InventoryScene extends Phaser.Scene {
  private heroBack?: HeroBack;
  private data0: InventoryData = {};
  private area: ScrollArea | null = null;
  /** Где играть вспышку/осколки после заточки (ячейка надетого предмета или центр экрана). */
  private fxAt = { x: GAME_W / 2, y: 760 };
  constructor() {
    super('Inventory');
  }

  create(data: InventoryData = {}): void {
    this.heroBack = data.heroBack;
    this.data0 = data;
    this.area = null;
    this.fxAt = { x: GAME_W / 2, y: 760 };
    const save = session.save;
    const hero = data.heroId ? save.heroes.find((h) => h.id === data.heroId) : undefined;
    if (hero && data.slot) this.picker(hero, data.slot);
    else this.all(data.filter ?? null);
  }

  /** Одинаковое объяснение ошибок снаряжения во всех листах. */
  private reportError(error: unknown): void {
    toast(this, error instanceof Error ? error.message : String(error), C.error);
  }

  // ---------- выбор предмета для слота героя ----------

  private picker(hero: HeroState, slot: Slot): void {
    screen(this, `${SLOT_NAMES[slot]}: ${heroName(hero, GAME)}`, 'Heroes', { to: 'Hero', data: this.heroData(hero.id) });
    const save = session.save;
    const cur = heroSlots(save, hero.id, GAME)[slot];
    const top = TOP + S.xs;
    // Карты MVP (охота): строка слота карты — когда в вещи карта или в запасе есть подходящая.
    const cardRow = !!cur && (!!cur.instance.card || cardsForItem(save, cur.def, GAME).length > 0);
    const curH = (cur ? CUR_H : CUR_H_EMPTY) + (cardRow ? CARD_ROW_H : 0);
    plate(this, GAME_W / 2, top + curH / 2, CW, curH, { ...SURFACE.raised, r: R.l });
    const cellSize = cur ? 168 : 120;
    const cx = LEFT + S.m + cellSize / 2;
    const cy = top + S.m + cellSize / 2;
    const tx = cx + cellSize / 2 + S.s;
    if (cur) {
      const lvl = refineLevel(cur.instance);
      this.fxAt = { x: cx, y: cy };
      itemCell(this, cx, cy, cellSize, slot, rarityNum(cur.def), cur.instance.itemId, lvl);
      pressable(this, this.add.zone(cx, cy, cellSize, cellSize), cellSize, cellSize, () => itemModal(this, cur.def, { refine: lvl, card: cur.instance.card ?? null }));
      ellipsize(text(this, tx, top + 62, refinedName(cur.def, lvl), T.heading, RARITY_COLORS[cur.def.rarity], { fontStyle: 'bold' }).setOrigin(0, 0.5).setName('curItemName'), GAME_W - LEFT - S.m - tx);
      ellipsize(text(this, tx, top + 116, itemStatsText(statsOf(cur.def, cur.instance)), T.caption, COLOR.textSecondary).setOrigin(0, 0.5), GAME_W - LEFT - S.m - tx);
      const by = top + 200;
      let bx = tx;
      if (this.canRefine(cur.instance, cur.def)) {
        const rb = button(this, bx + 150, by, 300, BTN.m, '', 'Заточить', () => this.refineSheet(cur.instance.id), T.body, { variant: 'secondary', sound: null });
        rb.container.setName('refineOpen');
        bx += 300 + S.s;
      }
      button(this, bx + 120, by, 240, BTN.m, '', 'Снять', () => {
        commit(actUnequip(session.save, cur.instance.id));
        this.backToHero(hero.id, `${heroName(hero, GAME)}: снят предмет «${cur.def.name}»`);
      }, T.body, { variant: 'ghost' }).container.setName('unequip');
      if (cardRow) this.cardSlotRow(hero, slot, cur.instance, cur.def, top + CUR_H);
    } else {
      for (const o of itemCell(this, cx, cy, cellSize, slot, COLOR_N.border)) (o as Phaser.GameObjects.Image).setAlpha(0.45);
      text(this, tx, cy, 'Пусто', T.heading, COLOR.textTertiary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    }

    const rows = stackRows(inventoryRows(save, GAME, slot).filter((r) => r.instance.id !== cur?.instance.id));
    const listTop = top + curH + S.s;
    if (!rows.length) {
      emptyCard(this, listTop + 260, 'Других предметов нет', 'bag', { label: 'В кампанию', onClick: () => this.scene.start('Campaign') });
      return;
    }
    this.list(rows.length, ROW_H, listTop, (i, y, a) => {
      const row = rows[i];
      const blocker = equipBlocker(row, hero, GAME);
      const comparison = equipmentComparison(cur ? heroItemStats(hero, cur.def, cur.instance, GAME) : undefined, row.def ? heroItemStats(hero, row.def, row.instance, GAME) : {}, GAME.features.power);
      const other = row.instance.equippedBy !== null;
      const note = blocker ?? `${comparison.text}${row.wornBy ? ` · у ${row.wornBy}` : ''}`;
      const noteColor = blocker ? COLOR.negative : comparison.tone === 'positive' ? COLOR.positive : comparison.tone === 'negative' ? COLOR.negative : COLOR.textSecondary;
      const box = this.itemRow(a, row, y, note, noteColor, !blocker);
      if (!blocker) {
        const b = button(this, CW / 2 - S.m - 110, -56, 220, BTN.m, '', other ? 'Забрать' : 'Надеть', a.tap(() => this.equip(hero, row, blocker)), T.body, { variant: 'secondary' });
        b.container.setName(`equip_${row.instance.id}`);
        box.add(b.container);
      } else box.setAlpha(0.6);
    });
  }

  /**
   * Слот карты MVP (docs/design/mvp-hunt.md): вставленная карта и её бонус или «Вставить» (карта из запаса того же слота,
   * навсегда — как в RO). y — верх строки (внутри карточки «надето сейчас»).
   */
  private cardSlotRow(hero: HeroState, slot: Slot, instance: ItemInstance, def: ItemDef, y: number): void {
    this.add.rectangle(GAME_W / 2, y, CW - 2 * S.m, 2, COLOR_N.border, 0.8);
    const cy = y + CARD_ROW_H / 2;
    const left = LEFT + S.m;
    const inside = instance.card ? cardDef(GAME, instance.card) : undefined;
    if (inside) {
      const art = !!cardArtId(inside.id);
      const name = text(this, left, cy - 22, inside.name, T.body, COLOR.gold, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName('cardInside');
      ellipsize(name, CW - 2 * S.m - (art ? 120 : 0));
      ellipsize(text(this, left, cy + 22, inside.text, T.caption, COLOR.textSecondary).setOrigin(0, 0.5), CW - 2 * S.m - (art ? 120 : 0));
      if (art) showCardArt(this, inside.id, GAME_W - LEFT - S.m - 48, cy, 96, undefined, name);
      return;
    }
    const first = cardsForItem(session.save, def, GAME)[0];
    const offer = text(this, left, cy - 22, first.name, T.body, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName('cardOffer');
    ellipsize(offer, CW - 2 * S.m - 280);
    ellipsize(text(this, left, cy + 22, first.text, T.caption, COLOR.textSecondary).setOrigin(0, 0.5), CW - 2 * S.m - 280);
    const b = button(this, GAME_W - LEFT - S.m - 120, cy, 240, BTN.m, '', 'Вставить', () =>
      confirm(this, `Вставить «${first.name}» в «${def.name}»?\nКарту нельзя вынуть.`, 'Вставить', () => {
        try {
          commit(insertCard(session.save, instance.id, first.id, GAME));
          sfx('refine_success');
          this.scene.restart({ heroId: hero.id, slot, heroBack: this.heroBack });
        } catch (e) {
          this.reportError(e);
        }
      }),
    T.body, { variant: 'secondary' });
    b.container.setName('cardInsert');
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
      this.reportError(e);
    }
  }

  /** Назад из слота — в карточку на вкладку «Снаряжение», с её прежним «Назад» (MT-04). */
  private heroData(heroId: string): HeroData {
    return { heroId, tab: 'gear', back: this.heroBack };
  }

  private backToHero(heroId: string, message: string): void {
    sfx('equip');
    this.scene.start('Hero', this.heroData(heroId));
    const s = this.scene.get('Hero');
    s.events.once(Phaser.Scenes.Events.CREATE, () => toast(s, message, C.success, 3000));
  }

  // ---------- заточка ----------

  /** Можно ли точить вещь сейчас (заточка есть, открыта и не на максимуме). */
  private canRefine(instance: ItemInstance, def: ItemDef): boolean {
    return !!refineConfig(GAME) && refineUnlocked(session.save, GAME) && !!refineModeCost(instance, def, GAME);
  }

  /** Лист заточки: способ (сегмент), прирост статов строками, риск — чипом, одна кнопка «Заточить» с ценой. */
  private refineSheet(instanceId: string): void {
    const instance = session.save.inventory.items.find((i) => i.id === instanceId);
    const def = instance ? GAME.equipment.items[instance.itemId] : undefined;
    if (!instance || !def) return;
    const lvl = refineLevel(instance);
    const modes = refineModes(lvl);
    const mode = modes.includes(refineMode) ? refineMode : 'normal';
    this.lockList(true);
    let reopening = false;
    let sheet: BottomSheet | null = null;
    sheet = bottomSheet(
      this,
      `Заточка +${lvl} → +${lvl + 1}`,
      (content, width, close) => {
        let y = 0;
        // Предмет: ячейка и имя (что точим).
        const cell = itemCell(this, 64, y + 64, 128, def.slot, rarityNum(def), instance.itemId, lvl);
        content.add(cell);
        content.add(ellipsize(text(this, 128 + S.s, y + 44, refinedName(def, lvl), T.body, RARITY_COLORS[def.rarity], { fontStyle: 'bold' }).setOrigin(0, 0.5), width - 128 - S.s));
        const ore = blessedOre(session.save);
        const oreChip = chip(this, 128 + S.s, y + 96, (s, x, cy, size) => oreIcon(s, x, cy, size), `${ore}`, 'neutral', { size: 's', align: 'left' }).setName('refineOre');
        content.add(oreChip);
        y += 128 + S.s;
        if (modes.length > 1) {
          const seg = segmented(this, width / 2, y + 44, width, modes.map((m) => REFINE_MODE_LABEL[m]), modes.indexOf(mode), (i) => {
            refineMode = modes[i];
            reopening = true;
            sheet?.layer.destroy();
            this.refineSheet(instanceId);
          });
          seg.container.setName('refineMode');
          content.add(seg.container);
          y += 88 + S.s;
        }
        // Прирост шага: растущие статы и бонус заточки.
        const a = refinedStats(def, lvl, GAME);
        const b = refinedStats(def, lvl + 1, GAME);
        for (const k of STAT_KEYS) {
          if ((b[k] ?? 0) === (a[k] ?? 0)) continue;
          content.add(stat(this, width / 2, y + 30, STAT_LABELS[k], b[k] ?? 0, { w: width, delta: (b[k] ?? 0) - (a[k] ?? 0) }));
          y += 60;
        }
        const pb = (x: number) => `${Math.round(x * 100)}%`;
        const bonus0 = refineBonus(lvl, GAME);
        const bonus1 = refineBonus(lvl + 1, GAME);
        content.add(stat(this, width / 2, y + 30, 'Бонус заточки', bonus0 > 0 ? `+${pb(bonus0)} → +${pb(bonus1)}` : `+${pb(bonus1)}`, { w: width }));
        y += 60 + S.s;
        // Риск — чипом с процентом; рудой — с гарантией улучшения, тратит руду.
        const chance = refineBreakChance(lvl, GAME, mode);
        const cost = refineModeCost(instance, def, GAME, mode)!;
        const noOre = mode === 'ore' && ore < 1;
        const risk = chance > 0 ? chip(this, 0, y + 36, 'lock', `Неудача ${pct(chance)}`, riskTone(chance), { align: 'left' }) : chip(this, 0, y + 36, 'check', 'Гарантия улучшения', 'positive', { align: 'left' });
        risk.setName('refineRisk');
        content.add(risk);
        if (mode === 'ore') content.add(chip(this, risk.width + S.xs, y + 36, (s, x, cy, size) => oreIcon(s, x, cy, size), '−1', noOre ? 'negative' : 'neutral', { align: 'left' }));
        y += 72 + S.l;
        content.add(text(this, 0, y, 'При неудаче предмет и прежняя заточка сохраняются.', T.caption, COLOR.textSecondary, { align: 'left', wordWrap: { width } }).setOrigin(0, 0).setName('refineProtection'));
        y += 92;
        const gold = session.save.resources.gold;
        const short = noOre ? 'Нет руды — она падает с боссов' : gold < cost.gold ? `Не хватает ${formatNumber(cost.gold - gold)} золота` : null;
        if (short) {
          content.add(text(this, width / 2, y, short, T.body, COLOR.negative, { fontStyle: 'bold' }).setName('refineShort'));
          y += 64;
        }
        const go = cta(this, width / 2, y + 70, 'Заточить', () => {
          if (short) {
            toast(this, short, C.error);
            return;
          }
          const run = () => {
            close();
            this.refine(instanceId, mode);
          };
          if (chance <= 0) return run();
          confirm(this, `Шанс неудачи ${pct(chance)}.\nЗолото будет потрачено. Предмет, карта и прежняя заточка сохранятся.`, 'Точить', run, { danger: chance > 0.3 });
        }, { w: 640, enabled: !short });
        go.container.setName('refineGo');
        priceIn(this, go, cost.gold, !short && gold >= cost.gold);
        content.add(go.container);
        return y + 140;
      },
      { onClose: () => !reopening && this.lockList(false) },
    );
    sheet.layer.setName('refineSheet');
  }

  private refine(instanceId: string, mode: RefineMode): void {
    try {
      const r = refineItem(session.save, instanceId, GAME, { mode });
      commit(r.save);
      const e = r.events[0];
      const def = GAME.equipment.items[e.itemId];
      const data = { ...this.data0 };
      if (e.type === 'refineFailed') {
        sfx('refine_fail');
        haptic('refineFail');
        this.scene.restart(data);
        this.events.once(Phaser.Scenes.Events.CREATE, () => {
          const said = randomLine('refineBreak');
          toast(this, `Неудача. Предмет и заточка сохранены${said ? `\n${said}` : ''}`, C.error, said ? 5000 : 3500);
        });
        return;
      }
      sfx('refine_success');
      haptic('refineOk');
      this.scene.restart(data);
      this.events.once(Phaser.Scenes.Events.CREATE, () => {
        burst(this, this.fxAt);
        const said = randomLine('refineSuccess');
        toast(this, `${def ? refinedName(def, e.to) : e.itemId}${said ? `\n${said}` : ''}`, C.success, said ? 4000 : 2500);
      });
    } catch (e) {
      sfx('ui_error');
      this.reportError(e);
    }
  }

  // ---------- весь инвентарь ----------

  private all(filter: Slot | null): void {
    screen(this, 'Инвентарь', 'Heroes', { to: 'Heroes' });
    // Вкладки экрана (запоминаются на сессию): снаряжение, карты героев, карты MVP из охоты (BUG-187).
    const tabs = ['gear', 'cards', 'mvp'] as const;
    const seg = segmented(this, GAME_W / 2, TOP + 52, CW, ['Снаряжение', 'Герои', 'Карты MVP'], Math.max(0, tabs.indexOf(inventoryUi.tab)), (i) => {
      inventoryUi.tab = tabs[i];
      this.scene.restart({});
    });
    seg.container.setName('invTabs');
    const below = TOP + 52 + 44 + S.s;
    if (inventoryUi.tab === 'cards') {
      this.cards(below);
      return;
    }
    if (inventoryUi.tab === 'mvp') {
      this.mvpCards(below);
      return;
    }
    this.gear(filter, below);
  }

  /** Фильтр — иконки слотов («Все» и 4 слота) и переключатель «Свободные»; ниже — сетка плиток предметов. */
  private gear(filter: Slot | null, top: number): void {
    const fy = top + 44;
    const opts: (Slot | null)[] = [null, ...SLOTS];
    const fw = 112;
    opts.forEach((s, i) => {
      const x = LEFT + fw / 2 + i * (fw + S.xs);
      const on = s === filter;
      const bg = plate(this, x, fy, fw, 88, on ? { fill: COLOR.surfaceRaised, border: mixHex(COLOR.border, COLOR.accent, 0.6), borderW: 3, r: R.m, hl: 0.14 } : { ...SURFACE.sunken, r: R.m }).setName(`invFilter_${s ?? 'all'}`);
      if (s) this.add.image(x, fy, itemIconKey(this, s)).setDisplaySize(60, 60).setTint(on ? COLOR_N.title : COLOR_N.textSecondary);
      else text(this, x, fy, 'Все', T.caption, on ? COLOR.title : COLOR.textSecondary, { fontStyle: 'bold' });
      pressable(this, bg, fw, 88, () => {
        if (!on) this.scene.restart({ filter: s });
      });
    });
    const fx = GAME_W - LEFT - 130;
    const fbg = plate(this, fx, fy, 260, 88, freeOnly ? { fill: COLOR.surfaceRaised, border: mixHex(COLOR.border, COLOR.accent, 0.6), borderW: 3, r: R.m, hl: 0.14 } : { ...SURFACE.sunken, r: R.m }).setName('invFreeOnly');
    text(this, fx, fy, 'Свободные', T.caption, freeOnly ? COLOR.title : COLOR.textSecondary, { fontStyle: 'bold' });
    pressable(this, fbg, 260, 88, () => {
      freeOnly = !freeOnly;
      this.scene.restart({ filter });
    });

    const flat = inventoryRows(session.save, GAME, filter ?? undefined).filter((r) => !freeOnly || r.instance.equippedBy === null);
    const rows = stackRows(flat);
    const sale = salvagePlan(session.save, GAME);
    const itemDefs = new Map(session.save.inventory.items.map((item) => [item.id, GAME.equipment.items[item.itemId]]));
    const saleIds = sale.instanceIds.filter((id) => !filter || itemDefs.get(id)?.slot === filter);
    let gridTop = fy + 44 + S.s;
    if (saleIds.length) {
      const saleY = gridTop + 44;
      const plan = salvagePlan(session.save, GAME, saleIds);
      text(this, LEFT, saleY, `Лишние копии: ${plan.instanceIds.length}`, T.caption, COLOR.textSecondary).setOrigin(0, 0.5).setName('invSaleCount');
      const sell = button(this, GAME_W - LEFT - 210, saleY, 420, 88, '', 'Продать повторы', () => this.sell(plan.instanceIds, true), T.caption, { variant: 'secondary' });
      sell.container.setName('invSellDuplicates');
      gridTop += 88 + S.s;
    }
    if (!rows.length) {
      emptyCard(this, gridTop + 300, filter || freeOnly ? 'Здесь пусто' : 'Пока пусто', 'bag', filter || freeOnly ? undefined : { label: 'В кампанию', onClick: () => this.scene.start('Campaign') });
      return;
    }
    const nRows = Math.ceil(rows.length / COLS);
    this.list(nRows, TILE_ROW, gridTop, (r, y, a) => {
      for (let c = 0; c < COLS; c++) {
        const row = rows[r * COLS + c];
        if (!row) break;
        const x = LEFT + TILE / 2 + c * (TILE + GAP);
        const hero = row.instance.equippedBy ? session.save.heroes.find((h) => h.id === row.instance.equippedBy) : undefined;
        const tile = itemTile(this, x, y, TILE, {
          slot: row.def?.slot ?? null,
          color: row.def ? RARITY_COLORS[row.def.rarity] : COLOR.textTertiary,
          itemId: row.instance.itemId,
          refine: refineLevel(row.instance),
          count: row.count,
          worn: !!hero,
          card: !!row.instance.card,
          ...(hero ? { face: (fx2: number, fy2: number, size: number) => heroFace(this, heroSprite(hero, GAME), size * 0.82, GAME.content.heroes[hero.templateId]?.gender).setPosition(fx2, fy2) } : {}),
        });
        tile.setName(`invItem_${row.instance.id}`);
        if (row.instance.locked) tile.add(icon(this, -TILE / 2 + 30, TILE / 2 - 30, 'lock', 40).setName('invItemLocked'));
        a.add(tile);
        pressable(this, tile, TILE, TILE, a.tap(() => this.itemSheet(row)));
      }
    }, 1);
  }

  /** Лист предмета: ячейка, редкость и слот, кто носит; статы строками; одна главная и одна вторичная кнопка. */
  private itemSheet(row: StackRow): void {
    const def = row.def;
    if (!def) {
      toast(this, 'Предмета больше нет в игре', C.muted);
      return;
    }
    const lvl = refineLevel(row.instance);
    const refinable = this.canRefine(row.instance, def);
    const heroId = row.instance.equippedBy;
    this.lockList(true);
    let next: (() => void) | null = null;
    const sheet = bottomSheet(
      this,
      refinedName(def, lvl),
      (content, width, close) => {
        const go = (fn: () => void) => () => {
          next = fn;
          close();
        };
        content.add(itemCell(this, 80, 80, 160, def.slot, rarityNum(def), row.instance.itemId, lvl));
        const tx = 160 + S.s;
        content.add(text(this, tx, 36, `${RARITY_NAMES[def.rarity]} · ${SLOT_NAMES[def.slot]}${row.count > 1 ? ` · ×${row.count}` : ''}`, T.body, RARITY_COLORS[def.rarity], { fontStyle: 'bold' }).setOrigin(0, 0.5));
        let ty = 92;
        if (row.wornBy) {
          content.add(tag(this, tx, ty, `Надет: ${row.wornBy}`, 'positive', { align: 'left' }));
          ty += 60;
        }
        if (row.instance.locked) {
          content.add(tag(this, tx, ty, 'Защищён от продажи', 'info', { align: 'left' }));
          ty += 60;
        }
        if (def.jobs?.length) {
          content.add(ellipsize(text(this, tx, ty, `Только: ${def.jobs.map((j) => GAME.content.jobs[j]?.name ?? j).join(', ')}`, T.caption, COLOR.textSecondary).setOrigin(0, 0.5), width - tx));
        }
        let y = Math.max(160 + S.s, ty + (def.jobs?.length ? 64 : 32));
        // Статы: значение с заточкой и прирост от неё.
        const now = statsOf(def, row.instance);
        for (const k of STAT_KEYS) {
          if (!(now[k] ?? 0)) continue;
          const base = def.stats[k] ?? 0;
          content.add(stat(this, width / 2, y + 30, STAT_LABELS[k], now[k] ?? 0, { w: width, delta: lvl ? (now[k] ?? 0) - base || null : null }));
          y += 60;
        }
        const inside = row.instance.card ? cardDef(GAME, row.instance.card) : undefined;
        if (inside) {
          content.add(stat(this, width / 2, y + 30, 'Карта', inside.name, { w: width, tone: 'gold' }));
          y += 60;
          content.add(ellipsize(text(this, 0, y + 20, inside.text, T.caption, COLOR.textSecondary).setOrigin(0, 0.5), width));
          y += 48;
        }
        const legend = itemLegend(def.id);
        if (legend) {
          const l = text(this, 0, y + S.xs, legend, T.caption, COLOR.textTertiary, { fontStyle: 'italic', align: 'left', wordWrap: { width } }).setOrigin(0, 0);
          l.setMaxLines(2);
          content.add(l);
          y += l.height + S.xs;
        }
        y += S.l;
        const controlW = (width - S.s) / 2;
        const protect = button(this, controlW / 2, y + 48, controlW, 96, '', row.instance.locked ? 'Снять защиту' : row.count > 1 ? 'Защитить одну' : 'Защитить', go(() => {
          commit(lockItem(session.save, row.instance.id, !row.instance.locked));
          this.scene.restart({ ...this.data0 });
        }), T.caption, { variant: 'secondary' });
        protect.container.setName('itemLock');
        content.add(protect.container);
        if (!salvageProtection(row.instance) && salvageValue(def, GAME) > 0) {
          const sell = button(this, controlW + S.s + controlW / 2, y + 48, controlW, 96, '', `Продать · ${formatNumber(salvageValue(def, GAME))}`, go(() => this.sell([row.instance.id])), T.caption, { variant: 'secondary' });
          sell.container.setName('itemSell');
          content.add(sell.container);
        }
        y += 96 + S.s;
        // Действия: свободный — «Надеть» (главная) и «Заточить»; надетый — «Заточить» (главная) и «К герою».
        type Act = { label: string; fn: () => void; name: string };
        const wear: Act = { label: 'Надеть', fn: go(() => this.wearSheet(row)), name: 'itemWear' };
        const refine: Act | null = refinable ? { label: 'Заточить', fn: go(() => this.refineSheet(row.instance.id)), name: 'itemRefine' } : null;
        const toHero: Act | null = heroId ? { label: 'К герою', fn: go(() => this.scene.start('Hero', { heroId, back: { to: 'Inventory' } })), name: 'itemHero' } : null;
        const lore: Act = { label: 'Летопись', fn: () => itemModal(this, def, { refine: lvl, card: row.instance.card ?? null }), name: 'itemLore' };
        const primary = heroId ? (refine ?? toHero!) : wear;
        const secondary = heroId ? (refine ? toHero! : lore) : (refine ?? lore);
        const bw = (width - S.s) / 2;
        const sb = button(this, bw / 2, y + 64, bw, 128, '', secondary.label, secondary.fn, T.heading, { variant: 'secondary', sound: null });
        sb.container.setName(secondary.name);
        const pb = cta(this, bw + S.s + bw / 2, y + 64, primary.label, primary.fn, { w: bw, h: 128 });
        pb.container.setName(primary.name);
        content.add([sb.container, pb.container]);
        return y + 128;
      },
      { onClose: () => (next ? next() : this.lockList(false)) },
    );
    sheet.layer.setName('itemSheet');
  }

  /** Подтверждение фиксирует конкретные id; ядро перепроверяет защиту перед списанием. */
  private sell(instanceIds: readonly string[], duplicates = false): void {
    const plan = salvagePlan(session.save, GAME, instanceIds);
    if (!plan.instanceIds.length) {
      toast(this, 'Эти предметы защищены или уже проданы', C.muted);
      this.lockList(false);
      return;
    }
    const question = `Продать ${plan.instanceIds.length} предм. за ${formatNumber(plan.gold)} золота?${duplicates ? '\nОдна запасная вещь каждого вида останется. Надетые, заточенные, с картой и защищённые вещи сохранятся.' : ''}`;
    confirm(this, question, 'Продать', () => {
      try {
        const result = salvageItems(session.save, plan.instanceIds, GAME);
        commit(result.save);
        this.scene.restart({ ...this.data0 });
        this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, `Продано: ${result.sold} · +${formatNumber(result.gold)} золота`, C.success));
      } catch (e) {
        this.reportError(e);
        this.lockList(false);
      }
    });
    this.lockList(false);
  }

  /** MT-12: лист «Кому надеть?»: до 6 героев (кому можно и отряд — первыми; копии — одной строкой) с разницей статов. */
  private wearSheet(row: StackRow): void {
    const def = row.def;
    if (!def) return;
    const save = session.save;
    const seen = new Set<string>();
    const heroes = [...save.heroes]
      .filter((h) => GAME.content.heroes[h.templateId])
      .sort((x, y) => (equipBlocker(row, x, GAME) ? 1 : 0) - (equipBlocker(row, y, GAME) ? 1 : 0) || Number(save.squad.includes(y.id)) - Number(save.squad.includes(x.id)) || y.level - x.level)
      .filter((h) => (seen.has(h.templateId) ? false : (seen.add(h.templateId), true)))
      .slice(0, 6);
    this.lockList(true);
    let chosen: HeroState | null = null;
    const sheet = bottomSheet(
      this,
      `Кому: ${def.name}`,
      (content, width, close) => {
        const rh = 256;
        heroes.forEach((hero, i) => {
          const blocker = equipBlocker(row, hero, GAME);
          const cur = heroSlots(save, hero.id, GAME)[def.slot];
          const comparison = equipmentComparison(cur ? heroItemStats(hero, cur.def, cur.instance, GAME) : undefined, heroItemStats(hero, def, row.instance, GAME), GAME.features.power);
          const face = heroFace(this, heroSprite(hero, GAME), 80, GAME.content.heroes[hero.templateId]?.gender);
          const r = listRow(this, width / 2, i * (rh + S.xs) + rh / 2, width, {
            icon: face,
            title: `${heroName(hero, GAME)} · ур. ${hero.level}`,
            subtitle: blocker ?? comparison.text,
            subtitleFullWidth: true,
            h: rh,
            dim: !!blocker,
            ...(save.squad.includes(hero.id) ? { trailing: tag(this, 0, 0, 'в отряде', 'positive') } : {}),
            onTap: () => {
              // Отмена и первый выбор окончательны, даже пока лист ещё уезжает.
              if (chosen || sheet.layer.name !== 'wearPicker') return;
              if (blocker) {
                toast(this, `Нельзя надеть: ${blocker}`, C.error);
                return;
              }
              chosen = hero;
              close();
            },
          });
          // Смешанный обмен статами — нейтральный; запрет — красный.
          const texts = r.list.filter((o): o is Phaser.GameObjects.Text => o.type === 'Text');
          texts[texts.length - 1]?.setColor(blocker ? COLOR.negative : comparison.tone === 'positive' ? COLOR.positive : comparison.tone === 'negative' ? COLOR.negative : COLOR.textSecondary);
          r.setName(`wear_${hero.id}`);
          content.add(r);
        });
        return heroes.length * (rh + S.xs) - S.xs;
      },
      {
        onClose: () => {
          this.lockList(false);
          if (!chosen) return;
          this.heroBack = { to: 'Inventory' };
          this.equip(chosen, row, null);
        },
      },
    );
    sheet.layer.setName('wearPicker');
  }

  // ---------- карты MVP (BUG-187) ----------

  /** Карты MVP в запасе (data/hunt.json → cards): строка на карту, «Вставить» — лист предметов того же слота без карты. */
  private mvpCards(top: number): void {
    const own = ownedCards(session.save);
    const defs = GAME.hunt.cards.filter((c) => (own[c.id] ?? 0) > 0);
    if (!defs.length) {
      emptyCard(this, top + 360, 'Карт MVP пока нет', 'bag', { label: 'На охоту', onClick: () => this.scene.start('Hunt') });
      return;
    }
    const rowH = 136;
    const area = (this.area = new ScrollArea(this, top, CONTENT_BOTTOM + 10));
    defs.forEach((c, i) => {
      const y = i * (rowH + S.xs) + rowH / 2;
      const free = this.cardTargets(c.slot);
      const trailing = button(this, 0, 0, 240, BTN.m, '', free.length ? 'Вставить' : 'Предметы', area.tap(() => this.cardTargetSheet(c.id)), T.body, { variant: 'secondary' }).container.setSize(240, BTN.m).setName(`mvpCardInsert_${c.id}`);
      const r = listRow(this, GAME_W / 2, y, CW, {
        icon: (s, x, iy, size) => s.add.image(x, iy, itemIconKey(s, c.slot)).setDisplaySize(size, size).setTint(COLOR_N.textSecondary),
        title: own[c.id] > 1 ? `${c.name} ×${own[c.id]}` : c.name,
        subtitle: c.text,
        trailing,
        h: rowH,
      });
      area.add(r);
    });
    area.setContentHeight(defs.length * (rowH + S.xs));
  }

  /** Предметы слота без карты: надетые — первыми, затем по редкости. */
  private cardTargets(slot: Slot): { instance: ItemInstance; def: ItemDef; wornBy: string | null }[] {
    const save = session.save;
    const order: readonly string[] = RARITIES;
    return save.inventory.items
      .filter((i) => !i.card && GAME.equipment.items[i.itemId]?.slot === slot)
      .map((instance) => {
        const hero = instance.equippedBy ? save.heroes.find((h) => h.id === instance.equippedBy) : undefined;
        return { instance, def: GAME.equipment.items[instance.itemId], wornBy: hero ? heroName(hero, GAME) : null };
      })
      .sort((a, b) => Number(!!b.wornBy) - Number(!!a.wornBy) || order.indexOf(b.def.rarity) - order.indexOf(a.def.rarity) || refineLevel(b.instance) - refineLevel(a.instance));
  }

  /** Все экземпляры слота без карты. Длинный список прокручивает и ограничивает bottomSheet. */
  private cardTargetSheet(cardId: string): void {
    const c = GAME.hunt.cards.find((x) => x.id === cardId);
    if (!c) return;
    const items = this.cardTargets(c.slot);
    let chosen: { item: (typeof items)[number]; number: number } | null = null;
    this.lockList(true);
    const sheet = bottomSheet(
      this,
      `Куда: ${c.name}`,
      (content, width, close) => {
        if (!items.length) {
          content.add(text(this, width / 2, 48, 'Подходящих предметов нет', T.heading, COLOR.textPrimary).setName('cardTargetEmpty'));
          content.add(text(this, width / 2, 132, `${SLOT_NAMES[c.slot]} без вставленной карты.\nСнаряжение можно получить в кампании.`, T.body, COLOR.textSecondary, { wordWrap: { width }, align: 'center' }));
          return 224;
        }
        const introH = 80;
        content.add(text(this, 0, 32, `${SLOT_NAMES[c.slot]} · Доступно: ${items.length}`, T.caption, COLOR.textSecondary).setOrigin(0, 0.5).setName('cardTargetCount'));
        const rh = 144;
        items.forEach((it, i) => {
          const lvl = refineLevel(it.instance);
          const status = it.wornBy ? `Надет: ${it.wornBy}` : it.instance.equippedBy ? 'Надет' : 'Свободен';
          const r = listRow(this, width / 2, introH + i * (rh + S.xs) + rh / 2, width, {
            icon: (s, x, y, size) => s.add.image(x, y, itemIconKey(s, it.def.slot, it.instance.itemId)).setDisplaySize(size, size),
            title: refinedName(it.def, lvl),
            subtitle: `Экз. ${i + 1} · ${status}`,
            trailing: '›',
            h: rh,
            onTap: () => {
              // Не менять выбранный экземпляр повторным касанием во время закрытия.
              if (chosen || sheet.layer.name !== 'cardTargetPicker') return;
              chosen = { item: it, number: i + 1 };
              close();
            },
          }).setName(`cardTarget_${it.instance.id}`);
          const texts = r.list.filter((o): o is Phaser.GameObjects.Text => o.type === 'Text');
          // trailing создаётся раньше заголовка.
          texts[1]?.setColor(RARITY_COLORS[it.def.rarity]);
          content.add(r);
        });
        return introH + items.length * (rh + S.xs) - S.xs;
      },
      { onClose: () => {
        this.lockList(false);
        if (!chosen) return;
        const { item: it, number } = chosen;
        const name = refinedName(it.def, refineLevel(it.instance));
        const status = it.wornBy ? `Надет: ${it.wornBy}` : it.instance.equippedBy ? 'Надет' : 'Свободен';
        // Подтверждение открывается после завершения анимации листа, без двух конкурирующих слоёв.
        confirm(this, `Вставить «${c.name}» в «${name}»?\nЭкз. ${number} · ${status}\nКарту нельзя вынуть.`, 'Вставить', () => {
          try {
            commit(insertCard(session.save, it.instance.id, c.id, GAME));
            sfx('refine_success');
            haptic('refineOk');
            this.scene.restart({});
            this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, `${c.name} — в «${name}»`, C.success));
          } catch (e) {
            this.reportError(e);
          }
        });
      } },
    );
    sheet.layer.setName('cardTargetPicker');
  }

  // ---------- карты героев ----------

  /**
   * «Карты героев»: вид («Таблица» — по умолчанию, «Карты») сегментом, сводка по редкостям (ромб + число; она же фильтр
   * и итоги столбцов таблицы) и сам вид. Фильтр по герою (с карточки героя «Копий: N ›» или нажатием строки таблицы)
   * всегда показывает вид «Карты» — справа «Имя ✕» снимает его.
   */
  private cards(top: number): void {
    const save = session.save;
    const rarity = inventoryUi.rarity;
    const only = inventoryUi.template && GAME.content.heroes[inventoryUi.template] ? inventoryUi.template : null;
    const view = only ? 'grid' : inventoryUi.view;
    const table = heroCardsTable(save, GAME, rarity);
    const onlyRow = only ? heroCardsTable(save, GAME).rows.find((r) => r.templateId === only) : undefined;
    const counts = onlyRow ? onlyRow.counts : table.totals;
    const total = onlyRow ? onlyRow.total : table.total;

    const rowY = top + 44;
    const views = ['table', 'grid'] as const;
    const seg = segmented(this, LEFT + 260, rowY, 520, ['Таблица', 'Карты'], views.indexOf(view), (i) => {
      inventoryUi.view = views[i];
      inventoryUi.template = null;
      this.scene.restart({});
    });
    seg.container.setName('cardsView');
    if (only) {
      button(this, GAME_W - LEFT - 200, rowY, 400, BTN.m, '', `${GAME.content.heroes[only].name} ✕`, () => {
        inventoryUi.template = null;
        this.scene.restart({});
      }, T.body, { variant: 'secondary', sound: 'ui_toggle' }).container.setName('cardsTemplateOff');
    }

    // Сводка по редкостям: слева «Всего» и число, справа 5 плашек (ромб цвета редкости и число) — это и фильтр
    // (повторное нажатие снимает), и итоги столбцов таблицы (плашки стоят ровно над столбцами).
    const chipY = rowY + 44 + S.s + 60;
    const CHIP_H = 120;
    text(this, LEFT, chipY - 26, onlyRow ? onlyRow.name : 'Всего', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    text(this, LEFT, chipY + 24, String(total), T.display, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5).setName('cardsTotal');
    RARITY_ORDER.forEach((r, i) => {
      const on = rarity === r;
      const n = counts[r];
      const x = colX(i);
      const col = rarityColor(r);
      const bg = plate(this, x, chipY, TBL_CELL - 10, CHIP_H, on ? { fill: mixHex(COLOR.surfaceRaised, col, 0.2), border: COLOR.accent, borderW: 4, r: R.m, hl: 0.14 } : { ...SURFACE.sunken, border: mixHex(COLOR.surfaceSunken, col, 0.5), borderW: 2, r: R.m }).setName(`cardsRarity_${r}`);
      const d = 15;
      this.add.polygon(x, chipY - 28, [d, 0, 2 * d, d, d, 2 * d, 0, d], parseInt(col.slice(1, 7), 16)).setStrokeStyle(3, 0x000000);
      text(this, x, chipY + 22, String(n), T.heading, n ? COLOR.textPrimary : COLOR.textTertiary, { fontStyle: 'bold' }).setName(`cardsCount_${r}`);
      if (!n && !on) bg.setAlpha(0.6);
      pressable(this, bg, TBL_CELL - 10, CHIP_H, () => {
        sfx('ui_toggle');
        inventoryUi.rarity = on ? null : (r as CardRarity);
        this.scene.restart({});
      });
    });
    const listTop = chipY + CHIP_H / 2 + S.s;
    if (view === 'table') {
      this.cardsTable(table.rows, rarity, listTop);
      return;
    }
    const list = heroCardsList(save, GAME, rarity, only);
    if (!list.length) {
      emptyCard(this, listTop + 300, 'Карт нет', 'bag');
      return;
    }
    const COLS3 = 3;
    const TILE_W = 300;
    const GAP_X = (CW - COLS3 * TILE_W) / (COLS3 - 1);
    const { h: tileH } = heroCardSize(TILE_W);
    const rowH = tileH + S.s;
    const rows = Math.ceil(list.length / COLS3);
    this.list(rows, rowH, listTop, (row, y, a) => {
      for (let c = 0; c < COLS3; c++) {
        const hero = list[row * COLS3 + c];
        if (!hero) break;
        drawHeroCard(this, LEFT + TILE_W / 2 + c * (TILE_W + GAP_X), y, hero, {
          w: TILE_W,
          needsBranch: needsBranch(hero, GAME),
          inSquad: save.squad.includes(hero.id),
          isNew: !!hero.isNew,
          locked: !!hero.locked,
          glow: false,
          parent: a.content,
          onTap: a.tap(() => this.scene.start('Hero', { heroId: hero.id, back: { to: 'Inventory' } })),
        });
      }
    });
  }

  /**
   * Вид «Таблица»: по строке на героя — мини-карта в рамке лучшей редкости, имя с иконкой линии, под ним класс или
   * «можно вознести», справа 5 ячеек цвета редкостей с числом карт (0 — пусто). Нажатие — его карты (вид «Карты»).
   */
  private cardsTable(rows: HeroCardsRow[], rarity: CardRarity | null, top: number): void {
    if (!rows.length) {
      emptyCard(this, top + 300, 'Карт нет', 'bag');
      return;
    }
    const RH = 144;
    const area = (this.area = new ScrollArea(this, top, contentBottom() + 10));
    area.setContentHeight(rows.length * RH + 10);
    rows.forEach((row, i) => {
      const y = RH * (i + 0.5);
      const empty = row.total === 0;
      const box = this.add.container(0, y).setName(`cardsRow_${row.templateId}`);
      const bg = plate(this, GAME_W / 2, 0, GAME_W - 2 * S.xs, RH - 12, { ...SURFACE.surface, r: R.m });
      bg.setInteractive();
      bg.on('pointerup', area.tap(() => {
        if (empty) {
          toast(this, `Карт героя «${row.name}» пока нет`, C.muted);
          return;
        }
        sfx('ui_toggle');
        inventoryUi.template = row.templateId;
        this.scene.restart({});
      }));
      box.add(bg);
      box.add(heroCardIcon(this, 80, 0, 112, row.best ?? 'green', row.templateId, { dim: empty }));
      box.add(this.add.image(156, -28, cardIcon(this, row.line)).setDisplaySize(40, 40).setTint(COLOR_N.textSecondary));
      box.add(ellipsize(text(this, 184, -28, row.name, T.body, empty ? COLOR.textTertiary : COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5), TBL_X0 - 194));
      const job = GAME.content.jobs[row.line]?.name ?? row.line;
      const sub = empty ? '—' : row.ascendable ? '▲ вознести' : job;
      box.add(ellipsize(text(this, 140, 28, sub, T.caption, empty ? COLOR.textTertiary : row.ascendable ? COLOR.positive : COLOR.textSecondary, { fontStyle: row.ascendable ? 'bold' : 'normal' }).setOrigin(0, 0.5).setName('cardsRowSub'), TBL_X0 - 150));
      RARITY_ORDER.forEach((r, c) => {
        const n = row.counts[r];
        const faded = !!rarity && rarity !== r;
        const col = rarityColor(r);
        const cell = plate(this, colX(c), 0, TBL_CELL - 12, RH - 36, n ? { fill: col, alpha: 0.85, r: R.s, hl: 0.2 } : { fill: COLOR.surfaceSunken, alpha: 0.6, border: mixHex(COLOR.surfaceSunken, col, 0.4), borderW: 2, r: R.s });
        box.add(cell);
        if (n) box.add(text(this, colX(c), 0, String(n), T.heading, COLOR.textPrimary, { fontStyle: 'bold', stroke: '#00000080', strokeThickness: 5 }).setAlpha(faded ? 0.35 : 1));
        if (faded) cell.setAlpha(0.3);
      });
      if (empty) box.setAlpha(0.6);
      area.add(box);
    });
    staggerIn(this, 'InventoryTable', area.content.list.slice(0, 8).map((o) => [o]));
  }

  // ---------- общее ----------

  /** Список под листом снизу не прокручивается и не нажимается, пока лист открыт. */
  private lockList(on: boolean): void {
    if (this.area) this.area.locked = on;
  }

  /**
   * Строки с прокруткой пальцем. T4-11: строятся только видимые строки (плюс запас ROW_BUFFER); при прокрутке ушедшие
   * из окна уничтожаются, новые достраиваются — 3000 предметов открываются так же быстро, как 30. draw(i, y, area) —
   * строка i с центром y (координаты содержимого списка).
   */
  private list(count: number, rowH: number, top: number, draw: (i: number, y: number, area: ScrollArea) => void, buffer = ROW_BUFFER): void {
    const bottom = CONTENT_BOTTOM + 10;
    const area = (this.area = new ScrollArea(this, top, bottom));
    area.setContentHeight(rowH * count + S.xs);
    const built = new Map<number, Phaser.GameObjects.GameObject[]>();
    let lastOffset = NaN;
    const sync = () => {
      const off = area.offset;
      if (off === lastOffset) return;
      lastOffset = off;
      const from = Math.max(0, Math.floor(off / rowH) - buffer);
      const to = Math.min(count - 1, Math.ceil((off + bottom - top) / rowH) + buffer);
      for (const [i, objs] of built) {
        if (i >= from && i <= to) continue;
        for (const o of objs) o.destroy();
        built.delete(i);
      }
      for (let i = from; i <= to; i++) {
        if (built.has(i)) continue;
        const before = new Set(area.content.list);
        draw(i, rowH * (i + 0.5), area);
        built.set(i, area.content.list.filter((o) => !before.has(o)));
      }
    };
    sync();
    // Первые видимые строки «выезжают» при первом открытии инвентаря за сессию (дальше строятся без анимации).
    if (juiceOn()) staggerIn(this, 'Inventory', [...built.values()]);
    this.events.on(Phaser.Scenes.Events.UPDATE, sync);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, sync));
  }

  /** Строка предмета (выбор для слота): ячейка, имя цветом редкости, разница статов цветом; контейнер с центром y. */
  private itemRow(a: ScrollArea, row: StackRow, y: number, note: string, noteColor: string, withButton: boolean): Phaser.GameObjects.Container {
    const box = this.add.container(GAME_W / 2, y).setName(`invRow_${row.instance.id}`);
    a.add(box);
    box.add(plate(this, 0, 0, CW, ROW_H - S.xs, { ...SURFACE.surface, r: R.m }));
    const def = row.def;
    const lvl = refineLevel(row.instance);
    const cx = -CW / 2 + S.s + CELL / 2;
    box.add(itemCell(this, cx, -56, CELL, def?.slot ?? null, rarityNum(def), row.instance.itemId, lvl));
    if (row.count > 1) box.add(text(this, cx + CELL / 2 - 4, -56 + CELL / 2 - 2, `×${row.count}`, T.caption, COLOR.textPrimary, { fontStyle: 'bold', stroke: '#1a1208', strokeThickness: 6 }).setOrigin(1, 1));
    const tx = cx + CELL / 2 + S.s;
    const tw = CW / 2 - tx - (withButton ? 220 + S.m + S.s : S.m);
    const name = def ? refinedName(def, lvl) : row.instance.itemId;
    box.add(ellipsize(text(this, tx, -56, name, T.body, def ? RARITY_COLORS[def.rarity] : COLOR.textTertiary, { fontStyle: 'bold' }).setOrigin(0, 0.5), tw));
    // Полная ширина под иконкой и кнопкой: ни мощь, ни потеря стата не скрываются многоточием.
    box.add(text(this, -CW / 2 + S.s, 16, note, T.caption, noteColor, { fontStyle: 'bold', align: 'left', wordWrap: { width: CW - 2 * S.s }, lineSpacing: 0 }).setOrigin(0, 0));
    // Касание по ячейке и имени — окно предмета (статы, кому подходит, легенда из Летописи).
    if (def) {
      const zw = tx + tw - (-CW / 2);
      const zone = this.add.zone(-CW / 2 + zw / 2, 0, zw, ROW_H - S.xs);
      box.add(zone);
      pressable(this, zone, zw, ROW_H - S.xs, a.tap(() => itemModal(this, def, { refine: lvl, lock: a, card: row.instance.card ?? null })));
    }
    return box;
  }
}

/** Цена-чип внутри главной кнопки: подпись слева, золото справа (тёмное на золоте; красное — не хватает). */
function priceIn(scene: Phaser.Scene, b: { container: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text }, gold: number, ok: boolean): void {
  const price = chip(scene, 0, 0, 'gold', formatNumber(gold), ok ? 'neutral' : 'negative', { bg: false });
  if (ok) (price.list.find((o) => o.type === 'Text') as Phaser.GameObjects.Text | undefined)?.setColor(COLOR.onAccent);
  const total = b.label.width + S.s + price.width;
  b.label.setX(-total / 2 + b.label.width / 2);
  price.setPosition(total / 2 - price.width / 2, -3);
  b.container.add(price);
}

/** Для тестов: размеры сетки снаряжения (5 в ряд в ширину контента). */
export const GRID = { COLS, TILE, GAP, TOUCH } as const;
