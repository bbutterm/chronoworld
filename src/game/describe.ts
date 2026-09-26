import type { Content, UnitDef } from '../core';

const ROLE: Record<string, string> = { tank: 'Танк', damage: 'Урон', healer: 'Лекарь', support: 'Поддержка' };

/** Описание юнита собирается из данных: статы + описания навыков. */
export function describeUnit(u: UnitDef, content: Content): string {
  const s = u.stats;
  const basic = content.skills[u.skills.basic];
  const ult = u.skills.ult ? content.skills[u.skills.ult] : undefined;
  const lines = [
    `${u.name} — ${ROLE[u.role] ?? u.role}, ${basic?.range === 'melee' ? 'ближний бой' : 'дальний бой'}`,
    `HP ${s.hp}   ATK ${s.atk}   DEF ${s.def}   SPD ${s.spd}`,
  ];
  if (ult) lines.push(`Ульта «${ult.name}»: ${ult.description ?? ''}`);
  for (const p of u.skills.passives) {
    const sk = content.skills[p];
    if (sk) lines.push(`Пассивка «${sk.name}»: ${sk.description ?? ''}`);
  }
  return lines.join('\n');
}
