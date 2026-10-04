import type Phaser from 'phaser';
import { clearHeroFocus, groupDigits, heroFocusOptions, heroResetInfo, heroTemplate, resetHeroLevel, setHeroFocus } from '../core';
import { GAME } from './content';
import { bottomSheet, confirm } from './screen';
import { commit, session } from './session';
import { COLOR, S, T } from './theme';
import { button, text, type ScrollArea } from './ui';

export interface HeroTrainingOptions {
  lock?: ScrollArea;
  onChange?: () => void;
  onClose?: () => void;
}

/** Ошибка остаётся под действием, которое её вызвало, и не исчезает прежде, чем её прочитают. */
function trainingError(label: Phaser.GameObjects.Text, error: unknown): void {
  label.setText(error instanceof Error ? error.message : String(error)).setColor(COLOR.negative);
}

/** Подготовка и бесплатное перераспределение: точные суммы и явное подтверждение возврата. */
export function openHeroTraining(scene: Phaser.Scene, heroId: string, opts: HeroTrainingOptions = {}): Phaser.GameObjects.Container {
  const hero = session.save.heroes.find((h) => h.id === heroId)!;
  const t = heroTemplate(GAME, hero.templateId);
  const reset = heroResetInfo(session.save, heroId, GAME);
  const focus = heroFocusOptions(hero, GAME);
  const wasLocked = opts.lock?.locked;
  if (opts.lock) opts.lock.locked = true;
  let changed = false;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (opts.lock) opts.lock.locked = wasLocked ?? false;
    opts.onClose?.();
    if (changed) opts.onChange?.();
  };
  const sheet = bottomSheet(scene, `Тренировка · ${t.name}`, (box, width, close) => {
    let y = 0;
    const line = (value: string, color: string = COLOR.textPrimary, size: number = T.body) => {
      const label = text(scene, 0, y, value, size, color, { align: 'left', wordWrap: { width, useAdvancedWrap: true } }).setOrigin(0, 0);
      box.add(label);
      y += label.height + S.s;
      return label;
    };
    line('Одна специализация за раз. Выбор и смена бесплатны; бонус действует с уровня ' + (GAME.cards.training?.unlockLevel ?? 10) + '.');
    for (const option of focus) {
      const choose = button(scene, width / 2, y + 66, width, 132, '', `${option.name} · ${option.bonusText}${option.selected ? ' ✓' : ''}`, () => {
        try {
          commit(setHeroFocus(session.save, heroId, option.id, GAME));
          changed = true;
          close();
        } catch (error) {
          trainingError(feedback, error);
        }
      }, T.body, { variant: 'secondary' });
      if (option.selected) choose.label.setColor(COLOR.title);
      choose.container.setName(`heroFocus_${option.id}`);
      choose.setEnabled(option.available && !option.selected && !session.save.bounties.active.some((b) => b.heroIds.includes(heroId)));
      box.add(choose.container);
      y += 132 + S.xs;
      const feedback = line(option.text, COLOR.textSecondary, T.caption).setName(`heroTrainingError_${option.id}`);
    }
    if (hero.journey?.focus) {
      const clear = button(scene, width / 2, y + 66, width, 132, '', 'Снять специализацию', () => {
        try {
          commit(clearHeroFocus(session.save, heroId));
          changed = true;
          close();
        } catch (error) {
          trainingError(feedback, error);
        }
      }, T.body, { variant: 'secondary' });
      clear.container.setName('heroClearFocus');
      clear.setEnabled(!session.save.bounties.active.some((b) => b.heroIds.includes(heroId)));
      box.add(clear.container);
      y += 132 + S.s;
      const feedback = line('Достигнутые вехи и записи останутся. Боевой бонус специализации будет снят.', COLOR.textSecondary, T.caption).setName('heroTrainingError_clear');
    }
    if (!focus[0]?.available) line(`Тренировка откроется на уровне ${GAME.cards.training?.unlockLevel ?? 10}.`, COLOR.textSecondary);
    y += S.s;
    line('Вернуть вложенные ресурсы', COLOR.title, T.heading);
    if (reset.canReset) {
      line(`Уровень ${reset.fromLevel} → ${reset.level}. Вернётся ${groupDigits(reset.refund.gold)} золота и ${groupDigits(reset.refund.exp)} опыта героев.`);
      line('Имя, освоенная профессия, вещи, близость и открытые записи останутся. Обычные навыки высокого уровня снова требуют текущей подготовки.', COLOR.textSecondary, T.caption);
      const resetButton = button(scene, width / 2, y + 66, width, 132, '', 'Вернуть ресурсы · бесплатно', () => {
        confirm(scene, `${t.name}: уровень ${reset.fromLevel} → ${reset.level}. Вернуть ${groupDigits(reset.refund.gold)} золота и ${groupDigits(reset.refund.exp)} опыта?`, 'Вернуть', () => {
          try {
            const outcome = resetHeroLevel(session.save, heroId, GAME);
            commit(outcome.save);
            changed = true;
            close();
          } catch (error) {
            trainingError(feedback, error);
          }
        });
      }, T.body, { variant: 'secondary' });
      resetButton.container.setName('heroResetLevel');
      box.add(resetButton.container);
      y += 132 + S.s;
      const feedback = line('Возврат не стоит алмазов. Ресурсы можно сразу вложить в другого героя.', COLOR.textSecondary, T.caption).setName('heroTrainingError_reset');
    } else {
      line(reset.blocker === 'expedition' ? 'Герой в экспедиции. Подготовку можно менять после возвращения.' : 'У героя нет оплаченных уровней для возврата. Подаренные уровни сохраняются.', COLOR.textSecondary);
    }
    return y;
  }, { onClose: finish });
  sheet.layer.setName('heroTraining');
  sheet.layer.once('destroy', finish);
  return sheet.layer;
}
