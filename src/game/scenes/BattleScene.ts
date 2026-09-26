import Phaser from 'phaser';
import { COMBAT, HEROES, simulateBattle, type BattleEvent, type BattleResult, type UnitSnapshot } from '../../core';
import { animKey, hasArt, hasSheet, heroBattle, heroSheet, ultIcon } from '../assets';
import { GAME_W, slotPos } from '../layout';
import { playback, playbackSpeeds, squads } from '../state';
import { button, text } from '../ui';

const SPRITE = 140;
/** Клетка спрайтшита на экране: персонаж занимает её нижнюю часть. */
const CELL = 250;
const BAR_W = 150;

interface UnitView {
  snap: UnitSnapshot;
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Sprite;
  /** Позиция ног спрайта (origin 0.5, 1). */
  feetY: number;
  sheet: string | null;
  hpBar: Phaser.GameObjects.Image;
  shieldBar: Phaser.GameObjects.Image;
  energyBar: Phaser.GameObjects.Image;
  hp: number;
  shield: number;
  energy: number;
  alive: boolean;
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
    this.result = simulateBattle(squads.A, squads.B, data.seed);

    this.add.image(GAME_W / 2, 960, 'bg_arena').setDisplaySize(GAME_W, 1920);
    text(this, GAME_W / 2, 70, 'Бой', 64, '#ffe9a8');
    this.timeText = text(this, GAME_W / 2, 150, '', 40);
    text(this, GAME_W / 2, 205, `seed ${data.seed}`, 24, '#7d8290');

    const speedBtn = button(this, 250, 330, 300, 110, 'ui_btn_speed', `${playback.speed}x`, () => {
      const i = playbackSpeeds.indexOf(playback.speed);
      playback.speed = playbackSpeeds[(i + 1) % playbackSpeeds.length];
      speedBtn.setLabel(`${playback.speed}x`);
    });
    button(this, 830, 330, 300, 110, 'ui_btn_skip', 'Пропустить', () => this.skip());

    for (const u of this.result.units) this.buildUnit(u);
  }

  private buildUnit(snap: UnitSnapshot): void {
    const { x, y } = slotPos(snap.side, snap.slot);
    const feetY = y + SPRITE / 2;
    const sheetId = heroSheet(snap.heroId);
    const sheet = hasSheet(this, sheetId) ? sheetId : null;
    const size = sheet || hasArt(heroBattle(snap.heroId)) ? CELL : SPRITE;
    const sprite = this.add
      .sprite(x, feetY, sheet ?? heroBattle(snap.heroId))
      .setOrigin(0.5, 1)
      .setDisplaySize(size, size)
      .setFlipX(snap.side === 'B' && (!!sheet || hasArt(heroBattle(snap.heroId))));
    if (sheet) sprite.play({ key: animKey(sheet, 'ready'), repeat: -1, startFrame: snap.slot % 3 });
    const barY = feetY + 14;
    this.add.image(x, barY, 'ui_bar_back').setDisplaySize(BAR_W + 6, 20);
    const hpBar = this.add
      .image(x - BAR_W / 2, barY, snap.side === 'A' ? 'ui_bar_hp_ally' : 'ui_bar_hp_enemy')
      .setOrigin(0, 0.5)
      .setDisplaySize(BAR_W, 14);
    const shieldBar = this.add.image(x - BAR_W / 2, barY - 5, 'ui_bar_shield').setOrigin(0, 0.5).setDisplaySize(0, 5);
    this.add.image(x, barY + 16, 'ui_bar_back').setDisplaySize(BAR_W + 6, 12);
    const energyBar = this.add.image(x - BAR_W / 2, barY + 16, 'ui_bar_energy').setOrigin(0, 0.5).setDisplaySize(0, 7);
    text(this, x, feetY - (size === CELL ? 238 : SPRITE + 16), HEROES[snap.heroId].name, 24);
    this.views.set(snap.uid, {
      snap,
      x,
      y,
      sprite,
      feetY,
      sheet,
      hpBar,
      shieldBar,
      energyBar,
      hp: snap.maxHp,
      shield: 0,
      energy: 0,
      alive: true,
    });
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

  private play(e: BattleEvent, animate: boolean): void {
    switch (e.type) {
      case 'turn':
        if (animate) this.pulse(e.unit);
        return;
      case 'attack': {
        const v = this.views.get(e.unit)!;
        v.energy = e.energy;
        this.redraw(v);
        if (!animate) return;
        this.playAnim(v, 'attack');
        const target = this.views.get(e.targets[0]);
        if (!target) return;
        if (e.kind === 'melee') this.lunge(v, target);
        else this.projectile(v, target, e.kind === 'heal' ? 'fx_heal' : v.snap.heroId === 'mage' ? 'fx_magic' : 'fx_arrow');
        return;
      }
      case 'ult': {
        const v = this.views.get(e.unit)!;
        v.energy = 0;
        this.redraw(v);
        if (!animate) return;
        this.floating(v.x, v.y - 140, e.name, '#ffd84a', 34);
        this.playAnim(v, 'attack');
        const icon = this.add.image(v.x, v.y - 200, ultIcon(v.snap.heroId)).setDisplaySize(72, 72);
        this.tweens.add({ targets: icon, y: icon.y - 40, alpha: 0, duration: 900 / playback.speed, onComplete: () => icon.destroy() });
        this.tweens.add({ targets: v.sprite, scale: v.sprite.scale * 1.25, duration: 140, yoyo: true });
        return;
      }
      case 'damage': {
        const v = this.views.get(e.target)!;
        v.hp = e.hp;
        v.shield = e.shield;
        v.energy = e.energy;
        this.redraw(v);
        if (!animate) return;
        const hpPart = e.amount - e.absorbed;
        this.floating(v.x + rnd(40), v.y - 40 + rnd(20), hpPart > 0 ? `-${hpPart}` : `(${e.absorbed})`, hpPart > 0 ? '#ffffff' : '#bcd6ff');
        this.flash(v);
        if (v.alive && v.sprite.anims.currentAnim?.key !== animKey(v.sheet ?? '', 'attack')) this.playAnim(v, 'hurt');
        this.fx(v, 'fx_hit', 0.45, 200, 0.5);
        return;
      }
      case 'heal': {
        const v = this.views.get(e.target)!;
        v.hp = e.hp;
        this.redraw(v);
        if (animate && e.amount > 0) {
          this.floating(v.x + rnd(40), v.y - 40, `+${e.amount}`, '#7dff8f');
          this.fx(v, 'fx_heal', 0.8);
        }
        return;
      }
      case 'buff': {
        const v = this.views.get(e.target)!;
        v.shield = e.shield;
        this.redraw(v);
        if (animate) {
          this.floating(v.x, v.y - 60, `щит +${e.amount}`, '#bcd6ff', 30);
          this.fx(v, 'fx_shield', 1.4, 400);
        }
        return;
      }
      case 'death': {
        const v = this.views.get(e.unit)!;
        v.alive = false;
        v.hp = 0;
        v.shield = 0;
        this.redraw(v);
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
        return;
      }
      case 'end':
        this.finished = true;
        this.timeText.setText(`${fmt(this.result.duration)} / ${fmt(COMBAT.timeLimitSeconds)}`);
        this.time.delayedCall(animate ? 1000 : 150, () => this.scene.start('Result', { result: this.result }));
        return;
    }
  }

  private redraw(v: UnitView): void {
    const max = v.snap.maxHp;
    v.hpBar.setDisplaySize(BAR_W * Math.max(0, v.hp / max), 14);
    v.shieldBar.setDisplaySize(BAR_W * Math.min(1, v.shield / max), 5);
    v.energyBar.setDisplaySize(BAR_W * (v.energy / COMBAT.energy.max), 7);
  }

  private pulse(uid: string): void {
    const v = this.views.get(uid)!;
    this.tweens.add({ targets: v.sprite, y: v.feetY - 14, duration: 90, yoyo: true });
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

  private lunge(v: UnitView, target: UnitView): void {
    const dx = (target.x - v.x) * 0.35;
    const dy = (target.y - v.y) * 0.35;
    this.tweens.add({ targets: v.sprite, x: v.x + dx, y: v.feetY + dy, duration: 110, yoyo: true, onComplete: () => v.sprite.setPosition(v.x, v.feetY) });
  }

  private projectile(from: UnitView, to: UnitView, tex: string): void {
    const p = this.add.image(from.x, from.y, tex).setDisplaySize(48, 48);
    this.tweens.add({ targets: p, x: to.x, y: to.y, duration: 220 / playback.speed, onComplete: () => p.destroy() });
  }

  private flash(v: UnitView): void {
    v.sprite.setTintFill(0xffffff);
    this.time.delayedCall(70, () => v.sprite.clearTint());
  }

  private fx(v: UnitView, tex: string, scale: number, duration = 250, alpha = 0.8): void {
    const img = this.add.image(v.x, v.y, tex).setDisplaySize(SPRITE * scale, SPRITE * scale).setAlpha(alpha);
    this.tweens.add({ targets: img, alpha: 0, scale: img.scale * 1.2, duration: duration / playback.speed, onComplete: () => img.destroy() });
  }

  private floating(x: number, y: number, value: string, color: string, size = 40): void {
    const t = text(this, x, y, value, size, color, { stroke: '#000000', strokeThickness: 6, fontStyle: 'bold' });
    this.tweens.add({ targets: t, y: y - 90, alpha: 0, duration: 900 / playback.speed, onComplete: () => t.destroy() });
  }
}

const fmt = (s: number) => {
  const sec = Math.floor(s);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};
const rnd = (spread: number) => (Math.random() - 0.5) * spread;
