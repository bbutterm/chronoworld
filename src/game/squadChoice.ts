/** Two honest, reversible roster options. No combat bonuses or invented win predictions. */
import { arrangeSquad, autoFormation, buildUnit, heroName, heroPower, heroRole, squadPower, type HeroState, type SaveState } from '../core';
import type { FeatureContext } from '../core/features/config';
import type { EquipmentConfig } from '../core/equipment/load';

type ChoiceContext = FeatureContext & { equipment?: EquipmentConfig };

export interface SquadOption {
  id: 'healing' | 'fighters';
  title: string;
  detail: string;
  heroId: string;
  heroName: string;
  squad: (string | null)[];
  power: number;
}

/** Include basic attacks, unlocked skills, ults and fallbacks; a support can heal too (Тео). */
export function canHealAllies(hero: HeroState, ctx: ChoiceContext): boolean {
  const skills = buildUnit(hero, ctx).skills;
  const pending = [skills.basic, skills.ult, ...skills.actives, ...skills.passives].filter((id): id is string => !!id);
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const skill = ctx.content.skills[id];
    if (!skill) continue;
    if (skill.target.side === 'ally' && skill.target.pick !== 'self' && skill.effects.some((e) => e.type === 'heal')) return true;
    if (skill.fallback) pending.push(skill.fallback);
  }
  return false;
}

/**
 * Only offer a real, full-size alternative after summoning. The same four fighters stay in both
 * options; the fifth slot is a healer or a fighter. Keep a tank when another fighter can be swapped.
 * A copy with a different branch still occupies the same card's one allowed squad slot.
 */
export function squadChoices(save: SaveState, ctx: ChoiceContext): SquadOption[] {
  if (!save.summon.firstTenDone || save.campaign.cleared.includes('ch1_s10')) return [];
  const healingIds = new Set(save.heroes.filter((h) => canHealAllies(h, ctx)).map((h) => h.id));
  const healers = save.heroes.filter((h) => healingIds.has(h.id))
    .sort((a, b) => heroPower(b, ctx, save) - heroPower(a, ctx, save) || a.id.localeCompare(b.id));
  const healer = healers[0];
  if (!healer) return [];
  const fighters = autoFormation({ ...save, heroes: save.heroes.filter((h) => !healingIds.has(h.id)) }, ctx);
  if (fighters.filter(Boolean).length !== 5) return [];
  const members = fighters.map((id) => save.heroes.find((h) => h.id === id)!);
  const sameCard = members.find((h) => h.templateId === healer.templateId);
  const replaceable = members.filter((h) => heroRole(h, ctx) !== 'tank');
  const fighter = sameCard ?? [...(replaceable.length ? replaceable : members)]
    .sort((a, b) => heroPower(a, ctx, save) - heroPower(b, ctx, save) || a.id.localeCompare(b.id))[0];
  const healing = arrangeSquad({ ...save, squad: fighters.map((id) => id === fighter.id ? healer.id : id) }, ctx);
  return [
    { id: 'healing', title: 'С лечением', detail: 'Этот герой лечит союзников', heroId: healer.id, heroName: heroName(healer, ctx), squad: healing, power: squadPower({ ...save, squad: healing }, ctx) },
    { id: 'fighters', title: 'Больше бойцов', detail: 'В отряде нет лечения союзников', heroId: fighter.id, heroName: heroName(fighter, ctx), squad: fighters, power: squadPower({ ...save, squad: fighters }, ctx) },
  ];
}
