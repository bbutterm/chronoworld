import Phaser from 'phaser';
import { buyShopSlot, refreshShop, shopStatus, type ShopSlotView, type ShopStatus } from '../../core';
import { GAME } from '../content';
import { formatNumber, itemStatsText, RARITY_COLORS, RARITY_NAMES } from '../flow';
import { compactNumber } from '../frame';
import { heroCardIcon, rarityName } from '../heroCard';
import { itemCell } from '../itemIcons';
import { bump, burst, collect, juiceOn, queueRewardFly, staggerIn } from '../juice';
import { GAME_W } from '../layout';
import { rewardIcon } from '../rewardsView';
import { bottomSheet, confirm, contentBottom, CONTENT_TOP, cta, refreshScreen, screen } from '../screen';
import { commit, now, session, today } from '../session';
import { shopBanner, shopCtx } from '../shopEntry';
import { skinIcon } from '../skin';
import { C, COLOR, E, FAMILY, M, R, RARITY, S, T } from '../theme';
import { button, chip, clampLines, mixHex, plate, pressable, ScrollArea, shieldTaps, SURFACE, tag, text, toast, type Tone } from '../ui';
import { lockedScreen } from '../unlockBanner';

import { sameShopOffer, utilityShopLayout } from '../utilityScreenLayout';
import { onViewChange, view } from '../viewport';

/**
 * Раскладка (поле 1080): шапка-витрина с Кафрой, под ней сетка товаров 4 × 2. Плитка — иконка в рамке редкости,
 * короткое название и цена-чип; нажатие — лист снизу с подробностями и одной главной «Купить» (§3 п. 1).
 */
export const SHOP_L = {
  bannerW: GAME_W - 2 * S.l,
  bannerH: 440,
  bannerTop: CONTENT_TOP + S.xs,
  cols: 4,
  tileH: 400,
  icon: 168,
  gap: S.s,
} as const;
const TILE_W = (SHOP_L.bannerW - (SHOP_L.cols - 1) * SHOP_L.gap) / SHOP_L.cols;
const GRID_TOP = SHOP_L.bannerTop + SHOP_L.bannerH + S.m;

/** Центр плитки товара i. */
export function tilePos(i: number): { x: number; y: number } {
  const col = i % SHOP_L.cols;
  const row = Math.floor(i / SHOP_L.cols);
  return { x: S.l + TILE_W / 2 + col * (TILE_W + SHOP_L.gap), y: GRID_TOP + SHOP_L.tileH / 2 + row * (SHOP_L.tileH + SHOP_L.gap) };
}

/** Мс до следующей местной полуночи (новый ассортимент). */
function msToMidnight(): number {
  const d = new Date(now());
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime();
}

/** «21 ч 05 мин» / «7 мин» — до нового ассортимента. */
export function timerText(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} ч ${String(m % 60).padStart(2, '0')} мин` : `${m} мин`;
}

/** Название товара слота для игрока. */
export function slotTitle(s: ShopSlotView): string {
  switch (s.kind) {
    case 'item':
      return GAME.equipment.items[s.itemId ?? '']?.name ?? 'Предмет';
    case 'heroCard':
      return `Карта: ${GAME.content.heroes[s.hero ?? '']?.name.split(' ')[0] ?? 'герой'}`;
    case 'heroExp':
      return 'Опыт героев';
    case 'scrolls':
      return 'Свиток призыва';
    case 'gold':
      return 'Мешок золота';
  }
}

/** Что даёт покупка — одна строка для листа подробностей. */
export function slotDetail(s: ShopSlotView): string {
  switch (s.kind) {
    case 'item': {
      const def = GAME.equipment.items[s.itemId ?? ''];
      return def ? itemStatsText(def.stats) : '';
    }
    case 'heroCard':
      return 'Копия героя для вознесения';
    case 'heroExp':
      return `+${formatNumber(s.count)} в запас опыта героев`;
    case 'scrolls':
      return `${s.count} — призыв в Таверне`;
    case 'gold':
      return `+${formatNumber(s.count)} золота`;
  }
}

/** Количество на иконке плитки («×2», «+18K»); у предметов и карт — нет. */
export function slotAmount(s: Pick<ShopSlotView, 'kind' | 'count'>): string {
  if (s.kind === 'item' || s.kind === 'heroCard') return '';
  if (s.kind === 'scrolls') return `×${s.count}`;
  return `+${compactNumber(s.count)}`;
}

/** Цена на плитке: длинные — коротко (900K), чтобы чип влез в плитку; в листе — полностью. */
export function priceLabel(price: number, short: boolean): string {
  return short && price >= 100_000 ? compactNumber(price) : formatNumber(price);
}

/** Цвет рамки товара: редкость предмета или карты; прочее — бронза. */
function frameColor(s: ShopSlotView): string {
  if (s.kind === 'item') {
    const def = GAME.equipment.items[s.itemId ?? ''];
    return def ? RARITY_COLORS[def.rarity] : COLOR.border;
  }
  if (s.kind === 'heroCard') return RARITY[s.rarity ?? 'blue'];
  return COLOR.border;
}

const priceTone = (s: ShopSlotView): Tone => (!s.affordable ? 'negative' : s.currency === 'gold' ? 'gold' : 'gem');

export interface ShopData {
  /** Только что куплен товар этого слота — плитка отзывается «покупкой». */
  bought?: number;
  scroll?: number;
}

/**
 * Лавка (как рынок AFK Arena): витрина с Кафрой, таймер нового товара и «Обновить» (первое за день бесплатно);
 * 8 товаров дня плитками без кнопок — касание открывает лист с подробностями и одной «Купить».
 * Правила — src/core/shop, числа — data/shop.json.
 */
export class ShopScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Container;
  private timerLabel = '';
  private area!: ScrollArea;
  private stock!: ShopStatus;
  private grid = utilityShopLayout(false);

  constructor() {
    super('Shop');
  }

  create(data: ShopData = {}): void {
    this.timer = undefined;
    screen(this, 'Лавка', 'Home', { to: 'Home' });
    const st = shopStatus(session.save, today(), shopCtx());
    if (!st.unlocked) {
      lockedScreen(this, 'shop');
      return;
    }
    this.area = new ScrollArea(this, SHOP_L.bannerTop, contentBottom());
    this.area.content.setName('shopScroll');
    this.drawStock(data.scroll ?? 0, data.bought);
    onViewChange(this, () => this.area.setBounds(SHOP_L.bannerTop, contentBottom()));
    let day = today();
    this.time.addEvent({ delay: 1000, loop: true, callback: () => {
      if (today() !== day) {
        day = today();
        this.drawStock();
      } else this.drawTimer();
    } });
  }

  private drawStock(scroll = this.area.offset, bought?: number): void {
    refreshScreen(this);
    this.area.clear();
    this.timer = undefined;
    this.stock = shopStatus(session.save, today(), shopCtx());
    this.grid = utilityShopLayout(view().adaptive, this.stock.slots.length);
    collect(this.children, () => this.banner(this.stock)).forEach((part) => this.area.add(part));
    const tiles: Phaser.GameObjects.GameObject[][] = [];
    for (const slot of this.stock.slots) {
      const parts = collect(this.children, () => this.tile(slot));
      parts.forEach((part) => this.area.add(part));
      tiles.push(parts);
    }
    this.area.setContentHeight(this.grid.height);
    this.area.offset = scroll;
    staggerIn(this, 'Shop', tiles);
    if (bought !== undefined) this.boughtFx(bought);
  }

  private visibleTilePos(index: number): { x: number; y: number } {
    const p = this.grid.tilePos(index);
    return { x: p.x, y: this.area.content.y + p.y };
  }

  /** Витрина: Кафра справа, слева — «Товары дня», таймер и «Обновить». */
  private banner(st: ShopStatus): void {
    const L = SHOP_L;
    const bannerH = this.grid.bannerH;
    const cy = bannerH / 2;
    shopBanner(this, GAME_W / 2, cy, L.bannerW, bannerH);
    const left = S.l + S.m;
    const title = text(this, left, S.m + T.title / 2, 'Товары дня', T.title, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    title.setShadow(0, 3, 'rgba(0,0,0,0.85)', 6, false, true);
    this.drawTimer();

    // «Обновить» — вторичная (главная на экране — «Купить» в листе товара); цена — рядом: бесплатно — золотой тег.
    const cost = st.nextRefreshCost;
    const by = bannerH - S.m - 48;
    const bw = 300;
    const b = button(this, left + bw / 2, by, bw, 96, '', 'Обновить', this.area.tap(() => this.refresh(st)), T.heading, { variant: 'secondary' });
    b.container.setName('shopRefresh');
    if (cost === null) b.setEnabled(false);
    const tx = left + bw + S.xs;
    if (cost === 0) tag(this, tx, by, 'Бесплатно', 'accent', { solid: true, align: 'left' }).setName('shopRefreshFree');
    else if (cost !== null) chip(this, tx, by, 'gems', cost, session.save.currency.gems >= cost ? 'gem' : 'negative', { size: 's', align: 'left' }).setName('shopRefreshCost');
  }

  /** Таймер нового ассортимента — чип с песочными часами; перерисовывается, только когда сменилась минута. */
  private drawTimer(): void {
    const label = timerText(msToMidnight());
    if (this.timer?.scene && label === this.timerLabel) return;
    this.timerLabel = label;
    this.timer?.destroy();
    const y = S.m + T.title + S.s + 28;
    this.timer = chip(this, S.l + S.m, y, 'hourglass', label, 'neutral', { size: 's', align: 'left' }).setName('shopTimer');
    this.area.add(this.timer);
  }

  private refresh(st: ShopStatus): void {
    const cost = st.nextRefreshCost;
    if (cost === null) {
      toast(this, `Новый товар в полночь — обновлений сегодня больше нет`);
      return;
    }
    const run = () => {
      try {
        const current = shopStatus(session.save, today(), shopCtx());
        if (current.day !== st.day || current.refreshes !== st.refreshes) return this.drawStock();
        commit(refreshShop(session.save, today(), shopCtx()));
        shieldTaps(this.sys?.game);
        this.drawStock();
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), C.error);
      }
    };
    if (cost === 0) run();
    else confirm(this, `Обновить весь товар за ${formatNumber(cost)} гемов?`, 'Обновить', run);
  }

  /** Иконка товара (центр x, y; size): предмет — ячейка в рамке редкости, карта — мини-карта, прочее — иконка RO. */
  private goodIcon(s: ShopSlotView, x: number, y: number, size: number): void {
    if (s.kind === 'item') {
      const def = GAME.equipment.items[s.itemId ?? ''];
      itemCell(this, x, y, size, def?.slot ?? null, Phaser.Display.Color.HexStringToColor(frameColor(s)).color, s.itemId);
      return;
    }
    plate(this, x, y, size, size, { ...SURFACE.sunken, border: mixHex(COLOR.surfaceSunken, frameColor(s), 0.8), borderW: 4, r: R.s });
    if (s.kind === 'heroCard') heroCardIcon(this, x, y, size - 16, s.rarity ?? 'blue', s.hero && GAME.content.heroes[s.hero] ? s.hero : undefined);
    else rewardIcon(this, x, y, s.kind === 'heroExp' ? 'exp' : s.kind, size * 0.62);
  }

  /** Плитка товара: иконка в рамке редкости, количество на ней, название в 2 строки, цена-чип. Продано — тускло с галкой. */
  private tile(s: ShopSlotView): void {
    const { x, y } = this.grid.tilePos(s.index);
    const w = this.grid.tileW;
    const h = this.grid.tileH;
    const off = s.soldOut || s.dayLimited;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const bg = plate(this, x, y, w, h, { ...SURFACE.raised, r: R.l }).setName(`shopSlot${s.index}`);
    const iy = y - h / 2 + S.s + SHOP_L.icon / 2;
    parts.push(...collect(this.children, () => this.goodIcon(s, x, iy, SHOP_L.icon)));
    const amount = slotAmount(s);
    if (amount) {
      const a = text(this, x + SHOP_L.icon / 2 - S.xxs, iy + SHOP_L.icon / 2 - S.xxs, amount, T.caption, COLOR.textPrimary, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setOrigin(1, 1);
      parts.push(a);
    }
    const name = text(this, x, iy + SHOP_L.icon / 2 + S.xs, slotTitle(s), T.caption, off ? COLOR.textTertiary : COLOR.textPrimary, {
      align: 'center',
      wordWrap: { width: w - 2 * S.xs },
    }).setOrigin(0.5, 0);
    clampLines(name, 2);
    parts.push(name);
    const py = y + h / 2 - S.s - 28;
    if (off) {
      parts.push(tag(this, x, py, s.soldOut ? 'Продано' : 'Завтра', 'neutral'));
      // Продано: плитка тускнеет, поверх иконки — крупная галка.
      for (const p of parts) (p as unknown as Phaser.GameObjects.Components.Alpha).setAlpha?.(0.45);
      bg.setAlpha(0.6);
      if (s.soldOut) this.add.image(x, iy, skinIcon('check')).setDisplaySize(96, 96).setTint(0x9fe0a6).setName(`shopSold${s.index}`);
    } else {
      chip(this, x, py, s.currency === 'gold' ? 'gold' : 'gems', priceLabel(s.price, true), priceTone(s), { size: 's' }).setName(`shopPrice${s.index}`);
    }
    pressable(this, bg, w, h, this.area.tap(() => this.open(s)));
  }

  /** Касание плитки: лист с подробностями и «Купить»; продано — короткий тост. */
  private open(s: ShopSlotView): void {
    if (s.soldOut) return toast(this, `Продано — новый товар через ${timerText(msToMidnight())}`);
    if (s.dayLimited) return toast(this, 'Этот товар можно купить снова завтра');
    const color = frameColor(s);
    const { day, refreshes } = this.stock;
    bottomSheet(this, slotTitle(s), (content, width, close) => {
      const icon = 200;
      const add = <O extends Phaser.GameObjects.GameObject>(o: O): O => (content.add(o), o);
      collect(this.children, () => this.goodIcon(s, icon / 2, icon / 2, icon)).forEach((o) => add(o));
      const amount = slotAmount(s);
      if (amount) add(text(this, icon - S.xxs, icon - S.xxs, amount, T.body, COLOR.textPrimary, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setOrigin(1, 1));
      const tx = icon + S.l;
      let ty = S.s;
      const def = s.kind === 'item' ? GAME.equipment.items[s.itemId ?? ''] : undefined;
      const rarity = def ? RARITY_NAMES[def.rarity] : s.kind === 'heroCard' ? `${rarityName(s.rarity ?? 'blue')} карта` : '';
      if (rarity) {
        const tg = add(tag(this, tx, ty + 26, rarity, 'neutral', { align: 'left' }));
        (tg.list[1] as Phaser.GameObjects.Text).setColor(color === COLOR.border ? COLOR.textSecondary : color);
        ty += 52 + S.xs;
      }
      const detail = add(text(this, tx, ty, slotDetail(s), T.body, COLOR.textPrimary, { wordWrap: { width: width - tx } }).setOrigin(0, 0));
      ty += detail.height + S.xs;
      if (s.stock > 1) add(text(this, tx, ty, `Осталось ${s.left} из ${s.stock}`, T.caption, COLOR.textSecondary).setOrigin(0, 0));
      // Цена и главная кнопка.
      const py = icon + S.l + 36;
      const price = add(chip(this, width / 2, py, s.currency === 'gold' ? 'gold' : 'gems', priceLabel(s.price, false), priceTone(s)));
      price.setName('shopSheetPrice');
      let by = py + 36 + S.m + 70;
      if (!s.affordable) {
        const have = s.currency === 'gold' ? session.save.resources.gold : session.save.currency.gems;
        add(text(this, width / 2, py + 36 + S.s + T.caption / 2, `Не хватает ${formatNumber(s.price - have)} ${s.currency === 'gold' ? 'золота' : 'гемов'}`, T.caption, COLOR.negative));
        by += T.caption + S.s;
      }
      const b = cta(this, width / 2, by, 'Купить', () => {
        if (!s.affordable) return toast(this, `Не хватает ${s.currency === 'gold' ? 'золота' : 'гемов'}`, C.error);
        close();
        this.buy(s, day, refreshes);
      }, { w: 560, h: 128, enabled: s.affordable });
      b.container.setName('shopBuy');
      add(b.container);
      return by + 64;
    });
  }

  private buy(s: ShopSlotView, day: string, refreshes: number): void {
    try {
      const current = shopStatus(session.save, today(), shopCtx());
      if (!sameShopOffer(s, current.slots[s.index], day, current.day, refreshes, current.refreshes)) return this.drawStock();
      const before = { gold: session.save.resources.gold, gems: session.save.currency.gems };
      const r = buyShopSlot(session.save, today(), s.index, shopCtx());
      commit(r.save);
      // Монеты летят в «таблетку», только если валюта прибавилась (мешок золота); трата — отсчёт числа в шапке.
      if (s.kind === 'gold') queueRewardFly('Shop', this.visibleTilePos(s.index), before);
      shieldTaps(this.sys?.game);
      this.drawStock(this.area.offset, s.index);
      // Куда делась покупка (сумка, запас опыта, Таверна) — не видно на экране: короткий тост.
      if (s.kind !== 'gold') toast(this, `Куплено: ${slotTitle(s)}`, C.success);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** Покупка: вспышка над плиткой и подскок её иконки (рутина — тихо, §3 п. 10). */
  private boughtFx(index: number): void {
    if (!juiceOn()) return;
    const { x, y } = this.visibleTilePos(index);
    const iy = y - SHOP_L.tileH / 2 + S.s + SHOP_L.icon / 2;
    burst(this, { x, y: iy });
    const mark = this.area.content.getByName(`shopSold${index}`) as Phaser.GameObjects.Image | null;
    if (mark) {
      const sx = mark.scaleX;
      mark.setScale(sx * 1.6).setAlpha(0);
      this.tweens.add({ targets: mark, scale: sx, alpha: 1, duration: M.base, ease: E.pop });
    } else {
      const price = this.area.content.getByName(`shopPrice${index}`) as Phaser.GameObjects.Container | null;
      if (price) bump(this, price);
    }
  }
}
