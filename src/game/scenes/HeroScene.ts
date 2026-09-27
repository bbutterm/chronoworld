import Phaser from 'phaser';
import { hintDone } from '../hints';
import { availableJobChanges, COMBAT, expToNext, heroGearStats, heroPower, heroSkills, heroSlots, SLOTS, statsAt, type HeroState, type Slot } from '../../core';
import { CONTENT, GAME } from '../content';
import { formatNumber, heroSprite, itemStatsText, lockedJobSkills, RARITY_COLORS, ROLE_NAMES, SLOT_NAMES, STAT_KEYS, STAT_LABELS } from '../flow';
import { GAME_W } from '../layout';
import { card, CONTENT_BOTTOM, CONTENT_TOP, portrait, screen } from '../screen';
import { session } from '../session';
import { anim, portraitKey, spriteView, whenSprites } from '../sprites';
import { button, ellipsize, hintPointer, panel, pressable, progressBar, ScrollArea, text } from '../ui';
import { C, FS, TINT } from '../theme';

const SKILL_ROW_H = 124;

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
    text(this, x, top + 115, `${ROLE_NAMES[job?.role ?? ''] ?? ''} · ${CONTENT.skills[job?.basic ?? '']?.range === 'melee' ? 'ближний бой' : 'дальний бой'}`, FS.body, C.muted).setOrigin(0, 0.5);
    const max = job?.maxJobLevel ?? hero.jobLevel;
    const atMax = hero.jobLevel >= max;
    const need = expToNext(hero.jobLevel, GAME.progression);
    text(this, x, top + 180, `Джоб ${hero.jobLevel} / ${max}`, FS.h3, C.text, { fontStyle: 'bold' }).setOrigin(0, 0.5);
    progressBar(this, x, top + 235, 600, 34, atMax ? 1 : hero.jobExp / need, atMax ? TINT.gold : TINT.success);
    text(this, x + 300, top + 235, atMax ? 'максимальный уровень' : `опыт ${hero.jobExp} / ${need}`, FS.caption, C.text, { stroke: C.stroke, strokeThickness: 4 });
    const power = text(this, 1010, top + 60, `Мощь ${formatNumber(heroPower(hero, GAME, session.save))}`, FS.h3, C.gold, {
      fontStyle: 'bold',
      stroke: C.stroke,
      strokeThickness: 6,
    }).setOrigin(1, 0.5);
    ellipsize(text(this, x, top + 60, job?.name ?? hero.job, FS.h1, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5), 1010 - x - power.width - 20);
    const history = hero.jobHistory.map((h) => `${CONTENT.jobs[h.job]?.name ?? h.job} ${h.jobLevel}`);
    if (history.length) ellipsize(text(this, x, top + 295, `Путь: ${history.join(' → ')} → ${job?.name ?? hero.job}`, FS.caption, C.dim).setOrigin(0, 0.5), 1010 - x);

    // --- Статы ---
    const sy = top + 430;
    card(this, GAME_W / 2, sy, 1040, 150, true);
    if (job) {
      // Статы с экипировкой (K6): крупно — итог, мелко — рост за уровень и прибавка предметов.
      const s = statsAt(job, hero.jobLevel);
      const g = job.growth;
      const gear = heroGearStats(session.save, hero.id, GAME);
      STAT_KEYS.forEach((k, i) => {
        const cx = 150 + i * 260;
        const plus = gear[k];
        text(this, cx, sy - 36, `${STAT_LABELS[k]} ${s[k] + plus}`, FS.h3, plus ? C.inkInfo : C.ink, { fontStyle: 'bold' });
        text(this, cx, sy + 8, g[k] ? `+${g[k]}/ур.` : '—', FS.caption, C.inkMuted);
        if (plus) text(this, cx, sy + 42, `+${plus} экип.`, FS.caption, C.inkInfo);
      });
    }

    // --- Экипировка: 4 слота ---
    const gy = sy + 185;
    const slots = heroSlots(session.save, hero.id, GAME);
    SLOTS.forEach((slot, i) => this.gearSlot(hero, slot, slots[slot], 150 + i * 260, gy));

    // --- Навыки ---
    const skills = heroSkills(hero, GAME);
    const rows: SkillRow[] = [{ id: skills.basic, kind: 'Обычная атака' }];
    for (const id of skills.actives) rows.push({ id, kind: activeKind(id) });
    for (const id of skills.passives) rows.push({ id, kind: 'Пассивный' });
    for (const l of lockedJobSkills(hero.job, hero.jobLevel, GAME)) rows.push({ id: l.skill, kind: '', locked: l.jobLevel });

    const changes = availableJobChanges(hero, GAME);
    const nextTier = (job?.tier ?? 2) + 1;
    const listTop = gy + 120;
    // Внизу — кнопка смены профессии или подсказка, когда она откроется.
    const listBottom = CONTENT_BOTTOM - (changes.length ? 150 : nextTier <= 2 ? 70 : 0);
    // Навыков может быть больше, чем влезает: список прокручивается пальцем внутри карточки.
    const listH = Math.min(listBottom - listTop, SKILL_ROW_H * rows.length + 20);
    card(this, GAME_W / 2, listTop + listH / 2, 1040, listH);
    this.skills = new ScrollArea(this, listTop + 10, listTop + listH - 10);
    rows.forEach((r, i) => this.skillRow(r, SKILL_ROW_H * (i + 0.5), SKILL_ROW_H));
    this.skills.setContentHeight(SKILL_ROW_H * rows.length);

    if (!changes.length && nextTier <= 2) {
      const need = GAME.progression.jobChange.tierLevel[String(nextTier) as '1' | '2'];
      text(this, GAME_W / 2, listTop + listH + 40, `Смена профессии откроется на джобе ${need}`, FS.body, C.title, {
        stroke: C.stroke,
        strokeThickness: 5,
      });
    }
    if (changes.length) {
      button(this, GAME_W / 2, CONTENT_BOTTOM - 65, 700, 130, 'ui_btn_primary', 'Сменить профессию', () =>
        this.scene.start('JobChange', { heroId: hero.id }),
      );
      // R: подсказка первой смены профессии.
      if (!hintDone('job_change')) hintPointer(this, GAME_W / 2, CONTENT_BOTTOM - 65, 'Смена профессии доступна — выберите новую', 'above', { w: 700, h: 130 });
    }
  }

  private skills!: ScrollArea;

  private gearSlot(hero: HeroState, slot: Slot, item: ReturnType<typeof heroSlots>[Slot], x: number, y: number): void {
    const bg = panel(this, x, y, 244, 200, item ? 'ui_slot_filled' : 'ui_slot_empty');
    pressable(this, bg, 244, 200, () => this.scene.start('Inventory', { heroId: hero.id, slot }));
    text(this, x, y - 70, SLOT_NAMES[slot], FS.small, C.dim);
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
    if (sk?.icon && this.textures.exists(sk.icon)) {
      a.add(this.add.image(90, y, sk.icon).setDisplaySize(iconSize, iconSize).setAlpha(locked ? 0.35 : 1));
    } else {
      a.add(this.add.rectangle(90, y, iconSize, iconSize, locked ? 0x444444 : 0x6b4a2a).setStrokeStyle(3, TINT.frame));
    }
    const kind = locked ? `откроется на джобе ${r.locked}` : r.kind;
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

  /** U: лист героя грузится при первом открытии карточки (и остаётся в кэше листов для боя). */
  private heroSprite(hero: HeroState, x: number, feetY: number): void {
    const id = heroSprite(hero, GAME);
    whenSprites(this, [id], () => this.drawHero(id, x, feetY));
  }

  private drawHero(id: string, x: number, feetY: number): void {
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

/** Подпись активного навыка: перезарядка и каст (например «КД 5 с · каст 2 с»). */
function activeKind(id: string): string {
  const sk = CONTENT.skills[id];
  const cd = sk?.cooldown ?? COMBAT.skills?.defaultCooldown ?? 8;
  const parts = [cd > 0 ? `КД ${cd} с` : 'КД нет'];
  if (sk?.castTime) parts.push(`каст ${sk.castTime} с`);
  return parts.join(' · ');
}
