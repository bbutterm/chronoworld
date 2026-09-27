import Phaser from 'phaser';
import { markHint } from '../hints';
import { actChangeJob, availableJobChanges, type HeroState } from '../../core';
import { CONTENT, GAME } from '../content';
import { describeEvents, heroSprite, jobChangeSkills, otherJobChangeReady, ROLE_NAMES, statsLine } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, confirm, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen, unitFigure } from '../screen';
import { commit, session, today } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, pressable, ScrollArea, text, toast } from '../ui';
import { C, FS, TINT } from '../theme';
import { SKIN } from '../skin';

/** Куда вернуть игрока после смены профессии (или по «Назад»): экран, откуда он пришёл. */
export interface JobChangeFrom {
  to: string;
  data?: object;
}

export interface JobChangeData {
  heroId: string;
  /** По умолчанию — карточка героя. */
  from?: JobChangeFrom;
}

/** Сколько длится торжественный показ новой профессии, если игрок не коснулся экрана раньше. */
export const REVEAL_MS = 2200;
/** Первые мс показа касание не закрывает его (палец ещё на кнопке «Выбрать» — не проскочить мимо). */
const REVEAL_TAP_LOCK_MS = 450;

/**
 * Выбор новой профессии из доступных веток. После выбора — короткий показ «герой в новой профессии»
 * и возврат туда, откуда пришли (итоги боя, карточка героя). Следующего готового героя не открываем сами:
 * на том экране будет кнопка «Ещё герой готов к профессии».
 */
export class JobChangeScene extends Phaser.Scene {
  private from!: JobChangeFrom;
  /** Показ новой профессии открыт (для e2e и защиты от повторного выбора). */
  revealing = false;

  constructor() {
    super('JobChange');
  }

  create(data: JobChangeData): void {
    this.from = data.from ?? { to: 'Hero', data: { heroId: data.heroId } };
    this.revealing = false;
    const hero = session.save.heroes.find((h) => h.id === data.heroId);
    const options = hero ? availableJobChanges(hero, GAME) : [];
    // Профессию уже сменили (или герой не дорос) — этот экран ему не нужен: сразу назад.
    if (!hero || !options.length) {
      this.scene.start(this.from.to, this.from.data);
      return;
    }
    markHint('job_change');
    screen(this, 'Смена профессии', null, { to: this.from.to, data: this.from.data });
    const reset = GAME.progression.jobChange.resetJobLevel;
    text(
      this,
      GAME_W / 2,
      CONTENT_TOP + 50,
      `${hero.name}: ${CONTENT.jobs[hero.job]?.name ?? hero.job}, джоб ${hero.jobLevel}.` +
        (reset ? ' Уровень начнётся с 1.' : '') +
        (GAME.progression.keepSkillsOnJobChange ? ' Навыки остаются.' : ''),
      FS.body,
      C.muted,
      { wordWrap: { width: 1000 }, stroke: C.stroke, strokeThickness: 3 },
    );

    // Сетка вариантов (до 3 в ряд) и подробности выбранного ниже — как выбор героя в AFK Arena.
    const cols = Math.min(3, options.length);
    const tileW = 320;
    const tileH = 250;
    const top = CONTENT_TOP + 120;
    this.detail = this.add.container(0, 0);
    this.tiles = [];
    options.forEach((jobId, i) => {
      const job = CONTENT.jobs[jobId];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = GAME_W / 2 + (col - (cols - 1) / 2) * (tileW + 20);
      const y = top + tileH / 2 + row * (tileH + 20);
      const bg = pressable(this, card(this, x, y, tileW, tileH, false), tileW, tileH, () => this.select(hero.id, jobId));
      portrait(this, x, y - 25, portraitKey(job.visual.sprite), 160);
      const name = ellipsize(text(this, x, y + 90, job.name, FS.h3, SKIN.cream, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), tileW - 24);
      this.tiles.push({ jobId, bg, name });
    });
    // Рамка выбранного варианта — скруглённая золотая, как рамки скина, с мягкой пульсацией.
    this.highlight = this.add.graphics().setDepth(5);
    this.highlight.lineStyle(6, TINT.gold, 1).strokeRoundedRect(-tileW / 2 - 4, -tileH / 2 - 4, tileW + 8, tileH + 8, 26);
    this.highlight.lineStyle(14, TINT.gold, 0.18).strokeRoundedRect(-tileW / 2 - 8, -tileH / 2 - 8, tileW + 16, tileH + 16, 30);
    this.tweens.add({ targets: this.highlight, alpha: 0.6, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' });
    const rows = Math.ceil(options.length / cols);
    this.detailTop = top + rows * (tileH + 20) + 10;
    // Подробности — карточка с прокруткой (описание и навыки могут не влезть), «Выбрать» закреплена внизу.
    card(this, GAME_W / 2, (this.detailTop + CONTENT_BOTTOM) / 2, 1040, CONTENT_BOTTOM - this.detailTop, true);
    this.area = new ScrollArea(this, this.detailTop + 12, CONTENT_BOTTOM - 180);
    // Кнопка «Выбрать» живёт в detail — он создан раньше карточки и без глубины оказывался под ней (кнопку не было видно).
    this.detail.setDepth(10);
    this.select(hero.id, options[0]);
  }

  private detail!: Phaser.GameObjects.Container;
  private area!: ScrollArea;
  private detailTop = 0;
  private highlight!: Phaser.GameObjects.Graphics;
  private tiles: { jobId: string; bg: Phaser.GameObjects.NineSlice; name: Phaser.GameObjects.Text }[] = [];

  private select(heroId: string, jobId: string): void {
    const hero = session.save.heroes.find((h) => h.id === heroId)!;
    const tile = this.tiles.find((t) => t.jobId === jobId);
    if (tile) this.highlight.setPosition(tile.bg.x, tile.bg.y);
    for (const t of this.tiles) t.name.setColor(t.jobId === jobId ? SKIN.goldLight : SKIN.cream);
    this.detail.removeAll(true);
    this.area.clear();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => this.area.add(o);
    const job = CONTENT.jobs[jobId];
    const bottom = CONTENT_BOTTOM;
    const range = CONTENT.skills[job.basic]?.range === 'melee' ? 'ближний бой' : 'дальний бой';
    const startLevel = GAME.progression.jobChange.resetJobLevel ? 1 : hero.jobLevel;
    let y = 45;
    add(text(this, GAME_W / 2, y, job.name, FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 6 }));
    y += 55;
    add(text(this, GAME_W / 2, y, `${ROLE_NAMES[job.role] ?? job.role} · ${range}`, FS.body, C.inkSuccess, { fontStyle: 'bold' }));
    y += 50;
    add(text(this, GAME_W / 2, y, statsLine(job.baseStats, '   '), FS.body, C.ink));
    y += 40;
    if (job.description) {
      const d = add(text(this, GAME_W / 2, y, job.description, FS.small, C.inkMuted, { wordWrap: { width: 940 }, lineSpacing: 4 }).setOrigin(0.5, 0));
      y += d.height + 25;
    }
    add(this.add.rectangle(GAME_W / 2, y, 900, 2, TINT.frame, 0.4));
    y += 20;
    add(text(this, 90, y, 'Навыки профессии', FS.small, C.inkGold, { fontStyle: 'bold' }).setOrigin(0, 0));
    y += 48;
    for (const sk of [...job.skills].sort((a, b) => a.jobLevel - b.jobLevel)) {
      const now = sk.jobLevel <= startLevel;
      add(text(this, 90, y, CONTENT.skills[sk.skill]?.name ?? sk.skill, FS.small, now ? C.ink : C.inkMuted, { fontStyle: now ? 'bold' : 'normal' }).setOrigin(0, 0));
      add(text(this, 990, y, now ? 'сразу' : `джоб ${sk.jobLevel}`, FS.caption, now ? C.inkSuccess : C.inkMuted).setOrigin(1, 0));
      y += 44;
    }
    this.area.setContentHeight(y + 10);
    this.detail.add(
      button(this, GAME_W / 2, bottom - 90, 560, 130, 'ui_btn_primary', 'Выбрать', () =>
        confirm(this, `${hero.name} станет: ${job.name}.\nВернуться назад нельзя.`, 'Выбрать', () => this.choose(heroId, jobId)),
      ).container,
    );
  }

  private choose(heroId: string, jobId: string): void {
    if (this.revealing) return;
    const save = session.save;
    if (!save.heroes.some((h) => h.id === heroId)) return;
    let r: ReturnType<typeof actChangeJob>;
    try {
      r = actChangeJob(save, today(), heroId, jobId, GAME);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
      return;
    }
    commit(r.save);
    const hero = r.save.heroes.find((h) => h.id === heroId)!;
    this.reveal(hero, jobChangeSkills(r.events, hero, GAME), describeEvents(r.events, r.save, GAME));
  }

  /** Торжественный показ: вспышка, лучи, герой в новой профессии, её название и новые навыки. Касание или пауза — назад. */
  private reveal(hero: HeroState, skills: string[], lines: string[]): void {
    this.revealing = true;
    this.area.locked = true;
    const cx = GAME_W / 2;
    const cy = 820;
    const job = CONTENT.jobs[hero.job];
    const layer = this.add.container(0, 0).setDepth(9500).setName('jobReveal');
    const shade = this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, 0x07060a, 0.95).setInteractive();
    const rays = this.add.image(cx, cy - 120, 'skin_rays').setDisplaySize(1100, 1100).setAlpha(0);
    layer.add([shade, rays]);
    this.tweens.add({ targets: rays, alpha: 0.9, duration: 350 });
    this.tweens.add({ targets: rays, angle: 360, duration: 24000, repeat: -1 });

    const head = text(this, cx, 330, 'Новая профессия!', FS.h2, SKIN.cream, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 });
    const pedestal = this.add.ellipse(cx, cy + 10, 300, 60, 0x000000, 0.45);
    layer.add([head, pedestal]);
    unitFigure(this, heroSprite(hero, GAME), cx, cy, 380, {
      maxScale: 2,
      onReady: (fig) => {
        layer.addAt(fig, layer.getIndex(pedestal) + 1);
        const sx = fig.scaleX;
        fig.setScale(sx * 0.6).setAlpha(0);
        this.tweens.add({ targets: fig, scale: sx, alpha: 1, duration: 420, ease: 'Back.easeOut' });
      },
    });
    const title = text(this, cx, cy + 110, job?.name ?? hero.job, FS.hero + 16, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 });
    const sub = text(this, cx, cy + 190, `${hero.name} · ${ROLE_NAMES[job?.role ?? ''] ?? ''}`, FS.h3, SKIN.cream, { stroke: C.stroke, strokeThickness: 5 });
    const skillLine = skills.length ? `Новые навыки: ${skills.join(', ')}` : 'Навыки откроются с ростом джоба';
    const sk = text(this, cx, cy + 270, skillLine, FS.body, C.success, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5, wordWrap: { width: 900 }, lineSpacing: 6 });
    const hint = text(this, cx, GAME_H - 170, 'Коснитесь, чтобы продолжить', FS.small, SKIN.creamDim, { stroke: C.stroke, strokeThickness: 4 });
    layer.add([title, sub, sk, hint]);
    title.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 450, delay: 150, ease: 'Back.easeOut' });
    for (const [i, o] of [sub, sk].entries()) {
      o.setAlpha(0);
      this.tweens.add({ targets: o, alpha: 1, y: { from: o.y + 20, to: o.y }, duration: 300, delay: 350 + i * 120 });
    }
    this.tweens.add({ targets: hint, alpha: 0.35, yoyo: true, repeat: -1, duration: 600 });

    // Искры разлетаются от героя.
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3;
      const d = 220 + Math.random() * 260;
      const s = this.add.image(cx, cy - 130, 'skin_spark').setTint(i % 3 ? 0xffd884 : 0xffffff).setScale(0.4 + Math.random() * 0.6);
      layer.add(s);
      this.tweens.add({
        targets: s,
        x: cx + Math.cos(a) * d,
        y: cy - 130 + Math.sin(a) * d,
        alpha: 0,
        angle: 180,
        duration: 900 + Math.random() * 500,
        delay: 80 + Math.random() * 200,
        ease: 'Cubic.easeOut',
      });
    }
    // Золотая вспышка поверх всего.
    const flash = this.add.rectangle(cx, GAME_H / 2, GAME_W, GAME_H, 0xffe2a0, 0.85);
    layer.add(flash);
    this.tweens.add({ targets: flash, alpha: 0, duration: 450, ease: 'Quad.easeOut' });

    // Время показа — по настоящим часам, а не по кадрам игры (на медленном устройстве кадров мало).
    const opened = performance.now();
    let done = false;
    const leave = () => {
      if (done || !this.sys.isActive()) return;
      done = true;
      this.finish(hero, lines);
    };
    shade.on('pointerup', () => {
      if (performance.now() - opened >= REVEAL_TAP_LOCK_MS) leave();
    });
    const timer = window.setTimeout(leave, REVEAL_MS);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.clearTimeout(timer));
  }

  /** Назад, откуда пришли; там — тост с итогом и, если кто-то ещё готов, об этом. */
  private finish(hero: HeroState, lines: string[]): void {
    const more = otherJobChangeReady(session.save, GAME, hero.id);
    const msg = [...lines, ...(more ? [`Ещё герой готов к профессии: ${more.name}`] : [])].join('\n');
    const target = this.from.to;
    this.scene.start(target, this.from.data);
    const sc = this.scene.get(target);
    sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, msg, C.success, 4500));
  }
}
