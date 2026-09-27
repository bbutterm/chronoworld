import Phaser from 'phaser';
import { achievementStatus, availableJobChanges, expToNext, gearUpgrades, heroEquipment, heroesWithGearUpgrades, heroPower, squadPower, withGear, type HeroState } from '../../core';
import { CONTENT, GAME } from '../content';
import { claimableAchievements, expBankLabel, firstJobChangeReady, formatNumber, heroSprite, jobChangeReadyCount, jobLevelText, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, cornerBadge, portrait, screen } from '../screen';
import { collect, pulse, staggerIn } from '../juice';
import { session } from '../session';
import { portraitKey } from '../sprites';
import { button, ellipsize, emptyState, hintPointer, pressable, progressBar, ScrollArea, text } from '../ui';
import { hintDone } from '../hints';
import { C, FS, TINT } from '../theme';
import type { JobChangeData } from './JobChangeScene';

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
    cornerBadge(this, 810, barY, 330, 100, claimableAchievements(achievementStatus(save, GAME)));

    // Кто-то готов сменить профессию — главное действие экрана наверху, а не только значок на карточке.
    const ready = firstJobChangeReady(save, GAME);
    let listTop = CONTENT_TOP + 120;
    if (ready) {
      const b = button(this, GAME_W / 2, listTop + 50, 1000, 110, 'ui_btn_primary', `Сменить профессию: ${ready.name} ›`, () =>
        this.scene.start('JobChange', { heroId: ready.id, from: { to: 'Heroes' } } satisfies JobChangeData),
      FS.h3);
      b.container.setName('jobChangeBtn');
      ellipsize(b.label, 940);
      cornerBadge(this, GAME_W / 2, listTop + 50, 1000, 110, jobChangeReadyCount(save, GAME));
      listTop += 130;
    }
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
    if (!ready && gi >= 0 && !hintDone('equip_gear')) {
      const cy = listTop + h / 2 + gi * (h + gap);
      if (cy + h / 2 <= CONTENT_BOTTOM) hintPointer(this, GAME_W / 2, cy, 'Наденьте трофеи — откройте героя', 'auto', { w: 1020, h });
    }
    // «Выезд» карточек — после подсказки: она обходит кнопки по их настоящим местам.
    staggerIn(this, 'Heroes', rows);
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
    // T1-08: есть вещи получше надетых — зелёная отметка вместо счётчика.
    const better = gearUpgrades(session.save, hero.id, GAME).length;
    a.add(text(this, 990, y - 10, better ? `▲ есть вещи получше` : `снаряжение ${gear}/4`, FS.small, better ? C.success : gear ? C.info : C.disabled, better ? { fontStyle: 'bold' } : {}).setOrigin(1, 0.5));
    a.add(ellipsize(text(this, x, y - 10, `${job?.name ?? hero.job} · ${ROLE_NAMES[job?.role ?? ''] ?? ''}`, FS.body, C.title).setOrigin(0, 0.5), 440));

    const max = job?.maxJobLevel ?? hero.jobLevel;
    const atMax = hero.jobLevel >= max;
    const need = expToNext(hero.jobLevel, GAME.progression, CONTENT.jobs[hero.job]?.tier);
    a.add(text(this, x, y + 45, jobLevelText(hero.jobLevel, max), FS.body, C.text).setOrigin(0, 0.5));
    const canChange = availableJobChanges(hero, GAME).length > 0;
    // Полоса опыта — отдельной строкой под «Ур. профессии N / M» (подпись уровня длинная, T1-23).
    const bx = x;
    const barW = 990 - x;
    const by = y + 92;
    a.add(progressBar(this, bx, by, barW, 36, atMax ? 1 : hero.jobExp / need, atMax ? TINT.gold : TINT.success, { key: `hero:${hero.id}:${hero.job}:${hero.jobLevel}` }));
    // T1-02: на максимуме — «опыт копится» (запас), полон — предупреждение.
    const bank = expBankLabel(hero, GAME);
    // T3-20: подпись на жёлтой полосе — тёмная, короткая и целиком внутри полосы (длинная — мельче, потом «…»).
    const barLabel = atMax ? (bank ? (bank.full ? 'запас опыта полон — смените профессию!' : `максимум · ${bank.text}`) : 'максимальный уровень') : `опыт ${formatNumber(hero.jobExp)} / ${formatNumber(need)}`;
    const bl = a.add(text(this, bx + barW / 2, by, barLabel, FS.caption, atMax ? (bank?.full ? '#8a1a0a' : '#2a1c08') : C.text, atMax ? { fontStyle: 'bold' } : { stroke: C.stroke, strokeThickness: 4 }));
    if (bl.width > barW - 24) bl.setFontSize(Math.max(24, Math.floor((FS.caption * (barW - 24)) / bl.width)));
    ellipsize(bl, barW - 24);

    if (canChange) {
      // Золотая плашка «Профессия!» справа от полосы: видно, у кого смена профессии (нажатие — карточка героя).
      const tag = text(this, 0, 0, 'Профессия!', FS.caption, '#2a1c08', { fontStyle: 'bold' });
      const tw = tag.width + 36;
      const pill = this.add.graphics();
      pill.fillStyle(TINT.gold, 1).fillRoundedRect(-tw / 2, -22, tw, 44, 22).lineStyle(3, 0x6b4a1a, 1).strokeRoundedRect(-tw / 2, -22, tw, 44, 22);
      const c = this.add.container(990 - tw / 2, y + 45, [pill, tag]);
      a.add(c);
      pulse(this, c, 1.08, 600);
    }
  }
}
