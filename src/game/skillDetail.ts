import Phaser from 'phaser';
import { COMBAT } from '../core';
import { CONTENT } from './content';
import { bottomSheet } from './screen';
import { factRows, skillFacts, skillKind } from './skillFacts';
import { skillIcon } from './skillIcons';
import { skinIcon } from './skin';
import { COLOR, COLOR_N, R, S, T, Z } from './theme';
import { plate, SURFACE, tag, text, type Tone } from './ui';

/**
 * Подробности навыка (касание плитки на карточке героя, навыка в выборе ветки, на вознесении) — лист снизу
 * (screen.ts bottomSheet): заголовок — название; иконка, вид тегом («Автонавык» / «Пассивный» / «Ульта» /
 * «Обычная атака»), условие открытия; полное описание; цифры строками «подпись — значение» (skillFacts → factRows).
 * Закрывается «×», касанием мимо листа и «назад».
 */
export interface SkillDetailOptions {
  /** Вид: «Обычная атака», «Автонавык», «Пассивный» (по умолчанию — по навыку). */
  kind?: string;
  /** Навык закрыт: подпись «Откроется на ур. 30 · нужен Золотой». */
  lockNote?: string;
  /** Нейтральная подпись под видом («Ветка Рыцарь · ур. 20»). */
  note?: string;
  /** «Сила навыков» редкости героя (цифры с её учётом). */
  power?: number;
  /** Обычная атака (без перезарядки и силы навыков). */
  basic?: boolean;
  /** Ульта героя: на энергии, без перезарядки. */
  ult?: boolean;
  /** Глубина слоя (над окном выбора ветки). */
  depth?: number;
  onClose?: () => void;
}

/** Метка листа навыка (data у слоя bottomSheet) — открытый лист закрывается перед новым. */
export const SKILL_DETAIL = 'skillDetail';
const ICON = 136;
const LABEL_W = 250;

/** Тон тега вида навыка. */
function kindTone(kind: string, passive: boolean): Tone {
  if (kind === 'Ульта') return 'gold';
  if (kind === 'Обычная атака') return 'neutral';
  return passive ? 'positive' : 'accent';
}

/** Открыть лист навыка (закрывает уже открытый). Возвращает слой листа (name `bottomSheet`, data `skillDetail`). */
export function openSkillDetail(scene: Phaser.Scene, skillId: string, o: SkillDetailOptions = {}): Phaser.GameObjects.Container | null {
  const sk = CONTENT.skills[skillId];
  if (!sk) return null;
  for (const c of scene.children.list) {
    if (c.getData?.(SKILL_DETAIL)) (c.getData('close') as (() => void) | undefined)?.();
  }
  const passive = !!sk.trigger;
  const kind = o.kind ?? skillKind(sk, o);
  const sheet = bottomSheet(
    scene,
    sk.name,
    (box, width) => {
      // Иконка и теги: вид, условие открытия (или нейтральная подпись).
      box.add(plate(scene, ICON / 2, ICON / 2, ICON, ICON, { ...SURFACE.sunken, border: o.ult ? COLOR.accent : COLOR.border, borderW: o.ult ? 4 : 2, r: R.m }));
      const icon = scene.add.image(ICON / 2, ICON / 2, skillIcon(scene, sk)).setDisplaySize(ICON - 24, ICON - 24);
      if (o.lockNote) icon.setTint(0x9a9a9a);
      box.add(icon);
      const tx = ICON + S.m;
      box.add(tag(scene, tx, 30, kind, kindTone(kind, passive), { align: 'left' }));
      const sub = o.lockNote ?? o.note;
      if (sub) {
        if (o.lockNote) box.add(scene.add.image(tx + 18, 96, skinIcon('lock')).setDisplaySize(32, 32).setTint(COLOR_N.warning));
        const st = text(scene, tx + (o.lockNote ? 46 : 0), 96, sub, T.caption, o.lockNote ? COLOR.warning : COLOR.textSecondary, { align: 'left', wordWrap: { width: width - tx - 46 } }).setOrigin(0, 0.5);
        st.setMaxLines(2);
        box.add(st);
      }
      let y = ICON + S.m;
      if (sk.description) {
        const desc = text(scene, 0, y, sk.description, T.body, COLOR.textPrimary, { align: 'left', wordWrap: { width } }).setOrigin(0, 0);
        box.add(desc);
        y += desc.height + S.m;
      }
      const facts = factRows(
        skillFacts(sk, {
          passive,
          basic: o.basic,
          ult: o.ult,
          power: o.power,
          defaultCooldown: COMBAT.skills?.defaultCooldown ?? 8,
          turnSeconds: COMBAT.statusTurnSeconds ?? 1,
          nameOf: (id) => CONTENT.skills[id]?.name,
        }),
      );
      // Цифры: тонкая линия сверху, строки «подпись — значение» на утопленной поверхности.
      box.add(scene.add.rectangle(width / 2, y, width, 2, COLOR_N.border, 0.8));
      y += S.s;
      for (const f of facts) {
        const v = text(scene, f.label ? LABEL_W : 0, y, f.value, T.caption, COLOR.textPrimary, { align: 'left', wordWrap: { width: f.label ? width - LABEL_W : width } }).setOrigin(0, 0);
        if (f.label) box.add(text(scene, 0, y, f.label, T.caption, COLOR.textSecondary, { align: 'left', wordWrap: { width: LABEL_W - S.xs } }).setOrigin(0, 0));
        box.add(v);
        y += v.height + S.xs;
      }
      return y;
    },
    { onClose: o.onClose },
  );
  sheet.layer.setDepth(o.depth ?? Z.modal).setData(SKILL_DETAIL, skillId);
  return sheet.layer;
}
