import Phaser from 'phaser';
import { achievementStatus, ascendRequirement, gearUpgrades, heroCard, heroEquipment, heroesWithGearUpgrades, heroPower, squadPower, withGear, type HeroState } from '../../core';
import { GAME } from '../content';
import { ascendReady, claimableAchievements, formatNumber, heroSprite, levelText, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, cornerBadge, portrait, screen } from '../screen';
import { collect, staggerIn } from '../juice';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, emptyState, hintPointer, pressable, ScrollArea, text } from '../ui';
import { hintDone } from '../hints';
import { C, FS } from '../theme';

/** Список героев (минимум до пакета H4): имя, класс, редкость (цвет), уровень; нажатие — карточка героя. */
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
    cornerBadge(this, 810, barY, 330, 100, claimableAchievements(achievementStatus(save, GAME)));

    let listTop = CONTENT_TOP + 120;
    // Опыт в общем запасе (тратится «Улучшить» на карточке героя) и золото.
    text(this, GAME_W / 2, listTop + 25, `Опыт в запасе: ${formatNumber(save.resources.heroExp)} · золото ${formatNumber(save.resources.gold)}`, FS.body, C.gold, { stroke: C.stroke, strokeThickness: 5 }).setName('heroExpPool');
    listTop += 60;
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
    const rows = heroes.map((hero, i) => collect(this.area.content, () => this.heroCard(hero, h / 2 + i * (h + gap), h, heroPower(hero, gctx))));
    this.area.setContentHeight(heroes.length * (h + gap));
    // T1-08: один раз — подсказка «Наденьте трофеи» на первом герое, которому есть что надеть (смена профессии важнее).
    const gearHero = heroesWithGearUpgrades(save, GAME)[0];
    const gi = heroes.findIndex((x) => x.id === gearHero);
    if (gi >= 0 && !hintDone('equip_gear')) {
      const cy = listTop + h / 2 + gi * (h + gap);
      if (cy + h / 2 <= CONTENT_BOTTOM) hintPointer(this, GAME_W / 2, cy, 'Наденьте трофеи — откройте героя', 'auto', { w: 1020, h });
    }
    // «Выезд» карточек — после подсказки: она обходит кнопки по их настоящим местам.
    staggerIn(this, 'Heroes', rows);
  }

  private area!: ScrollArea;

  private heroCard(hero: HeroState, y: number, h: number, power: number): void {
    const a = this.area;
    const c = GAME.content.heroes[hero.templateId] ? heroCard(hero, GAME) : undefined;
    const bg = a.add(card(this, GAME_W / 2, y, 1020, h));
    pressable(this, bg, 1020, h, a.tap(() => this.scene.start('Hero', { heroId: hero.id })));
    const px = 150;
    a.add(card(this, px, y, h - 50, h - 50, true));
    a.add(portrait(this, px, y, portraitKey(heroSprite(hero, GAME)), h - 70));
    // Рамка цвета редкости вокруг портрета.
    const rc = Phaser.Display.Color.HexStringToColor(c?.rarity.color ?? '#888888').color;
    a.add(this.add.rectangle(px, y, h - 56, h - 56).setStrokeStyle(6, rc).setFillStyle(0, 0));

    const x = 300;
    a.add(ellipsize(text(this, x, y - h / 2 + 55, c?.name ?? hero.templateId, FS.h1, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5), 380));
    const squadSlot = session.save.squad.indexOf(hero.id);
    const pw = a.add(text(this, 990, y - h / 2 + 55, `Мощь ${formatNumber(power)}`, FS.body, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(1, 0.5));
    // «в отряде» — слева от мощи, как бы длинно она ни была записана.
    if (squadSlot >= 0) a.add(text(this, 990 - pw.width - 20, y - h / 2 + 55, 'в отряде', FS.small, C.success).setOrigin(1, 0.5));
    const gear = heroEquipment(session.save, hero.id).length;
    // T1-08: есть вещи получше надетых — зелёная отметка вместо счётчика.
    const better = gearUpgrades(session.save, hero.id, GAME).length;
    a.add(text(this, 990, y - 10, better ? `▲ есть вещи получше` : `снаряжение ${gear}/4`, FS.small, better ? C.success : gear ? C.info : C.disabled, better ? { fontStyle: 'bold' } : {}).setOrigin(1, 0.5));
    if (!c) return;
    a.add(ellipsize(text(this, x, y - 10, `${c.jobName} · ${ROLE_NAMES[c.role] ?? ''}`, FS.body, C.title).setOrigin(0, 0.5), 440));
    a.add(text(this, x, y + 45, levelText(c.level, c.maxLevel), FS.body, C.text).setOrigin(0, 0.5));
    a.add(text(this, 990, y + 45, c.rarity.name, FS.body, c.rarity.color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(1, 0.5));
    const tags: string[] = [];
    if (c.isNew) tags.push('Новый!');
    if (ascendReady(session.save, GAME).some((x) => x.id === hero.id)) tags.push('Можно вознести!');
    const req = c.source === 'story' ? ascendRequirement(session.save, hero.id, GAME) : null;
    if (req?.shards) tags.push(`осколки ${req.shards.have}/${req.shards.need}`);
    if (tags.length) a.add(text(this, x, y + 92, tags.join(' · '), FS.caption, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }).setOrigin(0, 0.5));
  }
}
