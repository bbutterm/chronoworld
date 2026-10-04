import type { Lore } from '../lore/schema';
import { heroStoryPieces } from '../lore/heroStories';
import type { GameContext } from '../progression/types';
import type { SaveState } from '../save/schema';
import { bondView, type BondView, type TavernContext } from '../tavern/tavern';
import { activeForm, branchOf, heroTemplate, jobTitle, maxLevelOf } from './card';
import { findHero } from './level';
import { rarityIndex } from './schema';
import { heroFocusOptions, type HeroFocus, type HeroFocusOption } from './training';

type JourneyContext = GameContext & Partial<TavernContext> & { lore?: Pick<Lore, 'heroStories'> };

export interface HeroJourneyMilestone {
  id: string;
  title: string;
  detail: string;
  done: boolean;
}

export interface HeroJourney {
  heroId: string;
  templateId: string;
  name: string;
  identity: string;
  companion: boolean;
  level: number;
  peakLevel: number;
  focus?: HeroFocus;
  focusOptions: HeroFocusOption[];
  milestones: HeroJourneyMilestone[];
  nextGoal: { kind: 'level' | 'ascend' | 'branch' | 'story' | 'bond' | 'complete'; text: string };
  bond?: BondView;
}

/** Единый RPG-путь: конкретные действия, профессия и отношения, без новой валюты или награды за сброс. */
export function heroJourney(save: SaveState, heroId: string, ctx: JourneyContext): HeroJourney {
  const hero = findHero(save, heroId);
  const t = heroTemplate(ctx, hero.templateId);
  const peakLevel = Math.max(hero.level, hero.journey?.peakLevel ?? 1);
  const focusOptions = heroFocusOptions(hero, ctx);
  const branch = branchOf(t, hero.branch);
  const form = activeForm(t, hero);
  const advanced = branch?.advanced;
  const secondDone = !!branch;
  const advancedPeak = branch ? Math.max(hero.level, hero.journey?.branchLevels?.[branch.job] ?? 1) : 1;
  const veteranDone = !!advanced && advancedPeak >= advanced.minLevel && rarityIndex(hero.rarity) >= rarityIndex(advanced.minRarity);
  const bond = bondView(save, hero.templateId, ctx);
  const milestones: HeroJourneyMilestone[] = [
    { id: 'arrival', title: 'Встреча', detail: t.hook || t.bio, done: true },
    { id: 'training', title: 'Своя выучка', detail: `Уровень ${ctx.cards.training?.unlockLevel ?? 10}: выберите подготовку под роль героя. Переобучение бесплатно.`, done: !!hero.journey?.focus },
    { id: 'profession', title: secondDone ? jobTitle(ctx, branch!.job, t.gender) : 'Вторая профессия', detail: secondDone ? branch!.promotion : 'Соберите копии до фиолетовой редкости и выберите один из двух профессиональных путей.', done: secondDone },
  ];
  if (bond) {
    milestones.push({ id: 'trust', title: 'Доверие', detail: bond.scene.open ? bond.scene.title : `Вечера с отрядом: близость ${bond.scene.at} открывает личный разговор.`, done: bond.scene.seen });
    milestones.push({ id: 'personal', title: 'Личное испытание', detail: bond.quest.open ? `${bond.quest.title}: ${bond.quest.goal}` : `Близость ${bond.quest.at}: помочь герою в его собственном деле.`, done: bond.quest.done });
    milestones.push({ id: 'link', title: 'Плечом к плечу', detail: bond.quest.done ? `${bond.link.name}: ${bond.link.text}` : 'Завершите личное испытание, чтобы открыть совместный приём.', done: bond.link.open });
  }
  milestones.push({ id: 'veteran', title: veteranDone ? jobTitle(ctx, advanced!.job, t.gender) : 'Ветеран профессии', detail: advanced ? `На ${advanced.minLevel}-м уровне и ${advanced.minRarity === 'gold' ? 'золотой' : 'красной'} редкости выбранная профессия развивается дальше.` : 'Сначала выберите вторую профессию.', done: veteranDone });
  let nextGoal: HeroJourney['nextGoal'];
  if (focusOptions.length && !hero.journey?.focus) {
    nextGoal = focusOptions[0].available
      ? { kind: 'level', text: 'Выберите тренировку: стойкость, точность или прикрытие.' }
      : { kind: 'level', text: `Поднимите героя до уровня ${ctx.cards.training!.unlockLevel}, чтобы выбрать его выучку.` };
  } else if (rarityIndex(hero.rarity) < rarityIndex('purple')) {
    nextGoal = { kind: 'ascend', text: 'Собирайте копии этого героя для повышения профессии. Спутник сохраняет свой путь.' };
  } else if (!branch) {
    nextGoal = { kind: 'branch', text: 'Выберите вторую профессию: она меняет роль, навыки и историю героя.' };
  } else if (bond && !bond.scene.seen) {
    nextGoal = bond.scene.open ? { kind: 'bond', text: `Послушайте личный разговор «${bond.scene.title}».` } : { kind: 'bond', text: `Проводите вечера с героем в отряде: до личного разговора ${Math.max(0, bond.scene.at - bond.points)} близости.` };
  } else if (bond && !bond.quest.done) {
    nextGoal = { kind: 'bond', text: !bond.quest.open ? `Ещё ${Math.max(0, bond.quest.at - bond.points)} близости до личного испытания.` : !bond.quest.stageCleared ? 'Продвиньтесь по кампании, чтобы открыть место личного испытания.' : `Пройдите «${bond.quest.title}» вместе с героем.` };
  } else if (advanced && !veteranDone) {
    nextGoal = hero.level >= maxLevelOf(ctx, hero.rarity) || rarityIndex(hero.rarity) < rarityIndex(advanced.minRarity)
      ? { kind: 'ascend', text: `Повышайте редкость копиями. Выучка ветерана требует уровня ${advanced.minLevel} и ${advanced.minRarity === 'gold' ? 'золотой' : 'красной'} редкости.` }
      : { kind: 'level', text: `Доведите героя до уровня ${advanced.minLevel}: откроется ветеранская выучка.` };
  } else {
    const unread = ctx.lore && heroStoryPieces(save, hero.templateId, ctx.lore).find((p) => p.open && !p.read);
    nextGoal = unread ? { kind: 'story', text: `В дневнике новая запись: «${unread.title}».` } : { kind: 'complete', text: 'Продолжайте путь вместе: меняйте подготовку под врагов и пробуйте сочетания отряда.' };
  }
  return { heroId, templateId: hero.templateId, name: t.name, identity: form.bio ?? t.bio, companion: !!hero.companion, level: hero.level, peakLevel, ...(hero.journey?.focus ? { focus: hero.journey.focus } : {}), focusOptions, milestones, nextGoal, ...(bond ? { bond } : {}) };
}
