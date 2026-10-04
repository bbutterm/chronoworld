import type Phaser from 'phaser';
import { heroJourney } from '../core';
import { GAME, LORE } from './content';
import { bottomSheet } from './screen';
import { session } from './session';
import { COLOR, S, T } from './theme';
import { button, text, type ScrollArea } from './ui';
import { openHeroTraining } from './heroTrainingView';

export interface HeroJourneyOptions {
  lock?: ScrollArea;
  onChange?: () => void;
  onClose?: () => void;
}

/** Дневник развития персонажа: короткая следующая цель и вехи уже пройденного пути. */
export function openHeroJourney(scene: Phaser.Scene, heroId: string, opts: HeroJourneyOptions = {}): Phaser.GameObjects.Container {
  const journey = heroJourney(session.save, heroId, { ...GAME, lore: LORE });
  const wasLocked = opts.lock?.locked;
  if (opts.lock) opts.lock.locked = true;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (opts.lock) opts.lock.locked = wasLocked ?? false;
    opts.onClose?.();
  };
  const sheet = bottomSheet(scene, `Путь · ${journey.name}`, (box, width) => {
    let y = 0;
    const line = (value: string, color: string = COLOR.textPrimary, size: number = T.body) => {
      const label = text(scene, 0, y, value, size, color, { align: 'left', wordWrap: { width, useAdvancedWrap: true } }).setOrigin(0, 0);
      box.add(label);
      y += label.height + S.s;
    };
    line(journey.identity);
    line(`Достигнутый уровень: ${journey.peakLevel}. Этот путь сохраняется при переобучении.`, COLOR.textSecondary, T.caption);
    line('Следующий шаг', COLOR.title, T.heading);
    line(journey.nextGoal.text);
    if (journey.bond) line(`Близость ${journey.bond.points}/${journey.bond.max}: вечера ${journey.bond.tavernPoints}, доверие за общий путь ${journey.bond.journeyPoints}.`, COLOR.textSecondary, T.caption);
    const training = button(scene, width / 2, y + 66, width, 132, '', 'Подготовка и возврат ресурсов', () => {
      openHeroTraining(scene, heroId, { onChange: opts.onChange, onClose: () => sheet.close() });
    }, T.body, { variant: 'secondary' });
    training.container.setName('heroJourneyTraining');
    box.add(training.container);
    y += 132 + S.xl;
    line('Вехи персонажа', COLOR.title, T.heading);
    for (const milestone of journey.milestones) {
      line(`${milestone.done ? '✓' : '◇'} ${milestone.title}`, milestone.done ? COLOR.positive : COLOR.title, T.heading);
      line(milestone.detail, COLOR.textSecondary);
      y += S.xs;
    }
    return y;
  }, { onClose: finish });
  sheet.layer.setName('heroJourney');
  sheet.layer.once('destroy', finish);
  return sheet.layer;
}
