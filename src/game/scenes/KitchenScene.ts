import Phaser from 'phaser';
import { actBuyIngredient, actCookMeal, buffText, kitchenStatus, type KitchenStatus, type PantryRow, type RecipeView } from '../../core';
import { formatNumber } from '../flow';
import { compactNumber } from '../frame';
import { burst, bump, collect, juiceOn, staggerIn } from '../juice';
import { foodIcon, foodSpec, kitchenCtx } from '../kitchenEntry';
import { GAME_W } from '../layout';
import { confirm, contentBottom, CONTENT_TOP, refreshScreen, screen } from '../screen';
import { commit, session, today } from '../session';
import { COLOR, FAMILY, R, S, T } from '../theme';
import { BTN, button, chip, ellipsize, plate, pressable, ScrollArea, SURFACE, tag, text } from '../ui';
import { lockedScreen } from '../unlockBanner';
import { onViewChange } from '../viewport';

/** Раскладка (поле 1080): карточка блюда дня, кладовая 5 ячеек в ряд, карточки рецептов во всю ширину. */
export const KITCHEN_L = {
  w: GAME_W - 2 * S.l,
  mealH: 210,
  medal: 132,
  cellH: 236,
  cellIcon: 88,
  cardH: 236,
  cookW: 300,
} as const;

/**
 * Кухня в Таверне (docs/design/kitchen.md, ядро src/core/kitchen): сверху — блюдо дня (действует до полуночи), ниже —
 * кладовая (продукты и докупка за золото, лимит в день) и рецепты (что нужно, что даёт, «Приготовить»). Внизу —
 * откуда берутся продукты. Одно блюдо в день; главная кнопка — подтверждение готовки.
 */
export class KitchenScene extends Phaser.Scene {
  private area!: ScrollArea;
  private st!: KitchenStatus;

  constructor() {
    super('Kitchen');
  }

  create(): void {
    screen(this, 'Кухня', 'Home', { to: 'Home' });
    const ctx = kitchenCtx();
    if (!ctx.kitchen || !kitchenStatus(session.save, today(), ctx).unlocked) {
      lockedScreen(this, 'kitchen');
      return;
    }
    this.area = new ScrollArea(this, CONTENT_TOP, contentBottom());
    this.area.content.setName('kitchenScroll');
    this.draw(0, true);
    onViewChange(this, () => this.area.setBounds(CONTENT_TOP, contentBottom()));
    // Новый день (полночь) — блюдо закончилось, лимит покупок снова полный.
    let day = today();
    this.time.addEvent({ delay: 1000, loop: true, callback: () => {
      if (today() === day) return;
      day = today();
      this.draw();
    } });
  }

  private draw(scroll = this.area.offset, animate = false, fx?: { cooked?: boolean; bought?: string }): void {
    refreshScreen(this);
    this.area.clear();
    this.st = kitchenStatus(session.save, today(), kitchenCtx());
    const groups: Phaser.GameObjects.GameObject[][] = [];
    const left = S.l;
    let y = S.xs as number;
    groups.push(collect(this.children, () => this.mealCard(y)));
    y += KITCHEN_L.mealH + S.l;

    groups.push(collect(this.children, () => this.heading(y, 'Кладовая', `Куплено сегодня ${this.st.bought} / ${this.st.buyLimit}`)));
    y += T.heading / 2 + S.s;
    const n = this.st.pantry.length;
    const cellW = (KITCHEN_L.w - (n - 1) * S.xs) / n;
    groups.push(collect(this.children, () => this.st.pantry.forEach((p, i) => this.cell(p, left + cellW / 2 + i * (cellW + S.xs), y + KITCHEN_L.cellH / 2, cellW))));
    y += KITCHEN_L.cellH + S.l;

    groups.push(collect(this.children, () => this.heading(y, 'Рецепты', this.st.canCook ? 'Одно блюдо в день' : 'Новое блюдо — завтра')));
    y += T.heading / 2 + S.s;
    for (const r of this.st.recipes) {
      const top = y;
      groups.push(collect(this.children, () => this.recipeCard(r, top)));
      y += KITCHEN_L.cardH + S.s;
    }
    y += S.s;
    groups.push(collect(this.children, () => {
      const hint = text(this, GAME_W / 2, y, 'Продукты приносят экспедиции, охота на MVP и сундук простоя. Недостающее — в кладовой за золото.', T.caption, COLOR.textSecondary, {
        align: 'center',
        wordWrap: { width: KITCHEN_L.w - 2 * S.s },
      }).setOrigin(0.5, 0).setName('kitchenHint');
      y += hint.height;
    }));
    y += S.l;
    for (const g of groups) for (const o of g) this.area.add(o);
    this.area.setContentHeight(y);
    this.area.offset = scroll;
    if (animate) staggerIn(this, 'Kitchen', groups);
    if (fx?.cooked && juiceOn()) {
      const meal = this.area.content.getByName('kitchenMealIcon') as Phaser.GameObjects.Image | null;
      if (meal) {
        burst(this, { x: meal.x, y: this.area.content.y + meal.y });
        bump(this, meal);
      }
    }
    if (fx?.bought) {
      const count = this.area.content.getByName(`kitchenCount_${fx.bought}`) as Phaser.GameObjects.Text | null;
      if (count) bump(this, count);
    }
  }

  /** Заголовок раздела слева и короткое состояние справа (центр строки — y). */
  private heading(y: number, title: string, side: string): void {
    text(this, S.l, y, title, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    text(this, GAME_W - S.l, y, side, T.caption, COLOR.textSecondary).setOrigin(1, 0.5).setName(`kitchenSide_${title}`);
  }

  /** Блюдо дня: медальон, название и прибавка; нет блюда — что сегодня можно. */
  private mealCard(top: number): void {
    const L = KITCHEN_L;
    const cy = top + L.mealH / 2;
    const meal = this.st.meal;
    plate(this, GAME_W / 2, cy, L.w, L.mealH, { ...SURFACE.raised, r: R.l, ...(meal ? { border: COLOR.positive } : {}) }).setName('kitchenMeal');
    const mx = S.l + S.m + L.medal / 2;
    plate(this, mx, cy, L.medal, L.medal, { ...SURFACE.sunken, r: R.m });
    const icon = meal?.icon ?? 'pot';
    const img = foodIcon(this, mx, cy, icon, L.medal * 0.62).setName('kitchenMealIcon');
    if (!meal) img.setAlpha(0.45);
    const tx = mx + L.medal / 2 + S.m;
    const maxW = GAME_W - S.l - S.m - tx;
    text(this, tx, cy - 58, 'Блюдо дня', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    const name = text(this, tx, cy, meal ? meal.name : 'Ещё не готовили', T.heading, meal ? COLOR.title : COLOR.textSecondary, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5).setName('kitchenMealName');
    ellipsize(name, maxW);
    const sub = meal ? `${buffText(meal.buff)} · до полуночи` : this.st.canCook ? (this.st.ready ? 'Продуктов хватает — выберите рецепт' : 'Не хватает продуктов ни на одно блюдо') : 'Новое блюдо — завтра';
    const line = text(this, tx, cy + 56, sub, T.caption, meal ? COLOR.positive : COLOR.textSecondary, { fontStyle: meal ? 'bold' : 'normal' }).setOrigin(0, 0.5).setName('kitchenMealBuff');
    ellipsize(line, maxW);
  }

  /** Ячейка кладовой: иконка, «×N», название, цена (или «Завтра» — лимит дня). Касание — купить одну штуку. */
  private cell(p: PantryRow, x: number, cy: number, w: number): void {
    const L = KITCHEN_L;
    const h = L.cellH;
    const limit = this.st.buyLeft <= 0;
    const afford = session.save.resources.gold >= p.priceNow;
    const bg = plate(this, x, cy, w, h, { ...SURFACE.raised, r: R.m }).setName(`kitchenCell_${p.id}`);
    const iy = cy - h / 2 + S.m + L.cellIcon / 2;
    foodIcon(this, x, iy, p.icon, L.cellIcon);
    text(this, x + w / 2 - S.xs, cy - h / 2 + S.xxs, `×${p.count}`, T.caption, p.count ? COLOR.textPrimary : COLOR.textTertiary, { fontStyle: 'bold', stroke: COLOR.bg, strokeThickness: 6 })
      .setOrigin(1, 0)
      .setName(`kitchenCount_${p.id}`);
    const name = text(this, x, iy + L.cellIcon / 2 + S.xs, p.name, T.caption, COLOR.textPrimary).setOrigin(0.5, 0);
    ellipsize(name, w - S.xs);
    const py = cy + h / 2 - S.s - 24;
    if (limit) tag(this, x, py, 'Завтра', 'neutral');
    else chip(this, x, py, 'gold', p.priceNow >= 10_000 ? compactNumber(p.priceNow) : formatNumber(p.priceNow), afford ? 'gold' : 'negative', { size: 's', bg: false }).setName(`kitchenPrice_${p.id}`);
    if (limit || !afford) bg.setAlpha(0.7);
    pressable(this, bg, w, h, this.area.tap(() => this.buy(p)));
  }

  /** Рецепт: медальон, название, прибавка; ниже — продукты «есть / нужно» и «Приготовить» (или «Блюдо дня»). */
  private recipeCard(r: RecipeView, top: number): void {
    const L = KITCHEN_L;
    const cy = top + L.cardH / 2;
    plate(this, GAME_W / 2, cy, L.w, L.cardH, { ...SURFACE.raised, r: R.l, ...(r.active ? { border: COLOR.positive } : {}) }).setName(`kitchenRecipe_${r.id}`);
    const left = S.l + S.s;
    const medal = 104;
    const my = top + S.s + medal / 2;
    plate(this, left + medal / 2, my, medal, medal, { ...SURFACE.sunken, r: R.m });
    foodIcon(this, left + medal / 2, my, r.icon, medal * 0.62);
    const tx = left + medal + S.s;
    const maxW = GAME_W - S.l - S.s - tx;
    const name = text(this, tx, my - 24, r.name, T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5);
    ellipsize(name, maxW);
    const buff = text(this, tx, my + 30, buffText(r.buff), T.caption, COLOR.positive, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName(`kitchenBuff_${r.id}`);
    ellipsize(buff, maxW);
    // Нижний ряд: продукты рецепта чипами «есть/нужно» (не хватает — красным) и кнопка справа.
    const ry = top + L.cardH - S.s - BTN.m / 2;
    let x = left;
    for (const [id, need] of Object.entries(r.cost)) {
      const p = this.st.pantry.find((g) => g.id === id);
      if (!p) continue;
      const c = chip(this, x, ry, foodSpec(p.icon), `${Math.min(p.count, need)}/${need}`, r.missing[id] ? 'negative' : 'neutral', { size: 's', align: 'left' });
      x += c.width + S.xs;
    }
    const bx = GAME_W - S.l - S.s - L.cookW / 2;
    if (r.active) {
      tag(this, bx, ry, 'Блюдо дня', 'positive', { solid: true }).setName(`kitchenActive_${r.id}`);
      return;
    }
    const ok = this.st.canCook && r.affordable;
    const b = button(this, bx, ry, L.cookW, BTN.m, '', 'Приготовить', this.area.tap(() => this.cook(r)), T.body, { variant: 'secondary' });
    b.container.setName(`kitchenCook_${r.id}`);
    b.setEnabled(ok);
  }

  private cook(r: RecipeView): void {
    if (!this.st.canCook || !r.affordable) return;
    confirm(this, `Приготовить «${r.name}»?\n${buffText(r.buff)} до полуночи.`, 'Приготовить', () => {
      try {
        commit(actCookMeal(session.save, today(), r.id, kitchenCtx()));
        this.draw(0, false, { cooked: true });
      } catch (e) {
        console.warn(e);
        this.draw();
      }
    });
  }

  private buy(p: PantryRow): void {
    if (this.st.buyLeft <= 0 || session.save.resources.gold < p.priceNow) return;
    confirm(this, `Купить «${p.name}» за ${formatNumber(p.priceNow)} золота?\nСегодня можно ещё ${this.st.buyLeft}.`, 'Купить', () => {
      try {
        commit(actBuyIngredient(session.save, today(), p.id, kitchenCtx()));
        this.draw(this.area.offset, false, { bought: p.id });
      } catch (e) {
        console.warn(e);
        this.draw();
      }
    });
  }
}
