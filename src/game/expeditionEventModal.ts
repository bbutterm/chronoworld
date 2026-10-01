/**
 * Окно события экспедиции («текстовые приключения», docs/design/expedition-adventures.md): заголовок, 2–4 предложения,
 * 2–3 варианта. Под вариантом — кто из отряда подходит (портрет, «надёжно») или шанс; после выбора — исход и добыча.
 * Ядро — core/meta/expedition-events.ts; окно только показывает и вызывает chooseExpeditionEvent.
 */
import Phaser from 'phaser';
import { chooseExpeditionEvent, expeditionEventViews, type ExpeditionChoice, type ExpeditionEventView, type ExpeditionStoryLine } from '../core';
import { GAME } from './content';
import { formatNumber, heroSprite } from './flow';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { popIn, portrait } from './screen';
import { commit, now, session } from './session';
import { portraitKey } from './sprites';
import { C, FS } from './theme';
import { button, clampLines, ellipsize, panel, text, toast } from './ui';
import { firstTip } from './firstTips';

export const EVENT_MODAL = 'expEventModal';
const W = 980;
const INNER = W - 110;
const BTN_H = 108;
const HINT_H = 46;
const ROW = BTN_H + HINT_H + 18;

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

/** Строка добычи исхода: «+120 золота · +300 опыта · Кинжал · Зара ранена». */
export function outcomeRewardText(l: ExpeditionStoryLine): string {
  const parts: string[] = [];
  if (l.gold) parts.push(`${l.gold > 0 ? '+' : '−'}${formatNumber(Math.abs(l.gold))} золота`);
  if (l.jobExp) parts.push(`${l.jobExp > 0 ? '+' : '−'}${formatNumber(Math.abs(l.jobExp))} опыта`);
  if (l.gems) parts.push(`+${l.gems} гемов`);
  if (l.item) parts.push(GAME.equipment.items[l.item]?.name ?? l.item);
  const name = (id: string) => {
    const h = session.save.heroes.find((x) => x.id === id);
    return h ? (GAME.content.heroes[h.templateId]?.name ?? id) : id;
  };
  const female = (id: string) => {
    const h = session.save.heroes.find((x) => x.id === id);
    return !!h && GAME.content.heroes[h.templateId]?.gender === 'f';
  };
  if (l.wounded) parts.push(`${name(l.wounded)} ${female(l.wounded) ? 'ранена' : 'ранен'}`);
  if (l.bond) parts.push(`${name(l.bond[0])} и ${name(l.bond[1])} сблизились`);
  return parts.join(' · ');
}

/**
 * Открыть первое нерешённое событие экспедиции в локации. onClose — после закрытия окна (экран перерисовать).
 * Возвращает false, если решать нечего.
 */
export function openExpeditionEvent(scene: Phaser.Scene, locationId: string, onClose: () => void): boolean {
  const view = expeditionEventViews(session.save, locationId, now(), GAME).find((v) => v.pending);
  if (!view) return false;
  const layer = scene.add.container(0, 0).setDepth(9050).setName(EVENT_MODAL);
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x000000, 0.75).setInteractive();
  layer.add(shade);
  const inner = scene.add.container(0, 0);
  layer.add(inner);
  drawEvent(scene, layer, inner, view, onClose);
  popIn(scene, layer, shade);
  // Первое событие экспедиции — пара слов от Греты над окном (firstTips.ts, один раз).
  firstTip(scene, 'tip_expedition', 24, 9100);
  return true;
}

function locationName(id: string): string {
  return GAME.meta.expeditions.locations.find((l) => l.id === id)?.name ?? id;
}

/** Окно по высоте содержимого: панель, заголовок и место под тело. Возвращает верх тела. */
function frame(scene: Phaser.Scene, box: Phaser.GameObjects.Container, h: number, title: string, sub: string): number {
  const top = GAME_H / 2 - h / 2;
  box.add(panel(scene, GAME_W / 2, GAME_H / 2, W, h, 'ui_panel').setInteractive());
  box.add(ellipsize(text(scene, GAME_W / 2, top + 70, title, FS.h1, C.title, { fontStyle: 'bold', stroke: C.titleStroke, strokeThickness: 8 }), INNER));
  box.add(ellipsize(text(scene, GAME_W / 2, top + 124, sub, FS.small, C.muted), INNER));
  return top + 170;
}

function drawEvent(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, box: Phaser.GameObjects.Container, v: ExpeditionEventView, onClose: () => void): void {
  box.removeAll(true);
  const body = text(scene, 0, 0, v.text, FS.body, C.text, { align: 'left', wordWrap: { width: INNER }, lineSpacing: 8, stroke: C.stroke, strokeThickness: 3 }).setOrigin(0.5, 0);
  clampLines(body, 9);
  const h = 170 + body.height + 50 + v.choices.length * ROW + 40;
  const y0 = frame(scene, box, h, v.def.title, `${locationName(v.location)} · событие в пути`);
  body.setPosition(GAME_W / 2, y0);
  box.add(body);
  let y = y0 + body.height + 50 + BTN_H / 2;
  for (const c of v.choices) {
    const def = v.def.choices.find((x) => x.id === c.id)!;
    const b = button(scene, GAME_W / 2, y, INNER, BTN_H, c.isDefault ? 'k:buttonLong_beige' : c.hero ? 'ui_btn_primary' : 'ui_btn_secondary', c.label, () => choose(scene, layer, box, v, c.id, onClose), FS.h3);
    b.container.setName(`choice_${c.id}`);
    ellipsize(b.label, INNER - 40);
    box.add(b.container);
    const hy = y + BTN_H / 2 + HINT_H / 2 + 2;
    let hint: string;
    let color: string = C.muted;
    let hx = GAME_W / 2;
    if (c.isDefault) hint = 'Осторожно: без риска, добыча как обычно';
    else if (c.hero) {
      hint = `${c.hero.name} в отряде — надёжно (${pct(c.chance)})`;
      color = C.success;
      const h = session.save.heroes.find((x) => x.id === c.hero!.id);
      if (h) {
        hx += 24;
        box.add(portrait(scene, GAME_W / 2 - 250, hy, portraitKey(heroSprite(h, GAME)), 44));
      }
    } else if (c.missing) {
      hint = `Нужен ${requirementText(def)} — без него шанс ${pct(c.chance)}`;
      color = C.warning;
    } else hint = `Шанс ${pct(c.chance)}`;
    box.add(ellipsize(text(scene, hx, hy, hint, FS.small, color), INNER - 60));
    y += ROW;
  }
}

function choose(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, box: Phaser.GameObjects.Container, v: ExpeditionEventView, choiceId: string, onClose: () => void): void {
  try {
    commit(chooseExpeditionEvent(session.save, v.location, v.index, choiceId, now(), GAME));
  } catch (e) {
    toast(scene, e instanceof Error ? e.message : String(e), C.error);
    layer.destroy();
    onClose();
    return;
  }
  const done = expeditionEventViews(session.save, v.location, now(), GAME).find((x) => x.index === v.index);
  const out = done?.outcome;
  const next = expeditionEventViews(session.save, v.location, now(), GAME).find((x) => x.pending);
  box.removeAll(true);
  const head = out ? (out.ok ? 'Удалось!' : 'Не вышло') : v.def.title;
  const body = text(scene, 0, 0, out?.text ?? '', FS.body, C.text, { align: 'left', wordWrap: { width: INNER }, lineSpacing: 8, stroke: C.stroke, strokeThickness: 3 }).setOrigin(0.5, 0);
  clampLines(body, 8);
  const reward = out ? outcomeRewardText(out) : '';
  const rew = text(scene, 0, 0, reward, FS.small, out && out.gold < 0 ? C.warning : C.gold, { fontStyle: 'bold', wordWrap: { width: INNER }, stroke: C.stroke, strokeThickness: 4 }).setOrigin(0.5, 0);
  const lore = out?.lore ? text(scene, 0, 0, `В Летопись: ${out.lore}`, FS.small, C.info, { align: 'left', wordWrap: { width: INNER }, lineSpacing: 6 }).setOrigin(0.5, 0) : null;
  if (lore) clampLines(lore, 3);
  const h = 170 + body.height + 30 + (reward ? rew.height + 24 : 0) + (lore ? lore.height + 24 : 0) + 190;
  const y0 = frame(scene, box, h, head, `${v.def.title} · ${done?.choices.find((c) => c.id === choiceId)?.label ?? ''}`);
  body.setPosition(GAME_W / 2, y0);
  box.add(body);
  let y = y0 + body.height + 30;
  if (reward) {
    rew.setPosition(GAME_W / 2, y);
    box.add(rew);
    y += rew.height + 24;
  } else rew.destroy();
  if (lore) {
    lore.setPosition(GAME_W / 2, y);
    box.add(lore);
    y += lore.height + 24;
  }
  const btn = button(scene, GAME_W / 2, y + 80, 420, 120, 'ui_btn_primary', next ? 'Дальше' : 'Хорошо', () => {
    if (next) drawEvent(scene, layer, box, next, onClose);
    else {
      layer.destroy();
      onClose();
    }
  }, FS.h2);
  btn.container.setName('eventOk');
  box.add(btn.container);
}
