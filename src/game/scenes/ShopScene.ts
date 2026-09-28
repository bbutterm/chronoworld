import Phaser from 'phaser';
import { buyShopSlot, heroGender, refreshShop, shopStatus, storyHero, type ShopSlotView, type ShopStatus } from '../../core';
import { GAME } from '../content';
import { glow, medallion } from '../decor';
import { formatNumber, heroSprite, itemStatsText, RARITY_COLORS, RARITY_NAMES } from '../flow';
import { itemCell } from '../itemIcons';
import { collect, staggerIn } from '../juice';
import { GAME_W } from '../layout';
import { framedPortrait } from '../portraitFrame';
import { rewardIcon } from '../rewardsView';
import { card, confirm, CONTENT_TOP, gemIcon, screen } from '../screen';
import { commit, restartOnNewDay, session, today } from '../session';
import { shopCtx } from '../shopEntry';
import { C, FS, OUTLINE, TITLE_STYLE } from '../theme';
import { button, ellipsize, text, toast } from '../ui';
import { lockedScreen } from '../unlockBanner';

/** Карточки товаров: 2 столбца × 4 ряда. */
const CARD_W = 510;
const CARD_H = 310;
const COL_X = [GAME_W / 2 - 260, GAME_W / 2 + 260];
const GRID_TOP = CONTENT_TOP + 175 + CARD_H / 2;
const ROW_STEP = CARD_H + 15;

/** Мс до следующей местной полуночи (новый ассортимент). */
function msToMidnight(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - d.getTime();
}

function timerText(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

/** Название товара слота для игрока. */
export function slotTitle(s: ShopSlotView): string {
  switch (s.kind) {
    case 'item':
      return GAME.equipment.items[s.itemId ?? '']?.name ?? 'Предмет';
    case 'shards':
      return `Осколки: ${GAME.content.heroes[s.hero ?? '']?.name.split(' ')[0] ?? 'герой'}`;
    case 'heroExp':
      return 'Опыт героев';
    case 'scrolls':
      return 'Свиток призыва';
    case 'gold':
      return 'Мешок золота';
  }
}

/** Что именно даёт покупка: «×5», «+3 000 в запас», статы предмета. */
function slotDetail(s: ShopSlotView): string {
  switch (s.kind) {
    case 'item': {
      const def = GAME.equipment.items[s.itemId ?? ''];
      return def ? `${RARITY_NAMES[def.rarity]}\n${itemStatsText(def.stats)}` : '';
    }
    case 'shards':
      return `×${s.count}\nдля вознесения`;
    case 'heroExp':
      return `+${formatNumber(s.count)}\nв запас опыта`;
    case 'scrolls':
      return `×${s.count}\nдля Таверны`;
    case 'gold':
      return `+${formatNumber(s.count)}`;
  }
}

function priceText(s: Pick<ShopSlotView, 'currency' | 'price'>): string {
  return `${formatNumber(s.price)} ${s.currency === 'gold' ? 'золота' : 'гемов'}`;
}

/**
 * Лавка (как магазин AFK Arena): 8 товаров дня, «Купить» за золото или гемы, запас в слоте, обновление за гемы
 * (первое за день бесплатно) и таймер до нового ассортимента. Правила — src/core/shop, числа — data/shop.json.
 */
export class ShopScene extends Phaser.Scene {
  private timer?: Phaser.GameObjects.Text;

  constructor() {
    super('Shop');
  }

  create(): void {
    screen(this, 'Лавка', 'Home', { to: 'Home' });
    restartOnNewDay(this);
    const ctx = shopCtx();
    const st = shopStatus(session.save, today(), ctx);
    if (!st.unlocked) {
      lockedScreen(this, 'shop');
      return;
    }
    this.header(st);
    const cards: Phaser.GameObjects.GameObject[][] = [];
    st.slots.forEach((s) => cards.push(collect(this.children, () => this.slotCard(s))));
    staggerIn(this, 'Shop', cards);
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.timer?.setText(`Новый товар через ${timerText(msToMidnight())}`) });
  }

  /** Шапка: медальон, таймер до нового ассортимента и «Обновить». */
  private header(st: ShopStatus): void {
    const y = CONTENT_TOP + 80;
    card(this, GAME_W / 2, y, 1040, 150);
    glow(this, 110, y, 200, 0xffc860, 0.3, true);
    medallion(this, 110, y, 116, 'bag');
    text(this, 190, y - 28, 'Товары дня', FS.h2, C.title, TITLE_STYLE).setOrigin(0, 0.5);
    this.timer = text(this, 190, y + 26, `Новый товар через ${timerText(msToMidnight())}`, FS.small, C.muted, OUTLINE).setOrigin(0, 0.5);
    this.timer.setName('shopTimer');

    const cost = st.nextRefreshCost;
    const bx = GAME_W - 220;
    const label = cost === null ? 'На сегодня всё' : 'Обновить';
    const b = button(this, bx, y - 8, 330, 100, cost === null ? 'ui_btn_secondary' : 'ui_btn_primary', label, () => this.refresh(st), FS.h3);
    b.container.setName('shopRefresh');
    if (cost === null) b.container.setAlpha(0.6);
    const sub = cost === null ? '' : cost === 0 ? 'бесплатно' : `${formatNumber(cost)}`;
    if (sub) {
      const t = text(this, bx + (cost ? -14 : 0), y + 58, sub, FS.caption, cost === 0 ? C.success : C.text, OUTLINE);
      if (cost) gemIcon(this, t.x + t.width / 2 + 22, y + 58, 26);
    }
  }

  private refresh(st: ShopStatus): void {
    const cost = st.nextRefreshCost;
    if (cost === null) {
      toast(this, `Обновлять лавку можно ${shopCtx().shop.refresh.maxPerDay} раз в день — новый товар в полночь`);
      return;
    }
    const run = () => {
      try {
        commit(refreshShop(session.save, today(), shopCtx()));
        this.restartWith('Ассортимент обновлён', C.success);
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), C.error);
      }
    };
    if (cost === 0) run();
    else confirm(this, `Обновить весь товар за ${formatNumber(cost)} гемов?\nУ вас ${formatNumber(session.save.currency.gems)}.`, 'Обновить', run);
  }

  /** Карточка товара: иконка в рамке редкости, название, что даёт, цена и «Купить» (распродано — «Продано»). */
  private slotCard(s: ShopSlotView): void {
    const x = COL_X[s.index % 2];
    const y = GRID_TOP + Math.floor(s.index / 2) * ROW_STEP;
    const off = s.soldOut || s.dayLimited;
    const bg = card(this, x, y, CARD_W, CARD_H);
    bg.setName(`shopSlot${s.index}`);
    const def = s.kind === 'item' ? GAME.equipment.items[s.itemId ?? ''] : undefined;
    const color = def ? RARITY_COLORS[def.rarity] : s.kind === 'shards' ? '#d890ff' : s.kind === 'scrolls' ? '#f0d9a0' : C.title;
    ellipsize(text(this, x, y - CARD_H / 2 + 40, slotTitle(s), FS.body, color, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 5 }), CARD_W - 40);

    const ix = x - CARD_W / 2 + 100;
    const iy = y - 22;
    const size = 140;
    const ic = Phaser.Display.Color.HexStringToColor(color).color;
    if (s.kind === 'item') itemCell(this, ix, iy, size, def?.slot ?? null, ic, s.itemId);
    else {
      this.add.rectangle(ix, iy, size, size, 0x1a120a, 0.95).setStrokeStyle(4, ic, 1);
      if (s.kind === 'shards') {
        const hero = storyHero(session.save, s.hero ?? '');
        if (hero) framedPortrait(this, ix, iy, heroSprite(hero, GAME), size - 16, heroGender(hero, GAME));
        else rewardIcon(this, ix, iy, 'hero', size * 0.6);
      } else rewardIcon(this, ix, iy, s.kind === 'heroExp' ? 'exp' : s.kind, size * 0.62);
    }
    if (s.stock > 1 || !off) {
      text(this, ix + size / 2 - 6, iy + size / 2 - 18, `${s.left}/${s.stock}`, FS.caption, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(1, 0.5);
    }
    text(this, x - CARD_W / 2 + 190, iy - 10, slotDetail(s), FS.small, C.text, { ...OUTLINE, wordWrap: { width: CARD_W - 210 }, align: 'left' }).setOrigin(0, 0.5);

    // Цена и кнопка.
    const by = y + CARD_H / 2 - 60;
    if (off) {
      text(this, x, by, s.soldOut ? 'Продано' : 'Завтра снова', FS.h3, C.dim, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
      bg.setAlpha(0.7);
      return;
    }
    // Цена (иконка валюты и число) слева, «Купить» справа.
    const px = x - CARD_W / 2 + 40;
    s.currency === 'gold' ? rewardIcon(this, px + 20, by, 'gold', 44) : gemIcon(this, px + 20, by, 36);
    text(this, px + 52, by, formatNumber(s.price), FS.h3, s.affordable ? C.gold : C.danger, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5);
    const b = button(this, x + CARD_W / 2 - 130, by, 220, 84, s.affordable ? 'ui_btn_primary' : 'ui_btn_secondary', 'Купить', () => this.buy(s), FS.h3);
    b.container.setName(`shopBuy${s.index}`);
  }

  private buy(s: ShopSlotView): void {
    const run = () => {
      try {
        const r = buyShopSlot(session.save, today(), s.index, shopCtx());
        commit(r.save);
        this.restartWith(`Куплено: ${slotTitle(s)}${s.kind === 'item' ? '' : ` ${slotDetail(s).split('\n')[0]}`}`, C.success);
      } catch (e) {
        toast(this, e instanceof Error ? e.message : String(e), C.error);
      }
    };
    if (!s.affordable) {
      toast(this, `Не хватает ${s.currency === 'gold' ? 'золота' : 'гемов'}: нужно ${formatNumber(s.price)}`, C.error);
      return;
    }
    // Гемы — редкая валюта: переспросить; золото — покупка сразу (как в AFK).
    if (s.currency === 'gems') confirm(this, `Купить «${slotTitle(s)}» за ${priceText(s)}?`, 'Купить', run);
    else run();
  }

  private restartWith(msg: string, color: string): void {
    this.scene.restart();
    this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, msg, color));
  }
}
