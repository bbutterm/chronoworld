import type { Effect, HeroDef } from '../core';

const ROLE: Record<string, string> = { tank: 'Танк', damage: 'Урон', healer: 'Лекарь', support: 'Поддержка' };
const ATTACK: Record<string, string> = { melee: 'ближний бой', ranged: 'дальний бой', healer: 'лечение' };

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Описание ульты собирается из конфига, чтобы числа жили в одном месте. */
export function describeEffect(e: Effect): string {
  switch (e.type) {
    case 'damage': {
      const where: Record<string, string> = {
        enemyFrontRow: 'по всему фронту врага',
        enemyLowestHp: 'по врагу с наименьшим HP',
        enemyRandom: 'по случайным врагам',
        enemyAll: 'по всем врагам',
      };
      const hits = e.hits && e.hits > 1 ? `${e.hits} удара ` : 'Урон ';
      return `${hits}${where[e.target] ?? e.target} ×${e.k}`;
    }
    case 'heal':
      return `Лечит всех союзников на ${e.k} ATK`;
    case 'shield':
      return `Щит себе и соседу на ${pct(e.pctMaxHp)} их HP`;
  }
}

export function describeHero(h: HeroDef): string {
  const s = h.stats;
  return [
    `${h.name} — ${ROLE[h.role] ?? h.role}, ${ATTACK[h.attack]}, ${h.position === 'front' ? 'фронт' : 'тыл'}`,
    `HP ${s.hp}   ATK ${s.atk}   DEF ${s.def}   SPD ${s.spd}`,
    `Ульта «${h.ult.name}»: ${h.ult.effects.map(describeEffect).join('; ')}`,
  ].join('\n');
}
