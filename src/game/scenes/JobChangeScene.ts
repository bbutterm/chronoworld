import Phaser from 'phaser';
import { markHint } from '../hints';
import { actChangeJob, availableJobChanges } from '../../core';
import { CONTENT, GAME } from '../content';
import { describeEvents, firstJobChangeReady, ROLE_NAMES, statsLine } from '../flow';
import { GAME_W } from '../layout';
import { card, confirm, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen } from '../screen';
import { commit, session, today } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, emptyState, pressable, ScrollArea, text, toast } from '../ui';
import { C, FS } from '../theme';

/** Выбор новой профессии из доступных веток. */
export class JobChangeScene extends Phaser.Scene {
  constructor() {
    super('JobChange');
  }

  create(data: { heroId: string }): void {
    const hero = session.save.heroes.find((h) => h.id === data.heroId);
    markHint('job_change');
    screen(this, 'Смена профессии', null, { to: 'Hero', data: { heroId: data.heroId } });
    if (!hero) return;
    const options = availableJobChanges(hero, GAME);
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
      { wordWrap: { width: 1000 } },
    );
    if (!options.length) {
      emptyState(this, GAME_W / 2, 600, 'Сейчас смена профессии недоступна.\nОна открывается на определённом джобе — смотрите подсказку в карточке героя.');
      return;
    }

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
      ellipsize(text(this, x, y + 90, job.name, FS.h3, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), tileW - 24);
      this.tiles.push({ jobId, bg });
    });
    this.highlight = this.add.rectangle(0, 0, tileW + 8, tileH + 8).setStrokeStyle(8, 0xffd84a).setVisible(false);
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
  private highlight!: Phaser.GameObjects.Rectangle;
  private tiles: { jobId: string; bg: Phaser.GameObjects.NineSlice }[] = [];

  private select(heroId: string, jobId: string): void {
    const hero = session.save.heroes.find((h) => h.id === heroId)!;
    const tile = this.tiles.find((t) => t.jobId === jobId);
    if (tile) this.highlight.setPosition(tile.bg.x, tile.bg.y).setVisible(true);
    this.detail.removeAll(true);
    this.area.clear();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => this.area.add(o);
    const job = CONTENT.jobs[jobId];
    const bottom = CONTENT_BOTTOM;
    const range = CONTENT.skills[job.basic]?.range === 'melee' ? 'ближний бой' : 'дальний бой';
    let y = 45;
    add(text(this, GAME_W / 2, y, job.name, FS.h1, C.ink, { fontStyle: 'bold' }));
    y += 55;
    add(text(this, GAME_W / 2, y, `${ROLE_NAMES[job.role] ?? job.role} · ${range}`, FS.body, C.inkSuccess, { fontStyle: 'bold' }));
    y += 50;
    add(text(this, GAME_W / 2, y, statsLine(job.baseStats, '   '), FS.body, C.ink));
    y += 40;
    if (job.description) {
      const d = add(text(this, GAME_W / 2, y, job.description, FS.small, C.inkMuted, { wordWrap: { width: 940 }, lineSpacing: 4 }).setOrigin(0.5, 0));
      y += d.height + 25;
    }
    add(text(this, 90, y, 'Навыки профессии:', FS.small, C.ink, { fontStyle: 'bold' }).setOrigin(0, 0));
    y += 45;
    for (const sk of [...job.skills].sort((a, b) => a.jobLevel - b.jobLevel)) {
      add(text(this, 90, y, `джоб ${sk.jobLevel}: ${CONTENT.skills[sk.skill]?.name ?? sk.skill}`, FS.small, C.ink).setOrigin(0, 0));
      y += 42;
    }
    this.area.setContentHeight(y + 10);
    this.detail.add(
      button(this, GAME_W / 2, bottom - 90, 560, 130, 'ui_btn_primary', 'Выбрать', () =>
        confirm(this, `${hero.name} станет: ${job.name}. Вернуться назад нельзя.`, 'Выбрать', () => this.choose(heroId, jobId)),
      ).container,
    );
  }

  private choose(heroId: string, jobId: string): void {
    const save = session.save;
    const hero = save.heroes.find((h) => h.id === heroId);
    if (!hero) return;
    let r: ReturnType<typeof actChangeJob>;
    try {
      r = actChangeJob(save, today(), heroId, jobId, GAME);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
      return;
    }
    const next = r.save;
    commit(next);
    const lines = describeEvents(r.events, next, GAME);
    // Следующий готовый герой — сразу его выбор (как цепочка наград в AFK); иначе — карточка героя.
    const more = firstJobChangeReady(next, GAME);
    const target = more ? 'JobChange' : 'Hero';
    this.scene.start(target, { heroId: more?.id ?? heroId });
    const sc = this.scene.get(target);
    sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, lines.join('\n'), C.success, 5000));
  }
}
