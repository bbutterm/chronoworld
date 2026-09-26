import Phaser from 'phaser';
import { COMBAT, HEROES, simulateBattle, type BattleEvent, type BattleResult, type UnitSnapshot } from '../../core';
import { animKey, hasArt, hasSheet, heroBattle, heroSheet, ultIcon } from '../assets';
import { GAME_W, slotPos } from '../layout';
import { playback, playbackSpeeds, squads } from '../state';
import { button, panel, text } from '../ui';

/** Плейсхолдер героя на экране. */
const SPRITE = 140;
/** Клетка спрайтшита на экране: персонаж занимает её нижнюю часть. */
const CELL = 250;
/** Центр тела над точкой ног — туда летят снаряды и всплывают цифры. */
const BODY = 80;
const BAR_W = 150;
/** Ближний бой: на каком расстоянии по x от цели встаёт атакующий. */
const MELEE_GAP = 125;
/** Скорость подбега, пикселей в миллисекунду на 1x. */
const RUN_SPEED = 1.6;

interface UnitView {
  snap: UnitSnapshot;
  node: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Image;
  shieldBar: Phaser.GameObjects.Image;
  energyBar: Phaser.GameObjects.Image;
  bars: Phaser.GameObjects.GameObject[];
  sheet: string | null;
  melee: boolean;
  hp: number;
  shield: number;
  energy: number;
  alive: boolean;
  /** Время сцены (мс), когда юнит закончит подбег и нанесёт удар. */
  strikeAt: number;
  homeY: number;
  /** Куда юнит бежит или где стоит. */
  destX: number;
  destY: number;
  /** С кем сцепился в ближнем бою. */
  engagedWith: string | null;
}

export class BattleScene extends Phaser.Scene {
  private result!: BattleResult;
  private views = new Map<string, UnitView>();
  private cursor = 0;
  private clock = 0;
  private finished = false;
  private timeText!: Phaser.GameObjects.Text;

  constructor() {
    super('Battle');
  }

  create(data: { seed: number }): void {
    this.views.clear();
    this.cursor = 0;
    this.clock = 0;
    this.finished = false;
    this.deathDelay.clear();
    this.result = simulateBattle(squads.A, squads.B, data.seed);

    this.add.image(GAME_W / 2, 960, 'bg_arena').setDisplaySize(GAME_W, 1920);
    panel(this, GAME_W / 2, 130, 520, 200, 'ui_panel');
    text(this, GAME_W / 2, 85, 'Бой', 56, '#ffe9a8', { fontStyle: 'bold', stroke: '#3a2412', strokeThickness: 8 });
    this.timeText = text(this, GAME_W / 2, 150, '', 40, '#ffffff', { stroke: '#000000', strokeThickness: 5 });
    text(this, GAME_W / 2, 195, `seed ${data.seed}`, 22, '#e0cfb0');

    const speedBtn = button(this, 180, 360, 280, 110, 'ui_btn_speed', `${playback.speed}x`, () => {
      const i = playbackSpeeds.indexOf(playback.speed);
      playback.speed = playbackSpeeds[(i + 1) % playbackSpeeds.length];
      speedBtn.setLabel(`${playback.speed}x`);
      for (const v of this.views.values()) v.sprite.anims.timeScale = playback.speed;
    });
    button(this, 900, 360, 280, 110, 'ui_btn_skip', 'Пропустить', () => this.skip());

    for (const u of this.result.units) this.buildUnit(u);
  }

  private buildUnit(snap: UnitSnapshot): void {
    const { x, y } = slotPos(snap.side, snap.slot);
    const feetY = y + SPRITE / 2;
    const sheetId = heroSheet(snap.heroId);
    const sheet = hasSheet(this, sheetId) ? sheetId : null;
    const art = !!sheet || hasArt(heroBattle(snap.heroId));
    const size = art ? CELL : SPRITE;
    const sprite = this.add
      .sprite(0, 0, sheet ?? heroBattle(snap.heroId))
      .setOrigin(0.5, 1)
      .setDisplaySize(size, size)
      .setFlipX(snap.side === 'B' && art);
    if (sheet) {
      sprite.anims.timeScale = playback.speed;
      sprite.play({ key: animKey(sheet, 'ready'), repeat: -1, startFrame: snap.slot % 3 });
    }

    const barBack = this.add.image(0, 14, 'ui_bar_back').setDisplaySize(BAR_W + 6, 20);
    const hpBar = this.add
      .image(-BAR_W / 2, 14, snap.side === 'A' ? 'ui_bar_hp_ally' : 'ui_bar_hp_enemy')
      .setOrigin(0, 0.5)
      .setDisplaySize(BAR_W, 14);
    const shieldBar = this.add.image(-BAR_W / 2, 8, 'ui_bar_shield').setOrigin(0, 0.5).setDisplaySize(BAR_W, 5).setVisible(false);
    const energyBack = this.add.image(0, 32, 'ui_bar_back').setDisplaySize(BAR_W + 6, 12);
    const energyBar = this.add.image(-BAR_W / 2, 32, 'ui_bar_energy').setOrigin(0, 0.5).setDisplaySize(BAR_W, 8);
    const name = text(this, 0, art ? -238 : -SPRITE - 16, HEROES[snap.heroId].name, 24, '#ffffff', {
      stroke: '#000000',
      strokeThickness: 5,
    });
    const bars = [barBack, hpBar, shieldBar, energyBack, energyBar, name];
    const node = this.add.container(x, feetY, [sprite, ...bars]).setDepth(feetY);

    const v: UnitView = {
      snap,
      node,
      sprite,
      hpBar,
      shieldBar,
      energyBar,
      bars,
      sheet,
      melee: HEROES[snap.heroId].attack === 'melee',
      hp: snap.maxHp,
      shield: 0,
      energy: 0,
      alive: true,
      strikeAt: 0,
      homeY: feetY,
      destX: x,
      destY: feetY,
      engagedWith: null,
    };
    this.views.set(snap.uid, v);
    this.redraw(v);
  }

  update(_time: number, delta: number): void {
    if (this.finished) return;
    this.clock += (delta / 1000) * playback.speed;
    const log = this.result.log;
    while (this.cursor < log.length && log[this.cursor].t <= this.clock) {
      this.play(log[this.cursor], true);
      this.cursor++;
    }
    const shown = Math.min(this.clock, this.result.duration);
    this.timeText.setText(`${fmt(shown)} / ${fmt(COMBAT.timeLimitSeconds)}`);
  }

  private skip(): void {
    if (this.finished) return;
    const log = this.result.log;
    while (this.cursor < log.length) this.play(log[this.cursor++], false);
  }

  /** Сколько ждать, пока источник добежит до цели (удар и цифры — в момент касания). */
  private strikeDelay(sourceUid: string): number {
    const src = this.views.get(sourceUid);
    return src ? Math.max(0, src.strikeAt - this.time.now) : 0;
  }

  private later(ms: number, fn: () => void): void {
    if (ms <= 0) fn();
    else this.time.delayedCall(ms, fn);
  }

  private play(e: BattleEvent, animate: boolean): void {
    switch (e.type) {
      case 'turn':
        return;
      case 'attack': {
        const v = this.views.get(e.unit)!;
        v.energy = e.energy;
        this.redraw(v);
        if (!animate) return;
        const target = this.views.get(e.targets[0]);
        if (!target) return;
        if (e.kind === 'melee') this.meleeStrike(v, target);
        else {
          this.playAnim(v, 'attack');
          this.projectile(v, target, e.kind === 'heal' ? 'fx_heal' : v.snap.heroId === 'mage' ? 'fx_magic' : 'fx_arrow');
        }
        return;
      }
      case 'ult': {
        const v = this.views.get(e.unit)!;
        v.energy = 0;
        this.redraw(v);
        if (!animate) return;
        const target = this.nextTarget(e.unit, e.t);
        if (v.melee && target) this.meleeStrike(v, target);
        else this.playAnim(v, 'attack');
        const [cx, cy] = this.body(v);
        this.floating(cx, cy - 150, e.name, '#ffd84a', 34);
        const icon = this.add.image(cx, cy - 200, ultIcon(v.snap.heroId)).setDisplaySize(72, 72).setDepth(5000);
        this.tweens.add({ targets: icon, y: icon.y - 40, alpha: 0, duration: 900 / playback.speed, onComplete: () => icon.destroy() });
        return;
      }
      case 'damage': {
        const v = this.views.get(e.target)!;
        const delay = animate ? this.strikeDelay(e.source) : 0;
        this.later(delay, () => {
          v.hp = e.hp;
          v.shield = e.shield;
          v.energy = e.energy;
          this.redraw(v);
          if (!animate) return;
          const [cx, cy] = this.body(v);
          const hpPart = e.amount - e.absorbed;
          this.floating(cx + rnd(40), cy - 40 + rnd(20), hpPart > 0 ? `-${hpPart}` : `(${e.absorbed})`, hpPart > 0 ? '#ffffff' : '#bcd6ff');
          this.flash(v);
          if (v.alive && v.sprite.anims.currentAnim?.key !== animKey(v.sheet ?? '', 'attack')) this.playAnim(v, 'hurt');
          this.fx(v, 'fx_hit', 0.45, 200, 0.5);
        });
        if (e.hp <= 0) this.deathDelay.set(e.target, delay);
        return;
      }
      case 'heal': {
        const v = this.views.get(e.target)!;
        v.hp = e.hp;
        this.redraw(v);
        if (animate && e.amount > 0) {
          const [cx, cy] = this.body(v);
          this.floating(cx + rnd(40), cy - 40, `+${e.amount}`, '#7dff8f');
          this.fx(v, 'fx_heal', 0.8);
        }
        return;
      }
      case 'buff': {
        const v = this.views.get(e.target)!;
        v.shield = e.shield;
        this.redraw(v);
        if (animate) {
          const [cx, cy] = this.body(v);
          this.floating(cx, cy - 60, `щит +${e.amount}`, '#bcd6ff', 30);
          this.fx(v, 'fx_shield', 1.4, 400);
        }
        return;
      }
      case 'death': {
        const v = this.views.get(e.unit)!;
        v.alive = false;
        const delay = animate ? (this.deathDelay.get(e.unit) ?? 0) : 0;
        this.later(delay, () => this.die(v, animate));
        return;
      }
      case 'end':
        this.finished = true;
        this.timeText.setText(`${fmt(this.result.duration)} / ${fmt(COMBAT.timeLimitSeconds)}`);
        this.time.delayedCall(animate ? 1200 : 150, () => this.scene.start('Result', { result: this.result }));
        return;
    }
  }

  private deathDelay = new Map<string, number>();

  private die(v: UnitView, animate: boolean): void {
    v.hp = 0;
    v.shield = 0;
    this.redraw(v);
    for (const b of v.bars) (b as Phaser.GameObjects.Image).setVisible(false);
    v.node.setDepth(v.node.y - 1000);
    if (v.sheet) {
      // В спрайтшите есть кадр смерти — просто держим его.
      v.sprite.play(animKey(v.sheet, 'death'));
      if (animate) {
        this.fx(v, 'fx_death', 1.6, 600);
        this.tweens.add({ targets: v.sprite, alpha: 0.5, duration: 400 });
      } else v.sprite.setAlpha(0.5);
    } else if (animate) {
      this.fx(v, 'fx_death', 1.6, 600);
      this.tweens.add({ targets: v.sprite, alpha: 0.2, angle: v.snap.side === 'A' ? -90 : 90, duration: 400 });
    } else {
      v.sprite.setAlpha(0.2).setAngle(v.snap.side === 'A' ? -90 : 90);
    }
  }

  /** Первая цель урона от юнита в этот же момент — туда прыгает ульта ближнего бойца. */
  private nextTarget(uid: string, t: number): UnitView | undefined {
    const log = this.result.log;
    for (let i = this.cursor + 1; i < log.length && log[i].t === t; i++) {
      const e = log[i];
      if (e.type === 'damage' && e.source === uid) return this.views.get(e.target);
    }
    return undefined;
  }

  /** Подбежать к цели (если ещё не рядом), ударить и остаться в ближнем бою. */
  private meleeStrike(v: UnitView, target: UnitView): void {
    // Цель уже бежит ко мне — стоим и бьём, когда она добежит (иначе бойцы пробегут друг сквозь друга).
    if (target.engagedWith === v.snap.uid && target.alive) {
      v.strikeAt = Math.max(this.time.now, target.strikeAt);
      this.later(v.strikeAt - this.time.now, () => this.playAnim(v, 'attack'));
      return;
    }
    v.engagedWith = target.snap.uid;
    const dir = v.snap.side === 'A' ? -1 : 1;
    const tx = target.destX + dir * MELEE_GAP;
    // Несколько бойцов у одной цели встают со сдвигом в сторону своей линии.
    const ty = target.destY + Phaser.Math.Clamp((v.homeY - target.destY) * 0.35, -60, 60);
    v.destX = tx;
    v.destY = ty;
    const dist = Phaser.Math.Distance.Between(v.node.x, v.node.y, tx, ty);
    if (dist < 12) {
      v.strikeAt = this.time.now;
      this.playAnim(v, 'attack');
      return;
    }
    const ms = Phaser.Math.Clamp(dist / RUN_SPEED, 120, 420) / playback.speed;
    v.strikeAt = this.time.now + ms;
    this.tweens.killTweensOf(v.node);
    this.tweens.add({
      targets: v.node,
      x: tx,
      y: ty,
      duration: ms,
      ease: 'Sine.easeInOut',
      onUpdate: () => v.node.setDepth(v.node.y),
      onComplete: () => this.playAnim(v, 'attack'),
    });
    // Лёгкое подпрыгивание на бегу — у героев нет ряда ходьбы в спрайтшите.
    this.tweens.add({ targets: v.sprite, y: -10, duration: ms / 4, yoyo: true, repeat: 1, onComplete: () => v.sprite.setY(0) });
  }

  private body(v: UnitView): [number, number] {
    return [v.node.x, v.node.y - BODY];
  }

  private redraw(v: UnitView): void {
    const max = v.snap.maxHp;
    cropBar(v.hpBar, v.hp / max);
    cropBar(v.energyBar, v.energy / COMBAT.energy.max);
    v.shieldBar.setVisible(v.alive && v.shield > 0);
    cropBar(v.shieldBar, Math.min(1, v.shield / max));
  }

  /** Разовая анимация из спрайтшита, потом снова боевая стойка. */
  private playAnim(v: UnitView, name: 'attack' | 'hurt'): void {
    if (!v.sheet || !v.alive) return;
    const sheet = v.sheet;
    v.sprite.anims.timeScale = playback.speed;
    v.sprite.play(animKey(sheet, name));
    v.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (v.alive) v.sprite.play({ key: animKey(sheet, 'ready'), repeat: -1 });
    });
  }

  private projectile(from: UnitView, to: UnitView, texId: string): void {
    const [fx, fy] = this.body(from);
    const [tx, ty] = this.body(to);
    const p = this.add.image(fx, fy, texId).setDisplaySize(48, 48).setDepth(4000);
    this.tweens.add({ targets: p, x: tx, y: ty, duration: 220 / playback.speed, onComplete: () => p.destroy() });
  }

  private flash(v: UnitView): void {
    v.sprite.setTint(0xff7070);
    this.time.delayedCall(90, () => v.sprite.clearTint());
  }

  private fx(v: UnitView, texId: string, scale: number, duration = 250, alpha = 0.8): void {
    const [cx, cy] = this.body(v);
    const img = this.add.image(cx, cy, texId).setDisplaySize(SPRITE * scale, SPRITE * scale).setAlpha(alpha).setDepth(4000);
    this.tweens.add({ targets: img, alpha: 0, scale: img.scale * 1.2, duration: duration / playback.speed, onComplete: () => img.destroy() });
  }

  private floating(x: number, y: number, value: string, color: string, size = 40): void {
    const t = text(this, x, y, value, size, color, { stroke: '#000000', strokeThickness: 6, fontStyle: 'bold' }).setDepth(5000);
    this.tweens.add({ targets: t, y: y - 90, alpha: 0, duration: 900 / playback.speed, onComplete: () => t.destroy() });
  }
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
const rnd = (spread: number) => (Math.random() - 0.5) * spread;
