import Phaser from 'phaser';
import { COMBAT } from '../core';
import { CONTENT } from './content';
import { BLEED_X, BLEED_Y, GAME_H, GAME_W } from './layout';
import { popIn } from './screen';
import { skillFacts } from './skillFacts';
import { skillIcon } from './skillIcons';
import { C, FS, OUTLINE, TINT, TITLE_STYLE } from './theme';
import { panel, text } from './ui';

/**
 * Окно подробностей навыка (касание по навыку на карточке героя, в выборе ветки): иконка, название, вид
 * («Активный» / «Пассивный» / «Обычная атака»), перезарядка или условие открытия, полное описание (с переносом, FS.body)
 * и цифры (skillFacts). Поверх всего (своя глубина), закрывается касанием мимо окна или по «×».
 */
export interface SkillDetailOptions {
  /** Вид: «Обычная атака», «Активный», «Пассивный» (по умолчанию — по навыку). */
  kind?: string;
  /** Навык закрыт: подпись «Откроется на ур. 30 · нужен Золотой». */
  lockNote?: string;
  /** Нейтральная подпись под видом («Ветка Рыцарь · ур. 20»). */
  note?: string;
  /** «Сила навыков» редкости героя (цифры с её учётом). */
  power?: number;
  /** Обычная атака (без перезарядки и силы навыков). */
  basic?: boolean;
  /** Глубина слоя (над окном выбора ветки). */
  depth?: number;
  onClose?: () => void;
}

export const SKILL_DETAIL = 'skillDetail';
const W = 960;
const PAD = 56;
const ICON = 132;

/** Открыть окно навыка (закрывает уже открытое). Возвращает слой (name `skillDetail`). */
export function openSkillDetail(scene: Phaser.Scene, skillId: string, o: SkillDetailOptions = {}): Phaser.GameObjects.Container | null {
  const sk = CONTENT.skills[skillId];
  if (!sk) return null;
  (scene.children.getByName(SKILL_DETAIL) as Phaser.GameObjects.Container | null)?.destroy();
  const passive = !!sk.trigger;
  const kind = o.kind ?? (o.basic ? 'Обычная атака' : passive ? 'Пассивный' : 'Активный');
  const layer = scene.add.container(0, 0).setDepth(o.depth ?? 9300).setName(SKILL_DETAIL);
  const shade = scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W + 2 * BLEED_X, GAME_H + 2 * BLEED_Y, 0x000000, 0.72).setInteractive();
  const left = GAME_W / 2 - W / 2 + PAD;
  const inner = W - 2 * PAD;

  // Шапка: иконка, название, вид и перезарядка/условие открытия.
  const textX = left + ICON + 32;
  const name = text(scene, textX, 0, sk.name, FS.h2, C.title, { ...TITLE_STYLE, wordWrap: { width: inner - ICON - 32 - 50 } }).setOrigin(0, 0);
  const kindColor = passive ? C.success : o.basic ? C.muted : C.gold;
  const kindT = text(scene, textX, 0, kind, FS.small, kindColor, { fontStyle: 'bold', ...OUTLINE }).setOrigin(0, 0);
  const sub = o.lockNote ?? o.note;
  const lock = sub ? text(scene, textX, 0, sub, FS.small, o.lockNote ? C.warning : C.muted, { ...OUTLINE, wordWrap: { width: inner - ICON - 32 } }).setOrigin(0, 0) : null;
  const headH = Math.max(ICON, name.height + 8 + kindT.height + (lock ? 6 + lock.height : 0));
  // Описание и цифры.
  const desc = sk.description
    ? text(scene, left, 0, sk.description, FS.body, C.text, { align: 'left', wordWrap: { width: inner }, lineSpacing: 8, ...OUTLINE }).setOrigin(0, 0)
    : null;
  const facts = skillFacts(sk, {
    passive,
    basic: o.basic,
    power: o.power,
    defaultCooldown: COMBAT.skills?.defaultCooldown ?? 8,
    turnSeconds: COMBAT.statusTurnSeconds ?? 1,
    nameOf: (id) => CONTENT.skills[id]?.name,
  });
  const factsT = text(scene, left, 0, facts.map((f) => `• ${f}`).join('\n'), FS.small, C.muted, { align: 'left', wordWrap: { width: inner }, lineSpacing: 10, ...OUTLINE }).setOrigin(0, 0);

  const gap = 30;
  const h = PAD + headH + gap + 4 + gap + (desc ? desc.height + gap : 0) + factsT.height + PAD;
  const top = Math.max(120, GAME_H / 2 - h / 2);
  const box = panel(scene, GAME_W / 2, top + h / 2, W, h, 'ui_panel').setInteractive();
  let y = top + PAD;
  const icon = scene.add.image(left + ICON / 2, y + ICON / 2, skillIcon(scene, sk)).setDisplaySize(ICON, ICON);
  const iconFrame = scene.add.rectangle(left + ICON / 2, y + ICON / 2, ICON + 6, ICON + 6).setStrokeStyle(4, TINT.gold, 0.9);
  if (o.lockNote) icon.setTint(0x9a9a9a);
  name.setY(y);
  kindT.setY(y + name.height + 8);
  lock?.setY(kindT.y + kindT.height + 6);
  y += headH + gap;
  const line = scene.add.rectangle(GAME_W / 2, y, inner, 3, TINT.gold, 0.5);
  y += 4 + gap;
  if (desc) {
    desc.setY(y);
    y += desc.height + gap;
  }
  factsT.setY(y);
  // «×» в углу — для тех, кто не догадается коснуться мимо окна.
  const cross = text(scene, GAME_W / 2 + W / 2 - 50, top + 46, '×', FS.h1, C.muted, { fontStyle: 'bold' }).setName('skillDetailClose');
  const close = () => {
    if (!layer.scene) return;
    layer.destroy();
    o.onClose?.();
  };
  cross.setInteractive({ useHandCursor: true }).on('pointerup', close);
  shade.on('pointerup', close);
  layer.add([shade, box, iconFrame, icon, name, kindT, ...(lock ? [lock] : []), line, ...(desc ? [desc] : []), factsT, cross]);
  popIn(scene, layer, shade);
  return layer;
}
