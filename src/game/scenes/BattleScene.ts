import Phaser from 'phaser';
import { COMBAT, simulateBattle, type BattleEvent, type BattleResult, type UnitDef, type UnitSnapshot } from '../../core';
import type { AnimName } from '../../pipeline/sprites';
import { CONTENT } from '../content';
import { GAME_W } from '../layout';
import { anim, hitDelay, spriteView, type SpriteView } from '../sprites';
import { playback, playbackSpeeds, squads } from '../state';
import { button, panel, text } from '../ui';

const BAR_W = 150;
/** Полёт снаряда, мс на 1x. */
const PROJECTILE_MS = 220;
/** «Получил урон» не чаще, чем раз в столько мс, и не перебивает атаку. */
const HURT_COOLDOWN = 500;

interface UnitView {
  snap: UnitSnapshot;
  def: UnitDef;
  spriteId: string;
  look: SpriteView;
  node: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  hpBar: Phaser.GameObjects.Image;
  shieldBar: Phaser.GameObjects.Image;
  energyBar: Phaser.GameObjects.Image;
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
    this.result = simulateBattle(CONTENT, squads.A, squads.B, data.seed);

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
      this.tweens.timeScale = playback.speed;
      this.time.timeScale = playback.speed;
    });
    button(this, 900, 360, 280, 110, 'ui_btn_skip', 'Пропустить', () => this.skip());
    // Вся анимация (твины, задержки) идёт в темпе выбранной скорости.
    this.tweens.timeScale = playback.speed;
    this.time.timeScale = playback.speed;

    for (const u of this.result.units) this.buildUnit(u);
  }

  private buildUnit(snap: UnitSnapshot): void {
    const def = CONTENT.units[snap.unitId];
    const spriteId = def.visual.sprite;
    const look = spriteView(this, spriteId);
    const sprite = this.add.sprite(0, 0, look.key, 0).setOrigin(look.originX, look.originY);
    sprite.setScale(look.size / sprite.frame.height).setFlipX(snap.side === 'B' && look.art);
    sprite.anims.timeScale = playback.speed;

    const bar = (y: number, texId: string, h: number) => this.add.image(-BAR_W / 2, y, texId).setOrigin(0, 0.5).setDisplaySize(BAR_W, h);
    const barBack = this.add.image(0, 14, 'ui_bar_back').setDisplaySize(BAR_W + 6, 20);
    const hpBar = bar(14, snap.side === 'A' ? 'ui_bar_hp_ally' : 'ui_bar_hp_enemy', 14);
    const shieldBar = bar(8, 'ui_bar_shield', 5).setVisible(false);
    const energyBack = this.add.image(0, 32, 'ui_bar_back').setDisplaySize(BAR_W + 6, 12);
    const energyBar = bar(32, 'ui_bar_energy', 8);
    // Подпись — сразу над макушкой (высота фигуры в стойке из bbox листа).
    const nameY = -look.height - 22;
    const name = text(this, 0, nameY, def.name, 24, '#ffffff', { stroke: '#000000', strokeThickness: 5 });
    const bars = [barBack, hpBar, shieldBar, energyBack, energyBar, name];
    const node = this.add.container(snap.x, snap.y, [sprite, ...bars]).setDepth(snap.y);

    const v: UnitView = {
      snap,
      def,
      spriteId,
      look,
      node,
      sprite,
      hpBar,
      shieldBar,
      energyBar,
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
    this.loop(v, 'idle');
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
    this.timeText.setText(`${fmt(Math.min(this.clock, this.result.duration))} / ${fmt(COMBAT.timeLimitSeconds)}`);
  }

  private skip(): void {
    if (this.finished) return;
    const log = this.result.log;
    while (this.cursor < log.length) this.play(log[this.cursor++], false);
  }

  /** Отложить до момента удара источника (кадр удара анимации, полёт снаряда, рывок). */
  private atImpact(sourceUid: string | null, animate: boolean, fn: () => void): void {
    const src = sourceUid ? this.views.get(sourceUid) : undefined;
    const wait = animate && src ? src.impactAt - this.time.now : 0;
    if (wait > 0) this.time.delayedCall(wait, fn);
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
        v.energy = e.energy;
        this.redraw(v);
        if (!animate) return;
        const target = this.views.get(e.targets[0]);
        let impact = this.once(v, 'attack');
        if (e.kind !== 'melee' && target) {
          const tex = e.kind === 'heal' ? 'fx_heal' : (v.def.visual.projectile ?? 'fx_magic');
          this.time.delayedCall(impact, () => this.projectile(v, target, tex));
          impact += PROJECTILE_MS;
        }
        v.impactAt = this.time.now + impact;
        return;
      }
      case 'ult': {
        const v = this.views.get(e.unit)!;
        v.energy = 0;
        this.redraw(v);
        if (!animate) return;
        v.impactAt = this.time.now + this.once(v, 'cast');
        const [cx, cy] = this.body(v);
        this.floating(cx, cy - 150, e.name, '#ffd84a', 34);
        const icon = CONTENT.skills[e.skill]?.icon;
        if (icon) {
          const img = this.add.image(cx, cy - 210, icon).setDisplaySize(72, 72).setDepth(5000);
          this.tweens.add({ targets: img, y: img.y - 40, alpha: 0, duration: 900, onComplete: () => img.destroy() });
        }
        return;
      }
      case 'passive': {
        const v = this.views.get(e.unit)!;
        if (animate) this.floating(v.node.x, v.node.y - v.look.height - 60, e.name, '#c9a0ff', 28);
        return;
      }
      case 'skip': {
        const v = this.views.get(e.unit)!;
        if (animate) this.floating(v.node.x, v.node.y - v.look.height - 60, 'оглушён', '#ffcf6b', 28);
        return;
      }
      case 'damage': {
        const v = this.views.get(e.target)!;
        this.atImpact(e.dot ? null : e.source, animate, () => {
          v.hp = e.hp;
          v.shield = e.shield;
          v.energy = e.energy;
          this.redraw(v);
          if (!animate) return;
          const [cx, cy] = this.body(v);
          const hpPart = e.amount - e.absorbed;
          const color = e.dot ? '#9be36b' : hpPart > 0 ? '#ffffff' : '#bcd6ff';
          this.floating(cx + rnd(40), cy - 40 + rnd(20), hpPart > 0 ? `-${hpPart}` : `(${e.absorbed})`, color);
          this.hurt(v);
          const src = this.views.get(e.source);
          this.fx(v, src?.def.visual.hitFx ?? 'fx_hit', 0.45, 200, 0.5);
        });
        return;
      }
      case 'heal': {
        const v = this.views.get(e.target)!;
        this.atImpact(e.source, animate, () => {
          v.hp = e.hp;
          this.redraw(v);
          if (animate && e.amount > 0) {
            const [cx, cy] = this.body(v);
            this.floating(cx + rnd(40), cy - 40, `+${e.amount}`, '#7dff8f');
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
            const [cx, cy] = this.body(v);
            this.floating(cx, cy - 60, `щит +${e.amount}`, '#bcd6ff', 30);
            this.fx(v, 'fx_shield', 1.4, 400);
          }
        });
        return;
      }
      case 'status': {
        const v = this.views.get(e.target)!;
        if (animate && e.action === 'apply') {
          this.atImpact(e.source, animate, () => this.floating(v.node.x, v.node.y - v.look.height - 30, e.name, '#ffcf6b', 26));
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
        this.timeText.setText(`${fmt(this.result.duration)} / ${fmt(COMBAT.timeLimitSeconds)}`);
        this.time.delayedCall(animate ? 1200 : 150, () => this.scene.start('Result', { result: this.result }));
        return;
    }
  }

  // ---------- анимации ----------

  private loop(v: UnitView, name: 'idle' | 'walk'): void {
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
    v.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (v.alive) this.loop(v, v.moveTween ? 'walk' : 'idle');
    });
    return hitDelay(v.look, name);
  }

  private hurt(v: UnitView): void {
    v.sprite.setTint(0xff8080);
    this.time.delayedCall(90, () => v.sprite.clearTint());
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
    for (const b of v.bars) b.setVisible(false);
    v.node.setDepth(v.node.y - 1000);
    const key = anim(v.look, v.spriteId, 'death');
    if (key) {
      v.sprite.play(key);
      if (animate) this.tweens.add({ targets: v.sprite, alpha: 0.55, delay: 400, duration: 400 });
      else v.sprite.setAlpha(0.55);
    } else if (animate) {
      this.tweens.add({ targets: v.sprite, alpha: 0.2, angle: v.snap.side === 'A' ? -90 : 90, duration: 400 });
    } else v.sprite.setAlpha(0.2).setAngle(v.snap.side === 'A' ? -90 : 90);
    if (animate) this.fx(v, 'fx_death', 1.6, 600);
  }

  // ---------- мелочи ----------

  /** Центр тела над точкой ног — туда летят снаряды и всплывают цифры. */
  private body(v: UnitView): [number, number] {
    return [v.node.x, v.node.y - v.look.height * 0.5];
  }

  private redraw(v: UnitView): void {
    const max = v.snap.maxHp;
    cropBar(v.hpBar, v.hp / max);
    cropBar(v.energyBar, v.energy / COMBAT.energy.max);
    v.shieldBar.setVisible(v.alive && v.shield > 0);
    cropBar(v.shieldBar, Math.min(1, v.shield / max));
  }

  private projectile(from: UnitView, to: UnitView, texId: string): void {
    const [fx, fy] = this.body(from);
    const [tx, ty] = this.body(to);
    const p = this.add.image(fx, fy, texId).setDisplaySize(48, 48).setDepth(4000);
    this.tweens.add({ targets: p, x: tx, y: ty, duration: PROJECTILE_MS, onComplete: () => p.destroy() });
  }

  private fx(v: UnitView, texId: string, scale: number, duration = 250, alpha = 0.8): void {
    const [cx, cy] = this.body(v);
    const img = this.add.image(cx, cy, texId).setDisplaySize(140 * scale, 140 * scale).setAlpha(alpha).setDepth(4000);
    this.tweens.add({ targets: img, alpha: 0, scale: img.scale * 1.2, duration, onComplete: () => img.destroy() });
  }

  private floating(x: number, y: number, value: string, color: string, size = 40): void {
    const t = text(this, x, y, value, size, color, { stroke: '#000000', strokeThickness: 6, fontStyle: 'bold' }).setDepth(5000);
    this.tweens.add({ targets: t, y: y - 90, alpha: 0, duration: 900, onComplete: () => t.destroy() });
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
