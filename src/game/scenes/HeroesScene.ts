import Phaser from 'phaser';
import { achievementStatus, ascendAll, ascendAllSummary, heroesWithGearUpgrades, heroPower, levelUpInfo, needsBranch, pendingPicks, squadPower, withGear, type CardRarity, type HeroState } from '../../core';
import { GAME } from '../content';
import { ascendReady, claimableAchievements, formatNumber, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { confirm, CONTENT_BOTTOM, CONTENT_TOP, cornerBadge, screen } from '../screen';
import { countUp, staggerIn } from '../juice';
import { commit, session } from '../session';
import { sfx } from '../audio';
import { RARITY_CARD } from '../tavern';
import { button, ellipsize, emptyState, pressable, ScrollArea, text, toast, tutorialHint } from '../ui';
import { hintDone } from '../hints';
import { C, FS } from '../theme';
import { cardIcon, drawHeroCard, GUILD_NAMES, heroCardIcon, heroCardSize, LINES, rarityColor, ROLES } from '../heroCard';
import { collectionCount, collectionHeroes, groupCopies, heroesUi, inventoryUi, missingTemplates, RARITY_ORDER, SORT_LABELS, SORT_ORDER } from '../heroesView';
import { pulse } from '../juice';
import { heroStoryNew, storyDot } from '../heroStoryView';

const COLS = 3;
const TILE_W = 300;
const GAP_X = 36;
const GAP_Y = 30;
const CHIP = 100;

/** Последняя показанная мощь отряда — отсчёт до нового значения при возвращении с карточки. */
let lastSquadPower: number | null = null;

/**
 * H4 «Герои» — коллекция карточек как в AFK Arena: сетка 3 в ряд (рамка цвета редкости с орнаментом, лицо, класс,
 * роль, имя, уровень, ромбы редкостей), метки «в отряде», «Новый!» (сияние), замок, стрелки «можно улучшить /
 * вознести». Фильтры линии, роли и редкости, сортировка «Сила / Уровень / Редкость», «Коллекция» — серые
 * неполученные карточки. Нажатие — карточка героя (HeroScene), листание — в порядке этого списка.
 */
export class HeroesScene extends Phaser.Scene {
  constructor() {
    super('Heroes');
  }

  private area!: ScrollArea;

  create(): void {
    screen(this, 'Герои', 'Heroes');
    const save = session.save;
    const gctx = withGear(GAME, save);
    const barY = CONTENT_TOP + 50;
    // Мощь отряда (K2) — отсчитывается от прошлого показа (поднимали уровень на карточке).
    text(this, 30, barY - 24, 'Мощь отряда', FS.small, C.muted).setOrigin(0, 0.5);
    const sp = squadPower(save, GAME);
    const spText = text(this, 30, barY + 22, formatNumber(sp), FS.h2, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    countUp(this, spText, lastSquadPower ?? sp, sp, formatNumber, { duration: 700 });
    if (lastSquadPower !== null && sp > lastSquadPower) {
      const plus = text(this, 30 + spText.width + 16, barY + 22, `+${formatNumber(sp - lastSquadPower)}`, FS.body, C.positive, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5);
      this.tweens.add({ targets: plus, y: barY - 10, alpha: 0, delay: 900, duration: 900, onComplete: () => plus.destroy() });
    }
    lastSquadPower = sp;
    const free = save.inventory.items.filter((i) => i.equippedBy === null).length;
    button(this, 500, barY, 280, 100, 'ui_btn_secondary', `Инвентарь${free ? ` (${free})` : ''}`, () => {
      inventoryUi.template = null;
      this.scene.start('Inventory', {});
    }, FS.h3);
    // K10: достижения — отсюда и с главной.
    button(this, 835, barY, 330, 100, 'ui_btn_secondary', 'Достижения', () => this.scene.start('Achievements', { from: 'Heroes' }), FS.h3);
    cornerBadge(this, 835, barY, 330, 100, claimableAchievements(achievementStatus(save, GAME)));

    // Запас опыта (тратится «Улучшить» на карточке) и «Коллекция» — серые неполученные карточки.
    const rowY = CONTENT_TOP + 165;
    ellipsize(text(this, 30, rowY, `Опыт в запасе: ${formatNumber(save.resources.heroExp)}`, FS.body, C.gold, { stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5).setName('heroExpPool'), 420);
    // «Вознести всех»: всех, кому хватает свободных копий того же героя и золота (ascendAll), с подтверждением.
    const plan = ascendAll(save, GAME);
    const all = button(this, 590, rowY, 250, 96, plan.done.length ? 'ui_btn_primary' : 'ui_btn_secondary', 'Вознести всех', () => this.ascendAllConfirm(), FS.small, { sound: 'ui_toggle' });
    all.container.setName('ascendAllBtn');
    if (!plan.done.length) all.setEnabled(false);
    else pulse(this, all.container, 1.04);
    const cc = collectionCount(save, GAME);
    const coll = button(this, 885, rowY, 310, 96, heroesUi.showMissing ? 'k:buttonLong_brown' : 'ui_btn_secondary', `Коллекция ${cc.owned}/${cc.total}`, () => {
      heroesUi.showMissing = !heroesUi.showMissing;
      this.scene.restart();
    }, FS.body, { sound: 'ui_toggle' });
    coll.container.setName('collectionToggle');

    // Фильтры: линии (6) и сортировка; роли (4) и редкости (5). Повторное нажатие снимает фильтр.
    const f = heroesUi.filter;
    const r1 = CONTENT_TOP + 280;
    LINES.forEach((line, i) => {
      this.chip(50 + CHIP / 2 + i * (CHIP + 12), r1, f.line === line, () => (f.line = f.line === line ? null : line), (c) => {
        c.add(this.add.image(0, -4, cardIcon(this, line)).setDisplaySize(62, 62).setTint(f.line === line ? 0xffe08a : 0xeadfc6));
      }, `Линия: ${this.content.jobs[line]?.name ?? line} (${GUILD_NAMES[line] ?? ''})`);
    });
    const sortBtn = button(this, 880, r1, 300, CHIP, 'ui_btn_secondary', `${SORT_LABELS[heroesUi.sort]} ↕`, () => {
      heroesUi.sort = SORT_ORDER[(SORT_ORDER.indexOf(heroesUi.sort) + 1) % SORT_ORDER.length];
      this.scene.restart();
    }, FS.h3, { sound: 'ui_toggle' });
    sortBtn.container.setName('sortBtn');
    const r2 = r1 + CHIP + 16;
    ROLES.forEach((role, i) => {
      this.chip(50 + CHIP / 2 + i * (CHIP + 12), r2, f.role === role, () => (f.role = f.role === role ? null : role), (c) => {
        c.add(this.add.image(0, -4, cardIcon(this, role)).setDisplaySize(58, 58).setTint(f.role === role ? 0xffe08a : 0xeadfc6));
      }, `Роль: ${ROLE_NAMES[role] ?? role}`);
    });
    RARITY_ORDER.forEach((r, i) => {
      const x = 520 + CHIP / 2 + i * (CHIP + 2);
      this.chip(x, r2, f.rarity === r, () => (f.rarity = f.rarity === r ? null : (r as CardRarity)), (c) => {
        const col = Phaser.Display.Color.HexStringToColor(rarityColor(r)).color;
        const d = 24;
        c.add(this.add.polygon(0, -4, [d, 0, 2 * d, d, d, 2 * d, 0, d], col).setStrokeStyle(4, 0x000000));
      }, `Редкость: ${GAME.cards.rarities.find((x) => x.id === r)?.name ?? r}`, CHIP - 4);
    });

    // Сетка карточек.
    const listTop = r2 + CHIP / 2 + 20;
    this.area = new ScrollArea(this, listTop, CONTENT_BOTTOM + 10);
    // Копии одного героя — одной плиткой (лучший экземпляр) с «×N»; все экземпляры — на карточке и в корме вознесения.
    const groups = groupCopies(collectionHeroes(save, f, heroesUi.sort, GAME, (h) => heroPower(h, gctx)));
    const heroes = groups.map((g) => g.hero);
    heroesUi.order = heroes.map((h) => h.id);
    const picks = pendingPicks(save);
    const missing = heroesUi.showMissing ? missingTemplates(save, f, GAME) : [];
    if (!save.heroes.length) {
      this.area.add(emptyState(this, GAME_W / 2, 300, 'Героев пока нет.\nНачните новую игру: «Город» → настройки → «Сбросить прогресс».'));
      return;
    }
    if (!heroes.length && !missing.length && !picks.length) {
      this.area.add(emptyState(this, GAME_W / 2, 200, 'Под фильтр никто не подходит.\nНажмите выбранный значок ещё раз, чтобы снять фильтр.'));
      return;
    }
    const { h: tileH } = heroCardSize(TILE_W);
    const x0 = GAME_W / 2 - (COLS - 1) * (TILE_W + GAP_X) / 2;
    const at = (i: number) => ({ x: x0 + (i % COLS) * (TILE_W + GAP_X), y: GAP_Y / 2 + tileH / 2 + Math.floor(i / COLS) * (tileH + GAP_Y) });
    const ready = new Set(ascendReady(save, GAME).map((h) => h.id));
    const tiles: Phaser.GameObjects.GameObject[][] = [];
    // «Контракт героя» — первой плиткой: герой на выбор (и ветка).
    const lead = picks.length ? 1 : 0;
    if (lead) {
      const p = at(0);
      tiles.push([this.contractTile(p.x, p.y, picks.length, picks[0].rarity)]);
    }
    groups.forEach((g, i) => {
      const p = at(lead + i);
      tiles.push([this.tile(g.hero, p.x, p.y, ready.has(g.hero.id), g.copies)]);
    });
    missing.forEach((tid, k) => {
      const p = at(lead + heroes.length + k);
      const t = GAME.content.heroes[tid];
      tiles.push([
        drawHeroCard(this, p.x, p.y, tid, {
          w: TILE_W,
          greyed: true,
          parent: this.area.content,
          onTap: this.area.tap(() => toast(this, `${t.name}: ${t.source === 'story' ? 'присоединится по сюжету (и приходит из Таверны)' : 'призыв в Таверне'}. ${t.bio}`, C.title, 4000)),
        }),
      ]);
    });
    const n = lead + heroes.length + missing.length;
    this.area.setContentHeight(Math.ceil(n / COLS) * (tileH + GAP_Y) + GAP_Y);
    // T1-08: один раз — подсказка «Наденьте трофеи» на первом герое, которому есть что надеть.
    const gearHero = heroesWithGearUpgrades(save, GAME)[0];
    const gi = heroes.findIndex((x) => x.id === gearHero);
    if (gi >= 0 && !hintDone('equip_gear')) {
      const p = at(lead + gi);
      const cy = listTop + p.y;
      if (cy + tileH / 2 <= CONTENT_BOTTOM) tutorialHint(this, 'equip_gear', p.x, cy, 'auto', { w: TILE_W, h: tileH }, { text: 'Наденьте трофеи — откройте героя' });
    }
    // Обучение (hints.ts, шаг ascend): три копии героя — указатель на его плитку (если «Трофеи» уже не показаны).
    const ai = heroes.findIndex((x) => ready.has(x.id));
    if (ai >= 0 && !hintDone('ascend') && !(gi >= 0 && !hintDone('equip_gear'))) {
      const p = at(lead + ai);
      const cy = listTop + p.y;
      if (cy + tileH / 2 <= CONTENT_BOTTOM) tutorialHint(this, 'ascend', p.x, cy, 'auto', { w: TILE_W, h: tileH }, { text: 'Копий хватает — откройте героя и вознесите' });
    }
    staggerIn(this, 'Heroes', tiles);
  }

  /** Подтверждение «Вознести всех»: список «Вика: синяя → фиолетовая», затем вознесение и итог тостом. */
  private ascendAllConfirm(): void {
    const plan = ascendAll(session.save, GAME);
    const rows = ascendAllSummary(plan.done);
    if (!rows.length) {
      toast(this, 'Вознести некого: нужны свободные копии того же героя и золото.', C.muted);
      return;
    }
    const line = (r: (typeof rows)[number]) => `${r.name}: ${RARITY_CARD[r.from]} → ${RARITY_CARD[r.to]}${r.branchPending ? ' (ветка — потом)' : ''}`;
    const MAX = 7;
    const list = rows.slice(0, MAX).map(line);
    if (rows.length > MAX) list.push(`…и ещё ${rows.length - MAX}`);
    const gold = session.save.resources.gold - plan.save.resources.gold;
    const eaten = plan.done.reduce((n, d) => n + d.consumed.length, 0);
    const cost = `${gold > 0 ? `Золото: −${formatNumber(gold)} · ` : ''}копий в корм: ${eaten}`;
    confirm(this, `Вознести всех?\n\n${list.join('\n')}\n\n${cost}\nОтряд и закреплённые (замок) в корм не идут.`, 'Вознести', () => {
      // Сохранение могло измениться — считаем заново от текущего.
      const r = ascendAll(session.save, GAME);
      if (!r.done.length) return;
      commit(r.save);
      sfx('rarity_up');
      const res = ascendAllSummary(r.done);
      const branch = res.filter((x) => x.branchPending).map((x) => x.name);
      const msg = `Вознесено: ${res.map((x) => `${x.name} (${RARITY_CARD[x.to]})`).join(', ')}${branch.length ? `. Выберите ветку: ${branch.join(', ')}` : ''}`;
      this.scene.restart();
      this.events.once(Phaser.Scenes.Events.CREATE, () => toast(this, msg, C.success, 5000));
    });
  }

  private get content() {
    return GAME.content;
  }

  /** Плитка «Контракт героя»: рубашка цвета редкости, «?», число контрактов; нажатие — выбор героя. */
  private contractTile(x: number, y: number, count: number, rarity: CardRarity): Phaser.GameObjects.Container {
    const { h } = heroCardSize(TILE_W);
    const box = this.add.container(x, y).setName('contractTile');
    this.area.content.add(box);
    box.add(heroCardIcon(this, 0, -30, h - 90, rarity, undefined, { pick: true }));
    box.add(text(this, 0, h / 2 - 50, 'Контракт героя', FS.small, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }));
    box.add(text(this, 0, h / 2 - 14, `герой на выбор${count > 1 ? ` ×${count}` : ''}`, FS.caption, rarityColor(rarity), { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 4 }));
    const hit = this.add.rectangle(0, 0, TILE_W, h, 0x000000, 0.001);
    box.add(hit);
    pressable(this, hit, TILE_W, h, this.area.tap(() => this.scene.start('HeroPick', {})));
    pulse(this, box, 1.03, 800);
    return box;
  }

  /** Плитка героя игрока: метки отряда, «Новый!», замок, «можно улучшить / вознести», копии «×N», «Выберите ветку!». */
  private tile(hero: HeroState, x: number, y: number, canAscend: boolean, copies = 1): Phaser.GameObjects.Container {
    const save = session.save;
    const card = drawHeroCard(this, x, y, hero, {
      w: TILE_W,
      copies,
      needsBranch: needsBranch(hero, GAME),
      inSquad: save.squad.includes(hero.id),
      isNew: !!hero.isNew,
      locked: !!hero.locked,
      canAscend,
      canLevel: !canAscend && save.squad.includes(hero.id) && levelUpInfo(save, hero.id, GAME).canLevel,
      parent: this.area.content,
      onTap: this.area.tap(() => this.scene.start('Hero', { heroId: hero.id })),
    });
    // Открыт непрочитанный кусочек истории героя — отметка «новое» у левого края (ниже меток «в отряде», «Новый!», ветки).
    if (heroStoryNew(hero.templateId, save)) card.add(storyDot(this, -TILE_W / 2 + 34, -heroCardSize(TILE_W).h / 2 + 190, 22));
    return card;
  }

  /** Кнопка-фильтр со значком (выбранная — золотая рамка). */
  private chip(x: number, y: number, on: boolean, toggle: () => void, draw: (c: Phaser.GameObjects.Container) => void, name: string, w = CHIP): void {
    const b = button(this, x, y, w, CHIP, on ? 'k:buttonSquare_brown' : 'k:buttonSquare_beige', '', () => {
      toggle();
      this.scene.restart();
    }, FS.body, { sound: 'ui_toggle' });
    b.container.setName(name);
    draw(b.container);
  }
}
