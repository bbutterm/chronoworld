/**
 * Окно события экспедиции («текстовые приключения», docs/design/expedition-adventures.md): чистая карточка —
 * «картина» места с монстром и названием события, 2–4 предложения, 2–3 варианта строками (кто из отряда справится —
 * портрет, шанс — чипом справа). После выбора — исход: «Удалось!»/«Не вышло», текст и добыча чипами.
 * Ядро — core/meta/expedition-events.ts; окно только показывает и вызывает chooseExpeditionEvent.
 */
import Phaser from 'phaser';
import { chooseExpeditionEvent, expeditionEventViews, type EventChoiceView, type ExpeditionChoice, type ExpeditionEventView, type ExpeditionStoryLine } from '../core';
import { GAME } from './content';
import { formatNumber, heroSprite } from './flow';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { cta, popIn, portrait, unitFigure, unitTint } from './screen';
import { commit, now, session } from './session';
import { portraitKey } from './sprites';
import { skinIcon } from './skin';
import { COLOR, FAMILY, R, S, T, Z } from './theme';
import { chip, clampLines, ellipsize, listRow, plate, rewardRow, tag, text, toast, type ChipSpec, type Tone } from './ui';
import { firstTip } from './firstTips';

export const EVENT_MODAL = 'expEventModal';
const W = 960;
const INNER = W - 2 * S.l;
const ART_H = 300;
const ROW_H = 132;

const LINE_NAME: Record<string, string> = {
  swordman: 'мечник',
  archer: 'лучник',
  thief: 'вор',
  merchant: 'торговец',
  mage: 'маг',
  acolyte: 'послушник',
};
const ROLE_NAME: Record<string, string> = { tank: 'защитник', healer: 'лекарь', damage: 'боец', support: 'поддержка' };

/** «вор», «лекарь», «Кай» — кто нужен варианту. */
function requirementText(c: ExpeditionChoice): string {
  const r = c.requires;
  if (!r) return '';
  const names = [
    ...(r.line ?? []).map((l) => LINE_NAME[l] ?? l),
    ...(r.role ?? []).map((x) => ROLE_NAME[x] ?? x),
    ...(r.hero ?? []).map((h) => GAME.content.heroes[h]?.name ?? h),
  ];
  return names.join(' или ');
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function heroName(id: string): string {
  const h = session.save.heroes.find((x) => x.id === id);
  return h ? (GAME.content.heroes[h.templateId]?.name ?? id) : id;
}
function heroFemale(id: string): boolean {
  const h = session.save.heroes.find((x) => x.id === id);
  return !!h && GAME.content.heroes[h.templateId]?.gender === 'f';
}

/** Строка добычи исхода: «+120 золота · +300 опыта · Кинжал · Зара ранена» (итог возвращения, Летопись). */
export function outcomeRewardText(l: ExpeditionStoryLine): string {
  const parts: string[] = [];
  if (l.gold) parts.push(`${l.gold > 0 ? '+' : '−'}${formatNumber(Math.abs(l.gold))} золота`);
  if (l.jobExp) parts.push(`${l.jobExp > 0 ? '+' : '−'}${formatNumber(Math.abs(l.jobExp))} опыта`);
  if (l.gems) parts.push(`+${l.gems} гемов`);
  if (l.item) parts.push(GAME.equipment.items[l.item]?.name ?? l.item);
  if (l.wounded) parts.push(`${heroName(l.wounded)} ${heroFemale(l.wounded) ? 'ранена' : 'ранен'}`);
  if (l.bond) parts.push(`${heroName(l.bond[0])} и ${heroName(l.bond[1])} сблизились`);
  return parts.join(' · ');
}

/** Добыча исхода чипами (золото и опыт со знаком, гемы, предмет); ранение и сближение — тегами (outcomeTags). */
export function outcomeChips(l: Pick<ExpeditionStoryLine, 'gold' | 'jobExp' | 'gems' | 'item'>): ChipSpec[] {
  const sign = (n: number) => `${n > 0 ? '+' : '−'}${formatNumber(Math.abs(n))}`;
  const out: ChipSpec[] = [];
  if (l.gold) out.push({ icon: 'gold', value: sign(l.gold), tone: l.gold > 0 ? 'gold' : 'negative' });
  if (l.jobExp) out.push({ icon: 'hero_exp', value: sign(l.jobExp), tone: l.jobExp > 0 ? 'neutral' : 'negative' });
  if (l.gems) out.push({ icon: 'gems', value: `+${l.gems}`, tone: 'gem' });
  if (l.item) out.push({ icon: l.item, value: GAME.equipment.items[l.item]?.name ?? l.item, tone: 'info' });
  return out;
}

/** Теги исхода: «Зара ранена» (красный), «Кай и Зара сблизились» (зелёный). */
export function outcomeTags(l: Pick<ExpeditionStoryLine, 'wounded' | 'bond'>): { label: string; tone: Tone }[] {
  const out: { label: string; tone: Tone }[] = [];
  if (l.wounded) out.push({ label: `${heroName(l.wounded)} ${heroFemale(l.wounded) ? 'ранена' : 'ранен'}`, tone: 'negative' });
  if (l.bond) out.push({ label: `${heroName(l.bond[0])} и ${heroName(l.bond[1])} сблизились`, tone: 'positive' });
  return out;
}

/** Тон шанса варианта: надёжно (герой в отряде) — зелёный, без нужного героя — жёлтый, прочее — нейтральный. */
export function choiceTone(c: Pick<EventChoiceView, 'hero' | 'missing'>): Tone {
  return c.hero ? 'positive' : c.missing ? 'warning' : 'neutral';
}

/**
 * Открыть первое нерешённое событие экспедиции в локации. onClose — после закрытия окна (экран перерисовать).
 * Возвращает false, если решать нечего.
 */
export function openExpeditionEvent(scene: Phaser.Scene, locationId: string, onClose: () => void): boolean {
  const view = expeditionEventViews(session.save, locationId, now(), GAME).find((v) => v.pending);
  if (!view) return false;
  const layer = scene.add.container(0, 0).setDepth(Z.confirm + 50).setName(EVENT_MODAL);
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x000000, 0.72).setInteractive();
  layer.add(shade);
  const inner = scene.add.container(0, 0);
  layer.add(inner);
  drawEvent(scene, layer, inner, view, onClose);
  popIn(scene, layer, shade);
  // Первое событие экспедиции — пара слов от Греты над окном (firstTips.ts, один раз).
  firstTip(scene, 'tip_expedition', 24, Z.confirm + 100);
  return true;
}

function locationOf(id: string) {
  return GAME.meta.expeditions.locations.find((l) => l.id === id);
}

/**
 * Карточка окна высотой h по центру экрана: поднятая поверхность, сверху — «картина» места (цвет локации, свечение,
 * её монстр справа), на ней — подпись места и заголовок. Возвращает верх тела (под картиной).
 */
function frame(scene: Phaser.Scene, box: Phaser.GameObjects.Container, h: number, locationId: string, kicker: string, title: string, titleColor: string = COLOR.title): number {
  const top = GAME_H / 2 - h / 2;
  const left = GAME_W / 2 - W / 2;
  box.add(plate(scene, GAME_W / 2, GAME_H / 2, W, h, { fill: COLOR.surfaceRaised, alpha: 0.98, border: COLOR.border, borderW: 4, r: R.xl, hl: 0.15 }).setInteractive());
  const loc = locationOf(locationId);
  const ax = left + S.xs;
  const aw = W - 2 * S.xs;
  const ay = top + S.xs;
  const tint = Phaser.Display.Color.HexStringToColor(loc?.tint ?? '#5c4b31').color;
  const dark = Phaser.Display.Color.IntegerToColor(tint).darken(60).color;
  const g = scene.add.graphics();
  g.fillGradientStyle(tint, dark, tint, dark, 1).fillRect(ax, ay, aw, ART_H);
  box.add(g);
  if (scene.textures.exists('skin_glow')) {
    box.add(scene.add.image(ax + aw * 0.72, ay + ART_H * 0.5, 'skin_glow').setDisplaySize(aw * 0.6, ART_H * 1.2).setTint(0xfff0c8).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD));
  }
  box.add(scene.add.ellipse(ax + aw * 0.72, ay + ART_H - 34, 220, 30, 0x000000, 0.35));
  const unit = loc?.monster ? GAME.content.units[loc.monster] : undefined;
  // Тень под подписями (слева и снизу) — заголовок читается на любом цвете места.
  const shade = scene.add.graphics().fillGradientStyle(0, 0, 0, 0, 0.6, 0, 0.75, 0.2).fillRect(ax, ay, aw, ART_H);
  box.add(shade);
  if (unit) {
    unitFigure(scene, unit.visual.sprite, ax + aw * 0.72, ay + ART_H - 30, ART_H * 0.78 * (loc?.monsterScale ?? 1), {
      maxScale: 2,
      onReady: (o) => {
        if (!shade.scene || !box.scene) return void o.destroy();
        o.setTint(unitTint(unit.visual));
        box.addAt(o, box.getIndex(shade));
      },
    });
  }
  box.add(plate(scene, GAME_W / 2, ay + ART_H / 2, aw, ART_H, { fill: COLOR.bg, alpha: 0, border: COLOR.border, borderW: 3, r: R.l }));
  box.add(tag(scene, ax + S.m, ay + S.l, kicker, 'neutral', { align: 'left' }));
  const t = text(scene, ax + S.m, ay + ART_H - S.m, title, T.title, titleColor, {
    fontFamily: FAMILY.heading,
    fontStyle: 'bold',
    shadow: { offsetX: 0, offsetY: 3, color: '#000000', blur: 8, fill: true },
  }).setOrigin(0, 1);
  box.add(ellipsize(t, aw * 0.62));
  return ay + ART_H + S.l;
}

/** Иконка варианта: герой в отряде — его портрет, нет нужного — значок мечей, осторожный — флаг, прочее — звезда. */
function choiceIcon(scene: Phaser.Scene, c: EventChoiceView): Phaser.GameObjects.Image {
  const h = c.hero ? session.save.heroes.find((x) => x.id === c.hero!.id) : undefined;
  if (h) return portrait(scene, 0, 0, portraitKey(heroSprite(h, GAME)), 80);
  const name = c.isDefault ? 'flag' : c.missing ? 'swords' : 'star';
  const color = c.isDefault ? COLOR.textSecondary : c.missing ? COLOR.warning : COLOR.title;
  return scene.add.image(0, 0, skinIcon(name)).setDisplaySize(64, 64).setTint(Phaser.Display.Color.HexStringToColor(color).color);
}

function drawEvent(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, box: Phaser.GameObjects.Container, v: ExpeditionEventView, onClose: () => void): void {
  box.removeAll(true);
  const body = text(scene, 0, 0, v.text, T.body, COLOR.textPrimary, { align: 'left', wordWrap: { width: INNER, useAdvancedWrap: true } }).setOrigin(0, 0);
  clampLines(body, 7);
  const n = v.choices.length;
  const h = S.xs + ART_H + S.l + body.height + S.l + n * ROW_H + (n - 1) * S.xs + S.l;
  const y0 = frame(scene, box, h, v.location, `${locationOf(v.location)?.name ?? v.location} · в пути`, v.def.title);
  body.setPosition(GAME_W / 2 - INNER / 2, y0);
  box.add(body);
  let y = y0 + body.height + S.l + ROW_H / 2;
  for (const c of v.choices) {
    const def = v.def.choices.find((x) => x.id === c.id)!;
    const sub = c.hero ? `${c.hero.name} справится` : c.missing ? `Нужен ${requirementText(def)}` : c.isDefault ? 'Без риска' : undefined;
    const trailing = c.isDefault ? undefined : chip(scene, 0, 0, null, pct(c.chance), choiceTone(c), { size: 's' });
    const row = listRow(scene, GAME_W / 2, y, INNER, {
      icon: choiceIcon(scene, c),
      title: c.label,
      subtitle: sub,
      trailing,
      h: ROW_H,
      raised: !c.isDefault,
      onTap: () => choose(scene, layer, box, v, c.id, onClose),
    }).setName(`choice_${c.id}`);
    box.add(row);
    y += ROW_H + S.xs;
  }
}

function choose(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, box: Phaser.GameObjects.Container, v: ExpeditionEventView, choiceId: string, onClose: () => void): void {
  try {
    commit(chooseExpeditionEvent(session.save, v.location, v.index, choiceId, now(), GAME));
  } catch (e) {
    toast(scene, e instanceof Error ? e.message : String(e), COLOR.negative);
    layer.destroy();
    onClose();
    return;
  }
  const views = expeditionEventViews(session.save, v.location, now(), GAME);
  const done = views.find((x) => x.index === v.index);
  const out = done?.outcome;
  const next = views.find((x) => x.pending);
  box.removeAll(true);
  const head = out ? (out.ok ? 'Удалось!' : 'Не вышло') : v.def.title;
  const body = text(scene, 0, 0, out?.text ?? '', T.body, COLOR.textPrimary, { align: 'left', wordWrap: { width: INNER, useAdvancedWrap: true } }).setOrigin(0, 0);
  clampLines(body, 7);
  const chips = out ? outcomeChips(out) : [];
  const tags = out ? outcomeTags(out) : [];
  const lore = out?.lore ? text(scene, 0, 0, out.lore, T.caption, COLOR.textSecondary, { align: 'left', wordWrap: { width: INNER - 64, useAdvancedWrap: true } }).setOrigin(0, 0) : null;
  if (lore) clampLines(lore, 3);
  const rowsH = (chips.length ? 72 + S.s : 0) + (tags.length ? 52 + S.s : 0) + (lore ? lore.height + S.s : 0);
  const h = S.xs + ART_H + S.l + body.height + S.l + rowsH + 140 + S.l;
  const choice = done?.choices.find((c) => c.id === choiceId)?.label ?? v.def.title;
  const y0 = frame(scene, box, h, v.location, ellipsizeLabel(choice), head, out ? (out.ok ? COLOR.positive : COLOR.negative) : COLOR.title);
  const left = GAME_W / 2 - INNER / 2;
  body.setPosition(left, y0);
  box.add(body);
  let y = y0 + body.height + S.l;
  if (chips.length) {
    const row = rewardRow(scene, 0, y + 36, chips, { maxW: INNER, size: 'm' });
    row.setX(left + row.width / 2);
    box.add(row.setName('eventReward'));
    y += 72 + S.s;
  }
  if (tags.length) {
    let x = left;
    for (const tg of tags) {
      const t = tag(scene, x, y + 26, tg.label, tg.tone, { align: 'left' });
      box.add(t);
      x += t.width + S.xs;
    }
    y += 52 + S.s;
  }
  if (lore) {
    // Строка в Летопись — значок свитка и текст вторичным цветом.
    box.add(scene.add.image(left + 24, y + 22, skinIcon('scroll')).setDisplaySize(44, 44).setTint(Phaser.Display.Color.HexStringToColor(COLOR.title).color));
    lore.setPosition(left + 64, y);
    box.add(lore);
    y += lore.height + S.s;
  }
  const btn = cta(scene, GAME_W / 2, y + 70, next ? 'Дальше' : 'Хорошо', () => {
    if (next) drawEvent(scene, layer, box, next, onClose);
    else {
      layer.destroy();
      onClose();
    }
  }, { w: 440, h: 122 });
  btn.container.setName('eventOk');
  box.add(btn.container);
}

/** Подпись выбора на теге картины — не длиннее строки тега. */
function ellipsizeLabel(s: string): string {
  return s.length > 36 ? `${s.slice(0, 35)}…` : s;
}
