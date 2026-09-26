import { describe, expect, it } from 'vitest';
import { newGame, SaveStateSchema } from '../src/core';
import { loadGameContext } from '../scripts/lib/content-node';

const ctx = loadGameContext();

describe('сохранение', () => {
  it('newGame валиден и детерминирован', () => {
    const s = newGame(ctx, 123);
    expect(SaveStateSchema.parse(s)).toEqual(s);
    expect(newGame(ctx, 123)).toEqual(s);
    expect(s.heroes).toHaveLength(ctx.progression.heroes.count);
  });
  // T-C:
  it.todo('serialize → deserialize — то же состояние');
  it.todo('битый JSON и чужая структура → SaveError с понятным текстом');
  it.todo('версия новее SAVE_VERSION → SaveError');
  it.todo('миграция: сохранение версии 0 (фикстура) поднимается до текущей');
});
