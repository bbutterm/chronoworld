import Phaser from 'phaser';
import { actChangeJob, availableJobChanges } from '../../core';
import { CONTENT, GAME } from '../content';
import { describeEvents, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { card, confirm, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen } from '../screen';
import { commit, session, today } from '../session';
import { portraitKey } from '../sprites';
import { button, text, toast } from '../ui';

/** Выбор новой профессии из доступных веток. */
export class JobChangeScene extends Phaser.Scene {
  constructor() {
    super('JobChange');
  }

  create(data: { heroId: string }): void {
    const hero = session.save.heroes.find((h) => h.id === data.heroId);
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
      30,
      '#e0cfb0',
      { wordWrap: { width: 1000 } },
    );
    if (!options.length) {
      text(this, GAME_W / 2, 600, 'Сейчас смена профессии недоступна', 36);
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
      const bg = card(this, x, y, tileW, tileH, false);
      bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.select(hero.id, jobId));
      portrait(this, x, y - 25, portraitKey(job.visual.sprite), 160);
      text(this, x, y + 90, job.name, 34, '#ffe9a8', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 });
      this.tiles.push({ jobId, bg });
    });
    this.highlight = this.add.rectangle(0, 0, tileW + 8, tileH + 8).setStrokeStyle(8, 0xffd84a).setVisible(false);
    const rows = Math.ceil(options.length / cols);
    this.detailTop = top + rows * (tileH + 20) + 10;
    this.select(hero.id, options[0]);
  }

  private detail!: Phaser.GameObjects.Container;
  private detailTop = 0;
  private highlight!: Phaser.GameObjects.Rectangle;
  private tiles: { jobId: string; bg: Phaser.GameObjects.NineSlice }[] = [];

  private select(heroId: string, jobId: string): void {
    const hero = session.save.heroes.find((h) => h.id === heroId)!;
    const tile = this.tiles.find((t) => t.jobId === jobId);
    if (tile) this.highlight.setPosition(tile.bg.x, tile.bg.y).setVisible(true);
    this.detail.removeAll(true);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.detail.add(o);
      return o;
    };
    const job = CONTENT.jobs[jobId];
    const top = this.detailTop;
    const bottom = CONTENT_BOTTOM;
    add(card(this, GAME_W / 2, (top + bottom) / 2, 1040, bottom - top, true));
    const range = CONTENT.skills[job.basic]?.range === 'melee' ? 'ближний бой' : 'дальний бой';
    let y = top + 60;
    add(text(this, GAME_W / 2, y, job.name, 50, '#4a3520', { fontStyle: 'bold' }));
    y += 55;
    add(text(this, GAME_W / 2, y, `${ROLE_NAMES[job.role] ?? job.role} · ${range}`, 30, '#2f6b3a', { fontStyle: 'bold' }));
    y += 55;
    const s = job.baseStats;
    add(text(this, GAME_W / 2, y, `HP ${s.hp}   ATK ${s.atk}   DEF ${s.def}   SPD ${s.spd}`, 32, '#4a3520'));
    y += 45;
    if (job.description) {
      const d = add(text(this, GAME_W / 2, y, job.description, 28, '#6a4a2a', { wordWrap: { width: 940 } }).setOrigin(0.5, 0));
      y += d.height + 25;
    }
    add(text(this, 90, y, 'Навыки профессии:', 28, '#4a3520', { fontStyle: 'bold' }).setOrigin(0, 0));
    y += 45;
    for (const sk of [...job.skills].sort((a, b) => a.jobLevel - b.jobLevel)) {
      if (y > bottom - 200) break;
      add(text(this, 90, y, `джоб ${sk.jobLevel}: ${CONTENT.skills[sk.skill]?.name ?? sk.skill}`, 26, '#4a3520').setOrigin(0, 0));
      y += 38;
    }
    add(
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
      toast(this, e instanceof Error ? e.message : String(e), '#ffb4a0');
      return;
    }
    const next = r.save;
    commit(next);
    const lines = describeEvents(r.events, next, GAME);
    this.scene.start('Hero', { heroId });
    const heroScene = this.scene.get('Hero');
    heroScene.events.once(Phaser.Scenes.Events.CREATE, () => toast(heroScene, lines.join('\n'), '#9fe0a6', 5000));
  }
}
