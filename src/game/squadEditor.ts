import Phaser from 'phaser';
import { arrangeSquad, COMBAT, duplicateCardsInSquad, formationRank, heroCard, heroName, heroPower, misplacedInFront, squadPower, withGear, type HeroState, type UnitDef } from '../core';
import { GAME } from './content';
import { formatNumber, heroSprite, POWER_COLORS, POWER_VERDICT, powerTone, type PowerTone } from './flow';
import { bump, countUp, juiceOn } from './juice';
import { GAME_W } from './layout';
import { classifyGesture, dropHero, fieldSlots, hitSlot, removeAt, rosterOrder, swapSlots, tapHero, type Point, type SquadMove } from './prepLayout';
import { card, portrait, powerChip, setPowerChip, unitFigure, unitTint } from './screen';
import { commit, session } from './session';
import { SKIN_TINT, skinIcon } from './skin';
import { portraitKey } from './sprites';
import { button, ellipsize, panel, text, toast } from './ui';
import { worldPoint } from './viewport';
import { C, FS, TINT } from './theme';

/**
 * Подготовка к бою (экран этапа и «Отряд»), в духе AFK Arena:
 * - сверху — поле «как в бою»: 2 слота фронта ближе к противнику, 3 слота тыла дальше (combat.json field.slotsA);
 *   в слоте — герой в стойке (анимация idle), имя, значок роли, уровень и мощь; пустой слот — «+»;
 *   на экране этапа справа — противник (зеркально, как в бою);
 * - снизу — прокручиваемый список всех героев карточками (портрет, профессия, уровень, мощь, роль, «в отряде»).
 * Нажатие на карточку — герой встаёт в лучший свободный слот (танки и ближний бой — во фронт, стрелки и лекари —
 * в тыл) или убирается; нажатие на героя в слоте — убрать; на пустой слот — выбрать его для следующего героя.
 * Героя можно перетащить из списка в слот и между слотами (обмен), из слота в список — убрать; работает касанием.
 * Каждое изменение сразу пишется в сохранение (commit). «Уменьшить анимацию» — без стойки, прыжков и подлётов.
 */

export interface FormationOpts {
  /** Карточка поля (верх и низ). */
  field: { top: number; bottom: number };
  /** Противник этапа (слоты 0–4, как enemySquad) — рисуется справа; нет — поле только своего отряда. */
  enemies?: (UnitDef | null)[];
  /** Рекомендуемая мощь этапа (flow.ts recommendedPower): «Нужно N», цвет мощи отряда и вердикт (ahead/close/behind). */
  enemyPower?: number;
  /** Полоса прокрутки списка героев. */
  roster: { top: number; bottom: number };
  /** После каждой перерисовки (кнопки сцены, доступность «В бой»). */
  onChange?: () => void;
}

const SLOT_H = 200;
const ENEMY_W = 196;
const CARD_W = 246;
const CARD_H = 250;
const CARD_GAP = 12;
const COLS = 4;
/** «Прилипание» при перетаскивании: палец чуть мимо слота — всё равно в слот. */
const SNAP = 36;
/** Призрак героя при перетаскивании — над пальцем, чтобы палец его не закрывал. */
const GHOST_LIFT = 70;
const GHOST_SIZE = 150;

/** Значок роли: 0 — танк (щит), 1 — ближний бой (меч), 2 — дальний бой (лук), 3 — лекарь (крест). */
const RANK_ICON = ['tank', 'melee', 'ranged', 'healer'] as const;

type Tag = { slot: number } | { hero: string };

interface Gesture {
  kind: 'slot' | 'card' | 'list';
  slot: number;
  heroId: string | null;
  x0: number;
  y0: number;
  t0: number;
  scroll0: number;
  mode: 'pending' | 'drag' | 'scroll';
  press: Phaser.GameObjects.Container | null;
  holdTimer: Phaser.Time.TimerEvent | null;
}

export class FormationEditor {
  private readonly slotW: number;
  private readonly slots: Point[];
  private readonly enemySlots: Point[] = [];
  private readonly fieldLayer: Phaser.GameObjects.Container;
  private readonly rosterContent: Phaser.GameObjects.Container;
  private readonly thumb: Phaser.GameObjects.Rectangle;
  private readonly dragLayer: Phaser.GameObjects.Container;
  private readonly powerText: Phaser.GameObjects.Text;
  /** Вердикт «сил хватает / чуть не хватает / слабее» (только у этапа). */
  private verdict: Phaser.GameObjects.Container | null = null;
  private readonly tip: Phaser.GameObjects.Text;
  private readonly fixBtn: ReturnType<typeof button>;
  private slotViews: Phaser.GameObjects.Container[] = [];
  private cardViews = new Map<string, Phaser.GameObjects.Container>();
  private rosterH = 0;
  private scrollY = 0;
  private selected: number | null = null;
  private gen = 0;
  private gesture: Gesture | null = null;
  private ghost: Phaser.GameObjects.Container | null = null;
  private dropHint: Phaser.GameObjects.Text | null = null;
  private highlight: Phaser.GameObjects.Graphics;
  private hover = -1;
  private pop: number | null = null;
  private shownPower: number | null = null;
  /** Открыто окно поверх (подтверждение, диалог) — жесты выключены. */
  locked = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: FormationOpts,
  ) {
    ensureRoleIcons(scene);
    const { field } = opts;
    const vs = !!opts.enemies;
    this.slotW = vs ? 222 : 250;
    const xs = vs ? { back: 150, front: 386 } : { back: 300, front: 640 };
    const band = { top: field.top + 96, bottom: field.bottom - 12 };
    this.slots = fieldSlots(COMBAT.field.slotsA, band, xs, SLOT_H);
    if (vs) this.enemySlots = this.slots.map((p) => ({ x: p.x === xs.front ? 694 : 930, y: p.y }));

    // --- Поле: подложка, половины, линии, подписи колонок ---
    card(scene, GAME_W / 2, (field.top + field.bottom) / 2, 1050, field.bottom - field.top);
    const g = scene.add.graphics();
    const midY = (band.top + band.bottom) / 2;
    const fh = field.bottom - field.top - 20;
    g.fillStyle(0x1f3d26, 0.28).fillRoundedRect(28, field.top + 10, (vs ? 512 : 1024) - 28, fh, 18);
    if (vs) g.fillStyle(0x3d1f1a, 0.3).fillRoundedRect(540, field.top + 10, 512, fh, 18);
    // Тени под местами: видно, где будут стоять герои.
    (opts.enemies ?? []).forEach((u, i) => u && this.enemySlots[i] && g.fillStyle(0x000000, 0.3).fillEllipse(this.enemySlots[i].x, this.enemySlots[i].y + 34, 140, 30));
    const labelY = field.top + 76;
    const colLabel = (x: number, s: string) => text(scene, x, labelY, s, FS.caption, C.dim, { stroke: C.stroke, strokeThickness: 3 });
    colLabel(xs.back, 'тыл');
    colLabel(xs.front, 'фронт');
    if (vs) {
      g.lineStyle(3, SKIN_TINT.bronze, 0.9).lineBetween(540, field.top + 20, 540, field.bottom - 20);
      scene.add.image(540, midY, skinIcon('swords')).setDisplaySize(64, 64).setTint(SKIN_TINT.gold);
      colLabel(694, 'фронт');
      colLabel(930, 'тыл');
    } else {
      text(scene, 900, midY, 'к противнику\n→', FS.caption, C.dim, { stroke: C.stroke, strokeThickness: 3, lineSpacing: 4 });
    }

    // Мощь: над своим отрядом; у этапа справа — мощь противника.
    this.powerText = text(scene, vs ? 268 : GAME_W / 2, field.top + 36, '', FS.h3, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
    if (vs) {
      text(scene, 812, field.top + 36, `Нужно ${formatNumber(opts.enemyPower ?? 0)}`, FS.h3, C.enemy, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
      // «Почти готово»: вердикт на разделителе — зелёный / жёлтый «чуть не хватает» / красный (обновляется в refreshInfo).
      if (opts.enemyPower !== undefined) {
        const pc = { squad: 0, recommended: opts.enemyPower, tone: 'ahead' as const, verdict: POWER_VERDICT.ahead };
        this.verdict = powerChip(scene, 540, field.top + 36, pc, { label: pc.verdict }).setDepth(2);
      }
      this.drawEnemies(opts.enemies ?? []);
    }

    this.fieldLayer = scene.add.container(0, 0);

    // Строка под полем: подсказка или предупреждение «стрелки во фронте» + «Переставить».
    const tipY = field.bottom + 40;
    this.tip = text(scene, GAME_W / 2, tipY, '', FS.caption, C.muted);
    this.fixBtn = button(scene, GAME_W - 170, tipY, 300, 84, 'ui_btn_secondary', 'Переставить', () => this.rearrange(), FS.small);
    this.fixBtn.container.setName('rearrangeBtn');

    // --- Список героев с прокруткой ---
    const { roster } = opts;
    this.rosterContent = scene.add.container(0, roster.top);
    const mg = scene.make.graphics({}, false);
    mg.fillStyle(0xffffff).fillRect(0, roster.top, GAME_W, roster.bottom - roster.top);
    this.rosterContent.setMask(mg.createGeometryMask());
    // Видимая полоса списка (e2e: вне полосы содержимое скрыто маской и ничего не перекрывает).
    this.rosterContent.setData('clip', [roster.top, roster.bottom]);
    this.thumb = scene.add.rectangle(GAME_W - 8, roster.top, 8, 40, TINT.frame, 0.8).setOrigin(0.5, 0).setVisible(false);

    this.highlight = scene.add.graphics().setDepth(4000);
    this.dragLayer = scene.add.container(0, 0).setDepth(5000);

    const input = scene.input;
    const down = (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => this.onDown(p, over);
    const move = (p: Phaser.Input.Pointer) => this.onMove(p);
    const up = (p: Phaser.Input.Pointer) => this.onUp(p);
    const wheel = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const w = worldPoint(scene, p);
      if (!this.locked && !this.gesture && this.inRoster(w.y)) this.scrollTo(this.scrollY + dy);
    };
    input.on('pointerdown', down);
    input.on('pointermove', move);
    input.on('pointerup', up);
    input.on('pointerupoutside', up);
    input.on('wheel', wheel);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      input.off('pointerdown', down);
      input.off('pointermove', move);
      input.off('pointerup', up);
      input.off('pointerupoutside', up);
      input.off('wheel', wheel);
    });
  }

  /** Центр слота i на поле (для подсказок и e2e). */
  slotPos(i: number): Point {
    return this.slots[i];
  }

  // ---------- отрисовка ----------

  draw(): void {
    this.gen++;
    this.drawSlots();
    this.drawRoster();
    this.refreshInfo();
    this.opts.onChange?.();
  }

  private drawEnemies(enemies: (UnitDef | null)[]): void {
    const scene = this.scene;
    enemies.forEach((u, i) => {
      const p = this.enemySlots[i];
      if (!u || !p) return;
      const boss = u.kind === 'boss';
      // Фигура в стойке, лицом к отряду (зеркально, как в бою).
      unitFigure(scene, u.visual.sprite, p.x, p.y + 36, boss ? 130 : 110, {
        onReady: (o) => {
          o.setTint(unitTint(u.visual));
          if (o instanceof Phaser.GameObjects.Sprite) {
            o.setFlipX(true).setOrigin(1 - o.originX, o.originY);
            if (!juiceOn()) o.anims.pause();
          }
        },
      });
      // Имя целиком (T1-22): перенос по пробелу/дефису, не влезает — мельче.
      fitName(text(scene, p.x, p.y + 74, u.name, FS.caption, boss ? C.danger : C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5, lineSpacing: -6 }), ENEMY_W);
    });
  }

  private drawSlots(): void {
    const scene = this.scene;
    const gen = this.gen;
    this.fieldLayer.removeAll(true);
    this.slotViews = [];
    const save = session.save;
    const gctx = withGear(GAME, save);
    const w = this.slotW;
    const h = SLOT_H;
    save.squad.forEach((heroId, i) => {
      const p = this.slots[i];
      const hero = heroId ? save.heroes.find((x) => x.id === heroId) : undefined;
      const c = scene.add.container(p.x, p.y);
      this.fieldLayer.add(c);
      this.slotViews.push(c);
      const sel = this.selected === i;
      const bg = panel(scene, 0, 0, w, h, sel ? 'ui_slot_selected' : hero ? 'ui_slot_filled' : 'ui_slot_empty');
      bg.setAlpha(hero || sel ? 0.92 : 0.75);
      c.add(bg);
      this.tag(bg, { slot: i });
      if (!hero) {
        c.add(text(scene, 0, -16, '+', 96, sel ? C.gold : C.placeholder, { fontStyle: 'bold' }));
        c.add(text(scene, 0, 62, sel ? 'выбран' : i < 2 ? 'фронт' : 'тыл', FS.caption, sel ? C.gold : C.placeholder));
        return;
      }
      const rank = formationRank(hero, GAME);
      unitFigure(scene, heroSprite(hero, GAME), 0, 24, 104, {
        onReady: (o) => {
          if (gen !== this.gen || !c.scene) {
            o.destroy();
            return;
          }
          c.addAt(o, 1);
          if (o instanceof Phaser.GameObjects.Sprite && !juiceOn()) o.anims.pause();
        },
      });
      c.add(text(scene, -w / 2 + 12, -h / 2 + 8, `ур. ${hero.level}`, FS.caption, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0));
      c.add(scene.add.image(w / 2 - 30, -h / 2 + 30, roleIconKey(rank)).setDisplaySize(46, 46));
      c.add(ellipsize(text(scene, 0, 46, heroName(hero, GAME), FS.small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), w - 20));
      c.add(text(scene, 0, 78, formatNumber(heroPower(hero, gctx)), FS.caption, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }));
      if (this.pop === i && juiceOn()) {
        c.setScale(0.86);
        scene.tweens.add({ targets: c, scale: 1, duration: 220, ease: 'Back.easeOut' });
      }
    });
    this.pop = null;
  }

  private drawRoster(): void {
    const scene = this.scene;
    this.rosterContent.removeAll(true);
    this.cardViews.clear();
    const save = session.save;
    const gctx = withGear(GAME, save);
    const power = (hero: HeroState) => heroPower(hero, gctx);
    const heroes = rosterOrder(save.heroes, power);
    const x0 = GAME_W / 2 - ((COLS - 1) * (CARD_W + CARD_GAP)) / 2;
    heroes.forEach((hero, i) => {
      const x = x0 + (i % COLS) * (CARD_W + CARD_GAP);
      const y = 6 + CARD_H / 2 + Math.floor(i / COLS) * (CARD_H + CARD_GAP);
      const inSquad = save.squad.includes(hero.id);
      const c = scene.add.container(x, y);
      this.rosterContent.add(c);
      this.cardViews.set(hero.id, c);
      const bg = panel(scene, 0, 0, CARD_W, CARD_H, inSquad ? 'ui_slot_filled' : 'ui_slot_selected');
      c.add(bg);
      this.tag(bg, { hero: hero.id });
      const rank = formationRank(hero, GAME);
      const face = portrait(scene, 0, -44, portraitKey(heroSprite(hero, GAME)), 118);
      c.add(face);
      const card0 = heroCard(hero, GAME);
      c.add(text(scene, -CARD_W / 2 + 12, -CARD_H / 2 + 8, `ур. ${hero.level}`, FS.caption, card0.rarity.color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0));
      c.add(scene.add.image(CARD_W / 2 - 30, -CARD_H / 2 + 30, roleIconKey(rank)).setDisplaySize(46, 46));
      c.add(ellipsize(text(scene, 0, 34, card0.name, FS.small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), CARD_W - 20));
      c.add(ellipsize(text(scene, 0, 66, card0.jobName, FS.caption, C.title, { stroke: C.stroke, strokeThickness: 4 }), CARD_W - 24));
      c.add(text(scene, 0, 100, formatNumber(power(hero)), FS.caption, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }));
      if (inSquad) {
        // «В отряде»: портрет приглушён, поверх — зелёная плашка с галочкой.
        face.setAlpha(0.5);
        c.add(scene.add.rectangle(0, -8, CARD_W - 24, 40, 0x10301a, 0.85).setStrokeStyle(2, 0x6fd06f, 0.8));
        c.add(scene.add.image(-72, -8, skinIcon('check')).setDisplaySize(30, 30).setTint(0x9fe0a6));
        c.add(text(scene, 14, -8, 'в отряде', FS.caption, C.success, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 3 }));
      }
    });
    const rows = Math.ceil(heroes.length / COLS);
    this.rosterH = rows ? 12 + rows * CARD_H + (rows - 1) * CARD_GAP : 0;
    this.scrollTo(this.scrollY);
  }

  /** Мощь (отсчёт от прежней), подсказка или предупреждение «дальний бой во фронте». */
  private refreshInfo(): void {
    const save = session.save;
    const mine = squadPower(save, GAME);
    const prev = this.shownPower;
    this.shownPower = mine;
    const enemy = this.opts.enemyPower;
    if (enemy !== undefined) {
      const tone = powerTone(mine, enemy);
      this.powerText.setColor(POWER_COLORS[tone]);
      if (this.verdict) {
        const was = this.verdict.getData('tone') as PowerTone;
        setPowerChip(this.verdict, { squad: mine, recommended: enemy, tone, verdict: POWER_VERDICT[tone] }, POWER_VERDICT[tone]);
        if (prev !== null && was !== tone) bump(this.scene, this.verdict, 1.15);
      }
    }
    const fmt = (n: number) => (enemy !== undefined ? `Мощь ${formatNumber(n)}` : `Мощь отряда: ${formatNumber(n)}`);
    countUp(this.scene, this.powerText, prev ?? mine, mine, fmt, { duration: 400 });
    if (prev !== null && prev !== mine) bump(this.scene, this.powerText, 1.08);

    const misplaced = misplacedInFront(save, GAME);
    this.fixBtn.container.setVisible(misplaced.length > 0);
    if (misplaced.length) {
      const names = misplaced.map((id) => {
        const h = save.heroes.find((x) => x.id === id);
        return h ? heroName(h, GAME) : id;
      });
      this.tip.setText(`${names.join(', ')} во фронте — дальнему бою место в тылу`).setColor(C.warning).setX(40).setOrigin(0, 0.5);
      ellipsize(this.tip, GAME_W - 400);
    } else {
      const msg = !save.squad.some(Boolean)
        ? 'Поставьте в отряд хотя бы одного героя'
        : this.selected !== null
          ? 'Слот выбран — нажмите на героя в списке'
          : 'Нажмите на героя или перетащите его на место';
      this.tip.setText(msg).setColor(save.squad.some(Boolean) ? C.muted : C.warning).setX(GAME_W / 2).setOrigin(0.5);
      ellipsize(this.tip, 1000);
    }
  }

  // ---------- прокрутка ----------

  private get rosterView(): number {
    return this.opts.roster.bottom - this.opts.roster.top;
  }

  private get scrollable(): boolean {
    return this.rosterH > this.rosterView;
  }

  private scrollTo(v: number): void {
    const max = Math.max(0, this.rosterH - this.rosterView);
    this.scrollY = Phaser.Math.Clamp(v, 0, max);
    this.rosterContent.y = this.opts.roster.top - this.scrollY;
    this.thumb.setVisible(this.scrollable);
    if (!this.scrollable) return;
    const view = this.rosterView;
    const th = Math.max(60, (view * view) / this.rosterH);
    this.thumb.setSize(8, th).setY(this.opts.roster.top + (view - th) * (this.scrollY / max));
  }

  private inRoster(y: number): boolean {
    return y >= this.opts.roster.top && y <= this.opts.roster.bottom;
  }

  // ---------- жесты: нажатие, перетаскивание, прокрутка ----------

  private tag(o: Phaser.GameObjects.NineSlice, tag: Tag): void {
    o.setInteractive({ useHandCursor: true });
    o.setData('prep', tag);
  }

  private onDown(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.locked || this.gesture) return;
    const w = worldPoint(this.scene, p);
    // Верхний объект под пальцем: наш слот/карточка — жест наш; кнопка или окно поверх — не наш.
    const tag = over[0]?.getData?.('prep') as Tag | undefined;
    let g: Gesture | null = null;
    const base = { x0: w.x, y0: w.y, t0: p.downTime || this.scene.time.now, scroll0: this.scrollY, mode: 'pending' as const, press: null, holdTimer: null };
    if (tag && 'slot' in tag) g = { ...base, kind: 'slot', slot: tag.slot, heroId: session.save.squad[tag.slot] ?? null, press: this.slotViews[tag.slot] ?? null };
    else if (tag && 'hero' in tag && this.inRoster(w.y)) g = { ...base, kind: 'card', slot: -1, heroId: tag.hero, press: this.cardViews.get(tag.hero) ?? null };
    else if (!over.length && this.inRoster(w.y)) g = { ...base, kind: 'list', slot: -1, heroId: null };
    if (!g) return;
    this.gesture = g;
    g.press?.setScale(0.96);
    // Удержание на месте — герой «поднимается» и его можно тянуть (удобно для вертикального жеста в списке).
    if (g.heroId) {
      g.holdTimer = this.scene.time.delayedCall(240, () => {
        if (this.gesture === g && g.mode === 'pending') this.startDrag(g, this.scene.input.activePointer);
      });
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const g = this.gesture;
    if (!g || !p.isDown) return;
    const w = worldPoint(this.scene, p);
    const dx = w.x - g.x0;
    const dy = w.y - g.y0;
    if (g.mode === 'pending') {
      if (g.kind === 'list') {
        if (Math.hypot(dx, dy) > 14) g.mode = 'scroll';
      } else if (g.heroId) {
        const m = g.kind === 'slot'
          ? (Math.hypot(dx, dy) >= 16 ? 'drag' : 'pending')
          : classifyGesture({ dx, dy, heldMs: 0 }, { scrollable: this.scrollable, leftList: w.y < this.opts.roster.top });
        if (m === 'drag') this.startDrag(g, p);
        else if (m === 'scroll') {
          g.mode = 'scroll';
          this.release(g);
        }
      }
    }
    if (g.mode === 'scroll') {
      // Листали и увели палец с карточки вверх, за список, — значит, тянут героя на поле.
      if (g.kind === 'card' && w.y < this.opts.roster.top - 24) {
        this.scrollTo(g.scroll0);
        this.startDrag(g, p);
      } else this.scrollTo(g.scroll0 - dy);
    }
    if (g.mode === 'drag') this.moveGhost(w);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    g.holdTimer?.remove();
    this.release(g);
    const w = worldPoint(this.scene, p);
    const moved = Math.hypot(w.x - g.x0, w.y - g.y0);
    if (g.mode === 'pending' || (g.mode === 'drag' && moved < 16)) {
      this.endDrag();
      if (g.kind === 'slot') this.tapSlot(g.slot);
      else if (g.kind === 'card' && g.heroId) this.tapCard(g.heroId);
      return;
    }
    if (g.mode !== 'drag') return;
    // Цель — там, где призрак героя (он над пальцем), а не под самим пальцем.
    const at = { x: w.x, y: w.y - GHOST_LIFT };
    const target = hitSlot(this.slots, this.slotW, SLOT_H, at, SNAP);
    this.endDrag();
    if (target >= 0) {
      const squad = session.save.squad;
      const r = g.kind === 'slot' ? swapSlots(squad, g.slot, target) : dropHero(squad, g.heroId!, target);
      this.apply(r, target);
    } else if (g.kind === 'slot' && this.inRoster(at.y)) {
      this.apply(removeAt(session.save.squad, g.slot), null);
    }
  }

  private release(g: Gesture): void {
    if (g.press?.scene) g.press.setScale(1);
  }

  private startDrag(g: Gesture, p: Phaser.Input.Pointer): void {
    if (!g.heroId || g.mode === 'drag') return;
    const hero = session.save.heroes.find((h) => h.id === g.heroId);
    if (!hero) return;
    g.mode = 'drag';
    g.holdTimer?.remove();
    this.release(g);
    this.selected = null;
    const scene = this.scene;
    // Источник приглушаем: видно, откуда взят герой.
    g.press?.setAlpha(0.4);
    const ring = scene.add.circle(0, 0, GHOST_SIZE / 2 + 6, 0x14110c, 0.92).setStrokeStyle(6, TINT.gold);
    const face = portrait(scene, 0, 0, portraitKey(heroSprite(hero, GAME)), GHOST_SIZE);
    const name = text(scene, 0, GHOST_SIZE / 2 + 26, heroName(hero, GAME), FS.small, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
    this.ghost = scene.add.container(0, 0, [ring, face, name]);
    this.dragLayer.add(this.ghost);
    const w = worldPoint(scene, p);
    this.ghost.setPosition(w.x, w.y - GHOST_LIFT);
    if (juiceOn()) {
      this.ghost.setScale(0.7);
      scene.tweens.add({ targets: this.ghost, scale: 1, duration: 140, ease: 'Back.easeOut' });
    }
    this.moveGhost(w);
  }

  private moveGhost(w: Point): void {
    const g = this.gesture;
    if (!this.ghost || !g) return;
    this.ghost.setPosition(w.x, w.y - GHOST_LIFT);
    const hover = hitSlot(this.slots, this.slotW, SLOT_H, { x: w.x, y: w.y - GHOST_LIFT }, SNAP);
    if (hover === this.hover && this.highlight.visible) return;
    this.hover = hover;
    // Подсветка: все слоты — куда можно бросить; под пальцем — ярко; дальний бой над фронтом — оранжевым.
    const hero = session.save.heroes.find((h) => h.id === g.heroId);
    const rank = hero ? formationRank(hero, GAME) : 0;
    const hl = this.highlight.clear().setVisible(true);
    const sw = this.slotW;
    this.slots.forEach((s, i) => {
      if (i === g.slot) return;
      const on = i === hover;
      const bad = on && i < 2 && rank >= 2;
      const col = bad ? 0xff9a4a : TINT.gold;
      if (on) hl.fillStyle(col, 0.18).fillRoundedRect(s.x - sw / 2, s.y - SLOT_H / 2, sw, SLOT_H, 20);
      hl.lineStyle(on ? 8 : 3, col, on ? 1 : 0.45).strokeRoundedRect(s.x - sw / 2, s.y - SLOT_H / 2, sw, SLOT_H, 20);
    });
    // Из слота — в список: «убрать».
    if (g.kind === 'slot') {
      const r = this.opts.roster;
      hl.fillStyle(0x000000, 0.35).fillRoundedRect(20, r.top, GAME_W - 40, r.bottom - r.top, 20);
      hl.lineStyle(4, TINT.danger, 0.8).strokeRoundedRect(20, r.top, GAME_W - 40, r.bottom - r.top, 20);
      if (!this.dropHint) {
        this.dropHint = text(this.scene, GAME_W / 2, (r.top + r.bottom) / 2, 'Отпустите здесь — убрать из отряда', FS.h3, C.danger, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
        this.dragLayer.addAt(this.dropHint, 0);
      }
    }
    if (hover >= 0 && hover !== g.slot) this.slotViews[hover]?.setScale(1.04);
    this.slotViews.forEach((v, i) => i !== hover && v.scene && v.setScale(1));
  }

  private endDrag(): void {
    this.ghost?.destroy();
    this.ghost = null;
    this.dropHint?.destroy();
    this.dropHint = null;
    this.highlight.clear().setVisible(false);
    this.hover = -1;
    for (const v of this.slotViews) if (v.scene) v.setScale(1).setAlpha(1);
    for (const v of this.cardViews.values()) if (v.scene) v.setAlpha(1);
  }

  // ---------- действия ----------

  private tapSlot(i: number): void {
    const save = session.save;
    if (save.squad[i]) {
      this.selected = null;
      this.apply(removeAt(save.squad, i), null);
      return;
    }
    // Пустой слот: выбрать (следующий герой из списка встанет сюда); повторно — снять выбор.
    this.selected = this.selected === i ? null : i;
    this.draw();
  }

  private tapCard(heroId: string): void {
    const save = session.save;
    const hero = save.heroes.find((h) => h.id === heroId);
    if (!hero) return;
    const selected = this.selected;
    const r = tapHero(save.squad, heroId, formationRank(hero, GAME), selected);
    this.selected = null;
    const slot = r.squad ? r.squad.indexOf(heroId) : -1;
    this.apply(r, slot >= 0 ? slot : null);
  }

  private apply(r: SquadMove, popSlot: number | null): void {
    if (!r.squad) {
      if (r.reason === 'last') toast(this.scene, 'В отряде должен остаться хотя бы один герой');
      else if (r.reason === 'full') toast(this.scene, 'Отряд полон: перетащите героя на занятое место или уберите кого-нибудь');
      this.draw();
      return;
    }
    // Одна копия каждой карточки в отряде (ядро: duplicate_card).
    if (duplicateCardsInSquad(session.save, r.squad).length) {
      toast(this.scene, 'Эта карточка уже в отряде — можно взять только одну копию');
      this.draw();
      return;
    }
    commit({ ...session.save, squad: r.squad });
    this.pop = popSlot;
    this.draw();
  }

  /** T1-20: тот же состав по ролям — танки и ближний бой вперёд, стрелки и лекари в тыл. */
  rearrange(): void {
    commit({ ...session.save, squad: arrangeSquad(session.save, GAME) });
    this.selected = null;
    this.draw();
    toast(this.scene, 'Отряд переставлен: дальний бой и лекари — в тылу');
  }

  /** Отряд целиком заменён снаружи (авто, пресет) — перерисовать. */
  replaced(): void {
    this.selected = null;
    this.draw();
  }
}

// ---------- значки ролей ----------

const roleIconKey = (rank: number) => `prep_role_${RANK_ICON[Math.max(0, Math.min(3, rank))]}`;

/** Значки ролей рисуются кодом один раз на игру: кружок с бронзовой рамкой и символом. */
function ensureRoleIcons(scene: Phaser.Scene): void {
  const S = 64;
  const colors: Record<(typeof RANK_ICON)[number], string> = { tank: '#7fb2ff', melee: '#ff8f6a', ranged: '#9fe07a', healer: '#fff2a8' };
  for (const kind of RANK_ICON) {
    const key = `prep_role_${kind}`;
    if (scene.textures.exists(key)) continue;
    const tex = scene.textures.createCanvas(key, S, S);
    if (!tex) continue;
    const c = tex.getContext();
    c.fillStyle = '#1a1510';
    c.strokeStyle = '#d6ae63';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = colors[kind];
    c.strokeStyle = colors[kind];
    c.lineWidth = 5;
    c.lineCap = 'round';
    c.beginPath();
    if (kind === 'tank') {
      c.moveTo(18, 17);
      c.lineTo(46, 17);
      c.lineTo(46, 32);
      c.quadraticCurveTo(46, 44, 32, 50);
      c.quadraticCurveTo(18, 44, 18, 32);
      c.closePath();
      c.fill();
    } else if (kind === 'melee') {
      c.moveTo(20, 44);
      c.lineTo(44, 18);
      c.moveTo(22, 34);
      c.lineTo(30, 42);
      c.moveTo(17, 47);
      c.lineTo(21, 43);
      c.stroke();
    } else if (kind === 'ranged') {
      c.arc(26, 32, 17, -Math.PI / 2.4, Math.PI / 2.4);
      c.moveTo(26 + 17 * Math.cos(-Math.PI / 2.4), 32 + 17 * Math.sin(-Math.PI / 2.4));
      c.lineTo(26 + 17 * Math.cos(Math.PI / 2.4), 32 + 17 * Math.sin(Math.PI / 2.4));
      c.moveTo(20, 32);
      c.lineTo(48, 32);
      c.stroke();
      c.beginPath();
      c.moveTo(50, 32);
      c.lineTo(43, 27);
      c.lineTo(43, 37);
      c.closePath();
      c.fill();
    } else {
      c.fillRect(27, 16, 10, 32);
      c.fillRect(16, 27, 32, 10);
    }
    tex.refresh();
  }
}

/**
 * T1-22. Имя юнита целиком в ширину maxW: не влезает в строку — перенос по пробелу или дефису ближе к середине
 * (не больше двух строк); строка всё ещё шире — текст чуть уменьшается. Без многоточия.
 */
export function fitName(t: Phaser.GameObjects.Text, maxW: number): Phaser.GameObjects.Text {
  const name = t.text;
  if (t.width > maxW) {
    const breaks = [...name.matchAll(/[ -]/g)].map((m) => m.index!);
    if (breaks.length) {
      const mid = name.length / 2;
      const i = breaks.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
      t.setText(name[i] === '-' ? `${name.slice(0, i + 1)}\n${name.slice(i + 1)}` : `${name.slice(0, i)}\n${name.slice(i + 1)}`);
    }
  }
  if (t.width > maxW) t.setScale(maxW / t.width);
  return t;
}
