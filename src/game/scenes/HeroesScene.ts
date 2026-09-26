import Phaser from 'phaser';
import { availableJobChanges, expToNext, type HeroState } from '../../core';
import { CONTENT, GAME } from '../content';
import { heroSprite, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen } from '../screen';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { icon, progressBar, text } from '../ui';

/** Список героев: профессия, джоб-уровень, полоса опыта; нажатие — карточка героя. */
export class HeroesScene extends Phaser.Scene {
  constructor() {
    super('Heroes');
  }

  create(): void {
    screen(this, 'Герои', 'Heroes');
    const heroes = session.save.heroes;
    const gap = 20;
    const h = Math.min(270, (CONTENT_BOTTOM - CONTENT_TOP - gap * (heroes.length - 1)) / heroes.length);
    heroes.forEach((hero, i) => this.heroCard(hero, CONTENT_TOP + h / 2 + i * (h + gap), h));
  }

  private heroCard(hero: HeroState, y: number, h: number): void {
    const job = CONTENT.jobs[hero.job];
    const bg = card(this, GAME_W / 2, y, 1020, h);
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.start('Hero', { heroId: hero.id }));
    const px = 150;
    card(this, px, y, h - 50, h - 50, true);
    portrait(this, px, y, portraitKey(heroSprite(hero, GAME)), h - 70);

    const x = 300;
    text(this, x, y - h / 2 + 55, hero.name, 46, '#ffffff', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setOrigin(0, 0.5);
    const squadSlot = session.save.squad.indexOf(hero.id);
    if (squadSlot >= 0) text(this, 960, y - h / 2 + 55, `в отряде`, 26, '#9fe0a6').setOrigin(1, 0.5);
    text(this, x, y - 10, `${job?.name ?? hero.job} · ${ROLE_NAMES[job?.role ?? ''] ?? ''}`, 32, '#ffe9a8').setOrigin(0, 0.5);

    const max = job?.maxJobLevel ?? hero.jobLevel;
    const atMax = hero.jobLevel >= max;
    const need = expToNext(hero.jobLevel, GAME.progression);
    text(this, x, y + 45, `Джоб ${hero.jobLevel} / ${max}`, 30, '#ffffff').setOrigin(0, 0.5);
    progressBar(this, x + 230, y + 45, 400, 30, atMax ? 1 : hero.jobExp / need, atMax ? 0xffd84a : 0x6fd06f);
    text(this, x + 430, y + 45, atMax ? 'макс.' : `${hero.jobExp} / ${need}`, 24, '#ffffff', { stroke: '#000000', strokeThickness: 4 });

    if (availableJobChanges(hero, GAME).length > 0) {
      icon(this, 960, y + 45, 'iconCircle_blue', 40).setTint(0xffd84a);
      text(this, 930, y + 90, 'Смена профессии!', 26, '#ffd84a', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 }).setOrigin(1, 0.5);
    }
  }
}
