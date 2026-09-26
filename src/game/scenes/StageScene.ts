import Phaser from 'phaser';
import { enemySquad, getStage, stageStatus } from '../../core';
import { CONTENT, GAME } from '../content';
import { assignSlot, heroSprite } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, portrait, screen } from '../screen';
import { commit, session } from '../session';
import { portraitKey } from '../sprites';
import { button, panel, text, toast } from '../ui';

const SLOT_W = 196;
const slotX = (i: number) => GAME_W / 2 + (i - 2) * (SLOT_W + 12);

/** Подготовка к этапу: враги, награда, ваш отряд (слот → герой), «В бой». */
export class StageScene extends Phaser.Scene {
  private stageId!: string;
  private selected = 0;
  private squadLayer!: Phaser.GameObjects.Container;
  private fightBtn!: ReturnType<typeof button>;

  constructor() {
    super('Stage');
  }

  create(data: { stageId: string }): void {
    this.stageId = data.stageId;
    this.selected = Math.max(0, session.save.squad.indexOf(null));
    const stage = getStage(GAME, this.stageId);
    screen(this, `Этап ${stage.globalIndex + 1}${stage.boss ? ' · БОСС' : ''}`, null, { to: 'Campaign' });

    // --- Противник ---
    card(this, GAME_W / 2, 440, 1050, 480);
    text(this, GAME_W / 2, 240, stage.name, 44, '#ffe9a8', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 });
    text(this, GAME_W / 2, 295, 'Противник', 32, '#f0a0a0');
    enemySquad(this.stageId, GAME).forEach((u, i) => {
      const x = slotX(i);
      panel(this, x, 450, SLOT_W, 220, u ? 'ui_slot_filled' : 'ui_slot_empty');
      text(this, x, 355, i < 2 ? 'фронт' : 'тыл', 24, '#b8bcc8');
      if (!u) return;
      portrait(this, x, 440, portraitKey(u.visual.sprite), 150);
      text(this, x, 590, u.name, 26, u.kind === 'boss' ? '#ff9a8a' : '#ffffff', { stroke: '#000000', strokeThickness: 4, wordWrap: { width: SLOT_W } });
      text(this, x, 630, `HP ${u.stats.hp} · ATK ${u.stats.atk}`, 22, '#e0cfb0');
    });

    // --- Награда ---
    const first = stageStatus(session.save, this.stageId, GAME) !== 'cleared';
    const k = first ? 1 : GAME.progression.campaign.replayRewardMultiplier;
    card(this, GAME_W / 2, 755, 1050, 110, true);
    text(
      this,
      GAME_W / 2,
      755,
      `${first ? 'Награда' : `Повтор (×${k})`}:  золото ${Math.floor(stage.rewards.gold * k)} · опыт ${Math.floor(stage.rewards.jobExp * k)} каждому`,
      32,
      '#4a3520',
      { fontStyle: 'bold' },
    );

    // --- Ваш отряд и выбор героев ---
    card(this, GAME_W / 2, 1230, 1050, 800);
    text(this, GAME_W / 2, 870, 'Ваш отряд', 36, '#9fe0a6', { fontStyle: 'bold' });
    text(this, GAME_W / 2, 905, 'Выберите слот, затем героя. Нажмите на выбранный слот ещё раз — убрать.', 24, '#e0cfb0', {
      wordWrap: { width: 980 },
    });
    this.squadLayer = this.add.container(0, 0);

    this.fightBtn = button(this, GAME_W / 2, GAME_H - 110, 640, 150, 'ui_btn_primary', 'В бой', () => this.fight(), 56);
    this.drawSquad();
  }

  private drawSquad(): void {
    this.squadLayer.removeAll(true);
    const save = session.save;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => {
      this.squadLayer.add(o);
      return o;
    };

    save.squad.forEach((heroId, i) => {
      const x = slotX(i);
      const y = 1095;
      const sel = i === this.selected;
      const bg = add(panel(this, x, y, SLOT_W, 250, sel ? 'ui_slot_selected' : heroId ? 'ui_slot_filled' : 'ui_slot_empty'));
      bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.onSlot(i));
      add(text(this, x, y - 140, i < 2 ? 'фронт' : 'тыл', 22, '#b8bcc8'));
      const hero = heroId ? save.heroes.find((h) => h.id === heroId) : undefined;
      if (!hero) {
        add(text(this, x, y, 'пусто', 26, sel ? '#4a3520' : '#9a9aa0'));
        return;
      }
      add(portrait(this, x, y - 25, portraitKey(heroSprite(hero, GAME)), 150));
      add(text(this, x, y + 75, hero.name, 28, '#ffffff', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 }));
      add(text(this, x, y + 108, `${CONTENT.jobs[hero.job]?.name ?? hero.job} · ${hero.jobLevel}`, 22, '#ffe9a8', { stroke: '#000000', strokeThickness: 4 }));
    });

    add(text(this, GAME_W / 2, 1270, 'Герои', 32, '#ffe9a8'));
    const step = Math.min(200, 1000 / save.heroes.length);
    save.heroes.forEach((h, i) => {
      const x = GAME_W / 2 + (i - (save.heroes.length - 1) / 2) * step;
      const y = 1420;
      const inSquad = save.squad.indexOf(h.id);
      const bg = add(panel(this, x, y, step - 14, 220, inSquad >= 0 ? 'ui_slot_filled' : 'ui_slot_selected'));
      bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.onHero(h.id));
      add(portrait(this, x, y - 20, portraitKey(heroSprite(h, GAME)), 130)).setAlpha(inSquad >= 0 ? 0.55 : 1);
      add(text(this, x, y + 70, h.name, 26, '#ffffff', { stroke: '#000000', strokeThickness: 5 }));
      if (inSquad >= 0) add(text(this, x, y - 85, `слот ${inSquad + 1}`, 22, '#9fe0a6', { stroke: '#000000', strokeThickness: 4 }));
    });

    const ready = save.squad.some(Boolean);
    this.fightBtn.container.setAlpha(ready ? 1 : 0.45);
  }

  private onSlot(i: number): void {
    const save = session.save;
    if (i === this.selected && save.squad[i]) {
      if (save.squad.filter(Boolean).length === 1) {
        toast(this, 'В отряде должен остаться хотя бы один герой');
        return;
      }
      commit({ ...save, squad: assignSlot(save.squad, i, null) });
    }
    this.selected = i;
    this.drawSquad();
  }

  private onHero(heroId: string): void {
    const save = session.save;
    commit({ ...save, squad: assignSlot(save.squad, this.selected, heroId) });
    const nextEmpty = session.save.squad.indexOf(null);
    if (nextEmpty >= 0) this.selected = nextEmpty;
    this.drawSquad();
  }

  private fight(): void {
    if (!session.save.squad.some(Boolean)) {
      toast(this, 'Поставьте в отряд хотя бы одного героя');
      return;
    }
    this.scene.start('Battle', { mode: 'stage', stageId: this.stageId });
  }
}
