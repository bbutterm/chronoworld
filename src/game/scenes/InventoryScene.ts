import Phaser from 'phaser';
import {
  actEquip,
  actUnequip,
  heroName,
  heroSlots,
  lockedText,
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
  SLOTS,
  type CardRarity,
  type HeroState,
  type ItemDef,
  type ItemInstance,
  type Slot,
} from '../../core';
import { GAME } from '../content';
import { diffText, equipBlocker, formatNumber, inventoryRows, itemStatsText, RARITY_COLORS, RARITY_NAMES, SLOT_NAMES, STAT_KEYS, STAT_LABELS, statDiff, type InventoryRow } from '../flow';
import { GAME_W } from '../layout';
import { card, confirm, CONTENT_BOTTOM, CONTENT_TOP, emptyCard, screen } from '../screen';
import { commit, session } from '../session';
import { button, ellipsize, ScrollArea, text, toast } from '../ui';
import { C, FS, OUTLINE, TINT, TOUCH } from '../theme';
import { itemCell, oreIcon } from '../itemIcons';
import { burst, staggerIn } from '../juice';
import { markHint } from '../hints';
import { sfx } from '../audio';
import { drawHeroCard, heroCardSize, rarityColor } from '../heroCard';
import { heroCardsList, heroCardsSummary, inventoryUi, RARITY_ORDER } from '../heroesView';

/**
 * K6. Инвентарь.
 * - Без героя: вкладки «Снаряжение» (все предметы, фильтр по слоту, кто что носит) и «Карты героев» (каждый экземпляр
 *   героя — своя карта: копии по отдельности, фильтр редкости; нажатие — карточка этого экземпляра).
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

/** Высота карточки «Надето сейчас» (с блоком заточки: заголовок, прирост, три кнопки). */
const CUR_H = 560;
/** Высота карточки, когда заточка закрыта или на максимуме (одна строка). */
const CUR_H_SHORT = 290;

/** «30%» — шанс поломки. */
const pct = (p: number) => `${Math.round(p * 100)}%`;
/** Цвет риска поломки: нет — зелёный, до 30% — жёлтый, выше — красный. */
const riskColor = (p: number) => (p <= 0 ? C.positive : p <= 0.3 ? C.warning : C.danger);

/** Статы предмета с заточкой экземпляра. */
const statsOf = (def: ItemDef, instance: Pick<ItemInstance, 'refine'>) => refinedStats(def, refineLevel(instance), GAME);

/** «АТК 41 → 48 · ОЗ 260 → 312» — что даст следующий шаг заточки (только растущие статы). */
function refineGainText(def: ItemDef, from: number): string {
  const a = refinedStats(def, from, GAME);
  const b = refinedStats(def, from + 1, GAME);
  const parts = STAT_KEYS.filter((k) => (b[k] ?? 0) !== (a[k] ?? 0)).map((k) => `${STAT_LABELS[k]} ${a[k] ?? 0} → ${b[k] ?? 0}`);
  return parts.length ? parts.join(' · ') : 'статы почти не меняются';
}

/** Поломка при заточке: тряска экрана и осколки цвета редкости, разлетающиеся из точки at. */
function shatter(scene: Phaser.Scene, at: { x: number; y: number }, color: number): void {
  scene.cameras.main.shake(260, 0.012);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.2;
    const shard = scene.add.triangle(at.x, at.y, 0, 0, 22, 6, 6, 26, i % 2 ? color : 0x9a9a9a).setDepth(8000).setRotation(a);
    const r = 110 + (i % 4) * 35;
    scene.tweens.add({
      targets: shard,
      x: at.x + Math.cos(a) * r,
      y: at.y + Math.sin(a) * r + 90,
      angle: shard.angle + 240,
      alpha: 0,
      duration: 650,
      ease: 'Cubic.easeOut',
      onComplete: () => shard.destroy(),
    });
  }
}

/** Строка списка: предмет и сколько таких же свободных в стопке (T4-11). */
interface StackRow extends InventoryRow {
  count: number;
}

/**
 * T4-11: одинаковые свободные предметы — одной строкой «×N» (надетые — по одному: у каждого свой герой).
 * Заточенные по-разному (+0 и +3) — разные строки. Порядок — как у inventoryRows (первое появление предмета).
 */
export function stackRows(rows: InventoryRow[]): StackRow[] {
  const out: StackRow[] = [];
  const free = new Map<string, StackRow>();
  for (const r of rows) {
    if (r.instance.equippedBy !== null) {
      out.push({ ...r, count: 1 });
      continue;
    }
    const key = `${r.instance.itemId}+${r.instance.refine ?? 0}`;
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

    const hasRefine = !!refineConfig(GAME);
    const refineOpen = hasRefine && !!cur && refineUnlocked(save, GAME) && !!refineModeCost(cur.instance, cur.def, GAME);
    const curH = !hasRefine || !cur ? 200 : refineOpen ? CUR_H : CUR_H_SHORT;
    card(this, GAME_W / 2, top + curH / 2, 1040, curH, true);
    text(this, TEXT_X, top + 45, 'Надето сейчас', FS.small, C.inkMuted).setOrigin(0, 0.5);
    if (cur) {
      const lvl = refineLevel(cur.instance);
      itemCell(this, CELL_X, top + 110, CELL, slot, Phaser.Display.Color.HexStringToColor(RARITY_COLORS[cur.def.rarity]).color, cur.instance.itemId, lvl);
      ellipsize(text(this, TEXT_X, top + 100, refinedName(cur.def, lvl), FS.h2, RARITY_COLORS[cur.def.rarity], { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }).setOrigin(0, 0.5).setName('curItemName'), TEXT_W);
      ellipsize(text(this, TEXT_X, top + 155, `${RARITY_NAMES[cur.def.rarity]} · ${itemStatsText(statsOf(cur.def, cur.instance))}`, FS.small, C.ink).setOrigin(0, 0.5), TEXT_W);
      if (hasRefine) this.refineRow(hero, slot, cur.instance, cur.def, top);
      button(this, 880, top + 100, 250, 110, 'k:buttonLong_beige', 'Снять', () => {
        commit(actUnequip(session.save, cur.instance.id));
        this.backToHero(hero.id, `${heroName(hero, GAME)}: снят предмет «${cur.def.name}»`);
      }, FS.h3);
    } else {
      for (const o of itemCell(this, CELL_X, top + 110, CELL, slot, TINT.frame)) (o as Phaser.GameObjects.Image).setAlpha(0.35);
      text(this, TEXT_X, top + 110, 'Слот пуст', FS.h3, C.inkMuted, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    }

    const rows = stackRows(inventoryRows(save, GAME, slot).filter((r) => r.instance.id !== cur?.instance.id));
    const listTop = top + curH + 30;
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
      const diff = row.def ? statDiff(cur ? statsOf(cur.def, cur.instance) : undefined, statsOf(row.def, row.instance)) : [];
      const sum = diff.reduce((s, d) => s + d.delta, 0);
      const owner = row.wornBy ? `  · сейчас у: ${row.wornBy}` : '';
      this.itemRow(row, y, blocker ?? diffText(diff) + owner, blocker ? C.danger : sum > 0 ? C.positive : sum < 0 ? C.danger : C.muted);
      const other = row.instance.equippedBy !== null;
      const b = button(this, 880, y, 250, 110, blocker ? 'k:buttonLong_grey' : other ? 'ui_btn_secondary' : 'ui_btn_primary', other ? 'Забрать' : 'Надеть', a.tap(() =>
        this.equip(hero, row, blocker),
      ), FS.h3);
      a.add(b.container);
      if (blocker) b.setEnabled(false);
    });
  }

  /**
   * Блок заточки в карточке «Надето сейчас» (top — верх карточки): «Заточка +N → +N+1», руда «×N», прирост статов шага
   * и бонус заточки, три кнопки — «Заточить» (обычный шаг), «Надёжно» (цена × safeGoldMult, шанс ÷ safeBreakDiv),
   * «Рудой» (100%, тратит руду; нет руды — неактивна); под каждой — шанс поломки цветом риска. Безопасный шаг (0%) —
   * одна кнопка. Риск > 0 — подтверждение. Закрыто — «Откроется на этапе …», максимум — «+10 — максимум».
   */
  private refineRow(hero: HeroState, slot: Slot, instance: ItemInstance, def: ItemDef, top: number): void {
    this.add.rectangle(GAME_W / 2, top + 205, 980, 3, TINT.frame, 0.5);
    const lvl = refineLevel(instance);
    const y0 = top + 250;
    if (!refineUnlocked(session.save, GAME)) {
      text(this, TEXT_X, y0, `Заточка · ${lockedText(session.save, 'refine', GAME)}`, FS.small, C.inkMuted).setOrigin(0, 0.5).setName('refineLocked');
      return;
    }
    const ore = blessedOre(session.save);
    const oreText = text(this, 1000, y0, `Руда: ${ore}`, FS.body, C.ink, { fontStyle: 'bold' }).setOrigin(1, 0.5).setName('refineOre');
    oreIcon(this, oreText.x - oreText.width - 30, y0, 56);
    if (!refineModeCost(instance, def, GAME)) {
      text(this, TEXT_X, y0, `Заточка +${lvl} — максимум`, FS.body, C.gold, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 5 }).setOrigin(0, 0.5).setName('refineMax');
      return;
    }
    ellipsize(text(this, 50, y0, `Заточка +${lvl} → +${lvl + 1}`, FS.h3, C.gold, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 5 }).setOrigin(0, 0.5).setName('refineTitle'), 620);
    ellipsize(text(this, 50, y0 + 50, refineGainText(def, lvl), FS.small, C.ink).setOrigin(0, 0.5).setName('refineGain'), 960);
    const pctB = (b: number) => `+${Math.round(b * 100)}%`;
    text(this, 50, y0 + 92, `Бонус заточки: ${pctB(refineBonus(lvl, GAME))} → ${pctB(refineBonus(lvl + 1, GAME))} к статам вещи`, FS.caption, C.inkMuted).setOrigin(0, 0.5).setName('refineBonus');

    const risky = refineBreakChance(lvl, GAME) > 0;
    const modes: RefineMode[] = !risky ? ['normal'] : refineSafeAvailable(GAME) ? ['normal', 'safe', 'ore'] : ['normal', 'ore'];
    const W = modes.length === 1 ? 420 : 318;
    const xs = modes.length === 1 ? [GAME_W / 2] : modes.length === 2 ? [290, 790] : [197, 540, 883];
    const by = y0 + 180;
    modes.forEach((mode, i) => this.refineButton(hero, slot, instance, def, mode, xs[i], by, W));
  }

  /** Кнопка режима заточки с ценой и подписью шанса поломки под ней. */
  private refineButton(hero: HeroState, slot: Slot, instance: ItemInstance, def: ItemDef, mode: RefineMode, x: number, y: number, w: number): void {
    const lvl = refineLevel(instance);
    const cost = refineModeCost(instance, def, GAME, mode)!;
    const chance = refineBreakChance(lvl, GAME, mode);
    const gold = session.save.resources.gold;
    const ore = blessedOre(session.save);
    const noOre = mode === 'ore' && ore < 1;
    const enough = gold >= cost.gold;
    const title = mode === 'normal' ? 'Заточить' : mode === 'safe' ? 'Надёжно' : 'Рудой';
    const skin = noOre || !enough ? 'k:buttonLong_grey' : mode === 'ore' ? 'ui_btn_secondary' : mode === 'safe' ? 'ui_btn_primary' : chance > 0.3 ? 'k:buttonLong_brown' : 'ui_btn_primary';
    const go = () => this.refine(hero, slot, instance.id, mode);
    const what = `«${refinedName(def, lvl)}» до +${lvl + 1}`;
    const onTap = () => {
      if (chance <= 0) return go();
      const head = mode === 'safe' ? `Надёжная заточка: шанс поломки ${pct(chance)} (вместо ${pct(refineBreakChance(lvl, GAME))}).` : `Вещь может сломаться (${pct(chance)}).`;
      confirm(this, `${head}\nСломанная вещь исчезнет, золото (${formatNumber(cost.gold)}) не вернётся.\n\nТочить ${what}?`, 'Точить', go, { danger: chance > 0.3 });
    };
    const b = button(this, x, y, w, 120, skin, `${title}\n${formatNumber(cost.gold)}`, onTap, FS.body);
    b.container.setName(`refineBtn_${mode}`);
    const note = mode === 'ore' ? (noOre ? 'нет руды · с боссов' : 'без поломки · 1 руда') : chance > 0 ? `поломка ${pct(chance)}` : 'без риска поломки';
    text(this, x, y + 88, note, FS.caption, mode === 'ore' && noOre ? C.inkMuted : riskColor(chance), { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setName(`refineNote_${mode}`);
    if (noOre || !enough) {
      // Нажатие по серой кнопке — подсказка, чего не хватает.
      b.setEnabled(false);
      const hit = this.add.rectangle(x, y, w, 120, 0x000000, 0.001).setInteractive();
      hit.on('pointerup', () =>
        toast(this, noOre ? 'Нет Благословенной руды: она падает с боссов глав, Башни и Охоты' : `Не хватает золота: ${formatNumber(cost.gold - gold)}`, C.error),
      );
    }
  }

  private refine(hero: HeroState, slot: Slot, instanceId: string, mode: RefineMode): void {
    try {
      const r = refineItem(session.save, instanceId, GAME, { mode });
      commit(r.save);
      const e = r.events[0];
      const def = GAME.equipment.items[e.itemId];
      const at = { x: CELL_X, y: CONTENT_TOP + 110 };
      if (e.type === 'refineBroken') {
        // Поломка: глухой удар, тряска экрана и осколки из ячейки предмета.
        const color = def ? Phaser.Display.Color.HexStringToColor(RARITY_COLORS[def.rarity]).color : TINT.frame;
        sfx('hit_blunt');
        sfx('ui_error', { delay: 120 });
        this.scene.restart({ heroId: hero.id, slot });
        this.events.once(Phaser.Scenes.Events.CREATE, () => {
          shatter(this, at, color);
          toast(this, `Вещь сломалась! «${def ? refinedName(def, e.level) : e.itemId}» потеряна`, C.error, 3500);
        });
        return;
      }
      sfx('equip', { rate: 1.3 });
      sfx('coin', { delay: 60 });
      this.scene.restart({ heroId: hero.id, slot });
      this.events.once(Phaser.Scenes.Events.CREATE, () => {
        burst(this, at);
        const how = mode === 'ore' ? ' (Благословенная руда)' : mode === 'safe' ? ' (надёжная заточка)' : '';
        toast(this, `${def ? refinedName(def, e.to) : e.itemId}: заточка удалась!${how}`, C.success, 2500);
      });
    } catch (e) {
      sfx('ui_error');
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
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
    // Вкладки экрана: снаряжение и карты героев (запоминается на сессию).
    const main: { id: 'gear' | 'cards'; label: string }[] = [
      { id: 'gear', label: 'Снаряжение' },
      { id: 'cards', label: `Карты героев (${heroCardsList(session.save, GAME).length})` },
    ];
    main.forEach((t, i) => {
      const on = inventoryUi.tab === t.id;
      button(this, 20 + 520 * (i + 0.5), top + 50, 508, TOUCH, on ? 'k:buttonLong_brown' : 'k:buttonLong_beige', t.label, () => {
        if (on) return;
        inventoryUi.tab = t.id;
        this.scene.restart({});
      }, FS.h3, { sound: 'ui_toggle' }).container.setName(`invTab_${t.id}`);
    });
    if (inventoryUi.tab === 'cards') {
      this.cards(top + 110);
      return;
    }
    this.gear(filter, top + 105);
  }

  private gear(filter: Slot | null, top: number): void {
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

  // ---------- карты героев ----------

  /**
   * Все экземпляры героев по отдельности (копии — каждая своей картой): сводка по редкостям, фильтр редкости (ромбы),
   * сетка 3 в ряд с прокруткой; строятся только видимые ряды (сотни копий открываются быстро).
   */
  private cards(top: number): void {
    const save = session.save;
    const rarity = inventoryUi.rarity;
    const only = inventoryUi.template && GAME.content.heroes[inventoryUi.template] ? inventoryUi.template : null;
    const list = heroCardsList(save, GAME, rarity, only);
    if (only) {
      // С карточки героя («Копий: N ›») — только его копии; кнопка снимает фильтр.
      const n = heroCardsList(save, GAME, null, only).length;
      button(this, GAME_W / 2, top + 40, 760, 76, 'k:buttonLong_beige', `${GAME.content.heroes[only].name}: карт ${n} · показать всех ✕`, () => {
        inventoryUi.template = null;
        this.scene.restart({});
      }, FS.body, { sound: 'ui_toggle' }).container.setName('cardsTemplateOff');
    } else ellipsize(text(this, GAME_W / 2, top + 40, heroCardsSummary(save, GAME), FS.body, C.text, { stroke: C.stroke, strokeThickness: 5 }), 1040).setName('cardsSummary');
    // Фильтр редкости: ромбы, повторное нажатие снимает.
    const chipY = top + 130;
    const CH = 96;
    const x0 = GAME_W / 2 - (RARITY_ORDER.length - 1) * (CH + 16) / 2;
    RARITY_ORDER.forEach((r, i) => {
      const on = rarity === r;
      const b = button(this, x0 + i * (CH + 16), chipY, CH, CH, on ? 'k:buttonSquare_brown' : 'k:buttonSquare_beige', '', () => {
        inventoryUi.rarity = on ? null : (r as CardRarity);
        this.scene.restart({});
      }, FS.body, { sound: 'ui_toggle' });
      b.container.setName(`cardsRarity_${r}`);
      const d = 22;
      b.container.add(this.add.polygon(0, -4, [d, 0, 2 * d, d, d, 2 * d, 0, d], Phaser.Display.Color.HexStringToColor(rarityColor(r)).color).setStrokeStyle(4, 0x000000));
    });
    const listTop = chipY + CH / 2 + 16;
    if (!list.length) {
      emptyCard(this, listTop + 300, rarity ? 'Карт этой редкости нет.\nНажмите ромб ещё раз, чтобы снять фильтр.' : 'Карт героев пока нет.', 'bag');
      return;
    }
    const COLS = 3;
    const TILE_W = 300;
    const GAP_X = 36;
    const GAP_Y = 30;
    const { h: tileH } = heroCardSize(TILE_W);
    const rowH = tileH + GAP_Y;
    const rows = Math.ceil(list.length / COLS);
    const bottom = CONTENT_BOTTOM + 10;
    const area = (this.area = new ScrollArea(this, listTop, bottom));
    area.setContentHeight(rows * rowH + GAP_Y);
    const cx0 = GAME_W / 2 - (COLS - 1) * (TILE_W + GAP_X) / 2;
    const draw = (row: number): Phaser.GameObjects.GameObject[] => {
      const out: Phaser.GameObjects.GameObject[] = [];
      for (let c = 0; c < COLS; c++) {
        const hero = list[row * COLS + c];
        if (!hero) break;
        out.push(
          drawHeroCard(this, cx0 + c * (TILE_W + GAP_X), GAP_Y / 2 + tileH / 2 + row * rowH, hero, {
            w: TILE_W,
            needsBranch: needsBranch(hero, GAME),
            inSquad: save.squad.includes(hero.id),
            isNew: !!hero.isNew,
            locked: !!hero.locked,
            glow: false,
            parent: area.content,
            onTap: area.tap(() => this.scene.start('Hero', { heroId: hero.id })),
          }),
        );
      }
      return out;
    };
    const built = new Map<number, Phaser.GameObjects.GameObject[]>();
    let lastOffset = NaN;
    const sync = () => {
      const off = area.offset;
      if (off === lastOffset) return;
      lastOffset = off;
      const from = Math.max(0, Math.floor(off / rowH) - 1);
      const to = Math.min(rows - 1, Math.ceil((off + bottom - listTop) / rowH) + 1);
      for (const [i, objs] of built) {
        if (i >= from && i <= to) continue;
        for (const o of objs) o.destroy();
        built.delete(i);
      }
      for (let i = from; i <= to; i++) if (!built.has(i)) built.set(i, draw(i));
    };
    sync();
    staggerIn(this, 'InventoryCards', [...built.values()]);
    this.events.on(Phaser.Scenes.Events.UPDATE, sync);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, sync));
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
    const lvl = refineLevel(row.instance);
    for (const o of itemCell(this, CELL_X, y, CELL, def?.slot ?? null, Phaser.Display.Color.HexStringToColor(color).color, row.instance.itemId, lvl)) a.add(o);
    if (row.count > 1) a.add(text(this, CELL_X + CELL / 2 - 6, y + CELL / 2 - 4, `×${row.count}`, FS.caption, C.text, { fontStyle: 'bold', ...OUTLINE }).setOrigin(1, 1));
    const name = def ? refinedName(def, lvl) : `${row.instance.itemId} (нет в игре)`;
    a.add(ellipsize(text(this, TEXT_X, y - 44, name, FS.h3, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5), textW));
    a.add(
      ellipsize(
        text(this, TEXT_X, y, def ? `${RARITY_NAMES[def.rarity]} · ${SLOT_NAMES[def.slot]} · ${itemStatsText(statsOf(def, row.instance))}` : 'статов не даёт', FS.small, C.text, {
          stroke: C.stroke,
          strokeThickness: 4,
        }).setOrigin(0, 0.5),
        textW,
      ),
    );
    a.add(ellipsize(text(this, TEXT_X, y + 44, note, FS.small, noteColor, { stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5), textW));
  }
}
