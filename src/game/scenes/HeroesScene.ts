import Phaser from 'phaser';
import { achievementStatus, availableJobChanges, expToNext, heroEquipment, heroPower, squadPower, withGear, type HeroState } from '../../core';
import { CONTENT, GAME } from '../content';
import { claimableAchievements, formatNumber, heroSprite, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { badge, card, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen } from '../screen';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, emptyState, icon, pressable, progressBar, ScrollArea, text } from '../ui';
import { C, FS, TINT } from '../theme';

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
    text(this, 30, barY - 22, 'Мощь отряда', FS.small, C.muted).setOrigin(0, 0.5);
    text(this, 30, barY + 22, formatNumber(squadPower(save, GAME)), FS.h3, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    const free = save.inventory.items.filter((i) => i.equippedBy === null).length;
    button(this, 480, barY, 300, 100, 'ui_btn_secondary', `Инвентарь${free ? ` (${free})` : ''}`, () => this.scene.start('Inventory', {}), FS.h3);
    // K10: достижения — отсюда и с главной.
    button(this, 810, barY, 330, 100, 'ui_btn_secondary', 'Достижения', () => this.scene.start('Achievements', { from: 'Heroes' }), FS.h3);
    badge(this, 810 + 150, barY - 42, claimableAchievements(achievementStatus(save, GAME)));

    const listTop = CONTENT_TOP + 120;
    const gap = 20;
    this.area = new ScrollArea(this, listTop, CONTENT_BOTTOM + 10);
    if (!heroes.length) {
      this.area.add(emptyState(this, GAME_W / 2, 300, 'Героев пока нет.\nНачните новую игру на главной — отряд выдаётся сразу.'));
      return;
    }
    // До 5 героев — карточки делят экран; больше — фиксированная высота и прокрутка пальцем.
    const fit = (CONTENT_BOTTOM - listTop - gap * (heroes.length - 1)) / heroes.length;
    const h = heroes.length <= 5 ? Math.min(270, fit) : 250;
    const gctx = withGear(GAME, save);
    heroes.forEach((hero, i) => this.heroCard(hero, h / 2 + i * (h + gap), h, heroPower(hero, gctx)));
    this.area.setContentHeight(heroes.length * (h + gap));
  }

  private area!: ScrollArea;

  private heroCard(hero: HeroState, y: number, h: number, power: number): void {
    const a = this.area;
    const job = CONTENT.jobs[hero.job];
    const bg = a.add(card(this, GAME_W / 2, y, 1020, h));
    pressable(this, bg, 1020, h, a.tap(() => this.scene.start('Hero', { heroId: hero.id })));
    const px = 150;
    a.add(card(this, px, y, h - 50, h - 50, true));
    a.add(portrait(this, px, y, portraitKey(heroSprite(hero, GAME)), h - 70));

    const x = 300;
    a.add(ellipsize(text(this, x, y - h / 2 + 55, hero.name, FS.h1, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5), 380));
    const squadSlot = session.save.squad.indexOf(hero.id);
    const pw = a.add(text(this, 990, y - h / 2 + 55, `Мощь ${formatNumber(power)}`, FS.body, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(1, 0.5));
    // «в отряде» — слева от мощи, как бы длинно она ни была записана.
    if (squadSlot >= 0) a.add(text(this, 990 - pw.width - 20, y - h / 2 + 55, 'в отряде', FS.small, C.success).setOrigin(1, 0.5));
    const gear = heroEquipment(session.save, hero.id).length;
    a.add(text(this, 990, y - 10, `снаряжение ${gear}/4`, FS.small, gear ? C.info : C.disabled).setOrigin(1, 0.5));
    a.add(ellipsize(text(this, x, y - 10, `${job?.name ?? hero.job} · ${ROLE_NAMES[job?.role ?? ''] ?? ''}`, FS.body, C.title).setOrigin(0, 0.5), 440));

    const max = job?.maxJobLevel ?? hero.jobLevel;
    const atMax = hero.jobLevel >= max;
    const need = expToNext(hero.jobLevel, GAME.progression, CONTENT.jobs[hero.job]?.tier);
    a.add(text(this, x, y + 45, `Джоб ${hero.jobLevel} / ${max}`, FS.body, C.text).setOrigin(0, 0.5));
    a.add(progressBar(this, x + 230, y + 45, 400, 32, atMax ? 1 : hero.jobExp / need, atMax ? TINT.gold : TINT.success));
    a.add(text(this, x + 430, y + 45, atMax ? 'макс.' : `${hero.jobExp} / ${need}`, FS.caption, C.text, { stroke: C.stroke, strokeThickness: 4 }));

    if (availableJobChanges(hero, GAME).length > 0) {
      a.add(icon(this, 960, y + 45, 'iconCircle_blue', 40).setTint(TINT.gold));
      a.add(text(this, 930, y + 90, 'Смена профессии!', FS.caption, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(1, 0.5));
    }
  }
}
