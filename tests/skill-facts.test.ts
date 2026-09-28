import { describe, expect, it } from 'vitest';
import { plural, skillFacts, targetText } from '../src/game/skillFacts';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();
const opts = { defaultCooldown: 8, turnSeconds: 1, nameOf: (id: string) => ctx.content.skills[id]?.name };

describe('цифры навыка для окна подробностей', () => {
  it('русское множественное число', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, 'удар', 'удара', 'ударов'))).toEqual(['удар', 'удара', 'ударов', 'ударов', 'удар', 'удара', 'ударов']);
  });

  it('активный: перезарядка, цель, урон в % АТК с числом ударов', () => {
    const f = skillFacts(ctx.content.skills.archer_volley, opts);
    expect(f).toContain('Перезарядка: 8 с');
    expect(f.some((l) => l.startsWith('Цель: случайный враг') && l.endsWith('дальний бой'))).toBe(true);
    expect(f).toContain('Урон: 105% АТК × 3 удара');
  });

  it('«сила навыков» редкости умножает урон навыка, но не обычную атаку', () => {
    expect(skillFacts(ctx.content.skills.assassin_leap, { ...opts, power: 1.15 })).toContain('Урон: 207% АТК');
    const basic = skillFacts(ctx.content.skills.basic_melee, { ...opts, basic: true, power: 1.15 });
    expect(basic.some((l) => l.startsWith('Перезарядка'))).toBe(false);
    expect(basic.some((l) => l.includes('Сила навыков'))).toBe(false);
  });

  it('лечение с запасным навыком: цель — раненый союзник, «если целей нет»', () => {
    const f = skillFacts(ctx.content.skills.basic_heal, { ...opts, basic: true });
    expect(targetText(ctx.content.skills.basic_heal)).toContain('союзник с наименьшим % ОЗ');
    expect(f).toContain('Лечение: 100% АТК');
    expect(f.some((l) => l.startsWith('Если целей нет — «'))).toBe(true);
  });

  it('у каждого навыка героев — строки с цифрами, без «undefined»; у пассивки первая строка — условие', () => {
    for (const t of Object.values(ctx.content.heroes)) {
      for (const s of [...t.skills, ...t.branches.flatMap((b) => b.skills)]) {
        const sk = ctx.content.skills[s.skill];
        const f = skillFacts(sk, { ...opts, passive: !!sk.trigger });
        expect(f.length, s.skill).toBeGreaterThan(1);
        expect(f.join('\n'), s.skill).not.toMatch(/undefined|NaN/);
        if (sk.trigger) expect(f[0], s.skill).toMatch(/^Срабатывает: /);
      }
    }
  });
});
