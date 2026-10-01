import Phaser from 'phaser';
import { applyPreset, deletePreset, savePreset, squadPower, type Preset } from '../core';
import { GAME } from './content';
import { heroSprite, nextPresetName, presetMatches } from './flow';
import { haptic } from './haptics';
import { rarityColor } from './heroCard';
import { bottomSheet, confirm, portrait, type BottomSheet } from './screen';
import { commit, session } from './session';
import { portraitKey } from './sprites';
import { button, chip, mixHex, plate, SURFACE, tag, text, toast } from './ui';
import { C, COLOR, R, S, T, TOUCH } from './theme';

/**
 * Пресеты отряда листом снизу (итерация 4): вместо постоянной секции на экране «Отряд» — кнопка-закладка «Пресеты»
 * в заголовке сетки героев. В листе: «Сохранить текущий» и строки пресетов (имя, мощь, мини-портреты отряда;
 * «Поставить» или метка «Текущий»; «✕» — удалить с подтверждением). Поставили — лист закрывается, редактор
 * перерисовывается (onApplied). Сохранили / удалили — лист перестраивается на месте.
 */
export interface PresetsSheetOpts {
  /** Отряд заменён пресетом: перерисовать редактор. */
  onApplied: (p: Preset) => void;
  /** Лист открыт/закрыт — выключить жесты редактора под ним. */
  onLock?: (locked: boolean) => void;
}

const ROW_H = 132;

export function openPresetsSheet(scene: Phaser.Scene, opts: PresetsSheetOpts): BottomSheet {
  opts.onLock?.(true);
  let reopening = false;
  const reopen = (sheet: BottomSheet) => {
    reopening = true;
    sheet.layer.destroy();
    openPresetsSheet(scene, opts);
  };
  let self: BottomSheet | null = null;
  self = bottomSheet(
    scene,
    'Пресеты',
    (content, width, close) => {
      const save = session.save;
      const max = GAME.meta.expeditions.presets.max;
      const full = save.presets.length >= max;
      let y = 0;
      const head = text(scene, 0, y + 44, `${save.presets.length} / ${max}`, T.body, COLOR.textSecondary).setOrigin(0, 0.5);
      const saveBtn = button(scene, width - 230, y + 44, 460, 96, '', 'Сохранить текущий', () => {
        const same = session.save.presets.find((p) => presetMatches(p, session.save.squad));
        if (same) {
          toast(scene, `Такой пресет уже есть: «${same.name}»`);
          return;
        }
        try {
          const r = savePreset(session.save, nextPresetName(session.save.presets), GAME);
          commit(r.save);
          haptic('tap');
          if (self) reopen(self);
        } catch (e) {
          toast(scene, e instanceof Error ? e.message : String(e), C.error);
        }
      }, T.body, { variant: 'secondary' });
      saveBtn.container.setName('presetSave');
      if (full) saveBtn.setEnabled(false);
      content.add([head, saveBtn.container]);
      y += 88 + S.s;
      if (!save.presets.length) {
        content.add(text(scene, width / 2, y + 60, 'Пока пусто', T.body, COLOR.textTertiary));
        return y + 120;
      }
      save.presets.forEach((p, i) => {
        content.add(presetRow(scene, width, y + ROW_H / 2, p, {
          apply: () => {
            try {
              commit(applyPreset(session.save, p.id));
              close();
              opts.onApplied(p);
            } catch (e) {
              toast(scene, e instanceof Error ? e.message : String(e), C.error);
            }
          },
          remove: () =>
            confirm(scene, `Удалить пресет «${p.name}»?\nТекущий отряд не изменится.`, 'Удалить', () => {
              try {
                commit(deletePreset(session.save, p.id));
                if (self) reopen(self);
              } catch (e) {
                toast(scene, e instanceof Error ? e.message : String(e), C.error);
              }
            }, { danger: true }),
        }).setName(`preset_${i}`));
        y += ROW_H + S.xs;
      });
      return y - S.xs;
    },
    { onClose: () => !reopening && opts.onLock?.(false) },
  );
  return self;
}

/** Строка пресета: имя и мощь слева, мини-портреты отряда, справа «Поставить» (или «Текущий») и «✕». */
function presetRow(
  scene: Phaser.Scene,
  w: number,
  y: number,
  p: Preset,
  on: { apply: () => void; remove: () => void },
): Phaser.GameObjects.Container {
  const save = session.save;
  const current = presetMatches(p, save.squad);
  const c = scene.add.container(w / 2, y);
  const bg = plate(scene, 0, 0, w, ROW_H, current ? { ...SURFACE.raised, border: mixHex(COLOR.border, COLOR.positive, 0.5), r: R.m } : { ...SURFACE.sunken, r: R.m });
  c.add(bg);
  const left = -w / 2 + S.m;
  const name = text(scene, left, -24, p.name, T.body, COLOR.textPrimary, { fontStyle: 'bold' }).setOrigin(0, 0.5);
  const power = chip(scene, left, 26, 'swords', squadPower(applyPreset(save, p.id), GAME), 'neutral', { size: 's', bg: false, align: 'left' });
  c.add([name, power]);
  // Мини-портреты: рамка цвета редкости (пустое место — тусклая плашка).
  const px0 = left + 270;
  p.squad.forEach((id, i) => {
    const x = px0 + i * 64;
    const hero = id ? save.heroes.find((h) => h.id === id) : undefined;
    c.add(plate(scene, x, 0, 58, 58, hero ? { fill: COLOR.surfaceSunken, border: rarityColor(hero.rarity), borderW: 3, r: R.s } : { ...SURFACE.sunken, r: R.s }));
    if (hero) c.add(portrait(scene, x, 0, portraitKey(heroSprite(hero, GAME)), 50));
  });
  const right = w / 2 - S.m;
  const del = button(scene, right - TOUCH / 2, 0, TOUCH, TOUCH, '', '✕', on.remove, T.heading, { variant: 'danger' });
  c.add(del.container);
  if (current) c.add(tag(scene, right - TOUCH - S.xs, 0, 'Текущий', 'positive', { align: 'right' }));
  else {
    const b = button(scene, right - TOUCH - S.xs - 120, 0, 240, TOUCH, '', 'Поставить', on.apply, T.body, { variant: 'secondary' });
    c.add(b.container);
  }
  return c;
}
