import Phaser from 'phaser';
import {
  actClimbTower,
  actPlayStage,
  buildUnit,
  COMBAT,
  enemySquad,
  getStage,
  simulateBattle,
  towerFloor,
  withGear,
  type BattleEvent,
  type BattleResult,
  type SaveState,
  type StageOutcomeWithDrops,
  type TowerOutcome,
  type UnitDef,
  type UnitSnapshot,
} from '../../core';
import type { AnimName } from '../../pipeline/sprites';
import { CONTENT, GAME } from '../content';
import { stageSeed } from '../flow';
import { commit, now, session, today } from '../session';
import { GAME_W } from '../layout';
import { SKIN, SKIN_TINT } from '../skin';
import { anim, hitDelay, spriteView, whenSprites, type SpriteView } from '../sprites';
import { clampDelta } from '../lifecycle';
import { nextPlaybackSpeed, playback, setPlaybackSpeed, squads } from '../state';
import { DEPTH, FloatLayer, UltPresenter } from '../battleFx';
import { button, panel, text } from '../ui';
import { ease, Scheduler } from '../perf';
import { unitTint } from '../screen';
import { skillFx } from '../animatedFx';

/** Полоски компактные: у сошедшихся в ближнем бою пар они не должны касаться. */
const BAR_W = 124;
/** Полоски и имя сдвинуты к «своему тылу» (A — влево, B — вправо), чтобы у пары в ближнем бою не наезжали. */
const UI_SHIFT = 18;
/** Цифры урона: не больше стольких в столбике над одним юнитом, шаг столбика, подъём. */
const FLOAT_SLOTS = 3;
const FLOAT_STEP = 46;
const FLOAT_RISE = 36;
/** Сколько мс место в столбике считается занятым. */
const FLOAT_SLOT_MS = 420;
/** Белый «след» полоски HP: пауза и время догоняющего сжатия. */
const TRAIL_DELAY = 250;
const TRAIL_MS = 450;
/** Полёт снаряда, мс на 1x. */
const PROJECTILE_MS = 220;
/** «Получил урон» не чаще, чем раз в столько мс, и не перебивает атаку. */
const HURT_COOLDOWN = 500;
/** Красная вспышка при попадании, мс на 1x. */
const HURT_TINT_MS = 90;
/** Баннер босса: появление, показ, угасание (мс на 1x). Бой стоит, пока баннер на экране (без угасания). */
const BOSS_IN_MS = 220;
const BOSS_HOLD_MS = 1100;
const BOSS_OUT_MS = 400;
/** Баннер босса — полосой через центр поля: кнопки скорости и «Пропустить» (y≈360) не закрывает. */
const BOSS_BANNER_Y = 780;
/** Полоска HP босса под верхней панелью (над кнопками). */
const BOSS_BAR_Y = 282;
const BOSS_BAR_W = 700;

interface UnitView {
  snap: UnitSnapshot;
  def: UnitDef;
  spriteId: string;
  look: SpriteView;
  node: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Image;
  /** Белый след под HP: показывает только что снятое здоровье и плавно догоняет. */
  trailBar: Phaser.GameObjects.Image;
  trail: number;
  /** След догоняет HP: откуда, куда и сколько мс прошло (−1 — стоит). Считается в update, без твина на каждый удар. */
  trailFrom: number;
  trailTo: number;
  trailT: number;
  /** Сколько мс ещё держать красный оттенок попадания (0 — нет). */
  tintLeft: number;
  /** Смещение подписи с именем от точки ног (y). */
  nameY: number;
  /** Столбик цифр: до какого времени занято каждое место. */
  floatSlots: number[];
  /** Юнит кастует ульту (до своей следующей обычной атаки) — его удары подсвечиваются. */
  inUlt: boolean;
  shieldBar: Phaser.GameObjects.Image;
  energyBar: Phaser.GameObjects.Image;
  /** Полоса каста (на месте энергии): видна, пока юнит колдует. */
  castBar: Phaser.GameObjects.Image;
  castBack: Phaser.GameObjects.Image;
  /** Идёт каст: начало и длительность в секундах боя. */
  cast: { start: number; dur: number } | null;
  /** Навык текущего действия (для эффекта попадания). */
  lastSkill?: string;
  bars: Phaser.GameObjects.Components.Visible[];
  hp: number;
  shield: number;
  energy: number;
  alive: boolean;
  /** Время сцены (мс), когда удар текущего действия юнита достигнет цели. */
  impactAt: number;
  /** Идёт разовая анимация (атака, каст, смерть) — стойка/ходьба её не перебивают. */
  busyUntil: number;
  lastHurt: number;
  moveTween: Phaser.Tweens.Tween | null;
}

/** Тестовый бой (отряды экрана подготовки), этап кампании или этаж башни (отряд из сохранения). */
export type BattleData = { mode?: 'test'; seed: number } | { mode: 'stage'; stageId: string } | { mode: 'tower' };

/** Что получает экран итогов. */
export interface ResultData {
  result: BattleResult;
  /** Описания юнитов боя по unitId (у героев игрока и врагов этапа их нет в CONTENT.units). */
  defs: Record<string, UnitDef>;
  /** Только для этапа: итог с новым сохранением, событиями прогрессии и выпавшими предметами. skipped — бой пропущен (K7). */
  stage?: { stageId: string; outcome: StageOutcomeWithDrops; skipped?: boolean };
  /** Только для башни: какой этаж штурмовали и итог. */
  tower?: { floor: number; outcome: TowerOutcome };
}

/** Герои отряда с экипировкой — описания для боя и экрана итогов. */
export function squadDefs(save: SaveState): Record<string, UnitDef> {
  const ctx = withGear(GAME, save);
  const defs: Record<string, UnitDef> = {};
  for (const h of save.heroes) if (save.squad.includes(h.id)) defs[h.id] = buildUnit(h, ctx);
  return defs;
}

export class BattleScene extends Phaser.Scene {
  private result!: BattleResult;
  private defs: Record<string, UnitDef> = {};
  private stage?: ResultData['stage'];
  private tower?: ResultData['tower'];
  private committed = false;
  private views = new Map<string, UnitView>();
  private cursor = 0;
  private clock = 0;
  /** Какие пассивки уже подписывали в этом бою (unit:skill). */
  private shownPassives = new Set<string>();
  private finished = false;
  private timeText!: Phaser.GameObjects.Text;
  /** Последняя показанная секунда таймера — текст перерисовываем раз в секунду, а не каждый кадр. */
  private shownSec = -1;
  private ult!: UltPresenter;
  private floats!: FloatLayer;
  /** Сколько мс (с учётом скорости) бой ещё стоит ради баннера босса. */
  private introLeft = 0;
  /** Полоска HP босса наверху (только на босс-этапе). */
  private bossBar: { uid: string; fill: Phaser.GameObjects.Image } | null = null;
  /** Отложенные действия боя (момент удара, вылет снаряда) — своя очередь вместо таймера Phaser на каждый удар. */
  private readonly later = new Scheduler();
  /**
   * U: листы юнитов загружены и сцена построена. До этого бой не идёт (часы стоят), кнопок ещё нет.
   * Публичное — e2e/perf ждут готовности.
   */
  ready = false;

  constructor() {
    super('Battle');
  }

  create(data: BattleData): void {
    // Выключение сцены: забыть юнитов и пулы (объекты, твины и таймеры Phaser убирает сам). once — без накопления слушателей.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.views.clear();
    this.later.clear();
    this.shownSec = -1;
    this.cursor = 0;
    this.clock = 0;
    this.shownPassives.clear();
    this.finished = false;
    this.committed = false;
    this.ready = false;
    this.introLeft = 0;
    this.bossBar = null;
    let title = 'Тестовый бой';
    this.stage = undefined;
    this.tower = undefined;
    if (data.mode === 'stage') {
      // Бой считает ядро (actPlayStage: экипировка, выпадение, задания); сцена только проигрывает лог.
      // Сохраняем, когда бой закончится.
      const save = session.save;
      let outcome: StageOutcomeWithDrops;
      try {
        outcome = actPlayStage(save, today(), data.stageId, stageSeed(save), GAME, now());
      } catch (e) {
        console.warn(e);
        this.finished = true;
        this.scene.start('Campaign');
        return;
      }
      this.result = outcome.result;
      this.stage = { stageId: data.stageId, outcome };
      this.defs = squadDefs(save);
      for (const u of enemySquad(data.stageId, GAME)) if (u) this.defs[u.id] = u;
      const st = getStage(GAME, data.stageId);
      title = `Этап ${st.globalIndex + 1}. ${st.name}`;
    } else if (data.mode === 'tower') {
      const save = session.save;
      let outcome: TowerOutcome;
      try {
        outcome = actClimbTower(save, today(), stageSeed(save), GAME);
      } catch (e) {
        console.warn(e);
        this.finished = true;
        this.scene.start('Tower');
        return;
      }
      this.result = outcome.result;
      this.tower = { floor: outcome.floor, outcome };
      this.defs = squadDefs(save);
      for (const u of towerFloor(outcome.floor, GAME).enemies) if (u) this.defs[u.id] = u;
      title = `Башня · этаж ${outcome.floor}`;
    } else {
      this.result = simulateBattle(CONTENT, squads.A, squads.B, data.seed);
      this.stage = undefined;
      this.defs = CONTENT.units;
    }

    // U: листы только этого боя — грузятся по требованию (уже в кэше — строим сразу, в этом же кадре).
    const sprites = this.result.units.map((u) => this.defs[u.unitId].visual.sprite);
    whenSprites(this, sprites, () => this.build(title));
  }

  private build(title: string): void {
    this.ready = true;
    this.add.image(GAME_W / 2, 960, this.textures.exists('skin_bg_battle') ? 'skin_bg_battle' : 'bg_arena').setDisplaySize(GAME_W, 1920);
    panel(this, GAME_W / 2, 130, 760, 200, 'ui_panel');
    text(this, GAME_W / 2, 85, title, title.length > 20 ? 42 : 52, '#ffe9a8', { fontStyle: 'bold', stroke: '#3a2412', strokeThickness: 8 });
    this.timeText = text(this, GAME_W / 2, 150, '', 40, '#ffffff', { stroke: '#000000', strokeThickness: 5 });
    text(this, GAME_W / 2, 195, `seed ${this.result.seed}`, 22, '#e0cfb0');

    const speedBtn = button(this, 180, 360, 280, 110, 'ui_btn_speed', `${playback.speed}x`, () => {
      // Выбор скорости запоминается (localStorage) и действует в следующих боях.
      setPlaybackSpeed(nextPlaybackSpeed());
      speedBtn.setLabel(`${playback.speed}x`);
      for (const v of this.views.values()) v.sprite.anims.timeScale = playback.speed;
      this.tweens.timeScale = playback.speed;
      this.time.timeScale = playback.speed;
    });
    button(this, 900, 360, 280, 110, 'ui_btn_skip', 'Пропустить', () => this.skip());
    // Вся анимация (твины, задержки) идёт в темпе выбранной скорости.
    this.tweens.timeScale = playback.speed;
    this.time.timeScale = playback.speed;

    this.ult = new UltPresenter(this);
    this.floats = new FloatLayer(this);
    for (const u of this.result.units) this.buildUnit(u);
    if (this.stage && getStage(GAME, this.stage.stageId).boss) this.bossIntro();
  }

  /**
   * Босс-этап: крупный баннер «имя босса · Босс главы» (скин «тёмная бронза», золото) на ~1.5 с, затем угасает;
   * наверху — полоска HP босса. Баннер без интерактива: кнопки («Пропустить», скорость) работают сквозь показ.
   */
  private bossIntro(): void {
    const boss = this.result.units.find((u) => u.side === 'B' && this.defs[u.unitId]?.kind === 'boss');
    if (!boss) return;
    const name = this.defs[boss.unitId].name;

    const barX = GAME_W / 2 - BOSS_BAR_W / 2;
    this.add.image(GAME_W / 2, BOSS_BAR_Y, 'ui_bar_back').setDisplaySize(BOSS_BAR_W + 12, 46);
    const fill = this.add.image(barX, BOSS_BAR_Y, 'ui_bar_hp_enemy').setOrigin(0, 0.5).setDisplaySize(BOSS_BAR_W, 34);
    text(this, GAME_W / 2, BOSS_BAR_Y, name, 28, SKIN.goldLight, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 });
    this.bossBar = { uid: boss.uid, fill };
    const v = this.views.get(boss.uid);
    if (v) this.redraw(v);

    const w = 960;
    const h = 300;
    const band = this.add.rectangle(0, 0, GAME_W, h + 80, 0x000000, 0.55);
    const bg = this.textures.exists('skin_btn_active')
      ? panel(this, 0, 0, w, h, 'skin_btn_active')
      : this.add.rectangle(0, 0, w, h, 0x1d1914, 0.95).setStrokeStyle(6, SKIN_TINT.gold);
    const inner = this.add.rectangle(0, 0, w - 36, h - 36).setStrokeStyle(2, SKIN_TINT.gold, 0.5);
    const title = text(this, 0, -34, name.toUpperCase(), 104, SKIN.goldLight, { fontStyle: 'bold', stroke: '#2a1a08', strokeThickness: 12 });
    if (title.width > w - 80) title.setScale((w - 80) / title.width);
    const sub = text(this, 0, 82, 'Босс главы', 44, SKIN.cream, { stroke: '#000000', strokeThickness: 6 });
    const lineW = 150;
    const gap = sub.width / 2 + 30;
    const lines = [-1, 1].map((d) => this.add.rectangle(d * (gap + lineW / 2), 82, lineW, 4, SKIN_TINT.gold));
    const node = this.add
      .container(GAME_W / 2, BOSS_BANNER_Y, [band, bg, inner, title, sub, ...lines])
      .setDepth(DEPTH.banner + 10)
      .setAlpha(0)
      .setScale(1.15)
      .setName('bossBanner');
    this.introLeft = BOSS_IN_MS + BOSS_HOLD_MS;
    this.cameras.main.shake(260, 0.004);
    this.tweens.chain({
      targets: node,
      tweens: [
        { alpha: 1, scale: 1, duration: BOSS_IN_MS, ease: 'Back.easeOut' },
        { alpha: 1, duration: BOSS_HOLD_MS },
        { alpha: 0, duration: BOSS_OUT_MS, ease: 'Quad.easeIn' },
      ],
      onComplete: () => node.destroy(),
    });
  }

  private buildUnit(snap: UnitSnapshot): void {
    const def = this.defs[snap.unitId];
    const spriteId = def.visual.sprite;
    // visual.scale — крупнее фигура (и выше подпись/полоски): босс на листе обычного монстра.
    const base = spriteView(this, spriteId);
    const k = def.visual.scale ?? 1;
    const look = k === 1 ? base : { ...base, size: base.size * k, height: base.height * k };
    // Отражение идёт от середины клетки, а якорь ног не в середине: у отражённого — зеркальный origin, иначе фигура
    // уезжает от своих полосок (у поринга ×2 — заметно).
    const flip = snap.side === 'B' && look.art;
    const sprite = this.add.sprite(0, 0, look.key, 0).setOrigin(flip ? 1 - look.originX : look.originX, look.originY);
    sprite.setScale(look.size / sprite.frame.height).setFlipX(flip).setTint(unitTint(def.visual));
    sprite.anims.timeScale = playback.speed;

    const ox = snap.side === 'A' ? -UI_SHIFT : UI_SHIFT;
    const bar = (y: number, texId: string, h: number) => this.add.image(ox - BAR_W / 2, y, texId).setOrigin(0, 0.5).setDisplaySize(BAR_W, h);
    const hpTex = snap.side === 'A' ? 'ui_bar_hp_ally' : 'ui_bar_hp_enemy';
    const barBack = this.add.image(ox, 14, 'ui_bar_back').setDisplaySize(BAR_W + 6, 20);
    const trailBar = bar(14, hpTex, 14).setTintFill(0xffffff);
    const hpBar = bar(14, hpTex, 14);
    const shieldBar = bar(8, 'ui_bar_shield', 5).setVisible(false);
    const energyBack = this.add.image(ox, 32, 'ui_bar_back').setDisplaySize(BAR_W + 6, 12);
    const energyBar = bar(32, 'ui_bar_energy', 8);
    // Энергия нужна только тем, у кого есть ульта (монстры, боссы); герои применяют навыки по перезарядке.
    const hasUlt = !!def.skills.ult;
    energyBack.setVisible(hasUlt);
    energyBar.setVisible(hasUlt);
    const castBack = this.add.image(ox, 34, 'ui_bar_back').setDisplaySize(BAR_W + 6, 18).setVisible(false);
    const castBar = bar(34, 'ui_bar_energy', 12).setTintFill(0xc7a4ff).setVisible(false);
    // Подпись — сразу над макушкой (высота фигуры в стойке из bbox листа), со сдвигом к своему тылу.
    const nameY = -look.height - 22;
    const name = text(this, ox, nameY, def.name, 23, '#ffffff', { stroke: '#000000', strokeThickness: 5 });
    const bars = [barBack, trailBar, hpBar, shieldBar, ...(hasUlt ? [energyBack, energyBar] : []), name];
    const node = this.add.container(snap.x, snap.y, [sprite, ...bars, castBack, castBar]).setDepth(snap.y);

    const v: UnitView = {
      snap,
      def,
      spriteId,
      look,
      node,
      sprite,
      hpBar,
      trailBar,
      trail: 1,
      trailFrom: 1,
      trailTo: 1,
      trailT: -1,
      tintLeft: 0,
      nameY,
      floatSlots: new Array<number>(FLOAT_SLOTS).fill(0),
      inUlt: false,
      shieldBar,
      energyBar,
      castBar,
      castBack,
      cast: null,
      bars,
      hp: snap.maxHp,
      shield: 0,
      energy: 0,
      alive: true,
      impactAt: 0,
      busyUntil: 0,
      lastHurt: -Infinity,
      moveTween: null,
    };
    this.views.set(snap.uid, v);
    // Разовая анимация закончилась — вернуться к стойке/ходьбе. Один слушатель на юнита, а не на каждую атаку.
    sprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (v.alive) this.loop(v, v.moveTween ? 'walk' : v.cast ? 'cast' : 'idle');
    });
    this.loop(v, 'idle');
    this.redraw(v);
  }

  update(_time: number, rawDelta: number): void {
    if (!this.ready) return;
    // U: после паузы/подвисания бой не «прыгает» вперёд — шаг не больше MAX_FRAME_MS.
    const delta = clampDelta(rawDelta);
    // Лёгкие анимации (цифры, вспышки, снаряды, след HP, оттенок попадания) идут и после конца боя — до смены сцены.
    const dt = delta * this.tweens.timeScale;
    this.later.step(dt);
    this.floats.step(dt);
    for (const v of this.views.values()) this.animateUnit(v, dt);
    if (this.finished) return;
    // Баннер босса: часы боя стоят, пока он на экране («Пропустить» работает — skip не ждёт часов).
    if (this.introLeft > 0) {
      this.introLeft -= dt;
      return;
    }
    this.clock += (delta / 1000) * playback.speed;
    const log = this.result.log;
    while (this.cursor < log.length && log[this.cursor].t <= this.clock) {
      this.play(log[this.cursor], true);
      this.cursor++;
    }
    this.showTime(Math.min(this.clock, this.result.duration));
  }

  private showTime(s: number): void {
    const sec = Math.floor(s);
    if (sec === this.shownSec) return;
    this.shownSec = sec;
    this.timeText.setText(`${fmt(sec)} / ${fmt(COMBAT.timeLimitSeconds)}`);
  }

  /** След HP и красный оттенок попадания (раньше — твин и таймер на каждый удар). */
  private animateUnit(v: UnitView, dt: number): void {
    if (v.cast) cropBar(v.castBar, Phaser.Math.Clamp((this.clock - v.cast.start) / v.cast.dur, 0, 1));
    if (v.tintLeft > 0) {
      v.tintLeft -= dt;
      if (v.tintLeft <= 0) {
        v.tintLeft = 0;
        v.sprite.setTint(unitTint(v.def.visual));
      }
    }
    if (v.trailT < 0) return;
    v.trailT += dt;
    if (v.trailT <= TRAIL_DELAY) return;
    const p = Math.min(1, (v.trailT - TRAIL_DELAY) / TRAIL_MS);
    v.trail = v.trailFrom + (v.trailTo - v.trailFrom) * ease.quadIn(p);
    cropBar(v.trailBar, v.trail);
    if (p >= 1) v.trailT = -1;
  }

  private shutdown(): void {
    this.views.clear();
    this.later.clear();
    this.floats?.clear();
    this.ult?.clear();
  }

  private skip(): void {
    if (this.finished || !this.ready) return;
    const log = this.result.log;
    while (this.cursor < log.length) this.play(log[this.cursor++], false);
  }

  /** Отложить до момента удара источника (кадр удара анимации, полёт снаряда, рывок). */
  private atImpact(sourceUid: string | null, animate: boolean, fn: () => void): void {
    const src = sourceUid ? this.views.get(sourceUid) : undefined;
    const wait = animate && src ? src.impactAt - this.time.now : 0;
    if (wait > 0) this.later.after(wait, fn);
    else fn();
  }

  private play(e: BattleEvent, animate: boolean): void {
    switch (e.type) {
      case 'turn':
        return;
      case 'move': {
        const v = this.views.get(e.unit)!;
        if (!animate) {
          v.node.setPosition(e.to[0], e.to[1]).setDepth(e.to[1]);
          return;
        }
        this.moveTo(v, e.to[0], e.to[1], e.duration * 1000, e.kind);
        return;
      }
      case 'attack': {
        const v = this.views.get(e.unit)!;
        v.inUlt = false;
        v.lastSkill = e.skill;
        v.energy = e.energy;
        this.endCast(v);
        this.redraw(v);
        if (!animate) return;
        // Активный навык — его название над головой (обычная атака без подписи).
        if (e.name) this.headline(v, e.name, v.snap.side === 'A' ? '#ffe28a' : '#ffb0a0');
        const target = this.views.get(e.targets[0]);
        let impact = this.once(v, 'attack');
        if (e.kind !== 'melee' && target) {
          const tex = e.kind === 'heal' ? 'fx_heal' : (v.def.visual.projectile ?? 'fx_magic');
          this.later.after(impact, () => this.projectile(v, target, tex));
          impact += PROJECTILE_MS;
        }
        v.impactAt = this.time.now + impact;
        return;
      }
      case 'ult': {
        const v = this.views.get(e.unit)!;
        v.lastSkill = e.skill;
        v.energy = 0;
        v.inUlt = true;
        this.redraw(v);
        if (!animate) return;
        v.impactAt = this.time.now + this.once(v, 'cast');
        this.spotlight(v, e.name, e.skill);
        return;
      }
      case 'cast': {
        const v = this.views.get(e.unit)!;
        if (e.action === 'interrupt') {
          this.endCast(v);
          if (animate) this.headline(v, `${e.name} сбит`, '#ff9a8a');
          return;
        }
        v.cast = { start: e.t, dur: e.duration };
        v.castBack.setVisible(true);
        v.castBar.setVisible(true);
        cropBar(v.castBar, 0);
        if (!animate) return;
        this.headline(v, e.name, '#c9b6ff');
        this.loop(v, 'cast');
        return;
      }
      case 'passive': {
        const v = this.views.get(e.unit)!;
        // Название пассивки — только при первом срабатывании у юнита за бой, иначе экран засоряется
        // (пассивки на начало хода срабатывают каждый ход).
        const key = `${e.unit}:${e.skill}`;
        if (animate && !this.shownPassives.has(key)) this.headline(v, e.name, '#c9a0ff');
        this.shownPassives.add(key);
        return;
      }
      case 'skip': {
        const v = this.views.get(e.unit)!;
        if (animate) this.headline(v, 'оглушён', '#ffcf6b');
        return;
      }
      case 'damage': {
        const v = this.views.get(e.target)!;
        // Удар ульты — крупная золотая цифра (как крит); флаг читаем сейчас, до задержки удара.
        const big = !e.dot && !!this.views.get(e.source)?.inUlt;
        this.atImpact(e.dot ? null : e.source, animate, () => {
          v.hp = e.hp;
          v.shield = e.shield;
          v.energy = e.energy;
          this.redraw(v, animate);
          if (!animate) return;
          const hpPart = e.amount - e.absorbed;
          const color = e.dot ? '#9be36b' : big && hpPart > 0 ? '#ffd84a' : hpPart > 0 ? '#ffffff' : '#bcd6ff';
          this.popNumber(v, hpPart > 0 ? `-${hpPart}${big ? '!' : ''}` : `(${e.absorbed})`, color, big && hpPart > 0);
          this.hurt(v);
          const src = this.views.get(e.source);
          const hit = hitFxOf(src);
          if (hit === 'fx_magic') this.fx(v, hit, 1.7, 450, 0.95);
          else this.fx(v, hit, 0.45, 200, 0.5);
        });
        return;
      }
      case 'heal': {
        const v = this.views.get(e.target)!;
        this.atImpact(e.source, animate, () => {
          v.hp = e.hp;
          this.redraw(v, animate);
          if (animate && e.amount > 0) {
            this.popNumber(v, `+${e.amount}`, '#7dff8f');
            this.fx(v, 'fx_heal', 0.8);
          }
        });
        return;
      }
      case 'buff': {
        const v = this.views.get(e.target)!;
        this.atImpact(e.source, animate, () => {
          v.shield = e.shield;
          this.redraw(v);
          if (animate) {
            this.popNumber(v, `щит +${e.amount}`, '#bcd6ff', false, 30);
            this.fx(v, 'fx_shield', 1.4, 400);
          }
        });
        return;
      }
      case 'status': {
        const v = this.views.get(e.target)!;
        if (animate && e.action === 'apply') {
          const src = this.views.get(e.source);
          // Бафф союзнику (не свой яд/оглушение по врагу) — вспышка защиты из эффектов RO.
          const ally = !!src && src.snap.side === v.snap.side;
          const buff = ally ? skillFx(src?.lastSkill)?.buff ?? 'fx_shield' : null;
          this.atImpact(e.source, animate, () => {
            this.headline(v, e.name, '#ffcf6b');
            if (buff) this.fx(v, buff, 1.2, 400);
          });
        }
        return;
      }
      case 'energy': {
        const v = this.views.get(e.unit)!;
        v.energy = e.energy;
        this.redraw(v);
        return;
      }
      case 'death': {
        const v = this.views.get(e.unit)!;
        v.alive = false;
        this.atImpact(e.killer, animate, () => this.die(v, animate));
        return;
      }
      case 'end':
        this.finished = true;
        this.showTime(this.result.duration);
        this.commitStage();
        this.time.delayedCall(animate ? 1200 : 150, () =>
          this.scene.start('Result', { result: this.result, defs: this.defs, stage: this.stage, tower: this.tower } satisfies ResultData),
        );
        return;
    }
  }

  /** Итог этапа или этажа записывается один раз — в конце боя (и при «Пропустить»). */
  private commitStage(): void {
    const out = this.stage?.outcome ?? this.tower?.outcome;
    if (!out || this.committed) return;
    this.committed = true;
    commit(out.save);
  }

  // ---------- анимации ----------

  /** Каст закончился или сбит: спрятать полосу, вернуть стойку. */
  private endCast(v: UnitView): void {
    if (!v.cast) return;
    v.cast = null;
    v.castBack.setVisible(false);
    v.castBar.setVisible(false);
    if (v.alive && !v.moveTween) this.loop(v, 'idle');
  }

  private loop(v: UnitView, name: 'idle' | 'walk' | 'cast'): void {
    const key = anim(v.look, v.spriteId, name);
    if (key && v.sprite.anims.currentAnim?.key !== key) v.sprite.play({ key, repeat: -1 });
  }

  /** Разовая анимация; возвращает задержку до кадра удара (мс на 1x). */
  private once(v: UnitView, name: AnimName): number {
    const key = anim(v.look, v.spriteId, name);
    if (!key || !v.alive) return 0;
    v.sprite.play(key);
    const total = v.sprite.anims.currentAnim?.duration ?? 0;
    v.busyUntil = this.time.now + total;
    return hitDelay(v.look, name);
  }

  private hurt(v: UnitView): void {
    v.sprite.setTint(0xff8080);
    v.tintLeft = HURT_TINT_MS;
    if (!v.alive || this.time.now < v.busyUntil || this.time.now - v.lastHurt < HURT_COOLDOWN || v.moveTween) return;
    v.lastHurt = this.time.now;
    this.once(v, 'hurt');
  }

  private moveTo(v: UnitView, x: number, y: number, ms: number, kind: 'walk' | 'dash'): void {
    v.moveTween?.stop();
    if (kind === 'walk') this.loop(v, 'walk');
    // Удары, которые юнит нанесёт в конце рывка, покажем, когда он долетит.
    if (kind === 'dash') v.impactAt = Math.max(v.impactAt, this.time.now + ms);
    v.moveTween = this.tweens.add({
      targets: v.node,
      x,
      y,
      duration: ms,
      ease: kind === 'dash' ? 'Quad.easeOut' : 'Linear',
      onUpdate: () => v.node.setDepth(v.node.y),
      onComplete: () => {
        v.moveTween = null;
        if (v.alive && this.time.now >= v.busyUntil) this.loop(v, 'idle');
      },
    });
    if (kind === 'dash') this.tweens.add({ targets: v.sprite, y: -60, duration: ms / 2, yoyo: true, ease: 'Sine.easeOut' });
    else if (!anim(v.look, v.spriteId, 'walk')?.endsWith(':walk')) {
      // В листе нет ходьбы — хотя бы покачивание, чтобы не «скользил».
      this.tweens.add({ targets: v.sprite, y: -8, duration: 120, yoyo: true, repeat: Math.max(0, Math.floor(ms / 240) - 1), onComplete: () => v.sprite.setY(0) });
    }
  }

  private die(v: UnitView, animate: boolean): void {
    v.hp = 0;
    v.shield = 0;
    this.redraw(v);
    v.moveTween?.stop();
    this.endCast(v);
    for (const b of v.bars) b.setVisible(false);
    v.node.setDepth(v.node.y - 1000);
    const key = anim(v.look, v.spriteId, 'death');
    if (key) {
      v.sprite.play(key);
      if (animate) this.tweens.add({ targets: v.sprite, alpha: 0.55, delay: 400, duration: 400 });
      else v.sprite.setAlpha(0.55);
    } else {
      // Листа смерти нет: тело просто падает — стойку больше не крутим.
      v.sprite.anims.stop();
      if (animate) this.tweens.add({ targets: v.sprite, alpha: 0.2, angle: v.snap.side === 'A' ? -90 : 90, duration: 400 });
      else v.sprite.setAlpha(0.2).setAngle(v.snap.side === 'A' ? -90 : 90);
    }
    if (animate) this.fx(v, 'fx_death', 1.6, 600);
  }

  // ---------- мелочи ----------

  /** Перерисовать полоски. animate — снятое HP уходит белым следом, иначе след сразу догоняет. */
  private redraw(v: UnitView, animate = false): void {
    const max = v.snap.maxHp;
    const pct = Phaser.Math.Clamp(v.hp / max, 0, 1);
    cropBar(v.hpBar, pct);
    if (this.bossBar?.uid === v.snap.uid) cropBar(this.bossBar.fill, pct);
    if (pct >= v.trail || !animate) {
      v.trailT = -1;
      v.trail = pct;
      cropBar(v.trailBar, pct);
    } else {
      // След стоит TRAIL_DELAY, затем догоняет HP (Quad.easeIn) — в update (animateUnit).
      cropBar(v.trailBar, v.trail);
      v.trailFrom = v.trail;
      v.trailTo = pct;
      v.trailT = 0;
    }
    cropBar(v.energyBar, v.energy / COMBAT.energy.max);
    v.shieldBar.setVisible(v.alive && v.shield > 0);
    cropBar(v.shieldBar, Math.min(1, v.shield / max));
  }

  /** Снаряд и вспышки — из пула FloatLayer (вид как у прежних твинов). */
  private projectile(from: UnitView, to: UnitView, texId: string): void {
    this.floats.projectile(from.node.x, bodyY(from), to.node.x, bodyY(to), texId, 48, PROJECTILE_MS, DEPTH.fx);
  }

  private fx(v: UnitView, texId: string, scale: number, duration = 250, alpha = 0.8): void {
    this.floats.flash(v.node.x, bodyY(v), texId, 140 * scale, alpha, duration, DEPTH.fx, v.node.y);
  }

  /**
   * Цифра урона/лечения над юнитом. Цифры встают в небольшой столбик (FLOAT_SLOTS мест сверху вниз),
   * сдвинуты к тылу юнита и поднимаются ровно до подписи с именем — не заезжая на неё.
   * big — удар ульты: крупнее, золотом, с «хлопком».
   */
  private popNumber(v: UnitView, value: string, color: string, big = false, size = 40): void {
    const now = this.time.now;
    let slot = v.floatSlots.findIndex((t) => t <= now);
    if (slot < 0) {
      slot = 0;
      for (let i = 1; i < v.floatSlots.length; i++) if (v.floatSlots[i] < v.floatSlots[slot]) slot = i;
    }
    v.floatSlots[slot] = now + FLOAT_SLOT_MS;
    const fs = big ? Math.round(size * 1.3) : size;
    const cx = v.node.x;
    const cy = bodyY(v);
    const nameBottom = v.node.y + v.nameY + 14;
    const top = Math.max(cy - 30, nameBottom + fs / 2 + FLOAT_RISE + 4);
    const x = cx + (v.snap.side === 'A' ? -34 : 34) + rnd(14);
    const y = top + slot * FLOAT_STEP;
    // Пул надписей: не больше MAX_FLOATS на экране, стиль и замер шрифта кэшируются.
    const t = this.floats.number(x, y, value, fs, color, big ? '#5a2a00' : '#000000', big ? 8 : 6, DEPTH.numbers + slot, FLOAT_RISE, big ? 650 : 450, big);
    // У края экрана цифру не обрезаем.
    t.x = Phaser.Math.Clamp(t.x, t.width / 2 + 8, GAME_W - t.width / 2 - 8);
  }

  /** Короткая подпись над именем (пассивка, статус, «оглушён») — уходит вверх, прочь от имени. */
  private headline(v: UnitView, value: string, color: string): void {
    const x = v.node.x + (v.snap.side === 'A' ? -UI_SHIFT : UI_SHIFT);
    const y = v.node.y + v.nameY - 34;
    this.floats.headline(x, y, value, 26, color, DEPTH.numbers);
  }

  /** Ульта: экран темнеет, кастер подсвечен поверх затемнения, сверху — баннер с названием. */
  private spotlight(v: UnitView, skillName: string, skillId: string): void {
    this.ult.flashDim();
    this.ult.showBanner(v.def.name, skillName, v.snap.side === 'A', CONTENT.skills[skillId]?.icon);
    this.ult.glow(v.node.x, v.node.y);
    v.node.setDepth(DEPTH.spotlight + v.node.y / 10);
    this.tweens.add({ targets: v.node, scale: 1.12, duration: 160, yoyo: true, hold: 300, ease: 'Quad.easeOut' });
    this.later.after(1000, () => v.node.setDepth(v.alive ? v.node.y : v.node.y - 1000));
  }
}

/**
 * Эффект попадания по навыку атакующего: явная привязка из effects.json (skills.<id>.hit), иначе магия
 * (навык с кастом или дальний навык мага) — fx_magic, иначе эффект удара юнита (visual.hitFx).
 */
function hitFxOf(src: UnitView | undefined): string {
  const mapped = skillFx(src?.lastSkill)?.hit;
  if (mapped) return mapped;
  const sk = src?.lastSkill ? CONTENT.skills[src.lastSkill] : undefined;
  const magic = !!sk && (sk.castTime > 0 || (sk.range === 'ranged' && src?.def.visual.projectile === 'fx_magic'));
  return magic ? 'fx_magic' : (src?.def.visual.hitFx ?? 'fx_hit');
}

/** Полоска заполняется обрезкой текстуры, чтобы скруглённые края не сжимались. */
function cropBar(img: Phaser.GameObjects.Image, pct: number): void {
  const p = Phaser.Math.Clamp(pct, 0, 1);
  img.setCrop(0, 0, img.frame.width * p, img.frame.height);
}

const fmt = (s: number) => {
  const sec = Math.floor(s);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};
/** Центр тела над точкой ног (y) — туда летят снаряды и всплывают цифры; x — это node.x. */
const bodyY = (v: UnitView) => v.node.y - v.look.height * 0.5;
const rnd = (spread: number) => (Math.random() - 0.5) * spread;
