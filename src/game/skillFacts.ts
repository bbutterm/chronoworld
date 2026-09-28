import type { SkillDef } from '../core';

/**
 * Цифры навыка для окна подробностей (skillDetail.ts): цель, урон/лечение/щит в % АТК, статусы, перезарядка, каст,
 * условие пассивки. Только данные навыка — без Phaser (проверяется тестом tests/skill-facts.test.ts).
 */
export interface SkillFactsOptions {
  /** Пассивный навык (есть trigger). */
  passive?: boolean;
  /** Обычная атака: без перезарядки и без «силы навыков». */
  basic?: boolean;
  /** «Сила навыков» редкости (множитель урона/лечения/щита, кроме обычной атаки). */
  power?: number;
  /** Перезарядка по умолчанию (combat.json skills.defaultCooldown). */
  defaultCooldown: number;
  /** Длина «хода» статуса в секундах (combat.json statusTurnSeconds). */
  turnSeconds: number;
  /** Имя навыка по id (для «если целей нет — …»). */
  nameOf?: (id: string) => string | undefined;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const signed = (x: number): string => `${x > 0 ? '+' : '−'}${pct(Math.abs(x))}`;

/** 1 удар, 2 удара, 5 ударов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const ENEMY_PICK: Record<string, [string, string]> = {
  nearest: ['ближайший враг', 'ближайших врагов'],
  lowestHp: ['враг с наименьшим ОЗ', 'врагов с наименьшим ОЗ'],
  lowestHpPct: ['враг с наименьшим % ОЗ', 'врагов с наименьшим % ОЗ'],
  random: ['случайный враг', 'случайных врагов'],
  all: ['все враги', 'все враги'],
  self: ['на себя', 'на себя'],
};
const ALLY_PICK: Record<string, [string, string]> = {
  nearest: ['ближайший союзник', 'ближайших союзников'],
  lowestHp: ['союзник с наименьшим ОЗ', 'союзников с наименьшим ОЗ'],
  lowestHpPct: ['союзник с наименьшим % ОЗ', 'союзников с наименьшим % ОЗ'],
  random: ['случайный союзник', 'случайных союзников'],
  all: ['все союзники', 'все союзники'],
  self: ['на себя', 'на себя'],
};
const TRIGGER: Record<string, string> = {
  battleStart: 'в начале боя',
  turnStart: 'в начале каждого хода',
  hit: 'когда по герою попадают',
  kill: 'при убийстве врага',
  allyDeath: 'при гибели союзника',
};
const STAT_RU: Record<string, string> = { atk: 'АТК', def: 'ЗАЩ', spd: 'СКР' };

/** Кому достаётся навык: «Цель: 2 ближайших врагов (тыл)». */
export function targetText(sk: SkillDef): string {
  const t = sk.target;
  const [one, many] = (t.side === 'enemy' ? ENEMY_PICK : ALLY_PICK)[t.pick] ?? [t.pick, t.pick];
  let s = t.count > 1 && t.pick !== 'all' && t.pick !== 'self' ? `${t.count} ${many}` : one;
  if (t.row === 'front') s += ' (фронт)';
  else if (t.row === 'back') s += ' (тыл)';
  if (t.side === 'ally' && t.includeSelf && t.pick !== 'self' && t.pick !== 'all') s += ', включая себя';
  if (t.onlyWounded) s += ', только раненые';
  return s;
}

/** Строки с цифрами навыка (без описания): по одной мысли в строке. */
export function skillFacts(sk: SkillDef, o: SkillFactsOptions): string[] {
  const out: string[] = [];
  const power = o.basic ? 1 : (o.power ?? 1);
  if (o.passive) {
    const when = sk.trigger ? TRIGGER[sk.trigger] ?? sk.trigger : 'всегда';
    out.push(`Срабатывает: ${when}${sk.chance < 1 ? ` · шанс ${pct(sk.chance)}` : ''}`);
  } else if (!o.basic) {
    const cd = sk.cooldown ?? o.defaultCooldown;
    out.push(cd > 0 ? `Перезарядка: ${cd} с` : 'Без перезарядки');
  }
  if (sk.castTime > 0) out.push(`Каст: ${sk.castTime} с (оглушение сбивает)`);
  out.push(`Цель: ${targetText(sk)}${o.passive ? '' : ` · ${sk.range === 'melee' ? 'ближний бой' : 'дальний бой'}`}`);
  const hits = sk.hits > 1 ? ` × ${sk.hits} ${plural(sk.hits, 'удар', 'удара', 'ударов')}` : '';
  for (const e of sk.effects) {
    switch (e.type) {
      case 'damage':
        out.push(`Урон: ${pct(e.k * power)} АТК${hits}`);
        break;
      case 'heal':
        out.push(`Лечение: ${pct(e.k * power)} АТК${hits}`);
        break;
      case 'shield':
        out.push(`Щит: ${pct(e.pctMaxHp * power)} макс. ОЗ цели`);
        break;
      case 'status': {
        const st = e.status;
        const parts: string[] = [];
        for (const [k, v] of Object.entries(st.stats ?? {})) if (v) parts.push(`${signed(v)} ${STAT_RU[k] ?? k}`);
        if (st.stun) parts.push('оглушение');
        if (st.dot) parts.push(`урон ${pct(st.dot.k)} АТК за ход`);
        const dur = `${st.turns} ${plural(st.turns, 'ход', 'хода', 'ходов')}`;
        const sec = o.turnSeconds > 0 ? ` (${Math.round(st.turns * o.turnSeconds * 10) / 10} с)` : '';
        out.push(`«${st.name}»: ${parts.join(', ') || 'эффект'} на ${dur}${sec}${e.chance < 1 ? ` · шанс ${pct(e.chance)}` : ''}`);
        break;
      }
      case 'energy':
        out.push(`Энергия цели: ${e.amount > 0 ? '+' : '−'}${Math.abs(e.amount)}`);
        break;
      case 'dash':
        out.push('Рывок к цели');
        break;
    }
  }
  if (sk.fallback) {
    const n = o.nameOf?.(sk.fallback);
    if (n) out.push(`Если целей нет — «${n}»`);
  }
  if (power !== 1) out.push(`Сила навыков ×${power} редкости уже учтена в цифрах`);
  return out;
}
