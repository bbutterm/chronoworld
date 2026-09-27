import Phaser from 'phaser';
import {
  actAscend,
  ascendRequirement,
  autoFodder,
  heroCard,
  heroPower,
  heroTemplate,
  type AscendRequirement,
  type HeroState,
} from '../../core';
import { CONTENT, GAME } from '../content';
import { formatNumber, STAT_KEYS, STAT_LABELS } from '../flow';
import { GAME_H, GAME_W } from '../layout';
import { card, confirm, CONTENT_BOTTOM, CONTENT_TOP, popIn, screen } from '../screen';
import { commit, session, today } from '../session';
import { button, emptyState, pressable, progressBar, ScrollArea, text, toast } from '../ui';
import { C, FS, TINT } from '../theme';
import { sfx } from '../audio';
import { burst, countUp, juiceOn, pulse } from '../juice';
import { drawHeroCard, glowTexture, heroCardSize, raysTexture, rarityColor, rarityName, rarityPalette } from '../heroCard';
import { ascendPreview, ascendReadyWith, fodderSlotLabel, fodderSlots, placeFodder, shardSources, valuableFodder } from '../heroesView';

const TOP = CONTENT_TOP;
const CARD_W = 290;
const SLOT_W = 210;
const REVEAL_DEPTH = 8500;

/** Выбранный корм переживает перезапуск сцены (выбор в окне, «Авто»). */
let chosenFor: { heroId: string; ids: string[] } | null = null;

/**
 * H4 «Вознесение»: цель → результат (новая редкость, предел уровня, статы «было → стало», новые навыки, вторая
 * профессия), что нужно — слоты корма (призывные; нажатие — выбор из подходящих, «Авто» — самые слабые) или осколки
 * (сюжетные: прогресс и откуда брать), золото. «Вознести» — подтверждение, затем показ: корм втягивается в карточку,
 * вспышка цвета новой редкости, лучи, отсчёт мощи «+N», новые навыки; у сюжетных на фиолетовом — новая профессия и
 * строка истории. Звуки: rarity_up, job_change, equip (корм в слот). «Уменьшить анимацию» — сразу итог.
 */
export class AscendScene extends Phaser.Scene {
  constructor() {
    super('Ascend');
  }

  private heroId = '';
  private chosen: string[] = [];
  private slotPos: { x: number; y: number }[] = [];

  create(data: { heroId: string }): void {
    this.heroId = data.heroId;
    this.slotPos = [];
    const hero = session.save.heroes.find((h) => h.id === data.heroId);
    screen(this, 'Вознесение', 'Heroes', { to: 'Hero', data: { heroId: data.heroId } });
    if (!hero || !GAME.content.heroes[hero.templateId]) return;
    const req = ascendRequirement(session.save, hero.id, GAME);
    const prev = ascendPreview(hero, GAME);
    if (!req || !prev) {
      emptyState(this, GAME_W / 2, GAME_H / 2, 'Карточка на максимальной редкости — возносить некуда.');
      return;
    }
    // Выбор корма: прежний для этой карточки (только ещё подходящие), иначе — пусто.
    const valid = new Set(req.fodder.flatMap((f) => f.candidates));
    this.chosen = chosenFor?.heroId === hero.id ? chosenFor.ids.filter((id) => valid.has(id)) : [];
    chosenFor = { heroId: hero.id, ids: this.chosen };

    this.header(hero, req, prev);
    this.changes(hero, prev);
    if (req.fodder.length) this.fodderBlock(hero, req);
    else this.shardBlock(hero, req);
    this.footer(hero, req);
  }

  // ---------- было → стало ----------

  private header(hero: HeroState, req: AscendRequirement, prev: NonNullable<ReturnType<typeof ascendPreview>>): void {
    const { h } = heroCardSize(CARD_W);
    const y = TOP + 20 + h / 2;
    const toColor = rarityPalette(req.to);
    const glow = this.add.image(810, y, glowTexture(this)).setDisplaySize(CARD_W * 1.7, h * 1.5).setTint(toColor.glow).setAlpha(0.5).setBlendMode(Phaser.BlendModes.ADD);
    if (juiceOn()) this.tweens.add({ targets: glow, alpha: 0.2, duration: 900, yoyo: true, repeat: -1 });
    drawHeroCard(this, 250, y, hero, { w: CARD_W });
    drawHeroCard(this, 810, y, hero, { w: CARD_W, rarity: req.to, level: hero.level });
    // Стрелка «→» между карточками — бежит вправо.
    const arrow = text(this, 530, y - 30, '➜', 110, rarityColor(req.to), { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 8 });
    if (juiceOn()) this.tweens.add({ targets: arrow, x: 560, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    text(this, 530, y + 60, `${rarityName(req.from)}\n→ ${rarityName(req.to)}`, FS.caption, C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5, lineSpacing: 4 });
    void prev;
  }

  private changes(hero: HeroState, prev: NonNullable<ReturnType<typeof ascendPreview>>): void {
    const { h } = heroCardSize(CARD_W);
    const top = TOP + 40 + h;
    const lines: { s: string; color: string }[] = [];
    lines.push({ s: `Предел уровня ${prev.maxLevel.from} → ${prev.maxLevel.to}`, color: C.gold });
    if (prev.newJob) lines.push({ s: `Новая профессия: ${CONTENT.jobs[prev.newJob]?.name ?? prev.newJob}`, color: rarityColor(prev.to) });
    if (prev.skillPower.to !== prev.skillPower.from) lines.push({ s: `Сила навыков ×${prev.skillPower.from} → ×${prev.skillPower.to}`, color: C.positive });
    const skills = prev.newSkills.slice(0, 3).map((s) => `${CONTENT.skills[s.skill]?.name ?? s.skill}${s.now ? '' : ` (ур. ${s.level})`}`);
    if (skills.length) lines.push({ s: `Навыки: ${skills.join(', ')}`, color: C.info });
    const hh = 110 + lines.length * 46;
    card(this, GAME_W / 2, top + hh / 2, 1040, hh, true);
    STAT_KEYS.forEach((k, i) => {
      const cx = 150 + i * 260;
      const a = prev.stats.from[k];
      const b = prev.stats.to[k];
      text(this, cx, top + 30, STAT_LABELS[k], FS.caption, C.inkMuted);
      text(this, cx, top + 72, `${formatNumber(a)} → ${formatNumber(b)}`, FS.caption, b > a ? C.positive : C.ink, { fontStyle: 'bold' });
    });
    lines.forEach((l, i) => text(this, GAME_W / 2, top + 125 + i * 46, l.s, FS.caption, l.color, { fontStyle: 'bold', wordWrap: { width: 980 } }).setMaxLines(1));
    this.blockTop = top + hh + 20;
    void hero;
  }

  private blockTop = 0;

  // ---------- корм (призывные) ----------

  private fodderBlock(hero: HeroState, req: AscendRequirement): void {
    const slots = fodderSlots(req);
    const placed = placeFodder(req, this.chosen);
    const { h: sh } = heroCardSize(SLOT_W);
    const top = this.blockTop;
    const hh = sh + 170;
    card(this, GAME_W / 2, top + hh / 2, 1040, hh);
    text(this, 50, top + 42, 'Корм', FS.h3, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5);
    const auto = button(this, 880, top + 46, 260, 90, 'ui_btn_secondary', 'Авто', () => this.autoFill(hero), FS.h3);
    auto.container.setName('autoFodder');
    const n = slots.length;
    const step = Math.min(SLOT_W + 40, 960 / Math.max(1, n));
    const x0 = GAME_W / 2 - ((n - 1) * step) / 2;
    const y = top + 100 + sh / 2;
    slots.forEach((s, i) => {
      const x = x0 + i * step;
      this.slotPos.push({ x, y });
      const id = placed[i];
      const fh = id ? session.save.heroes.find((q) => q.id === id) : undefined;
      if (fh) {
        drawHeroCard(this, x, y, fh, { w: SLOT_W, showIcons: false, onTap: () => this.unchoose(id!) });
      } else {
        const bg = this.add.rectangle(x, y, SLOT_W, sh, 0x0b0805, 0.7).setStrokeStyle(4, Phaser.Display.Color.HexStringToColor(rarityColor(s.rarity)).color, 0.9);
        const has = req.fodder[s.group].candidates.length > 0;
        text(this, x, y - 40, '+', 90, has ? C.text : C.placeholder, { fontStyle: 'bold' });
        text(this, x, y + 50, has ? 'выбрать' : 'нет карт', FS.caption, has ? C.muted : C.danger);
        pressable(this, bg, SLOT_W, sh, () => this.pick(hero, req, s.group));
        if (has && juiceOn()) pulse(this, bg, 1.03, 900);
      }
      text(this, x, y + sh / 2 + 28, fodderSlotLabel(s, hero, GAME), FS.caption, C.muted, { wordWrap: { width: step - 10 } }).setMaxLines(2);
    });
    const missing = req.fodder.find((f) => f.candidates.length < f.count);
    if (missing) {
      text(this, GAME_W / 2, top + hh - 22, 'Не хватает карточек — призовите героев в Таверне', FS.caption, C.warning, { stroke: C.stroke, strokeThickness: 4 });
    }
    this.blockTop = top + hh + 20;
  }

  private autoFill(hero: HeroState): void {
    const ids = autoFodder(session.save, hero.id, GAME);
    if (!ids) {
      toast(this, 'Подходящих карточек не хватает', C.error, 2500);
      return;
    }
    chosenFor = { heroId: hero.id, ids };
    sfx('equip');
    this.scene.restart({ heroId: hero.id });
  }

  private unchoose(id: string): void {
    chosenFor = { heroId: this.heroId, ids: this.chosen.filter((x) => x !== id) };
    this.scene.restart({ heroId: this.heroId });
  }

  /** Окно выбора корма для слота group: подходящие свободные карточки (слабые первыми). */
  private pick(hero: HeroState, req: AscendRequirement, group: number): void {
    const cands = req.fodder[group].candidates.filter((id) => !this.chosen.includes(id));
    if (!cands.length) {
      toast(this, req.fodder[group].candidates.length ? 'Все подходящие уже выбраны' : 'Нет подходящих карточек — призовите героев в Таверне', C.error, 2500);
      return;
    }
    const layer = this.add.container(0, 0).setDepth(9000).setName('fodderPicker');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.75).setInteractive();
    const boxH = 1200;
    const box = card(this, GAME_W / 2, GAME_H / 2, 1000, boxH).setInteractive();
    const title = text(this, GAME_W / 2, GAME_H / 2 - boxH / 2 + 60, `Корм: ${fodderSlotLabel(req.fodder[group], hero, GAME)}`, FS.h3, C.title, { fontStyle: 'bold' });
    layer.add([shade, box, title]);
    // Закрыть — перезапуск экрана (список выбора со своей прокруткой уходит целиком).
    const close = () => this.scene.restart({ heroId: this.heroId });
    shade.on('pointerup', close);
    const w = 260;
    const { h } = heroCardSize(w);
    const areaTop = GAME_H / 2 - boxH / 2 + 110;
    const areaBottom = GAME_H / 2 + boxH / 2 - 150;
    const area = new ScrollArea(this, areaTop, areaBottom);
    area.content.setDepth(9001);
    cands.forEach((id, i) => {
      const fh = session.save.heroes.find((q) => q.id === id)!;
      const x = GAME_W / 2 + ((i % 3) - 1) * (w + 30);
      const y = 20 + h / 2 + Math.floor(i / 3) * (h + 24);
      drawHeroCard(this, x, y, fh, {
        w,
        parent: area.content,
        onTap: area.tap(() => {
          chosenFor = { heroId: this.heroId, ids: [...this.chosen, id] };
          sfx('equip');
          this.scene.restart({ heroId: this.heroId });
        }),
      });
    });
    area.setContentHeight(Math.ceil(cands.length / 3) * (h + 24) + 20);
    const cancel = button(this, GAME_W / 2, GAME_H / 2 + boxH / 2 - 80, 400, 110, 'k:buttonLong_beige', 'Отмена', close, FS.h3, { sound: 'ui_back' });
    layer.add(cancel.container);
    popIn(this, layer, shade);
  }

  // ---------- осколки (сюжетные) ----------

  private shardBlock(hero: HeroState, req: AscendRequirement): void {
    const top = this.blockTop;
    const src = shardSources(session.save, hero.templateId, GAME);
    const hh = 190 + src.length * 44 + (req.minLevel ? 50 : 0);
    card(this, GAME_W / 2, top + hh / 2, 1040, hh);
    const sh = req.shards!;
    const done = sh.have >= sh.need;
    text(this, 50, top + 45, 'Осколки героя', FS.h3, C.title, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 }).setOrigin(0, 0.5);
    text(this, 1000, top + 45, `${sh.have}/${sh.need}`, FS.h2, done ? C.positive : C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(1, 0.5).setName('shardCount');
    progressBar(this, 50, top + 105, 950, 34, sh.have / sh.need, done ? TINT.success : 0xd6ae63, { key: `shards_${hero.id}` });
    let y = top + 160;
    if (req.minLevel) {
      text(this, 50, y, `Нужен уровень ${req.minLevel} (сейчас ${hero.level})`, FS.caption, hero.level >= req.minLevel ? C.positive : C.warning, { fontStyle: 'bold' }).setOrigin(0, 0.5);
      y += 50;
    }
    for (const s of src) {
      text(this, 50, y, `• ${s}`, FS.caption, C.muted).setOrigin(0, 0.5);
      y += 44;
    }
    this.blockTop = top + hh + 20;
  }

  // ---------- кнопка и подтверждение ----------

  private footer(hero: HeroState, req: AscendRequirement): void {
    const ready = ascendReadyWith(session.save, hero.id, this.chosen, GAME);
    const by = CONTENT_BOTTOM - 80;
    const goldOk = session.save.resources.gold >= req.gold;
    text(this, GAME_W / 2, by - 110, `Золото: ${formatNumber(req.gold)} (есть ${formatNumber(session.save.resources.gold)})`, FS.body, goldOk ? C.gold : C.warning, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5 });
    const blocker = req.blockers[0] ?? (req.fodder.length && !ready ? 'Заполните все слоты корма («Авто» — самые слабые)' : '');
    if (blocker) text(this, GAME_W / 2, by - 160, blocker, FS.caption, C.warning, { stroke: C.stroke, strokeThickness: 4, wordWrap: { width: 980 } });
    if (ready) {
      const g = this.add.image(GAME_W / 2, by, glowTexture(this)).setDisplaySize(900, 300).setTint(rarityPalette(req.to).glow).setAlpha(0.6).setBlendMode(Phaser.BlendModes.ADD);
      if (juiceOn()) this.tweens.add({ targets: g, alpha: 0.25, duration: 800, yoyo: true, repeat: -1 });
    }
    const b = button(this, GAME_W / 2, by, 620, 140, ready ? 'ui_btn_primary' : 'ui_btn_secondary', 'Вознести', () => this.confirmAscend(hero, req), FS.hero);
    b.container.setName('ascendConfirm');
    if (ready) pulse(this, b.container, 1.04);
    else b.setEnabled(false);
  }

  private confirmAscend(hero: HeroState, req: AscendRequirement): void {
    if (!ascendReadyWith(session.save, hero.id, this.chosen, GAME)) {
      toast(this, req.blockers[0] ?? 'Заполните все слоты корма', C.error, 2500);
      return;
    }
    const name = heroCard(hero, GAME).name;
    const fodder = this.chosen.map((id) => session.save.heroes.find((h) => h.id === id)).filter((h): h is HeroState => !!h);
    const lines = [`${name}: ${rarityName(req.from)} → ${rarityName(req.to)}`];
    if (req.shards) lines.push(`Потратится осколков: ${req.shards.need}, золота: ${formatNumber(req.gold)}`);
    else {
      lines.push(`В корм: ${fodder.map((h) => `${heroCard(h, GAME).name} (ур. ${h.level})`).join(', ')}`);
      lines.push(`Золото: ${formatNumber(req.gold)}. Опыт корма вернётся в запас.`);
      if (valuableFodder(session.save, this.chosen).length) lines.push('Внимание: в корме синие карточки и выше!');
    }
    confirm(this, lines.join('\n'), 'Вознести', () => this.doAscend(hero));
  }

  private doAscend(hero: HeroState): void {
    const before = { power: heroPower(hero, GAME, session.save), rarity: hero.rarity, card: heroCard(hero, GAME) };
    const fodder = req0Positions(this.slotPos, this.chosen.length);
    try {
      const r = actAscend(session.save, today(), hero.id, this.chosen, GAME);
      commit(r.save);
      chosenFor = null;
      this.reveal(hero.id, before, r.events, fodder, r.refund);
    } catch (e) {
      toast(this, e instanceof Error ? e.message : String(e), C.error);
    }
  }

  // ---------- показ ----------

  private reveal(
    heroId: string,
    before: { power: number; rarity: HeroState['rarity']; card: ReturnType<typeof heroCard> },
    events: ReturnType<typeof actAscend>['events'],
    fodderFrom: { x: number; y: number }[],
    refund: { exp: number; gold: number },
  ): void {
    const hero = session.save.heroes.find((h) => h.id === heroId)!;
    const after = heroCard(hero, GAME);
    const pal = rarityPalette(hero.rarity);
    const power = heroPower(hero, GAME, session.save);
    const asc = events.find((e) => e.type === 'ascended');
    const jobChanged = !!(asc && asc.type === 'ascended' && asc.jobChanged);
    const skills = events.flatMap((e) => (e.type === 'skillUnlocked' ? [CONTENT.skills[e.skill]?.name ?? e.skill] : []));
    const motion = juiceOn();
    const layer = this.add.container(0, 0).setDepth(REVEAL_DEPTH).setName('ascendReveal');
    const shade = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x05040a, 1).setAlpha(0.94).setInteractive();
    layer.add(shade);
    const cy = 760;
    const rays = this.add.image(GAME_W / 2, cy, raysTexture(this)).setDisplaySize(1200, 1200).setTint(pal.glow).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    const halo = this.add.image(GAME_W / 2, cy, glowTexture(this)).setDisplaySize(760, 860).setTint(pal.tint).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    layer.add([rays, halo]);
    const W = 460;
    const oldCard = drawHeroCard(this, GAME_W / 2, cy, hero, { w: W, rarity: before.rarity, figure: 'sprite', showIcons: false });
    layer.add(oldCard);

    // Текст итога (появляется после вспышки).
    const info = this.add.container(0, 0).setAlpha(motion ? 0 : 1);
    layer.add(info);
    const title = text(this, GAME_W / 2, 250, 'Вознесение!', FS.hero + 16, C.gold, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 10 });
    const sub = text(this, GAME_W / 2, 340, `${rarityName(before.rarity)} → ${rarityName(hero.rarity)}`, FS.h1, rarityColor(hero.rarity), { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 8 });
    info.add([title, sub]);
    let y = cy + heroCardSize(W).h / 2 + 60;
    const powerLine = text(this, GAME_W / 2 - 40, y, '', FS.h1, C.gold, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 7 });
    const plus = text(this, GAME_W / 2 + 200, y, `+${formatNumber(power - before.power)}`, FS.h2, C.positive, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 6 }).setOrigin(0, 0.5);
    info.add([powerLine, plus]);
    y += 70;
    const extra: string[] = [`Предел уровня ${before.card.maxLevel} → ${after.maxLevel}`];
    if (jobChanged) extra.unshift(`${after.name} — теперь ${after.jobName}!`);
    if (skills.length) extra.push(`Новый навык: ${skills.join(', ')}`);
    if (refund.exp || refund.gold) extra.push(`Вернулось: опыт ${formatNumber(refund.exp)}, золото ${formatNumber(refund.gold)}`);
    for (const s of extra) {
      info.add(text(this, GAME_W / 2, y, s, FS.h3, s.startsWith('Новый') ? C.info : jobChanged && s === extra[0] ? rarityColor(hero.rarity) : C.text, { fontStyle: 'bold', stroke: C.stroke, strokeThickness: 5, wordWrap: { width: 980 } }));
      y += 58;
    }
    if (jobChanged) {
      const form = heroTemplate(GAME, hero.templateId).forms.find((f) => f.rarity === hero.rarity);
      if (form?.promotion) {
        info.add(text(this, GAME_W / 2, y + 20, `«${form.promotion}»`, FS.body, C.title, { fontStyle: 'italic', stroke: C.stroke, strokeThickness: 4, wordWrap: { width: 940 }, lineSpacing: 6 }));
        y += 100;
      }
    }
    const done = button(this, GAME_W / 2, Math.max(y + 90, GAME_H - 250), 520, 130, 'ui_btn_primary', 'Отлично!', () => this.scene.start('Hero', { heroId }), FS.h2);
    done.container.setName('revealDone').setAlpha(motion ? 0 : 1);
    layer.add(done.container);

    const finish = (newCard: Phaser.GameObjects.Container) => {
      sfx('rarity_up');
      if (jobChanged) sfx('job_change', { delay: 0.6 });
      countUp(this, powerLine, before.power, power, (n) => `Мощь ${formatNumber(n)}`, { duration: 900, delay: motion ? 200 : 0 });
      if (!motion) {
        rays.setAlpha(0.35);
        halo.setAlpha(0.5);
        return;
      }
      this.cameras.main.shake(220, 0.006);
      const flash = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0xffffff, 1).setDepth(REVEAL_DEPTH + 10);
      this.tweens.add({ targets: flash, alpha: 0, duration: 420, onComplete: () => flash.destroy() });
      burst(this, { x: GAME_W / 2, y: cy });
      newCard.setScale(1.25);
      this.tweens.add({ targets: newCard, scale: 1, duration: 420, ease: 'Back.easeOut' });
      this.tweens.add({ targets: rays, alpha: 0.4, duration: 400 });
      this.tweens.add({ targets: rays, angle: 360, duration: 30000, repeat: -1 });
      this.tweens.add({ targets: halo, alpha: 0.55, duration: 400 });
      this.tweens.add({ targets: info, alpha: 1, duration: 350, delay: 150 });
      this.tweens.add({ targets: done.container, alpha: 1, duration: 300, delay: 900 });
      plus.setAlpha(0);
      this.tweens.add({ targets: plus, alpha: 1, y: plus.y - 20, duration: 400, delay: 1000 });
    };
    const swap = () => {
      oldCard.destroy();
      const nc = drawHeroCard(this, GAME_W / 2, cy, hero, { w: W, figure: 'sprite', showIcons: false, glow: true });
      layer.addAt(nc, layer.getIndex(info));
      finish(nc);
    };
    if (!motion) {
      swap();
      return;
    }
    // Корм летит в карточку и растворяется; карточка дрожит и светится.
    this.tweens.add({ targets: shade, alpha: { from: 0, to: 0.94 }, duration: 250 });
    const flyers = fodderFrom.map((p) => {
      const g = this.add.image(p.x, p.y, glowTexture(this)).setDisplaySize(200, 260).setTint(pal.glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(REVEAL_DEPTH + 5);
      this.tweens.add({ targets: g, x: GAME_W / 2, y: cy, scale: 0.3, duration: 520, delay: 200, ease: 'Cubic.easeIn', onComplete: () => g.destroy() });
      return g;
    });
    void flyers;
    this.tweens.add({ targets: halo, alpha: 0.35, duration: 700, delay: 200 });
    this.tweens.add({ targets: oldCard, x: GAME_W / 2 + 6, duration: 50, yoyo: true, repeat: 8, delay: 350 });
    // Твином, а не таймером сцены: последовательность идёт по реальному времени даже на медленных кадрах.
    this.tweens.addCounter({ from: 0, to: 1, duration: fodderFrom.length ? 900 : 700, onComplete: swap });
  }
}

/** Точки вылета корма — места заполненных слотов по порядку. */
function req0Positions(pos: { x: number; y: number }[], n: number): { x: number; y: number }[] {
  return pos.slice(0, Math.max(0, n));
}
