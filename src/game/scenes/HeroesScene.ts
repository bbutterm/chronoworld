import Phaser from 'phaser';
import { ascendAll, ascendAllSummary, chooseBranch, heroCard, jobTitle, heroesWithGearUpgrades, heroPower, levelUpInfo, needsBranch, pendingPicks, squadPower, withGear, type CardRarity, type HeroState } from '../../core';
import { GAME } from '../content';
import { ascendReady, formatNumber, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { bottomSheet, confirm, CONTENT_BOTTOM, CONTENT_TOP, contentBottom, screen } from '../screen';
import { countUp, pulse, staggerIn } from '../juice';
import { commit, session } from '../session';
import { sfx } from '../audio';
import { haptic } from '../haptics';
import { RARITY_CARD } from '../tavern';
import { button, ellipsize, iconOf, plate, pressable, ScrollArea, SURFACE, tag, text, toast, tutorialHint } from '../ui';
import { hintDone } from '../hints';
import { C, COLOR, hexNum, M, R, S, T, TOUCH, TOUCH_COMFORT, Z } from '../theme';
import { cardIcon, drawHeroCard, heroCardIcon, heroCardSize, LINES, rarityColor, rarityName, ROLES } from '../heroCard';
import { collectionCount, collectionHeroes, groupCopies, heroesUi, inventoryUi, missingTemplates, RARITY_ORDER, SORT_LABELS, SORT_ORDER } from '../heroesView';
import { heroStoryNew, toastOpenedStories } from '../heroStoryView';
import { lockLabel } from '../unlockBanner';
import { openBranchPicker } from '../branchPicker';

const COLS = 3;
/** Сетка на всю ширину контента (1080 − 2·S.l = 984): 3 × 304 + 2 × 36. */
const TILE_W = 304;
const GAP_X = 36;
const GAP_Y = S.m;
/** Поле экрана (§4.2). */
const L = S.l;
/** Высота строки управления (класс, фильтр, сортировка). */
const CTRL_H = TOUCH_COMFORT;

/** Последняя показанная мощь отряда — отсчёт до нового значения при возвращении с карточки. */
let lastSquadPower: number | null = null;

/** Данные create: keep — перерисовка того же визита (фильтр, сортировка, «Коллекция»): подсказки обучения не повторять. */
export interface HeroesData {
  keep?: boolean;
}

/**
 * H4 «Герои» — коллекция карточек как в AFK Arena: сетка 3 в ряд крупных карточек (рамка редкости, лицо, класс, имя,
 * уровень, ромбы редкостей), не больше одного значка-повода на карточке (вознести > ветка > улучшить > вещь > история >
 * новый), тихая галка «в отряде». Сверху — мощь отряда и запас опыта, «Коллекция» и инвентарь; строка фильтра класса
 * (подписанный выбор в листе), роль и редкость — в листе «Фильтр» (активные — чипы с «×»),
 * явный выбор сортировки. «Вознести всех» — плавающая главная кнопка, только когда есть кого. Нажатие — карточка героя
 * (HeroScene), листание — в порядке этого списка.
 */
export class HeroesScene extends Phaser.Scene {
  constructor() {
    super('Heroes');
  }

  private area!: ScrollArea;

  /** Перерисовать экран тем же визитом (фильтр, сортировка): без повторных подсказок обучения. */
  private redraw(): void {
    this.scene.restart({ keep: true } satisfies HeroesData);
  }

  create(data: HeroesData = {}): void {
    screen(this, 'Герои', 'Heroes');
    const save = session.save;
    const gctx = withGear(GAME, save);
    const f = heroesUi.filter;

    // Строка 1: мощь отряда (отсчёт от прошлого показа) и запас опыта слева; «Коллекция» и инвентарь справа.
    const aY = CONTENT_TOP + 62;
    const sp = squadPower(save, GAME);
    const spText = text(this, L, aY - 14, formatNumber(sp), T.title, COLOR.title, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName('squadPower');
    text(this, L, aY + 36, 'Мощь отряда', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    countUp(this, spText, lastSquadPower ?? sp, sp, formatNumber, { duration: M.count });
    if (lastSquadPower !== null && sp > lastSquadPower) {
      const plus = text(this, L + spText.width + S.xs, aY - 14, `+${formatNumber(sp - lastSquadPower)}`, T.body, COLOR.positive, { fontStyle: 'bold' }).setOrigin(0, 0.5);
      this.tweens.add({ targets: plus, y: aY - 50, alpha: 0, delay: M.count, duration: M.count, onComplete: () => plus.destroy() });
    }
    lastSquadPower = sp;
    const ex = L + Math.max(spText.width, 210) + S.l;
    const expIco = iconOf(this, ex + 20, aY - 12, 'hero_exp', 40);
    const expVal = text(this, ex + (expIco ? 48 : 0), aY - 12, formatNumber(save.resources.heroExp), T.heading, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5).setName('heroExpPool');
    text(this, ex, aY + 36, 'Опыт в запасе', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);

    const invX = GAME_W - L - TOUCH / 2;
    const inv = button(this, invX, aY, TOUCH, TOUCH, '', '', () => {
      inventoryUi.template = null;
      this.scene.start('Inventory', {});
    }, T.caption, { variant: 'icon' });
    inv.container.setName('inventoryBtn');
    const bag = iconOf(this, 0, 0, 'bag', 56, COLOR.textPrimary);
    if (bag) inv.container.add(bag);
    const cc = collectionCount(save, GAME);
    // Две строки сохраняют полный счётчик (включая 12/12), не забирая ширину у опыта.
    const collW = 290;
    const collX = invX - TOUCH / 2 - S.xs - collW / 2;
    const coll = button(this, collX, aY, collW, TOUCH, heroesUi.showMissing ? 'skin_btn_active' : 'ui_btn_secondary', `Коллекция\n${cc.owned}/${cc.total}`, () => {
      heroesUi.showMissing = !heroesUi.showMissing;
      this.redraw();
    }, T.caption, { sound: 'ui_toggle' });
    coll.container.setName('collectionToggle');
    // Длинный запас опыта не наезжает на «Коллекцию».
    ellipsize(expVal, Math.max(120, collX - collW / 2 - S.s - expVal.x));

    // Строка 2: подписанные цели вместо семи тесных значков класса.
    const bY = aY + TOUCH / 2 + S.s + CTRL_H / 2;
    const classW = 388;
    const filterW = 248;
    const sortW = GAME_W - 2 * L - classW - filterW - 2 * S.xs;
    const classBtn = button(this, L + classW / 2, bY, classW, CTRL_H, f.line ? 'skin_btn_active' : 'ui_btn_secondary',
      f.line ? GAME.content.jobs[f.line]?.name ?? f.line : 'Все классы', () => this.openClasses(), T.caption, { sound: null });
    classBtn.container.setName('classFilter');
    ellipsize(classBtn.label, classW - S.l);
    const extra = !!(f.role || f.rarity);
    const filtX = L + classW + S.xs + filterW / 2;
    const filt = button(this, filtX, bY, filterW, CTRL_H, extra ? 'skin_btn_active' : 'ui_btn_secondary',
      `Фильтр${extra ? ` · ${Number(!!f.role) + Number(!!f.rarity)}` : ''}`, () => this.openFilters(), T.caption, { sound: null });
    filt.container.setName('filterBtn');
    const sortX = GAME_W - L - sortW / 2;
    const sortBtn = button(this, sortX, bY, sortW, CTRL_H, 'ui_btn_secondary', SORT_LABELS[heroesUi.sort],
      () => this.openSort(), T.caption, { sound: null });
    sortBtn.container.setName('sortBtn');
    const lw = sortBtn.label.width;
    const sx = -(lw + 34) / 2;
    sortBtn.label.setX(sx + 34 + lw / 2);
    sortBtn.container.add(this.sortGlyph(sx + 11, COLOR.textSecondary));

    // Строка 3 — только при фильтре роли/редкости: чипы «Танк ×», «Синий ×»; касание снимает.
    let rowBottom = bY + CTRL_H / 2;
    if (extra) {
      const cY = rowBottom + S.xs + TOUCH / 2;
      let cx = L;
      const chipOf = (label: string, name: string, clear: () => void) => {
        const t = tag(this, cx, cY, `${label}  ×`, 'accent', { align: 'left' }).setName(name);
        const hit = this.add.zone(t.x, cY, t.width, TOUCH);
        pressable(this, hit, t.width, 52, () => {
          clear();
          this.redraw();
        });
        cx += t.width + S.xs;
      };
      if (f.role) chipOf(ROLE_NAMES[f.role] ?? f.role, 'roleChip', () => (f.role = null));
      if (f.rarity) chipOf(rarityName(f.rarity), 'rarityChip', () => (f.rarity = null));
      rowBottom = cY + TOUCH / 2;
    }

    // Сетка карточек.
    const listTop = rowBottom + S.s;
    this.area = new ScrollArea(this, listTop, contentBottom() + 10);
    // Копии одного героя — одной плиткой (лучший экземпляр) с «+N»; все экземпляры — на карточке и в корме вознесения.
    const groups = groupCopies(collectionHeroes(save, f, heroesUi.sort, GAME, (h) => heroPower(h, gctx)));
    const heroes = groups.map((g) => g.hero);
    heroesUi.order = heroes.map((h) => h.id);
    const picks = pendingPicks(save);
    const missing = heroesUi.showMissing ? missingTemplates(save, f, GAME) : [];
    if (!save.heroes.length) {
      this.area.add(text(this, GAME_W / 2, 200, 'Героев пока нет', T.body, COLOR.textPrimary, { stroke: C.stroke, strokeThickness: 3 }));
      return;
    }
    if (!heroes.length && !missing.length && !picks.length) {
      this.area.add(text(this, GAME_W / 2, 140, 'Под фильтр никто не подходит', T.body, COLOR.textPrimary, { stroke: C.stroke, strokeThickness: 3 }).setName('emptyFilter'));
      const reset = button(this, GAME_W / 2, 260, 400, TOUCH, 'ui_btn_secondary', 'Сбросить фильтры', this.area.tap(() => this.resetFilters()), T.body);
      reset.container.setName('resetFilters');
      this.area.add(reset.container);
      return;
    }
    const { h: tileH } = heroCardSize(TILE_W);
    const x0 = GAME_W / 2 - ((COLS - 1) * (TILE_W + GAP_X)) / 2;
    const at = (i: number) => ({ x: x0 + (i % COLS) * (TILE_W + GAP_X), y: GAP_Y / 2 + tileH / 2 + Math.floor(i / COLS) * (tileH + GAP_Y) });
    const ready = new Set(ascendReady(save, GAME).map((h) => h.id));
    // «Вещь получше» — только у отряда: у запаса из 40 героев иначе горела бы каждая плитка (§2.4 п. 8).
    const gearUps = new Set(heroesWithGearUpgrades(save, GAME).filter((id) => save.squad.includes(id)));
    const tiles: Phaser.GameObjects.GameObject[][] = [];
    // «Контракт героя» — первой плиткой: герой на выбор (и ветка).
    const lead = picks.length ? 1 : 0;
    if (lead) {
      const p = at(0);
      tiles.push([this.contractTile(p.x, p.y, picks.length, picks[0].rarity)]);
    }
    groups.forEach((g, i) => {
      const p = at(lead + i);
      tiles.push([this.tile(g.hero, p.x, p.y, ready.has(g.hero.id), gearUps.has(g.hero.id), g.copies)]);
    });
    missing.forEach((tid, k) => {
      const p = at(lead + heroes.length + k);
      const t = GAME.content.heroes[tid];
      tiles.push([
        drawHeroCard(this, p.x, p.y, tid, {
          w: TILE_W,
          greyed: true,
          showRole: false,
          parent: this.area.content,
          onTap: this.area.tap(() => toast(this, `${t.name}: ${t.source === 'story' ? 'присоединится по сюжету (и приходит из Таверны)' : 'призыв в Таверне'}. ${t.bio}`, COLOR.title, 4000)),
        }),
      ]);
    });
    const n = lead + heroes.length + missing.length;
    let contentH = Math.ceil(n / COLS) * (tileH + GAP_Y) + GAP_Y;
    // Героев мало (начало игры) — под сеткой строка-вход в Таверну (или когда она откроется), а не пустой лес.
    if (n <= COLS * 2 && !f.line && !f.role && !f.rarity) contentH += this.tavernRow(contentH + S.xs + 68) + S.l;
    // «Вознести всех» — плавающая главная кнопка справа внизу, только когда есть кого (§3 п. 1 и 11).
    if (ascendAll(save, GAME).done.length) {
      const bw = 360;
      const bh = 112;
      const all = button(this, GAME_W - L - bw / 2, contentBottom() - bh / 2 - S.xs, bw, bh, 'ui_btn_primary', 'Вознести всех', () => this.ascendAllConfirm(), T.heading, { sound: 'ui_toggle' });
      all.container.setName('ascendAllBtn').setDepth(Z.sticky);
      pulse(this, all.container, 1.04);
      contentH += bh + S.s;
    }
    this.area.setContentHeight(contentH);
    staggerIn(this, 'Heroes', tiles);

    // Обучение — один раз за визит, не при каждой перерисовке фильтром: «наденьте трофеи», иначе «вознесите».
    if (data.keep) return;
    const gearHero = heroesWithGearUpgrades(save, GAME)[0];
    const gi = heroes.findIndex((x) => x.id === gearHero);
    if (gi >= 0 && !hintDone('equip_gear')) {
      const p = at(lead + gi);
      const cy = listTop + p.y;
      if (cy + tileH / 2 <= CONTENT_BOTTOM) tutorialHint(this, 'equip_gear', p.x, cy, 'auto', { w: TILE_W, h: tileH }, { text: 'Наденьте трофеи' });
      return;
    }
    const ai = heroes.findIndex((x) => ready.has(x.id));
    if (ai >= 0 && !hintDone('ascend')) {
      const p = at(lead + ai);
      const cy = listTop + p.y;
      if (cy + tileH / 2 <= CONTENT_BOTTOM) tutorialHint(this, 'ascend', p.x, cy, 'auto', { w: TILE_W, h: tileH }, { text: 'Копий хватает — вознесите' });
    }
  }

  private resetFilters(): void {
    heroesUi.filter.line = null;
    heroesUi.filter.role = null;
    heroesUi.filter.rarity = null;
    this.redraw();
  }

  /** Классы с полными подписями; открытие и отмена не меняют выбор. */
  private openClasses(): void {
    const sheet = bottomSheet(this, 'Класс героя', (box, width, close) => {
      const options = [null, ...LINES];
      const gap = S.xs;
      const w = (width - gap) / 2;
      options.forEach((line, i) => {
        const on = heroesUi.filter.line === line;
        const label = line ? GAME.content.jobs[line]?.name ?? line : 'Все классы';
        const b = button(this, (i % 2) * (w + gap) + w / 2, Math.floor(i / 2) * (CTRL_H + gap) + CTRL_H / 2,
          w, CTRL_H, on ? 'skin_btn_active' : 'ui_btn_secondary', `${on ? '✓ ' : ''}${label}`, () => {
            if (sheet.layer.name !== 'bottomSheet') return;
            heroesUi.filter.line = line;
            close();
            this.time.delayedCall(M.fast, () => this.redraw());
          }, T.body, { sound: 'ui_toggle' });
        b.container.setName(line ? `Линия: ${label}` : 'Линия: все');
        ellipsize(b.label, w - S.l);
        box.add(b.container);
      });
      return Math.ceil(options.length / 2) * (CTRL_H + gap);
    });
  }

  /** Сортировка выбирается явно, направление показано до выбора. */
  private openSort(): void {
    const sheet = bottomSheet(this, 'Сначала в списке', (box, width, close) => {
      const labels = { power: 'Самые сильные', level: 'Высокий уровень', rarity: 'Редкие герои' };
      SORT_ORDER.forEach((sort, i) => {
        const on = heroesUi.sort === sort;
        const b = button(this, width / 2, i * (CTRL_H + S.xs) + CTRL_H / 2, width, CTRL_H,
          on ? 'skin_btn_active' : 'ui_btn_secondary', `${on ? '✓ ' : ''}${labels[sort]}`, () => {
            if (sheet.layer.name !== 'bottomSheet') return;
            heroesUi.sort = sort;
            close();
            this.time.delayedCall(M.fast, () => this.redraw());
          }, T.body, { sound: 'ui_toggle' });
        b.container.setName(`sort_${sort}`);
        box.add(b.container);
      });
      return SORT_ORDER.length * (CTRL_H + S.xs);
    });
  }

  /** Значок сортировки «по убыванию»: три полосы от длинной к короткой (в шрифте нет ↕ — Graphics). */
  private sortGlyph(x: number, color: string): Phaser.GameObjects.Graphics {
    const g = this.add.graphics({ x, y: 0 });
    const n = hexNum(color);
    g.fillStyle(n, 1);
    g.fillRect(-11, -14, 22, 5).fillRect(-11, -3, 15, 5).fillRect(-11, 8, 8, 5);
    return g;
  }

  /** Лист «Фильтр»: роль (4 значка с подписью) и редкость (5 ромбов). Касание выбирает или снимает и закрывает лист. */
  private openFilters(): void {
    const f = heroesUi.filter;
    const sheet = bottomSheet(this, 'Фильтр', (box, width, close) => {
      const pick = (apply: () => void) => {
        if (sheet.layer.name !== 'bottomSheet') return;
        apply();
        close();
        this.time.delayedCall(M.fast, () => this.redraw());
      };
      const cell = (cx: number, cy: number, cw: number, on: boolean, name: string, onTap: () => void) => {
        const bg = plate(this, cx, cy, cw, 140, on ? { fill: COLOR.surfaceRaised, border: COLOR.accent, borderW: 3, r: R.m, hl: 0.14 } : { ...SURFACE.sunken, r: R.m }).setName(name);
        box.add(bg);
        pressable(this, bg, cw, 140, onTap);
      };
      let y = 0;
      box.add(text(this, 0, y + 20, 'Роль', T.caption, COLOR.textSecondary).setOrigin(0, 0.5));
      y += 56;
      const roleW = (width - 3 * S.xs) / 4;
      ROLES.forEach((role, i) => {
        const on = f.role === role;
        const cx = i * (roleW + S.xs) + roleW / 2;
        const cy = y + 70;
        const color = on ? COLOR.title : COLOR.textPrimary;
        cell(cx, cy, roleW, on, `Роль: ${ROLE_NAMES[role] ?? role}`, () => pick(() => (f.role = on ? null : role)));
        box.add(this.add.image(cx, cy - 22, cardIcon(this, role)).setDisplaySize(56, 56).setTint(hexNum(color)));
        box.add(ellipsize(text(this, cx, cy + 40, ROLE_NAMES[role] ?? role, T.caption, color, { fontStyle: 'bold' }), roleW - S.xs));
      });
      y += 140 + S.l;
      box.add(text(this, 0, y + 20, 'Редкость', T.caption, COLOR.textSecondary).setOrigin(0, 0.5));
      y += 56;
      const rw = (width - 4 * S.xs) / 5;
      RARITY_ORDER.forEach((r, i) => {
        const rar = r as CardRarity;
        const on = f.rarity === rar;
        const cx = i * (rw + S.xs) + rw / 2;
        const cy = y + 70;
        cell(cx, cy, rw, on, `Редкость: ${rarityName(rar)}`, () => pick(() => (f.rarity = on ? null : rar)));
        const d = 22;
        box.add(this.add.polygon(cx, cy - 22, [d, 0, 2 * d, d, d, 2 * d, 0, d], hexNum(rarityColor(rar))).setStrokeStyle(3, hexNum(COLOR.bg)));
        box.add(ellipsize(text(this, cx, cy + 40, rarityName(rar), T.caption, on ? COLOR.title : COLOR.textPrimary, { fontStyle: 'bold' }), rw - S.xxs));
      });
      y += 140 + S.l;
      if (f.line || f.role || f.rarity) {
        const reset = button(this, width / 2, y + TOUCH / 2, 420, TOUCH, '', 'Сбросить всё', () =>
          pick(() => {
            f.line = null;
            f.role = null;
            f.rarity = null;
          }), T.body, { variant: 'ghost' });
        reset.container.setName('resetFilters');
        box.add(reset.container);
        y += TOUCH + S.s;
      }
      return y;
    });
  }

  /** Строка-вход «Таверна» под короткой сеткой (начало игры): открыта — касание ведёт туда; закрыта — когда откроется. Высота. */
  private tavernRow(y: number): number {
    const lock = lockLabel('tavern');
    const w = GAME_W - 2 * L;
    const h = 136;
    const row = this.add.container(GAME_W / 2, y).setName('heroesTip');
    this.area.add(row);
    const bg = plate(this, 0, 0, w, h, { ...SURFACE.surface, r: R.m });
    row.add(bg);
    const ico = heroCardIcon(this, -w / 2 + S.s + 37, 0, 100, 'blue');
    if (lock) ico.setAlpha(0.5);
    row.add(ico);
    const left = -w / 2 + S.s + 74 + S.s;
    row.add(text(this, left, -22, 'Новые герои — в Таверне', T.body, lock ? COLOR.textSecondary : COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5));
    const sub = lock ? `${lock.charAt(0).toUpperCase()}${lock.slice(1)}` : 'Три одинаковые карты — следующая редкость';
    row.add(ellipsize(text(this, left, 26, sub, T.caption, COLOR.textSecondary).setOrigin(0, 0.5), w / 2 - left - S.xl));
    if (!lock) {
      row.add(text(this, w / 2 - S.m, 0, '›', T.title, COLOR.title, { fontStyle: 'bold' }).setOrigin(1, 0.5));
      pressable(this, bg, w, h, this.area.tap(() => this.scene.start('Tavern', {})));
    }
    return h;
  }

  /** Подтверждение «Вознести всех»: список «Вика: синяя → фиолетовая», затем вознесение и итог тостом. */
  private ascendAllConfirm(): void {
    const plan = ascendAll(session.save, GAME);
    const rows = ascendAllSummary(plan.done);
    if (!rows.length) {
      toast(this, 'Вознести некого: нужны свободные копии героя (для красного — ещё лишние фиолетовые) и золото.', C.muted);
      return;
    }
    const line = (r: (typeof rows)[number]) => `${r.name}: ${RARITY_CARD[r.from]} → ${RARITY_CARD[r.to]}${r.branchPending ? ' (ветка — потом)' : ''}`;
    const MAX = 7;
    const list = rows.slice(0, MAX).map(line);
    if (rows.length > MAX) list.push(`…и ещё ${rows.length - MAX}`);
    const gold = session.save.resources.gold - plan.save.resources.gold;
    const eaten = plan.done.reduce((n, d) => n + d.consumed.length, 0);
    const cost = `${gold > 0 ? `Золото: −${formatNumber(gold)} · ` : ''}копий в корм: ${eaten}`;
    // Слоты «любой» (золотой → красный) едят лишние копии других героев — назвать их (BUG-168).
    const byId = new Map(session.save.heroes.map((h) => [h.id, h]));
    const others = plan.done.flatMap((d) => d.consumed.map((id) => byId.get(id)).filter((h) => h && h.templateId !== d.templateId).map((h) => this.content.heroes[h!.templateId]?.name ?? h!.templateId));
    const otherLine = others.length ? `\nЛишние копии других героев: ${[...new Set(others)].join(', ')}.` : '';
    confirm(this, `Вознести всех?\n\n${list.join('\n')}\n\n${cost}${otherLine}\nОтряд, закреплённые (замок) и лучший экземпляр каждого героя в корм не идут.`, 'Вознести', () => {
      // Сохранение могло измениться — считаем заново от текущего.
      const r = ascendAll(session.save, GAME);
      if (!r.done.length) return;
      commit(r.save);
      sfx('rarity_up');
      haptic('levelUp');
      const res = ascendAllSummary(r.done);
      const msg = `Вознесено: ${res.map((x) => `${x.name} (${RARITY_CARD[x.to]})`).join(', ')}`;
      // RN-21: фиолетовые без ветки — сразу окно выбора ветки по очереди (иначе вторую профессию и истории 60+ не увидеть).
      const pending = res.filter((x) => x.branchPending).map((x) => x.heroId);
      this.redraw();
      this.events.once(Phaser.Scenes.Events.CREATE, () => {
        if (pending.length) pickBranchChain(this, pending);
        else toast(this, msg, C.success, 4000);
      });
    });
  }

  private get content() {
    return GAME.content;
  }

  /** Плитка «Контракт героя»: рубашка цвета редкости, «✦», число контрактов; нажатие — выбор героя. */
  private contractTile(x: number, y: number, count: number, rarity: CardRarity): Phaser.GameObjects.Container {
    const { h } = heroCardSize(TILE_W);
    const box = this.add.container(x, y).setName('contractTile');
    this.area.content.add(box);
    box.add(heroCardIcon(this, 0, -36, h - 100, rarity, undefined, { pick: true }));
    box.add(text(this, 0, h / 2 - 50, 'Контракт героя', T.caption, COLOR.title, { fontStyle: 'bold' }));
    if (count > 1) box.add(text(this, 0, h / 2 - 12, `×${count}`, T.caption, rarityColor(rarity), { fontStyle: 'bold' }));
    const hit = this.add.rectangle(0, 0, TILE_W, h, 0x000000, 0.001);
    box.add(hit);
    pressable(this, hit, TILE_W, h, this.area.tap(() => this.scene.start('HeroPick', {})));
    pulse(this, box, 1.03, M.emphasis + M.base);
    return box;
  }

  /**
   * Плитка героя игрока. Один угловой значок-повод (heroCardMark: вознести > ветка > улучшить > вещь > история > новый):
   * «новая история» и «вещь получше» — туда же, а не отдельной красной точкой; «в отряде» — тихая галка.
   */
  private tile(hero: HeroState, x: number, y: number, canAscend: boolean, gearUpgrade: boolean, copies = 1): Phaser.GameObjects.Container {
    const save = session.save;
    const inSquad = save.squad.includes(hero.id);
    return drawHeroCard(this, x, y, hero, {
      w: TILE_W,
      copies,
      showRole: false,
      needsBranch: needsBranch(hero, GAME),
      inSquad,
      isNew: !!hero.isNew,
      locked: !!hero.locked,
      canAscend,
      canLevel: !canAscend && inSquad && levelUpInfo(save, hero.id, GAME).canLevel,
      gearUpgrade,
      storyNew: heroStoryNew(hero.templateId, save) > 0,
      parent: this.area.content,
      onTap: this.area.tap(() => this.scene.start('Hero', { heroId: hero.id })),
    });
  }
}

/**
 * RN-21. Выбор ветки по очереди для фиолетовых без ветки (после «Вознести всех»): окно веток героя за героем.
 * «Отмена» — остальных не спрашиваем, на плитках остаётся «Выберите ветку!».
 */
export function pickBranchChain(sc: Phaser.Scene, heroIds: readonly string[]): void {
  const [id, ...rest] = heroIds;
  const hero = session.save.heroes.find((h) => h.id === id);
  if (!hero) return;
  if (!needsBranch(hero, GAME)) return pickBranchChain(sc, rest);
  const c = heroCard(hero, GAME);
  const left = heroIds.length > 1 ? ` Дальше: ${rest.map((x) => heroCard(session.save.heroes.find((h) => h.id === x) ?? hero, GAME).name).join(', ')}.` : '';
  openBranchPicker(sc, {
    templateId: hero.templateId,
    title: `${c.name}: выберите ветку`,
    subtitle: `Вторая профессия и новая часть истории героя (ур. 60+). Выбор бесплатный, первая смена — тоже.${left}`,
    heroId: hero.id,
    save: session.save,
    confirmLabel: (job) => (job ? `Выбрать: ${jobTitle(GAME, job, c.gender)}` : 'Выберите ветку'),
    onConfirm: (job) => {
      let say = (target: Phaser.Scene) => toast(target, `${c.name} — теперь ${jobTitle(GAME, job, c.gender)}!`, C.success, 2500);
      let success = false;
      try {
        const before = session.save;
        const r = chooseBranch(session.save, hero.id, job, GAME);
        commit(r.save);
        success = true;
        sfx('job_change');
        haptic('levelUp');
        const first = say;
        say = (target) => {
          first(target);
          target.time.delayedCall(1600, () => toastOpenedStories(target, before, r.save, hero.templateId));
        };
      } catch (e) {
        say = (target) => toast(target, e instanceof Error ? e.message : String(e), C.error, 3000);
      }
      if (success && rest.length) {
        sc.time.delayedCall(400, () => pickBranchChain(sc, rest));
      } else {
        // Плитки перерисовать (ушла плашка «Выберите ветку!»), тост — уже на новом экземпляре сцены.
        sc.scene.restart();
        sc.events.once(Phaser.Scenes.Events.CREATE, () => say(sc));
      }
    },
    onCancel: () => toast(sc, 'Ветку можно выбрать позже: карточка героя → «Выбрать ветку»', C.muted, 3500),
  });
}
