import Phaser from 'phaser';
import { arrangeSquad, COMBAT, duplicateCardsInSquad, formationRank, heroName, misplacedInFront, squadPower, withGear, heroPower, type HeroState, type RecommendedLevel, type UnitDef } from '../core';
import { sfx } from './audio';
import { GAME } from './content';
import { enemyLevelColor, heroSprite, powerTone, recommendText } from './flow';
import { haptic } from './haptics';
import { backTexture, frameTexture, rarityColor } from './heroCard';
import { bump, countUp, juiceOn } from './juice';
import { GAME_W } from './layout';
import { numberFont, type NumberFont } from './numberFont';
import type { CachedTextStyle } from './perf';
import { classifyGesture, dropHero, fieldSlots, formationBodyRows, hitSlot, PREP, removeAt, rosterCardW, rosterOneEach, rosterOrder, slotBand, swapSlots, tapHero, type Point, type SquadMove } from './prepLayout';
import { portrait, powerCompare, unitFigure, unitTint, updatePowerCompare } from './screen';
import { commit, session } from './session';
import { skinIcon } from './skin';
import { portraitKey } from './sprites';
import { button, ellipsize, plate, type ScrollArea, SURFACE, text, toast } from './ui';
import { minimumFontSize, worldPoint } from './viewport';
import { C, COLOR, COLOR_N, E, FAMILY, M, R, S, T } from './theme';

/**
 * Подготовка к бою (экран этапа и «Отряд»), в духе AFK Arena:
 * - сверху — поле «как в бою»: 2 слота фронта ближе к противнику, 3 слота тыла дальше (combat.json field.slotsA);
 *   в слоте — герой в стойке (анимация idle) в рамке цвета редкости и маленький значок уровня; пустой слот —
 *   утопленная плашка с «+» (один раз мягко пульсирует, opts.hintEmpty); ряды различаются полосой фона (фронт светлее),
 *   без подписей; на экране этапа справа — противник (зеркально, как в бою);
 * - мощь — один ряд powerCompare (screen.ts): своя мощь и «Не хватает N» только при нехватке (§3 правило 11);
 * - снизу — прокручиваемая сетка всех героев компактными плитками (портрет, уровень, значок роли, рамка редкости);
 *   кто в отряде — приглушён, с галкой в углу (без плашек и подписей). Число уровня — растровым шрифтом (BitmapText:
 *   один атлас на все цифры экрана, §7), а не отдельным Text на каждую плитку.
 * Нажатие на карточку — герой встаёт в лучший свободный слот (танки и ближний бой — во фронт, стрелки и лекари —
 * в тыл) или убирается; нажатие на героя в слоте — убрать; на пустой слот — выбрать его для следующего героя
 * (слот и сетка подсвечиваются). Героя можно перетащить из списка в слот и между слотами (обмен), из слота в список —
 * убрать; работает касанием. Каждое изменение сразу пишется в сохранение (commit), с лёгкой вибрацией.
 * «Уменьшить анимацию» — без стойки, прыжков, пульса и подлётов.
 */

export interface FormationOpts {
  /** Карточка поля (верх и низ). */
  field: { top: number; bottom: number };
  /** Противник этапа (слоты 0–4, как enemySquad) — рисуется справа; нет — поле только своего отряда. */
  enemies?: (UnitDef | null)[];
  /** Рекомендуемая мощь этапа (flow.ts recommendedPower): powerCompare «своя мощь · Не хватает N». */
  enemyPower?: number;
  /** Уровни врагов по слотам enemies (core stageLevels): число у каждого, цвет — против среднего уровня отряда. */
  enemyLevels?: (number | null)[];
  /** Рекомендуемый уровень этапа (core recommendedHeroLevel): «Героям нужен ур. N» строкой под полем — только при нехватке сил. */
  recommend?: RecommendedLevel;
  /** Полоса прокрутки списка героев. */
  roster: { top: number; bottom: number };
  /** После каждой перерисовки (кнопки сцены, доступность «В бой»). */
  onChange?: () => void;
  /**
   * Итерация 4 (необязательно). Пустые слоты один раз мягко пульсируют при открытии экрана — вместо строки
   * «Нажмите на героя…». По умолчанию true (если есть кого поставить); false — без пульса.
   */
  hintEmpty?: boolean;
  /**
   * Итерация 4 (необязательно). Мощь на поле: true (по умолчанию) — редактор сам рисует ряд мощи над своим отрядом
   * (с enemyPower — powerCompare «⚔ своя · Не хватает N», без него — «⚔ своя»). false — не рисует: сцена показывает
   * мощь сама (например, свой powerCompare в шапке) и обновляет её в onChange.
   */
  showPower?: boolean;
  /**
   * Итерация 4 (необязательно). false — редактор не рисует своё «оформление» поля: ряд мощи (как showPower: false)
   * и строку «Героям нужен ур. N» под полем — их показывает сцена (StageScene: свой powerCompare). Подписей
   * «фронт/тыл», «Нужно N», плашки-вердикта и мечей в центре поля больше нет вовсе. По умолчанию true.
   */
  chrome?: boolean;
  /**
   * Итерация 4 (необязательно). Заголовок сетки героев строкой y: «Герои» слева и справа кнопки-иконки с короткой
   * подписью — «Авто» (волшебная палочка, onAuto) и «Пресеты» (закладка, onPresets); кнопка без обработчика не рисуется.
   * Не задан — заголовок рисует сцена.
   */
  rosterHead?: { y: number; title?: string; onAuto?: () => void; onPresets?: () => void };
  /** Поле и весь ростер прокручиваются одним телом; координаты правил расстановки остаются прежними. */
  scrollBody?: { area: ScrollArea; origin: number };
}

/** Сколько держится заметка в строке подсказки (RR-17), мс. */
const NOTE_MS = 3000;
const SLOT_H = PREP.slotH;
/** Плитки сетки героев: 5 колонок на ширину контента 1080 − 2·S.l (prepLayout.ts PREP). */
const COLS = PREP.cols;
const CARD_GAP = PREP.gap;
const CARD_W = rosterCardW(GAME_W);
const CARD_H = PREP.cardH;
/** «Прилипание» при перетаскивании: палец чуть мимо слота — всё равно в слот. */
const SNAP = 36;
/** Призрак героя при перетаскивании — над пальцем, чтобы палец его не закрывал. */
const GHOST_LIFT = 70;
const GHOST_SIZE = 150;
/** Высота ряда мощи над слотами. */
const HEAD_H = PREP.headH;

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
  /** Мощь: powerCompare (этап) или «⚔ число» (отряд); null — мощь рисует сцена (showPower: false). */
  private readonly powerBox: Phaser.GameObjects.Container | null = null;
  private readonly powerText: Phaser.GameObjects.Text | null = null;
  /** Числа уровней врагов — перекрашиваются при смене отряда (refreshInfo). */
  private readonly levelTexts: { t: Phaser.GameObjects.BitmapText; level: number }[] = [];
  private readonly tip: Phaser.GameObjects.Text;
  /** RR-17: короткая заметка в строке подсказки («Отряд расставлен автоматически») и когда она отживёт. */
  private note: { text: string; until: number } | null = null;
  private readonly fixBtn: ReturnType<typeof button>;
  private readonly font: NumberFont;
  /** Подсветка сетки, пока выбран пустой слот (вместо строки «Слот выбран — нажмите на героя»). */
  private readonly selFrame: Phaser.GameObjects.Graphics;
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
  private highlightShift = 0;
  private pop: number | null = null;
  private popAll = false;
  private hinted = false;
  private shownPower: number | null = null;
  /** Открыто окно поверх (подтверждение, диалог, лист) — жесты выключены. */
  locked = false;
  private bodyContainer: Phaser.GameObjects.Container | null = null;
  private bodyDragLocked = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: FormationOpts,
  ) {
    const before = new Set(scene.children.list);
    ensurePrepTextures(scene);
    this.font = levelFont(scene);
    const { field } = opts;
    const vs = !!opts.enemies;
    this.slotW = vs ? 200 : 220;
    const xs = vs ? { back: 150, front: 386 } : { back: 330, front: 690 };
    const band = slotBand(field);
    this.slots = fieldSlots(COMBAT.field.slotsA, band, xs, SLOT_H);
    if (vs) this.enemySlots = this.slots.map((p) => ({ x: p.x === xs.front ? 694 : 930, y: p.y }));

    // --- Поле: поверхность без рамки; своя половина и половина противника — оттенком, фронт — светлой полосой ---
    const fh = field.bottom - field.top;
    const fieldX = S.l / 2;
    const fieldW = GAME_W - S.l;
    plate(scene, GAME_W / 2, field.top + fh / 2, fieldW, fh, { ...SURFACE.surface, r: R.l });
    const g = scene.add.graphics();
    const half = vs ? GAME_W / 2 - fieldX : fieldW;
    g.fillStyle(0x3f7a4a, 0.1).fillRoundedRect(fieldX, field.top, half, fh, R.l);
    if (vs) {
      g.fillStyle(0x7a3a2f, 0.12).fillRoundedRect(GAME_W / 2, field.top, half, fh, R.l);
      g.lineStyle(2, COLOR_N.border, 0.7).lineBetween(GAME_W / 2, field.top + HEAD_H - S.xs, GAME_W / 2, field.bottom - S.m);
    }
    // Ряды различаются фоном: светлая полоса за фронтом (ближе к врагу), без подписей «фронт / тыл».
    const colTop = band.top - S.xs;
    g.fillStyle(0xfff0d0, 0.05).fillRoundedRect(xs.front - this.slotW / 2 - S.xs, colTop, this.slotW + 2 * S.xs, field.bottom - S.xs - colTop, R.m);
    (opts.enemies ?? []).forEach((u, i) => u && this.enemySlots[i] && g.fillStyle(0x000000, 0.3).fillEllipse(this.enemySlots[i].x, this.enemySlots[i].y + 34, 140, 30));

    // Мощь: у этапа — powerCompare по центру над полем (своя · «Не хватает N» при нехватке: сравнение двух сторон),
    // у «Отряда» — «⚔ мощь» над своим отрядом.
    const headY = field.top + S.l;
    if (opts.showPower !== false && opts.chrome !== false) {
      if (opts.enemyPower !== undefined) {
        this.powerBox = powerCompare(scene, GAME_W / 2, headY, 0, opts.enemyPower, { align: 'center' }).setDepth(2);
      } else {
        const ico = scene.add.image(0, 0, skinIcon('swords')).setDisplaySize(48, 48).setTint(COLOR_N.title);
        this.powerText = text(scene, 0, 0, '', T.heading, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
        this.powerBox = scene.add.container(fieldX + S.m, headY, [ico, this.powerText]).setName('squadPower');
        ico.setX(24);
        this.powerText.setX(48 + S.xxs);
      }
    }
    if (vs) this.drawEnemies(opts.enemies ?? []);

    this.fieldLayer = scene.add.container(0, 0);

    // Строка под полем — только когда есть что сказать: предупреждение «стрелки во фронте» + «Переставить», пустой
    // отряд или короткая заметка (Авто). Постоянной инструкции нет.
    const tipY = opts.scrollBody ? formationBodyRows(field.bottom).warningY : field.bottom + 40;
    this.tip = text(scene, GAME_W / 2, tipY, '', T.caption, COLOR.textSecondary);
    this.fixBtn = button(scene, GAME_W - S.l - 150, tipY, 300, 84, '', 'Переставить', () => this.rearrange(), T.caption, { variant: 'secondary' });
    this.fixBtn.container.setName('rearrangeBtn');

    // --- Заголовок сетки (необязательно) ---
    if (opts.rosterHead) this.drawRosterHead(opts.rosterHead);

    // --- Сетка героев с прокруткой ---
    const { roster } = opts;
    this.selFrame = scene.add.graphics();
    this.rosterContent = scene.add.container(0, roster.top);
    if (!opts.scrollBody) {
      const mg = scene.make.graphics({}, false);
      mg.fillStyle(0xffffff).fillRect(0, roster.top, GAME_W, roster.bottom - roster.top);
      this.rosterContent.setMask(mg.createGeometryMask());
      // Видимая полоса классического списка.
      this.rosterContent.setData('clip', [roster.top, roster.bottom]);
    }
    this.thumb = scene.add.rectangle(GAME_W - S.xs, roster.top, 6, 40, COLOR_N.border, 0.9).setOrigin(0.5, 0).setVisible(false);

    this.highlight = scene.add.graphics().setDepth(4000);
    this.dragLayer = scene.add.container(0, 0).setDepth(5000);

    const input = scene.input;
    const down = (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => this.onDown(p, over);
    const move = (p: Phaser.Input.Pointer) => this.onMove(p);
    const up = (p: Phaser.Input.Pointer) => this.onUp(p);
    const wheel = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (opts.scrollBody) return;
      const w = worldPoint(scene, p);
      if (!this.locked && !this.gesture && this.inRoster(w.y)) this.scrollTo(this.scrollY + dy);
    };
    input.on('pointerdown', down);
    input.on('pointermove', move);
    input.on('pointerup', up);
    input.on('pointerupoutside', up);
    input.on('wheel', wheel);
    const autoScroll = (_time: number, delta: number) => {
      const body = opts.scrollBody?.area;
      if (!body || this.gesture?.mode !== 'drag' || !scene.input.activePointer.isDown) return;
      const w = worldPoint(scene, scene.input.activePointer);
      const [top, bottom] = body.content.getData('clip') as [number, number];
      const edge = 72;
      const dy = w.y < top + edge ? -1 : w.y > bottom - edge ? 1 : 0;
      if (!dy) return;
      const previous = body.offset;
      body.offset += dy * Math.min(30, delta * 0.75);
      if (body.offset !== previous) this.moveGhost(w);
    };
    if (opts.scrollBody) scene.events.on(Phaser.Scenes.Events.UPDATE, autoScroll);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      input.off('pointerdown', down);
      input.off('pointermove', move);
      input.off('pointerup', up);
      input.off('pointerupoutside', up);
      input.off('wheel', wheel);
      scene.events.off(Phaser.Scenes.Events.UPDATE, autoScroll);
      this.cancelGesture();
    });
    if (opts.scrollBody) {
      this.bodyContainer = scene.add.container(0, -opts.scrollBody.origin).setName('formationBody');
      opts.scrollBody.area.add(this.bodyContainer);
      this.addToBody(scene.children.list.filter(o => !before.has(o)));
      const mask = opts.scrollBody.area.content.mask;
      if (mask) {
        this.highlight.setMask(mask);
        this.dragLayer.setMask(mask);
      }
    }
  }

  /** Дополнения сцены (разведка, награды, кнопки ростера) используют ту же прокрутку и маску. */
  addToBody(objects: Phaser.GameObjects.GameObject[]): void {
    if (!this.bodyContainer || !this.opts.scrollBody) return;
    const outside = new Set([...this.opts.scrollBody.area.parts, this.bodyContainer, this.highlight, this.dragLayer]);
    this.bodyContainer.add(objects.filter(o => !outside.has(o)));
  }

  /** Resize отменяет незавершённый перенос, сохраняя выбранный пустой слот и состав. */
  setBodyBounds(top: number, bottom: number): void {
    this.cancelGesture();
    this.opts.scrollBody?.area.setBounds(top, bottom);
  }

  private bodyShift(): number {
    const body = this.opts.scrollBody;
    return body ? body.area.content.y - body.origin : 0;
  }

  private logicalPoint(p: Point): Point {
    return { x: p.x, y: p.y - this.bodyShift() };
  }

  private bodyContains(p: Point): boolean {
    const body = this.opts.scrollBody?.area;
    if (!body) return true;
    const [top, bottom] = body.content.getData('clip') as [number, number];
    return p.y >= top && p.y <= bottom;
  }

  private cancelGesture(): void {
    const gesture = this.gesture;
    this.gesture = null;
    gesture?.holdTimer?.remove();
    if (gesture) this.release(gesture);
    this.endDrag();
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

  /** «Герои» и кнопки-иконки «Авто» / «Пресеты» справа (opts.rosterHead). */
  private drawRosterHead(head: NonNullable<FormationOpts['rosterHead']>): void {
    const scene = this.scene;
    text(scene, S.l, head.y, head.title ?? 'Герои', T.heading, COLOR.title, { fontFamily: FAMILY.heading, fontStyle: 'bold' }).setOrigin(0, 0.5).setName('rosterTitle');
    let right = GAME_W - S.l;
    const add = (label: string, icon: string, name: string, onTap: () => void) => {
      // Ширина — по иконке и подписи с полями: длинная подпись («Пресеты», «Presets») не выходит за край экрана.
      const probe = text(scene, 0, 0, label, T.caption, COLOR.textPrimary, { fontStyle: 'bold' });
      const w = Math.max(210, Math.ceil(44 + S.xxs + probe.width + 2 * S.s));
      probe.destroy();
      const b = button(scene, right - w / 2, head.y, w, 88, '', label, onTap, T.caption, { variant: 'secondary' });
      const ico = scene.add.image(0, -2, icon).setDisplaySize(44, 44).setTint(COLOR_N.title);
      b.container.add(ico);
      // Иконка и подпись — одной группой по центру кнопки.
      const both = 44 + S.xxs + b.label.width;
      ico.setX(-both / 2 + 22);
      b.label.setX(-both / 2 + 44 + S.xxs + b.label.width / 2);
      b.container.setName(name);
      right -= w + S.xs;
    };
    // Справа налево: «Пресеты» у края, «Авто» левее.
    if (head.onPresets) add('Пресеты', 'prep_ico_presets', 'presetsBtn', head.onPresets);
    if (head.onAuto) add('Авто', 'prep_ico_auto', 'autoBtn', head.onAuto);
  }

  private drawEnemies(enemies: (UnitDef | null)[]): void {
    const scene = this.scene;
    enemies.forEach((u, i) => {
      const p = this.enemySlots[i];
      if (!u || !p) return;
      const boss = u.kind === 'boss';
      // Фигура в стойке, лицом к отряду (зеркально, как в бою). Имя и подробности — по касанию (экран этапа).
      unitFigure(scene, u.visual.sprite, p.x, p.y + 36, boss ? 130 : 110, {
        onReady: (o) => {
          this.bodyContainer?.add(o);
          o.setTint(unitTint(u.visual));
          if (o instanceof Phaser.GameObjects.Sprite) {
            o.setFlipX(true).setOrigin(1 - o.originX, o.originY);
            if (!juiceOn()) o.anims.pause();
          }
        },
      });
      // Уровень — числом справа от фигуры, на уровне груди, поверх фигуры; цвет — против уровня отряда.
      const level = this.opts.enemyLevels?.[i];
      if (level != null) {
        const t = this.levelLabel(p.x + (boss ? 66 : 58), p.y - 8, level).setName(`enemyLevel${i}`).setDepth(3);
        this.levelTexts.push({ t, level });
      }
    });
  }

  /** Число уровня растровым шрифтом (белые глифы с тёмной обводкой; цвет — tint). */
  private levelLabel(x: number, y: number, level: number): Phaser.GameObjects.BitmapText {
    return this.scene.add.bitmapText(x, y, this.font.key, String(level), Math.max(this.font.size, minimumFontSize())).setOrigin(0.5);
  }

  private drawSlots(): void {
    const scene = this.scene;
    const gen = this.gen;
    this.fieldLayer.removeAll(true);
    this.slotViews = [];
    const save = session.save;
    const w = this.slotW;
    const h = SLOT_H;
    // Пустые слоты один раз мягко пульсируют при открытии — если есть кого поставить.
    const pulse = !this.hinted && this.opts.hintEmpty !== false && juiceOn() && save.heroes.some((x) => !save.squad.includes(x.id));
    this.hinted = true;
    let popIndex = 0;
    save.squad.forEach((heroId, i) => {
      const p = this.slots[i];
      const hero = heroId ? save.heroes.find((x) => x.id === heroId) : undefined;
      const c = scene.add.container(p.x, p.y).setName(`slot${i}`);
      this.fieldLayer.add(c);
      this.slotViews.push(c);
      const sel = this.selected === i;
      const bg = hero
        ? plate(scene, 0, 0, w, h, { fill: COLOR.surfaceRaised, alpha: 0.92, border: rarityColor(hero.rarity), borderW: 4, r: R.m, hl: 0.1 })
        : plate(scene, 0, 0, w, h, { ...SURFACE.sunken, ...(sel ? { border: COLOR.accent, borderW: 4 } : {}), r: R.m });
      c.add(bg);
      this.tag(bg, { slot: i });
      if (!hero) {
        const plus = scene.add.image(0, 0, 'prep_plus').setDisplaySize(64, 64).setTint(sel ? COLOR_N.accent : COLOR_N.textTertiary).setAlpha(sel ? 1 : 0.7);
        c.add(plus);
        if (pulse) scene.tweens.add({ targets: c, scale: 1.05, duration: M.slow, delay: M.base + i * 60, yoyo: true, repeat: 1, ease: E.inOut });
        return;
      }
      unitFigure(scene, heroSprite(hero, GAME), 0, h / 2 - 24, 128, {
        onReady: (o) => {
          if (gen !== this.gen || !c.scene) {
            o.destroy();
            return;
          }
          c.addAt(o, 1);
          if (o instanceof Phaser.GameObjects.Sprite && !juiceOn()) o.anims.pause();
        },
      });
      // Уровень — маленьким числом в левом верхнем углу (цвет редкости — у рамки).
      c.add(this.levelLabel(-w / 2 + S.m, -h / 2 + S.s + 2, hero.level).setName('slotLevel'));
      if ((this.pop === i || this.popAll) && juiceOn()) {
        c.setScale(0.86);
        scene.tweens.add({ targets: c, scale: 1, duration: M.base, delay: this.popAll ? popIndex++ * 40 : 0, ease: E.pop });
      }
    });
    this.pop = null;
    this.popAll = false;
  }

  private drawRoster(): void {
    const scene = this.scene;
    this.rosterContent.removeAll(true);
    this.cardViews.clear();
    const save = session.save;
    const gctx = withGear(GAME, save);
    const power = (hero: HeroState) => heroPower(hero, gctx);
    const heroes = rosterOrder(rosterOneEach(save.heroes, save.squad, power), power);
    const x0 = GAME_W / 2 - ((COLS - 1) * (CARD_W + CARD_GAP)) / 2;
    const inset = 6;
    heroes.forEach((hero, i) => {
      const x = x0 + (i % COLS) * (CARD_W + CARD_GAP);
      const y = S.xs + CARD_H / 2 + Math.floor(i / COLS) * (CARD_H + CARD_GAP);
      const inSquad = save.squad.includes(hero.id);
      // Плитка: фон и рамка редкости, портрет, значок роли, уровень; в отряде — приглушена, с галкой.
      const back = scene.add.image(0, 0, backTexture(scene, hero.rarity)).setDisplaySize(CARD_W - 2 * inset, CARD_H - 2 * inset);
      this.tag(back, { hero: hero.id });
      const face = portrait(scene, 0, -12, portraitKey(heroSprite(hero, GAME)), CARD_W - 30);
      const frame = scene.add.image(0, 0, frameTexture(scene, hero.rarity, CARD_W, CARD_H));
      const role = scene.add.image(-CARD_W / 2 + 30, -CARD_H / 2 + 30, roleIconKey(formationRank(hero, GAME))).setDisplaySize(40, 40);
      const lvl = this.levelLabel(0, CARD_H / 2 - 30, hero.level);
      const parts: Phaser.GameObjects.GameObject[] = [back, face, frame, role, lvl];
      if (inSquad) {
        back.setTint(0x6a6a6a);
        face.setAlpha(0.4);
        role.setAlpha(0.5);
        parts.push(scene.add.image(CARD_W / 2 - 30, -CARD_H / 2 + 30, 'prep_check').setDisplaySize(44, 44).setName('inSquad'));
      }
      const c = scene.add.container(x, y, parts).setName(`rosterCard_${hero.id}`);
      this.rosterContent.add(c);
      this.cardViews.set(hero.id, c);
    });
    const rows = Math.ceil(heroes.length / COLS);
    this.rosterH = rows ? 2 * S.xs + rows * CARD_H + (rows - 1) * CARD_GAP : 0;
    this.scrollTo(this.scrollY);
    if (this.opts.scrollBody) this.opts.scrollBody.area.setContentHeight(Math.max(this.opts.roster.top + this.rosterH, this.opts.field.bottom + 140) - this.opts.scrollBody.origin + S.m);
    // Выбран пустой слот — сетка подсвечена рамкой акцента: следующий герой встанет туда.
    const r = this.opts.roster;
    this.selFrame.clear();
    if (this.selected !== null) this.selFrame.lineStyle(4, COLOR_N.accent, 0.7).strokeRoundedRect(S.xs, r.top - S.xxs, GAME_W - 2 * S.xs, (this.opts.scrollBody ? this.rosterH : r.bottom - r.top) + 2 * S.xxs, R.l);
  }

  /** Мощь (отсчёт от прежней), «нужен уровень» при нехватке, предупреждение «дальний бой во фронте». */
  private refreshInfo(): void {
    const save = session.save;
    const mine = squadPower(save, GAME);
    const prev = this.shownPower;
    this.shownPower = mine;
    for (const { t, level } of this.levelTexts) t.setTint(Phaser.Display.Color.HexStringToColor(enemyLevelColor(level, save)).color);
    const enemy = this.opts.enemyPower;
    if (this.powerBox && enemy !== undefined) {
      updatePowerCompare(this.powerBox, mine, enemy);
    } else if (this.powerText) {
      countUp(this.scene, this.powerText, prev ?? mine, mine, (n) => groupDigits(n), { duration: 400 });
    }
    if (this.powerBox && prev !== null && prev !== mine) bump(this.scene, this.powerBox, 1.06);

    const misplaced = misplacedInFront(save, GAME);
    this.fixBtn.container.setVisible(misplaced.length > 0);
    if (misplaced.length) {
      const names = misplaced.map((id) => {
        const h = save.heroes.find((x) => x.id === id);
        return h ? heroName(h, GAME) : id;
      });
      this.tip.setText(`${names.join(', ')} во фронте — дальнему бою место в тылу`).setColor(C.warning).setX(S.l).setOrigin(0, 0.5);
      ellipsize(this.tip, GAME_W - 2 * S.l - 300 - S.s);
      return;
    }
    // RR-17: «Отряд расставлен автоматически» — строкой под полем на пару секунд, а не тостом на названии этапа.
    const note = this.note && this.scene.time.now < this.note.until ? this.note.text : null;
    const empty = !save.squad.some(Boolean);
    // Сил не хватает — какие нужны герои (§3 правило 11: требование — только при нехватке).
    const rec = this.opts.chrome !== false && this.opts.recommend && enemy !== undefined && powerTone(mine, enemy) !== 'ahead' ? recommendText(this.opts.recommend) : '';
    const msg = note ?? (empty ? 'Поставьте в отряд хотя бы одного героя' : rec);
    this.tip.setText(msg).setColor(note ? COLOR.positive : COLOR.warning).setX(GAME_W / 2).setOrigin(0.5).setName(rec && msg === rec ? 'stageRecommend' : '');
    ellipsize(this.tip, GAME_W - 2 * S.l);
  }

  // ---------- прокрутка ----------

  private get rosterView(): number {
    return this.opts.roster.bottom - this.opts.roster.top;
  }

  private get scrollable(): boolean {
    return this.rosterH > this.rosterView;
  }

  private scrollTo(v: number): void {
    if (this.opts.scrollBody) {
      this.scrollY = 0;
      this.rosterContent.y = this.opts.roster.top;
      this.thumb.setVisible(false);
      return;
    }
    const max = Math.max(0, this.rosterH - this.rosterView);
    this.scrollY = Phaser.Math.Clamp(v, 0, max);
    this.rosterContent.y = this.opts.roster.top - this.scrollY;
    this.thumb.setVisible(this.scrollable);
    if (!this.scrollable) return;
    const view = this.rosterView;
    const th = Math.max(60, (view * view) / this.rosterH);
    this.thumb.setSize(6, th).setY(this.opts.roster.top + (view - th) * (this.scrollY / max));
  }

  private inRoster(y: number): boolean {
    return y >= this.opts.roster.top && y <= (this.opts.scrollBody ? this.opts.roster.top + this.rosterH : this.opts.roster.bottom);
  }

  // ---------- жесты: нажатие, перетаскивание, прокрутка ----------

  private tag(o: Phaser.GameObjects.NineSlice | Phaser.GameObjects.Image, tag: Tag): void {
    o.setInteractive({ useHandCursor: true });
    o.setData('prep', tag);
  }

  private onDown(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    if (this.locked || this.gesture || this.opts.scrollBody?.area.locked) return;
    const w = worldPoint(this.scene, p);
    if (!this.bodyContains(w)) return;
    const at = this.logicalPoint(w);
    // Верхний объект под пальцем: наш слот/карточка — жест наш; кнопка или окно поверх — не наш.
    const tag = over[0]?.getData?.('prep') as Tag | undefined;
    let g: Gesture | null = null;
    const base = { x0: w.x, y0: w.y, t0: p.downTime || this.scene.time.now, scroll0: this.opts.scrollBody?.area.offset ?? this.scrollY, mode: 'pending' as const, press: null, holdTimer: null };
    if (tag && 'slot' in tag) g = { ...base, kind: 'slot', slot: tag.slot, heroId: session.save.squad[tag.slot] ?? null, press: this.slotViews[tag.slot] ?? null };
    else if (tag && 'hero' in tag && this.inRoster(at.y)) g = { ...base, kind: 'card', slot: -1, heroId: tag.hero, press: this.cardViews.get(tag.hero) ?? null };
    else if (!over.length && this.inRoster(at.y)) g = { ...base, kind: 'list', slot: -1, heroId: null };
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
      if (g.kind === 'list' || (!g.heroId && this.opts.scrollBody)) {
        if (Math.hypot(dx, dy) > 14) {
          g.mode = 'scroll';
          this.release(g);
        }
      } else if (g.heroId) {
        // Мышью герой переносится сразу; вертикальный жест пальцем сначала листает тело.
        const m = (g.kind === 'slot' && !this.opts.scrollBody) || (this.opts.scrollBody && !p.wasTouch)
          ? (Math.hypot(dx, dy) >= 16 ? 'drag' : 'pending')
          : classifyGesture({ dx, dy, heldMs: 0 }, { scrollable: this.opts.scrollBody?.area.scrollable ?? this.scrollable, leftList: !this.opts.scrollBody && w.y < this.opts.roster.top });
        if (m === 'drag') this.startDrag(g, p);
        else if (m === 'scroll') {
          g.mode = 'scroll';
          this.release(g);
        }
      }
    }
    if (g.mode === 'scroll') {
      if (this.opts.scrollBody) return;
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
    if (!this.bodyContains(w)) {
      this.endDrag();
      return;
    }
    const moved = Math.hypot(w.x - g.x0, w.y - g.y0);
    if (g.mode === 'pending' || (g.mode === 'drag' && moved < 16)) {
      this.endDrag();
      if (g.kind === 'slot') this.tapSlot(g.slot);
      else if (g.kind === 'card' && g.heroId) this.tapCard(g.heroId);
      return;
    }
    if (g.mode !== 'drag') return;
    // Цель — там, где призрак героя (он над пальцем), а не под самим пальцем.
    const at = this.logicalPoint({ x: w.x, y: w.y - GHOST_LIFT });
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
    if (this.opts.scrollBody) {
      const area = this.opts.scrollBody.area;
      area.offset = g.scroll0;
      area.locked = true;
      this.bodyDragLocked = true;
      const [top, bottom] = area.content.getData('clip') as [number, number];
      // Сбрасываем начавшуюся прокрутку: теперь удерживаем героя, а не двигаем тело.
      area.setBounds(top, bottom);
    }
    this.selected = null;
    this.selFrame.clear();
    const scene = this.scene;
    // Источник приглушаем: видно, откуда взят герой.
    g.press?.setAlpha(0.4);
    const ring = scene.add.circle(0, 0, GHOST_SIZE / 2 + 6, COLOR_N.surfaceSunken, 0.92).setStrokeStyle(6, Phaser.Display.Color.HexStringToColor(rarityColor(hero.rarity)).color);
    const face = portrait(scene, 0, 0, portraitKey(heroSprite(hero, GAME)), GHOST_SIZE);
    this.ghost = scene.add.container(0, 0, [ring, face]);
    this.dragLayer.add(this.ghost);
    const w = worldPoint(scene, p);
    this.ghost.setPosition(w.x, w.y - GHOST_LIFT);
    if (juiceOn()) {
      this.ghost.setScale(0.7);
      scene.tweens.add({ targets: this.ghost, scale: 1, duration: M.fast, ease: E.pop });
    }
    this.moveGhost(w);
  }

  private moveGhost(w: Point): void {
    const g = this.gesture;
    if (!this.ghost || !g) return;
    this.ghost.setPosition(w.x, w.y - GHOST_LIFT);
    const shift = this.bodyShift();
    const hover = hitSlot(this.slots, this.slotW, SLOT_H, this.logicalPoint({ x: w.x, y: w.y - GHOST_LIFT }), SNAP);
    if (hover === this.hover && shift === this.highlightShift && this.highlight.visible) return;
    this.hover = hover;
    this.highlightShift = shift;
    // Подсветка: все слоты — куда можно бросить; под пальцем — ярко; дальний бой над фронтом — оранжевым.
    const hero = session.save.heroes.find((h) => h.id === g.heroId);
    const rank = hero ? formationRank(hero, GAME) : 0;
    const hl = this.highlight.clear().setVisible(true);
    const sw = this.slotW;
    this.slots.forEach((s, i) => {
      if (i === g.slot) return;
      const on = i === hover;
      const bad = on && i < 2 && rank >= 2;
      const col = bad ? COLOR_N.warning : COLOR_N.accent;
      if (on) hl.fillStyle(col, 0.18).fillRoundedRect(s.x - sw / 2, s.y + shift - SLOT_H / 2, sw, SLOT_H, R.m);
      hl.lineStyle(on ? 6 : 3, col, on ? 1 : 0.45).strokeRoundedRect(s.x - sw / 2, s.y + shift - SLOT_H / 2, sw, SLOT_H, R.m);
    });
    // Из слота — в список: «убрать».
    if (g.kind === 'slot') {
      const r = this.opts.roster;
      const height = this.opts.scrollBody ? this.rosterH : r.bottom - r.top;
      hl.fillStyle(0x000000, 0.35).fillRoundedRect(S.xs, r.top + shift, GAME_W - 2 * S.xs, height, R.l);
      hl.lineStyle(4, COLOR_N.negative, 0.8).strokeRoundedRect(S.xs, r.top + shift, GAME_W - 2 * S.xs, height, R.l);
      if (!this.dropHint) {
        this.dropHint = text(this.scene, GAME_W / 2, r.top + shift + Math.min(height / 2, 100), 'Убрать из отряда', T.heading, COLOR.negative, { fontStyle: 'bold' });
        this.dropHint.setShadow(0, 2, 'rgba(0,0,0,0.8)', 4, false, true);
        this.dragLayer.addAt(this.dropHint, 0);
      }
      this.dropHint.setY(r.top + shift + Math.min(height / 2, 100));
    }
    if (hover >= 0 && hover !== g.slot) this.slotViews[hover]?.setScale(1.04);
    this.slotViews.forEach((v, i) => i !== hover && v.scene && v.setScale(1));
  }

  private endDrag(): void {
    if (this.bodyDragLocked && this.opts.scrollBody) this.opts.scrollBody.area.locked = false;
    this.bodyDragLocked = false;
    this.ghost?.destroy();
    this.ghost = null;
    this.dropHint?.destroy();
    this.dropHint = null;
    if (this.highlight.scene) this.highlight.clear().setVisible(false);
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
    sfx('ui_toggle');
    haptic('tap');
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
      if (r.reason === 'last' || r.reason === 'full') haptic('error');
      this.draw();
      return;
    }
    // Одна копия каждой карточки в отряде (ядро: duplicate_card).
    if (duplicateCardsInSquad(session.save, r.squad).length) {
      toast(this.scene, 'Эта карточка уже в отряде — можно взять только одну копию');
      haptic('error');
      this.draw();
      return;
    }
    commit({ ...session.save, squad: r.squad });
    // Рутина — тихо (§3 правило 10): щелчок, лёгкая вибрация и подскок слота.
    sfx('ui_toggle');
    haptic('tap');
    this.pop = popSlot;
    this.draw();
  }

  /** T1-20: тот же состав по ролям — танки и ближний бой вперёд, стрелки и лекари в тыл. */
  rearrange(): void {
    commit({ ...session.save, squad: arrangeSquad(session.save, GAME) });
    this.selected = null;
    this.popAll = true;
    haptic('tap');
    this.draw();
    toast(this.scene, 'Отряд переставлен: дальний бой и лекари — в тылу');
  }

  /** Отряд целиком заменён снаружи (авто, пресет) — перерисовать; герои «запрыгивают» в слоты. */
  replaced(note?: string): void {
    this.selected = null;
    this.popAll = true;
    haptic('tap');
    if (note) {
      const until = this.scene.time.now + NOTE_MS;
      this.note = { text: note, until };
      // Подсказка вернётся к обычной, когда заметка отжила (если за это время ничего не менялось).
      this.scene.time.delayedCall(NOTE_MS + 20, () => {
        if (this.note?.until === until && this.tip.scene) this.refreshInfo();
      });
    }
    this.draw();
  }
}

/** Мощь «34 617» (пробелы по разрядам). */
function groupDigits(n: number): string {
  return Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Растровый шрифт чисел уровня (numberFont.ts): белый жирный T.caption с тёмной обводкой; цвет — tint. */
function levelFont(scene: Phaser.Scene): NumberFont {
  const style: CachedTextStyle = { fontFamily: FAMILY.body, fontSize: `${T.caption}px`, color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 6, fontStyle: 'bold' };
  const probe = scene.add.text(0, 0, '', { fontFamily: FAMILY.body, align: 'center' }).setVisible(false).setActive(false);
  const font = numberFont(scene, style, probe);
  probe.destroy();
  return font;
}

// ---------- значки ----------

const roleIconKey = (rank: number) => `prep_role_${RANK_ICON[Math.max(0, Math.min(3, rank))]}`;

type Ctx2D = CanvasRenderingContext2D;

function canvasIcon(scene: Phaser.Scene, key: string, size: number, draw: (c: Ctx2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const c = tex.getContext();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  draw(c);
  tex.refresh();
}

/** Щит / меч / лук / крест — символы ролей в квадрате 64 (цвет и толщина — снаружи). */
function roleGlyph(c: Ctx2D, kind: (typeof RANK_ICON)[number]): void {
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
}

/**
 * Текстуры подготовки рисуются кодом один раз на игру: значки ролей (кружок с бронзовой рамкой и символом),
 * «+» пустого слота, галка «в отряде»,
 * иконки кнопок «Авто» (палочка) и «Пресеты» (закладка).
 */
function ensurePrepTextures(scene: Phaser.Scene): void {
  const S64 = 64;
  const colors: Record<(typeof RANK_ICON)[number], string> = { tank: '#7fb2ff', melee: '#ff8f6a', ranged: '#9fe07a', healer: '#fff2a8' };
  for (const kind of RANK_ICON) {
    canvasIcon(scene, `prep_role_${kind}`, S64, (c) => {
      c.fillStyle = '#1a1510';
      c.strokeStyle = '#d6ae63';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(S64 / 2, S64 / 2, S64 / 2 - 3, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = colors[kind];
      c.strokeStyle = colors[kind];
      c.lineWidth = 5;
      roleGlyph(c, kind);
    });
  }
  canvasIcon(scene, 'prep_plus', S64, (c) => {
    c.strokeStyle = '#ffffff';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(32, 14);
    c.lineTo(32, 50);
    c.moveTo(14, 32);
    c.lineTo(50, 32);
    c.stroke();
  });
  canvasIcon(scene, 'prep_check', S64, (c) => {
    c.fillStyle = '#1f5a24';
    c.strokeStyle = '#b6f0a0';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(32, 32, 28, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.strokeStyle = '#eaffe0';
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(19, 33);
    c.lineTo(28, 42);
    c.lineTo(45, 23);
    c.stroke();
  });
  // Палочка со звёздочкой («Авто»).
  canvasIcon(scene, 'prep_ico_auto', S64, (c) => {
    c.strokeStyle = '#ffffff';
    c.fillStyle = '#ffffff';
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(12, 52);
    c.lineTo(38, 26);
    c.stroke();
    const star = (x: number, y: number, r: number) => {
      c.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        const rr = i % 2 ? r * 0.38 : r;
        c.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      c.closePath();
      c.fill();
    };
    star(46, 18, 13);
    star(22, 16, 6);
    star(52, 42, 6);
  });
  // Закладка («Пресеты»).
  canvasIcon(scene, 'prep_ico_presets', S64, (c) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(18, 8);
    c.lineTo(46, 8);
    c.lineTo(46, 56);
    c.lineTo(32, 44);
    c.lineTo(18, 56);
    c.closePath();
    c.fill();
  });
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

/** Размеры сетки героев (для раскладки сцен): ширина и высота плитки, зазор, колонок. */
export const ROSTER_GRID = { cols: COLS, cardW: CARD_W, cardH: CARD_H, gap: CARD_GAP } as const;
