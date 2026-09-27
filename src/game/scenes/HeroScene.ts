import Phaser from 'phaser';
import { hintDone, markHint } from '../hints';
import { actAscend, actEquipBest, actLevelUp, ascendRequirement, autoFodder, COMBAT, gearUpgrades, heroCard, heroGearStats, heroPower, heroSkillList, heroSlots, levelUpInfo, markHeroSeen, SLOTS, type HeroState, type Slot } from '../../core';
import { CONTENT, GAME } from '../content';
import { formatNumber, heroSprite, itemStatsText, levelText, RARITY_COLORS, ROLE_NAMES, SLOT_NAMES, STAT_KEYS, STAT_LABELS } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, screen, unitFigure } from '../screen';
import { commit, session, today } from '../session';
import { button, ellipsize, hintPointer, panel, pressable, ScrollArea, text, toast } from '../ui';
import { C, FS, TINT } from '../theme';
import { skillIcon } from '../skillIcons';
import { figureFrame } from '../portraitFrame';

const SKILL_ROW_H = 124;

interface SkillRow {
  id: string;
  kind: string;
  locked?: number;
}

/**
 * Карточка героя (минимум до пакета H4): имя, класс, роль и редкость (цвет рамки), уровень, «Улучшить» (опыт пула +
 * золото), «Вознести» (осколки у сюжетных, корм у призывных — самый слабый набор), статы, экипировка, навыки
 * (закрытые — «откроется на ур. N»).
 */
export class HeroScene extends Phaser.Scene {
  constructor() {
    super('Hero');
  }

  create(data: { heroId: string }): void {
    let hero = session.save.heroes.find((h) => h.id === data.heroId);
    if (hero?.isNew) {
      commit(markHeroSeen(session.save, hero.id));
      hero = session.save.heroes.find((h) => h.id === data.heroId);
    }
    const c = hero && GAME.content.heroes[hero.templateId] ? heroCard(hero, GAME) : undefined;
    screen(this, c?.name ?? 'Герой', 'Heroes', { to: 'Heroes' });
    if (!hero || !c) return;
    const job = CONTENT.jobs[c.job];
    const rarityColor = c.rarity.color;

    // --- Герой: спрайт в стойке (рамка цвета редкости), класс, редкость, уровень, «Улучшить» ---
    const top = CONTENT_TOP;
    card(this, GAME_W / 2, top + 175, 1040, 350);
    card(this, 200, top + 175, 300, 300, true);
    // Фигура — на тёплой подложке в золотой рамке, с тенью под ногами; поверх — рамка цвета редкости.
    figureFrame(this, 200, top + 175, 300, top + 300);
    this.add.rectangle(200, top + 175, 292, 292).setStrokeStyle(8, Phaser.Display.Color.HexStringToColor(rarityColor).color).setFillStyle(0, 0);
    this.heroSprite(hero, 200, top + 300);
    const x = 380;
    text(this, x, top + 115, `${ROLE_NAMES[c.role] ?? ''} · ${CONTENT.skills[job?.basic ?? '']?.range === 'melee' ? 'ближний бой' : 'дальний бой'}`, FS.body, C.muted).setOrigin(0, 0.5);
    const rarityLabel = text(this, 1010, top + 115, c.rarity.name, FS.body, rarityColor, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(1, 0.5);
    rarityLabel.setName('heroRarity');
    const info = levelUpInfo(session.save, hero.id, GAME);
    text(this, x, top + 180, levelText(c.level, c.maxLevel), FS.h3, C.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    text(this, 1010, top + 180, `Опыт в запасе: ${formatNumber(info.pool)}`, FS.caption, C.gold, { stroke: C.stroke, strokeThickness: 4 }).setOrigin(1, 0.5);
    const power = text(this, 1010, top + 60, `Мощь ${formatNumber(heroPower(hero, GAME, session.save))}`, FS.h3, C.gold, {
      fontStyle: 'bold',
      stroke: C.stroke,
      strokeThickness: 6,
    }).setOrigin(1, 0.5);
    ellipsize(text(this, x, top + 60, c.jobName, FS.h1, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5), 1010 - x - power.width - 20);
    // «Улучшить» (справа, вне рамки фигуры): цена следующего уровня слева от кнопки; предел — «Вознести».
    const req = ascendRequirement(session.save, hero.id, GAME);
    const bx = 1010 - 170;
    if (info.cost) {
      const up = button(this, bx, top + 272, 340, 100, info.canLevel ? 'ui_btn_primary' : 'ui_btn_secondary', 'Улучшить', () => this.levelUp(hero!), FS.h3);
      up.container.setName('levelUpBtn');
      if (!info.canLevel) up.container.setAlpha(0.6);
      const need = info.blocker === 'not_enough_exp' ? C.warning : C.muted;
      text(this, x, top + 252, `опыт ${formatNumber(info.cost.exp)}`, FS.caption, need).setOrigin(0, 0.5);
      text(this, x, top + 292, `золото ${formatNumber(info.cost.gold)}`, FS.caption, info.blocker === 'not_enough_gold' ? C.warning : C.muted).setOrigin(0, 0.5);
      if (info.canLevel && !hintDone('level_up')) hintPointer(this, bx, top + 272, 'Опыт из запаса — в уровень героя', 'below', { w: 340, h: 100 });
    } else if (req) {
      button(this, bx, top + 272, 340, 100, 'ui_btn_primary', 'Вознести', () => this.ascend(hero!), FS.h3).container.setName('ascendBtn');
      text(this, x, top + 272, ascendNote(req), FS.caption, req.blockers.length ? C.warning : C.muted, { wordWrap: { width: bx - 170 - x - 20 } }).setOrigin(0, 0.5);
    } else {
      text(this, x, top + 272, 'Максимальная редкость и уровень', FS.body, C.gold, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    }

    // --- Статы ---
    const sy = top + 430;
    card(this, GAME_W / 2, sy, 1040, 150, true);
    // Статы с экипировкой (K6): крупно — итог, мелко — прибавка предметов.
    const gear = heroGearStats(session.save, hero.id, GAME);
    STAT_KEYS.forEach((k, i) => {
      const cx = 150 + i * 260;
      const plus = gear[k];
      text(this, cx, sy - 36, `${STAT_LABELS[k]} ${c.stats[k] + plus}`, FS.h3, plus ? C.inkInfo : C.ink, { fontStyle: 'bold' });
      if (plus) text(this, cx, sy + 22, `+${plus} экип.`, FS.caption, C.inkInfo);
    });

    // --- Экипировка: 4 слота ---
    const gy = sy + 185;
    const slots = heroSlots(session.save, hero.id, GAME);
    // T1-08: в инвентаре есть вещи лучше надетых — отметка на слоте и «Надеть лучшее».
    const ups = gearUpgrades(session.save, hero.id, GAME);
    SLOTS.forEach((slot, i) => this.gearSlot(hero!, slot, slots[slot], 150 + i * 260, gy, ups.some((u) => u.slot === slot)));

    // --- Навыки ---
    const job0 = CONTENT.jobs[c.job];
    const rows: SkillRow[] = [{ id: job0?.basic ?? '', kind: 'Обычная атака' }];
    for (const sk of heroSkillList(hero, GAME)) rows.push(sk.unlocked ? { id: sk.skill, kind: sk.passive ? 'Пассивный' : activeKind(sk.skill) } : { id: sk.skill, kind: '', locked: sk.level });

    let listTop = gy + 120;
    if (ups.length) {
      const best = button(this, GAME_W / 2, listTop + 55, 700, 110, 'ui_btn_primary', `Надеть лучшее (${ups.length})`, () => this.equipBest(hero!), FS.h3);
      best.container.setName('equipBestBtn');
      if (!hintDone('equip_gear')) hintPointer(this, GAME_W / 2, listTop + 55, 'Наденьте трофеи', 'below', { w: 700, h: 110 });
      listTop += 125;
    }
    // Внизу — осколки сюжетного героя и следующая форма (вторая профессия).
    const note = c.source === 'story' && req?.shards ? `Осколки ${c.name}: ${req.shards.have} / ${req.shards.need}${c.nextForm ? ` · на «${GAME.cards.rarities.find((r) => r.id === c.nextForm!.rarity)?.name}» — ${c.nextForm.jobName}` : ''}` : '';
    const listBottom = CONTENT_BOTTOM - (note ? 70 : 0);
    // Навыков может быть больше, чем влезает: список прокручивается пальцем внутри карточки.
    const listH = Math.min(listBottom - listTop, SKILL_ROW_H * rows.length + 20);
    card(this, GAME_W / 2, listTop + listH / 2, 1040, listH);
    this.skills = new ScrollArea(this, listTop + 10, listTop + listH - 10);
    rows.forEach((r, i) => this.skillRow(r, SKILL_ROW_H * (i + 0.5), SKILL_ROW_H));
    this.skills.setContentHeight(SKILL_ROW_H * rows.length);
    if (note) ellipsize(text(this, GAME_W / 2, listTop + listH + 40, note, FS.body, C.title, { stroke: C.stroke, strokeThickness: 5 }), 1020);
  }

  /** «Улучшить»: один уровень за опыт пула и золото. */
  private levelUp(hero: HeroState): void {
    try {
      const r = actLevelUp(session.save, today(), hero.id, GAME, 1);
      commit(r.save);
      markHint('level_up');
      const skills = r.events.flatMap((e) => (e.type === 'skillUnlocked' ? [CONTENT.skills[e.skill]?.name ?? e.skill] : []));
      this.scene.restart({ heroId: hero.id });
      if (skills.length) {
        const sc = this.scene.get('Hero');
        sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, `Новый навык: ${skills.join(', ')}`, C.success, 3000));
      }
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  /** «Вознести»: сюжетные — осколками, призывные — самым слабым подходящим кормом. */
  private ascend(hero: HeroState): void {
    try {
      const fodder = autoFodder(session.save, hero.id, GAME) ?? [];
      const r = actAscend(session.save, today(), hero.id, fodder, GAME);
      commit(r.save);
      const e = r.events.find((x) => x.type === 'ascended');
      this.scene.restart({ heroId: hero.id });
      const sc = this.scene.get('Hero');
      const msg = e && e.type === 'ascended' && e.jobChanged ? `Вознесение! Теперь — ${CONTENT.jobs[e.job]?.name ?? e.job}` : 'Вознесение!';
      sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, msg, C.success, 3000));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private skills!: ScrollArea;

  /** T1-08: надеть все улучшения из инвентаря (свободные вещи получше надетых). */
  private equipBest(hero: HeroState): void {
    try {
      const r = actEquipBest(session.save, hero.id, GAME);
      commit(r.save);
      markHint('equip_gear');
      const names = r.equipped.map((u) => GAME.equipment.items[u.itemId]?.name ?? u.itemId);
      this.scene.restart({ heroId: hero.id });
      const sc = this.scene.get('Hero');
      sc.events.once(Phaser.Scenes.Events.CREATE, () => toast(sc, `${heroCard(hero, GAME).name}: надето — ${names.join(', ')}`, C.success, 3000));
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  private gearSlot(hero: HeroState, slot: Slot, item: ReturnType<typeof heroSlots>[Slot], x: number, y: number, better = false): void {
    const bg = panel(this, x, y, 244, 200, item ? 'ui_slot_filled' : 'ui_slot_empty');
    pressable(this, bg, 244, 200, () => this.scene.start('Inventory', { heroId: hero.id, slot }));
    text(this, x, y - 70, SLOT_NAMES[slot], FS.small, C.dim);
    // Есть вещь получше — зелёная стрелка «▲» в углу слота.
    if (better) {
      this.add.circle(x + 98, y - 76, 22, TINT.success).setStrokeStyle(3, 0xffffff).setDepth(5);
      text(this, x + 98, y - 78, '▲', FS.caption, C.text, { fontStyle: 'bold' }).setDepth(6);
    }
    if (!item) {
      text(this, x, y + 10, '+', 72, C.placeholder, { fontStyle: 'bold' });
      return;
    }
    const color = RARITY_COLORS[item.def.rarity];
    this.add.rectangle(x, y - 46, 200, 5, Phaser.Display.Color.HexStringToColor(color).color);
    ellipsize(text(this, x, y + 5, item.def.name, FS.body, color, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }), 226);
    text(this, x, y + 62, itemStatsText(item.def.stats), FS.caption, C.text, { stroke: C.stroke, strokeThickness: 4, wordWrap: { width: 230 } }).setMaxLines(2);
  }

  private skillRow(r: SkillRow, y: number, h: number): void {
    const a = this.skills;
    const sk = CONTENT.skills[r.id];
    const locked = r.locked !== undefined;
    const iconSize = Math.min(80, h - 16);
    // Значок навыка (skillIcons: PNG художника или нарисованный кодом); закрытый — тусклый и серый.
    const icon = this.add.image(90, y, skillIcon(this, sk)).setDisplaySize(iconSize, iconSize);
    if (locked) icon.setAlpha(0.4).setTint(0x8a8a8a);
    a.add(icon);
    const kind = locked ? `откроется на ур. ${r.locked}` : r.kind;
    const kindText = a.add(text(this, 1010, y - h * 0.24, kind, FS.caption, locked ? C.dim : r.kind.startsWith('КД') ? C.gold : C.success).setOrigin(1, 0.5));
    a.add(ellipsize(text(this, 150, y - h * 0.24, `${sk?.name ?? r.id}`, FS.body, locked ? C.disabled : C.text, { fontStyle: 'bold' }).setOrigin(0, 0.5), 1010 - 150 - kindText.width - 20));
    if (sk?.description) {
      a.add(
        text(this, 150, y + h * 0.18, sk.description, FS.caption, locked ? C.disabled : C.muted, { align: 'left', wordWrap: { width: 860 } })
          .setOrigin(0, 0.5)
          .setMaxLines(2),
      );
    }
  }

  /** U: лист героя грузится при первом открытии карточки (и остаётся в кэше листов для боя). Фигура ~250 ед., как в бою. */
  private heroSprite(hero: HeroState, x: number, feetY: number): void {
    unitFigure(this, heroSprite(hero, GAME), x, feetY, 250);
  }
}

/** Что нужно для вознесения — одной строкой. */
function ascendNote(req: NonNullable<ReturnType<typeof ascendRequirement>>): string {
  if (req.blockers.length) return req.blockers[0];
  if (req.shards) return `осколки ${req.shards.have} / ${req.shards.need} · золото ${formatNumber(req.gold)}`;
  const miss = req.fodder.find((f) => f.candidates.length < f.count);
  if (miss) return `нужно карточек (${miss.kind === 'same' ? 'та же' : 'линия'}): ${miss.count}`;
  return `золото ${formatNumber(req.gold)}`;
}

/** Подпись активного навыка: перезарядка и каст (например «КД 5 с · каст 2 с»). */
function activeKind(id: string): string {
  const sk = CONTENT.skills[id];
  const cd = sk?.cooldown ?? COMBAT.skills?.defaultCooldown ?? 8;
  const parts = [cd > 0 ? `КД ${cd} с` : 'КД нет'];
  if (sk?.castTime) parts.push(`каст ${sk.castTime} с`);
  return parts.join(' · ');
}
