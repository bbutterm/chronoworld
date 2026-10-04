import type Phaser from 'phaser';
import {
  BRANCH_RARITY,
  heroCard,
  heroCopyUpgradeInfo,
  heroCopyUpgradeOptions,
  heroTemplate,
  rarityDef,
  rarityIndex,
  upgradeHeroFromCopy,
  type HeroCopyUpgradeOption,
} from '../core';
import { GAME } from './content';
import { bottomSheet, type BottomSheet } from './screen';
import { commit, session } from './session';
import { COLOR, S, T, TOUCH_COMFORT } from './theme';
import { button, text, type ScrollArea } from './ui';
import { view } from './viewport';

export interface HeroUpgradeCopyOptions {
  lock?: ScrollArea;
  onChange?: () => void;
  onClose?: () => void;
  /** Открыть занятую копию, сохранив возврат к исходному герою. */
  onInspect?: (heroId: string) => void;
}

/** Учитывает сжатие игрового поля безопасными отступами Telegram. */
export function heroCopyTouchHeight(): number {
  const v = view();
  return Math.max(TOUCH_COMFORT, Math.ceil(44 * v.worldW / v.cssW));
}

/** Подтверждение читается и до перехода всех экранов на компактную раскладку. */
export function heroCopyTextSize(preferred: number): number {
  const v = view();
  return Math.max(preferred, Math.ceil(12 * v.worldW / v.cssW));
}

/** Более редкая копия продолжает путь выбранного героя без переноса личности и без потери второй карты. */
export function openHeroUpgradeCopyPicker(scene: Phaser.Scene, heroId: string, opts: HeroUpgradeCopyOptions = {}): Phaser.GameObjects.Container {
  const hero = session.save.heroes.find(h => h.id === heroId)!;
  const name = heroTemplate(GAME, hero.templateId).name;
  const wasLocked = opts.lock?.locked;
  if (opts.lock) opts.lock.locked = true;
  const touchH = heroCopyTouchHeight();
  const bodySize = heroCopyTextSize(T.body);
  const captionSize = heroCopyTextSize(T.caption);
  let sheet!: BottomSheet;
  let phase: 'copies' | 'confirm' | 'closed' = 'copies';
  let replacing = false;
  let busy = false;
  let changed = false;
  let inspect: string | null = null;
  let finished = false;
  const finish = () => {
    if (finished || replacing) return;
    finished = true;
    phase = 'closed';
    scene.events.off('shutdown', shutdown);
    if (opts.lock) opts.lock.locked = wasLocked ?? false;
    opts.onClose?.();
    if (!scene.sys.isActive()) return;
    if (changed) opts.onChange?.();
    else if (inspect) opts.onInspect?.(inspect);
  };
  const shutdown = () => {
    changed = false;
    inspect = null;
    finish();
  };
  scene.events.once('shutdown', shutdown);
  const active = (expected: typeof phase) => phase === expected && !busy && !finished && !sheet.layer.getData('closing');
  const bind = (next: BottomSheet, sheetName: string) => {
    sheet = next;
    sheet.layer.setName(sheetName);
    sheet.layer.once('destroy', finish);
  };
  const error = (label: Phaser.GameObjects.Text, value: unknown) => {
    label.setText(value instanceof Error ? value.message : String(value)).setColor(COLOR.negative);
  };
  const copyNumber = (copyId: string) => session.save.heroes.filter(h => h.templateId === hero.templateId).findIndex(h => h.id === copyId) + 1;

  const showConfirm = (preview: HeroCopyUpgradeOption) => {
    phase = 'confirm';
    replacing = true;
    sheet.layer.destroy();
    try {
      bind(bottomSheet(scene, `Развить спутника · ${name}`, (box, width, close) => {
        let y = 0;
        const line = (value: string, color: string = COLOR.textPrimary, size: number = T.body) => {
          const label = text(scene, 0, y, value, heroCopyTextSize(size), color, { align: 'left', wordWrap: { width, useAdvancedWrap: true } }).setOrigin(0, 0);
          box.add(label);
          y += label.height + S.s;
          return label;
        };
        const target = session.save.heroes.find(h => h.id === heroId)!;
        const donor = session.save.heroes.find(h => h.id === preview.heroId)!;
        line(`Ваш спутник · ${name} · ур. ${target.level}`, COLOR.title, T.heading).setName('heroCopyRecipient');
        line(`${rarityDef(GAME, preview.from).name} → ${rarityDef(GAME, preview.to).name}`).setName('heroCopyRecipientRarity');
        line(`Копия ${copyNumber(donor.id)} · ур. ${donor.level}`, COLOR.title, T.heading).setName('heroCopyDonor');
        line(`${rarityDef(GAME, preview.to).name} → ${rarityDef(GAME, preview.from).name}`).setName('heroCopyDonorRarity');
        line('Оба героя останутся. Уровень, обучение, близость и пройденный путь сохранятся у каждого.', COLOR.textSecondary, T.caption);
        if (preview.targetBranch) {
          const job = heroCard({ ...target, rarity: preview.to, branch: preview.targetBranch }, GAME).jobName;
          line(`${target.branch ? 'Профессия спутника' : 'Восстановится прежняя профессия спутника'}: ${job}. Путь копии ему не передаётся.`, COLOR.textSecondary, T.caption).setName('heroCopyBranchRecovery');
        } else if (rarityIndex(preview.to) >= rarityIndex(BRANCH_RARITY)) {
          line('Вторую профессию спутника вы выберете сами. Профессия копии ему не передаётся.', COLOR.textSecondary, T.caption);
        }
        if (donor.branch && rarityIndex(preview.from) < rarityIndex(BRANCH_RARITY)) {
          const firstJob = heroCard({ ...donor, rarity: preview.from, branch: undefined }, GAME).jobName;
          line(`Копия вернётся к первой профессии: ${firstJob}. Вехи её прежней ветки останутся в пути; профессия восстановится на фиолетовом и выше.`, COLOR.warning, T.caption).setName('heroCopyBranchWarning');
        }
        if (preview.unequipped.length) {
          const items = preview.unequipped.map(id => {
            const item = session.save.inventory.items.find(it => it.id === id);
            return item ? (GAME.equipment.items[item.itemId]?.name ?? 'Предмет') : 'Предмет';
          });
          line(`Неподходящие после обмена вещи вернутся в сумку: ${items.join(', ')}. Их улучшения сохранятся.`, COLOR.warning, T.caption).setName('heroCopyGearWarning');
        }
        line('Стоимость: бесплатно · 0 золота · 0 алмазов', COLOR.positive, T.body).setName('heroCopyCost');
        const feedback = line('Редкость поменяется только после подтверждения.', COLOR.textSecondary, T.caption).setName('heroCopyConfirmFeedback');
        y += Math.max(0, 4 * (captionSize + S.xxs) - feedback.height);
        const apply = button(scene, width / 2, y + touchH / 2, width, touchH, '', 'Развить спутника · бесплатно', () => {
          if (!active('confirm')) return;
          busy = true;
          try {
            const current = heroCopyUpgradeInfo(session.save, heroId, preview.heroId, GAME);
            if (!current.canUpgrade) throw new Error(current.blocker ?? 'Копия сейчас недоступна.');
            const currentHero = session.save.heroes.find(h => h.id === heroId)!;
            const currentDonor = session.save.heroes.find(h => h.id === preview.heroId)!;
            if (current.from !== preview.from || current.to !== preview.to || current.donorLevel !== preview.donorLevel
              || current.targetBranch !== preview.targetBranch || currentHero.level !== target.level
              || currentDonor.branch !== donor.branch || current.unequipped.join('|') !== preview.unequipped.join('|')) {
              throw new Error('Герои изменились. Обмен требует повторного просмотра.');
            }
            const outcome = upgradeHeroFromCopy(session.save, heroId, preview.heroId, GAME);
            commit(outcome.save);
            changed = true;
            close();
          } catch (e) {
            busy = false;
            error(feedback, e);
          }
        }, bodySize, { variant: 'primary' });
        box.add(apply.container.setName('heroCopyUpgradeConfirm'));
        y += touchH + S.s;
        box.add(button(scene, width / 2, y + touchH / 2, width, touchH, '', 'Отмена', () => {
          if (active('confirm')) close();
        }, bodySize, { variant: 'secondary' }).container.setName('heroCopyUpgradeCancel'));
        return y + touchH;
      }, { onClose: finish }), 'heroCopyUpgradeConfirmSheet');
    } catch (e) {
      replacing = false;
      finish();
      throw e;
    } finally {
      replacing = false;
    }
  };

  bind(bottomSheet(scene, `Развить спутника · ${name}`, (box, width, close) => {
    let y = 0;
    const line = (value: string, color: string = COLOR.textPrimary, size: number = T.body) => {
      const label = text(scene, 0, y, value, heroCopyTextSize(size), color, { align: 'left', wordWrap: { width, useAdvancedWrap: true } }).setOrigin(0, 0);
      box.add(label);
      y += label.height + S.s;
      return label;
    };
    line(`${name} · ${rarityDef(GAME, hero.rarity).name} · ур. ${hero.level}`, COLOR.title, T.heading);
    line('Более редкая копия поможет вашему герою продолжить путь. Он получит её редкость, а копия — его нынешнюю. Оба останутся в коллекции.', COLOR.textSecondary);
    const options = heroCopyUpgradeOptions(session.save, heroId, GAME);
    if (!options.length) line('Более редких копий пока нет. Продолжайте собирать карты этого героя.', COLOR.textSecondary);
    for (const option of options) {
      y += S.xs;
      line(`Копия ${copyNumber(option.heroId)} · ${rarityDef(GAME, option.to).name} · ур. ${option.donorLevel}`, COLOR.title, T.heading).setName(`heroCopyOption_${option.heroId}`);
      const feedback = line(option.blocker ?? 'Свободная копия. Перед обменом вы увидите, что изменится.', option.canUpgrade ? COLOR.textSecondary : COLOR.warning, T.caption).setName(`heroCopyOptionFeedback_${option.heroId}`);
      y += Math.max(0, 4 * (captionSize + S.xxs) - feedback.height);
      const recipientBusy = session.save.bounties.active.some(b => b.heroIds.includes(heroId));
      const control = button(scene, width / 2, y + touchH / 2, width, touchH, '', option.canUpgrade ? 'Посмотреть обмен' : 'Открыть копию', () => {
        if (!active('copies')) return;
        try {
          const current = heroCopyUpgradeInfo(session.save, heroId, option.heroId, GAME);
          if (current.canUpgrade) {
            showConfirm(current);
          } else {
            error(feedback, current.blocker ?? 'Копия сейчас недоступна.');
            if (!option.canUpgrade && opts.onInspect && !session.save.bounties.active.some(b => b.heroIds.includes(heroId))) {
              inspect = option.heroId;
              close();
            }
          }
        } catch (e) {
          error(feedback, e);
        }
      }, bodySize, { variant: 'secondary' });
      control.setEnabled(option.canUpgrade || (!!opts.onInspect && !recipientBusy));
      if (recipientBusy) control.setLabel('Дождитесь и заберите награды');
      box.add(control.container.setName(`heroCopySelect_${option.heroId}`));
      y += touchH + S.s;
    }
    return y;
  }, { onClose: finish }), 'heroCopyUpgradePicker');
  return sheet.layer;
}
