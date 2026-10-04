import Phaser from 'phaser';
import { redeemCode, type RedeemResult } from '../core';
import { GAME } from './content';
import { haptic } from './haptics';
import { bottomSheet, cta } from './screen';
import { commit, session, shiftTime } from './session';
import { COLOR, COLOR_N, S, T } from './theme';
import { plate, pressable, SURFACE, text, toast } from './ui';

/** Сколько символов можно ввести (коды короткие; длиннее — опечатка). */
const MAX_LEN = 24;
const FIELD_H = 120;
const LAB_CODES_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ADVANCE_LAB === '1';

/** Текст результата для игрока. */
export function codeMessage(r: RedeemResult): string {
  if (!r.ok) return r.reason === 'used' ? 'Этот код уже введён' : r.reason === 'empty' ? 'Введите код' : 'Такого кода нет';
  const parts: string[] = [];
  if (r.gems > 0) parts.push(`+${r.gems} алмазов`);
  if (r.hours > 0) parts.push(`часы игры вперёд на ${r.hours} ч`);
  return `Код принят: ${parts.join(', ')}`;
}

/**
 * Раздел «Коды» (настройки): поле ввода и «Ввести». Клавиатура телефона — через скрытый DOM-input (Phaser сам текст не
 * вводит): касание поля даёт ему фокус, набранное повторяется в поле на холсте. Принятый код — алмазы на счёт, часы
 * вперёд (session.shiftTime), экран перерисовывается (onDone), чтобы обновились валюта и таймеры.
 */
export function openCodes(scene: Phaser.Scene, onDone: () => void): void {
  const input = document.createElement('input');
  Object.assign(input.style, {
    position: 'fixed',
    left: '50%',
    top: '30%',
    width: '1px',
    height: '1px',
    opacity: '0',
    border: '0',
    padding: '0',
    fontSize: '16px', // меньше 16 — iOS приближает страницу при фокусе
  });
  input.maxLength = MAX_LEN;
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Код');
  input.name = 'cwCode';
  document.body.appendChild(input);

  let value: Phaser.GameObjects.Text;
  let result: Phaser.GameObjects.Text;
  let caret: Phaser.GameObjects.Rectangle;
  let done = false;
  let applying = false;

  const cleanup = () => {
    input.remove();
  };
  const sheet = bottomSheet(
    scene,
    'Коды',
    (content, width, close) => {
      let y = 0;
      const field = plate(scene, width / 2, y + FIELD_H / 2, width, FIELD_H, { ...SURFACE.sunken, r: 20 }).setName('codeField');
      value = text(scene, S.m, y + FIELD_H / 2, 'Введите код', T.heading, COLOR.textTertiary).setOrigin(0, 0.5).setName('codeValue');
      caret = scene.add.rectangle(S.m, y + FIELD_H / 2, 4, 56, COLOR_N.accent).setOrigin(0, 0.5).setVisible(false);
      content.add([field, value, caret]);
      pressable(scene, field, width, FIELD_H, () => input.focus());
      y += FIELD_H + S.s;
      result = text(scene, width / 2, y + 24, '', T.body, COLOR.textSecondary).setOrigin(0.5).setName('codeResult');
      content.add(result);
      y += 48 + S.s;
      const apply = async () => {
        if (done || applying) return;
        applying = true;
        const submitted = input.value;
        let cfg = GAME.codes ?? { codes: [] };
        try {
          if (LAB_CODES_ENABLED) {
            const { withLabCodes } = await import('../core/codes/lab');
            cfg = withLabCodes(cfg);
          }
        } catch {
          if (input.isConnected) result.setText('Не удалось открыть тестовые коды').setColor(COLOR.negative);
          return;
        } finally {
          applying = false;
        }
        if (!input.isConnected) return;
        const r = redeemCode(session.save, submitted, cfg, { allowLab: LAB_CODES_ENABLED });
        result.setText(codeMessage(r)).setColor(r.ok ? COLOR.positive : COLOR.negative);
        if (!r.ok) {
          haptic('error');
          return;
        }
        done = true;
        commit(r.save);
        if (r.hours > 0) shiftTime(r.hours * 3600_000);
        haptic('reward');
        input.blur();
        const msg = codeMessage(r);
        close();
        onDone();
        // После перерисовки экрана — тост уже в новом экране.
        scene.events.once(Phaser.Scenes.Events.CREATE, () => toast(scene, msg, COLOR.positive, 2500));
      };
      const btn = cta(scene, width / 2, y + 70, 'Ввести', apply, { w: Math.min(width, 600) });
      btn.container.setName('codeApply');
      content.add(btn.container);
      input.onkeydown = (e) => {
        if (e.key === 'Enter') apply();
      };
      return y + 140;
    },
    { onClose: cleanup },
  );
  sheet.layer.setName('codesSheet');
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);

  const render = () => {
    if (!value?.scene) return;
    const v = input.value;
    value.setText(v || 'Введите код').setColor(v ? COLOR.textPrimary : COLOR.textTertiary);
    caret.setX(S.m + (v ? value.width + 6 : 0)).setVisible(document.activeElement === input);
    if (result?.scene && result.text) result.setText('');
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', render);
  // Сразу фокус: открыли «Коды» касанием — клавиатура поднимется (iOS разрешает фокус только из касания).
  input.focus();
}
