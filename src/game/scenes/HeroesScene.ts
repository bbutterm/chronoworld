import Phaser from 'phaser';
import { achievementStatus, availableJobChanges, expToNext, heroEquipment, heroPower, squadPower, withGear, type HeroState } from '../../core';
import { CONTENT, GAME } from '../content';
import { claimableAchievements, formatNumber, heroSprite, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { badge, card, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen } from '../screen';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, icon, progressBar, text } from '../ui';

/** Список героев: профессия, джоб-уровень, полоса опыта; нажатие — карточка героя. */
export class HeroesScene extends Phaser.Scene {
  constructor() {
    super('Heroes');
  }

  create(): void {
    screen(this, 'Герои', 'Heroes');
    const save = session.save;
    const heroes = save.heroes;
    // Мощь отряда (K2) и вход в инвентарь (K6).
    const barY = CONTENT_TOP + 50;
    text(this, 30, barY - 22, 'Мощь отряда', 28, '#e0cfb0').setOrigin(0, 0.5);
    text(this, 30, barY + 22, formatNumber(squadPower(save, GAME)), 38, '#ffd84a', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setOrigin(0, 0.5);
    const free = save.inventory.items.filter((i) => i.equippedBy === null).length;
    button(this, 480, barY, 300, 100, 'ui_btn_secondary', `Инвентарь${free ? ` (${free})` : ''}`, () => this.scene.start('Inventory', {}), 34);
    // K10: достижения — отсюда и с главной.
    button(this, 810, barY, 330, 100, 'ui_btn_secondary', 'Достижения', () => this.scene.start('Achievements', { from: 'Heroes' }), 34);
    badge(this, 810 + 150, barY - 42, claimableAchievements(achievementStatus(save, GAME)));

    const listTop = CONTENT_TOP + 120;
    const gap = 20;
    const h = Math.min(270, (CONTENT_BOTTOM - listTop - gap * (heroes.length - 1)) / heroes.length);
    const gctx = withGear(GAME, save);
    heroes.forEach((hero, i) => this.heroCard(hero, listTop + h / 2 + i * (h + gap), h, heroPower(hero, gctx)));
  }

  private heroCard(hero: HeroState, y: number, h: number, power: number): void {
    const job = CONTENT.jobs[hero.job];
    const bg = card(this, GAME_W / 2, y, 1020, h);
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.start('Hero', { heroId: hero.id }));
    const px = 150;
    card(this, px, y, h - 50, h - 50, true);
    portrait(this, px, y, portraitKey(heroSprite(hero, GAME)), h - 70);

    const x = 300;
    text(this, x, y - h / 2 + 55, hero.name, 46, '#ffffff', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setOrigin(0, 0.5);
    const squadSlot = session.save.squad.indexOf(hero.id);
    if (squadSlot >= 0) text(this, 700, y - h / 2 + 55, 'в отряде', 28, '#9fe0a6').setOrigin(0, 0.5);
    text(this, 990, y - h / 2 + 55, `Мощь ${formatNumber(power)}`, 32, '#ffd84a', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 }).setOrigin(1, 0.5);
    const gear = heroEquipment(session.save, hero.id).length;
    text(this, 990, y - 10, `снаряжение ${gear}/4`, 28, gear ? '#6fb8ff' : '#9a9aa0').setOrigin(1, 0.5);
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
