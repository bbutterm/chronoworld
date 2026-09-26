import Phaser from 'phaser';
import { availableJobChanges, expToNext, heroGearStats, heroPower, heroSkills, heroSlots, SLOTS, statsAt, type HeroState, type Slot } from '../../core';
import { CONTENT, GAME } from '../content';
import { formatNumber, heroSprite, itemStatsText, lockedJobSkills, RARITY_COLORS, ROLE_NAMES, SLOT_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen } from '../screen';
import { session } from '../session';
import { anim, portraitKey, spriteView } from '../sprites';
import { button, panel, progressBar, text } from '../ui';

interface SkillRow {
  id: string;
  kind: string;
  locked?: number;
}

/** Карточка героя: статы, навыки (открытые и закрытые), смена профессии. */
export class HeroScene extends Phaser.Scene {
  constructor() {
    super('Hero');
  }

  create(data: { heroId: string }): void {
    const hero = session.save.heroes.find((h) => h.id === data.heroId);
    screen(this, hero?.name ?? 'Герой', 'Heroes', { to: 'Heroes' });
    if (!hero) return;
    const job = CONTENT.jobs[hero.job];

    // --- Герой: спрайт в стойке, профессия, уровень ---
    const top = CONTENT_TOP;
    card(this, GAME_W / 2, top + 175, 1040, 350);
    card(this, 200, top + 175, 300, 300, true);
    this.heroSprite(hero, 200, top + 300);
    const x = 380;
    text(this, x, top + 60, job?.name ?? hero.job, 48, '#ffe9a8', { fontStyle: 'bold', stroke: '#000000', strokeThickness: 6 }).setOrigin(0, 0.5);
    text(this, x, top + 115, `${ROLE_NAMES[job?.role ?? ''] ?? ''} · ${CONTENT.skills[job?.basic ?? '']?.range === 'melee' ? 'ближний бой' : 'дальний бой'}`, 30, '#e0cfb0').setOrigin(0, 0.5);
    const max = job?.maxJobLevel ?? hero.jobLevel;
    const atMax = hero.jobLevel >= max;
    const need = expToNext(hero.jobLevel, GAME.progression);
    text(this, x, top + 180, `Джоб ${hero.jobLevel} / ${max}`, 36, '#ffffff', { fontStyle: 'bold' }).setOrigin(0, 0.5);
    progressBar(this, x, top + 235, 600, 34, atMax ? 1 : hero.jobExp / need, atMax ? 0xffd84a : 0x6fd06f);
    text(this, x + 300, top + 235, atMax ? 'максимальный уровень' : `опыт ${hero.jobExp} / ${need}`, 24, '#ffffff', { stroke: '#000000', strokeThickness: 4 });
    text(this, 1010, top + 60, `Мощь ${formatNumber(heroPower(hero, GAME, session.save))}`, 36, '#ffd84a', {
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6,
    }).setOrigin(1, 0.5);
    const history = hero.jobHistory.map((h) => `${CONTENT.jobs[h.job]?.name ?? h.job} ${h.jobLevel}`);
    if (history.length) text(this, x, top + 295, `Путь: ${history.join(' → ')} → ${job?.name ?? hero.job}`, 24, '#b8bcc8').setOrigin(0, 0.5);

    // --- Статы ---
    const sy = top + 410;
    card(this, GAME_W / 2, sy, 1040, 110, true);
    if (job) {
      // Статы с экипировкой (K6): крупно — итог, мелко — рост за уровень и прибавка предметов.
      const s = statsAt(job, hero.jobLevel);
      const g = job.growth;
      const gear = heroGearStats(session.save, hero.id, GAME);
      const cells: [string, number, number, number][] = [
        ['HP', s.hp, g.hp, gear.hp],
        ['ATK', s.atk, g.atk, gear.atk],
        ['DEF', s.def, g.def, gear.def],
        ['SPD', s.spd, g.spd, gear.spd],
      ];
      cells.forEach(([name, v, grow, plus], i) => {
        const cx = 150 + i * 260;
        text(this, cx, sy - 16, `${name} ${v + plus}`, 36, plus ? '#1f5a9a' : '#4a3520', { fontStyle: 'bold' });
        text(this, cx, sy + 28, `${grow ? `+${grow}/ур.` : ''}${plus ? `  (+${plus} экип.)` : ''}` || '—', 24, '#7a5a3a');
      });
    }

    // --- Экипировка: 4 слота ---
    const gy = sy + 170;
    const slots = heroSlots(session.save, hero.id, GAME);
    SLOTS.forEach((slot, i) => this.gearSlot(hero, slot, slots[slot], 150 + i * 260, gy));

    // --- Навыки ---
    const skills = heroSkills(hero, GAME);
    const rows: SkillRow[] = [{ id: skills.basic, kind: 'Обычная атака' }];
    skills.actives.forEach((id, i) => rows.push({ id, kind: i === skills.actives.length - 1 ? 'Ульта' : 'Активный' }));
    for (const id of skills.passives) rows.push({ id, kind: 'Пассивный' });
    for (const l of lockedJobSkills(hero.job, hero.jobLevel, GAME)) rows.push({ id: l.skill, kind: '', locked: l.jobLevel });

    const changes = availableJobChanges(hero, GAME);
    const nextTier = (job?.tier ?? 2) + 1;
    const listTop = gy + 120;
    // Внизу — кнопка смены профессии или подсказка, когда она откроется.
    const listBottom = CONTENT_BOTTOM - (changes.length ? 150 : nextTier <= 2 ? 70 : 0);
    const rowH = Math.min(120, (listBottom - listTop - 20) / rows.length);
    const listH = rowH * rows.length + 20;
    card(this, GAME_W / 2, listTop + listH / 2, 1040, listH);
    rows.forEach((r, i) => this.skillRow(r, listTop + 10 + rowH * (i + 0.5), rowH));

    if (!changes.length && nextTier <= 2) {
      const need = GAME.progression.jobChange.tierLevel[String(nextTier) as '1' | '2'];
      text(this, GAME_W / 2, listTop + listH + 40, `Смена профессии откроется на джобе ${need}`, 32, '#ffe9a8', {
        stroke: '#000000',
        strokeThickness: 5,
      });
    }
    if (changes.length) {
      button(this, GAME_W / 2, CONTENT_BOTTOM - 65, 700, 130, 'ui_btn_primary', 'Сменить профессию', () =>
        this.scene.start('JobChange', { heroId: hero.id }),
      );
    }
  }

  private gearSlot(hero: HeroState, slot: Slot, item: ReturnType<typeof heroSlots>[Slot], x: number, y: number): void {
    const bg = panel(this, x, y, 244, 200, item ? 'ui_slot_filled' : 'ui_slot_empty');
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => this.scene.start('Inventory', { heroId: hero.id, slot }));
    text(this, x, y - 70, SLOT_NAMES[slot], 28, '#b8bcc8');
    if (!item) {
      text(this, x, y + 10, '+', 72, '#8a8f99', { fontStyle: 'bold' });
      return;
    }
    const color = RARITY_COLORS[item.def.rarity];
    this.add.rectangle(x, y - 46, 200, 5, Phaser.Display.Color.HexStringToColor(color).color);
    text(this, x, y + 5, item.def.name, 30, color, { fontStyle: 'bold', stroke: '#000000', strokeThickness: 5, wordWrap: { width: 230 } });
    text(this, x, y + 62, itemStatsText(item.def.stats), 24, '#ffffff', { stroke: '#000000', strokeThickness: 4, wordWrap: { width: 230 } }).setMaxLines(2);
  }

  private skillRow(r: SkillRow, y: number, h: number): void {
    const sk = CONTENT.skills[r.id];
    const locked = r.locked !== undefined;
    const iconSize = Math.min(80, h - 16);
    if (sk?.icon && this.textures.exists(sk.icon)) {
      this.add.image(90, y, sk.icon).setDisplaySize(iconSize, iconSize).setAlpha(locked ? 0.35 : 1);
    } else {
      this.add.rectangle(90, y, iconSize, iconSize, locked ? 0x444444 : 0x6b4a2a).setStrokeStyle(3, 0xc8a060);
    }
    const kind = locked ? `откроется на джобе ${r.locked}` : r.kind;
    text(this, 150, y - h * 0.22, `${sk?.name ?? r.id}`, 32, locked ? '#9a9aa0' : '#ffffff', { fontStyle: 'bold' }).setOrigin(0, 0.5);
    text(this, 1010, y - h * 0.22, kind, 24, locked ? '#b8bcc8' : r.kind === 'Ульта' ? '#ffd84a' : '#9fe0a6').setOrigin(1, 0.5);
    if (sk?.description && h >= 80) {
      text(this, 150, y + h * 0.2, sk.description, 22, locked ? '#8a8a90' : '#e0cfb0', { align: 'left', wordWrap: { width: 860 } })
        .setOrigin(0, 0.5)
        .setMaxLines(2);
    }
  }

  private heroSprite(hero: HeroState, x: number, feetY: number): void {
    const id = heroSprite(hero, GAME);
    const view = spriteView(this, id);
    if (!view.art) {
      portrait(this, x, feetY - 120, portraitKey(id), 240);
      return;
    }
    const spr = this.add.sprite(x, feetY, view.key, 0).setOrigin(view.originX, view.originY);
    // Фигура ~240 px над ногами, как в бою, но в рамке карточки.
    spr.setScale(Math.min(1, 250 / Math.max(1, view.height)) * (view.size / spr.frame.height));
    const idle = anim(view, id, 'idle');
    if (idle) spr.play({ key: idle, repeat: -1 });
  }
}
