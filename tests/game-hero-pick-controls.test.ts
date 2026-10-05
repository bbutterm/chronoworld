import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const node = () => {
    const o: any = { add: () => o, setName: () => o, setDisplaySize: () => o, setTint: () => o, setAlpha: () => o, setBlendMode: () => o, setVisible: () => o, setPosition: () => o, setScale: () => o };
    return o;
  };
  return { node, pickers: [] as any[], cards: [] as (() => void)[], claim: vi.fn(), commit: vi.fn(), save: { pendingPicks: [], heroes: [] } };
});
vi.mock('phaser', () => ({ default: { Scene: class {}, BlendModes: { ADD: 1 } } }));
vi.mock('../src/core', () => ({ BRANCH_RARITY: 'purple', rarityIndex: (r: string) => ['green','blue','purple','gold','red'].indexOf(r), claimHeroPick: h.claim, pickOptions: () => ['alan','vika'] }));
vi.mock('../src/game/content', () => ({ GAME: { content: { heroes: { alan: { name: 'Алан', gender: 'm' }, vika: { name: 'Вика', gender: 'f' } } } } }));
vi.mock('../src/game/session', () => ({ session: { save: h.save }, commit: h.commit }));
vi.mock('../src/game/branchPicker', () => ({ openBranchPicker: (_s: unknown, opts: any) => { h.pickers.push(opts); } }));
vi.mock('../src/game/audio', () => ({ sfx: vi.fn() }));
vi.mock('../src/game/flow', () => ({ ROLE_NAMES: {} }));
vi.mock('../src/game/heroCard', () => ({ rarityName: () => 'Фиолетовый', heroCardSize: () => ({ h: 240 }), glowTexture: () => 'glow', drawHeroCard: (_s: unknown, _x: number, _y: number, _id: string, opts: any) => { h.cards.push(opts.onTap); return h.node(); } }));
vi.mock('../src/game/juice', () => ({ juiceOn: () => false, staggerIn: vi.fn() }));
vi.mock('../src/game/screen', () => ({ CONTENT_TOP: 160, contentBottom: () => 1736 }));
vi.mock('../src/game/ui', () => ({
  plate: () => h.node(), text: () => h.node(), toast: vi.fn(),
  ScrollArea: class {
    content = h.node();
    add<T>(o: T) { return o; }
    setContentHeight() {}
    tap(onTap: () => void) { return onTap; }
  },
}));
import { HeroPickScene } from '../src/game/scenes/HeroPickScene';

beforeEach(() => {
  vi.clearAllMocks(); h.pickers.length = 0; h.cards.length = 0;
  h.claim.mockReturnValue({ save: h.save, heroId: 'h_new' });
});
function scene() {
  const s = new HeroPickScene();
  Object.assign(s, { add: { image: h.node }, children: { bringToTop: vi.fn() } });
  s['reveal'] = vi.fn();
  return s;
}

describe('безопасное получение контракта героя', () => {
  it('повторные касания карточки только выделяют героя; награда выдаётся явной кнопкой', () => {
    const s = scene(); const go: any = { setEnabled: vi.fn(), setLabel: vi.fn() };
    const choose = vi.spyOn(s as any, 'choose');
    s['grid']({ rarity: 'blue', source: 'qa' }, go);
    h.cards[0](); h.cards[0]();
    expect(choose).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
    expect(go.setLabel).toHaveBeenLastCalledWith('Забрать: Алан');
    h.cards[1](); expect(go.setLabel).toHaveBeenLastCalledWith('Забрать: Вика');
  });
  it('прямое получение происходит один раз даже при двух быстрых подтверждениях', () => {
    const s = scene(); const pick = { rarity: 'blue' as const, source: 'qa' };
    s['choose'](pick, 0, 'alan'); s['choose'](pick, 0, 'alan');
    expect(h.claim).toHaveBeenCalledOnce(); expect(h.commit).toHaveBeenCalledOnce();
    expect(s['reveal']).toHaveBeenCalledOnce();
  });
  it('две попытки открыть выбор дают одно окно; отмена разрешает вернуться без выдачи', () => {
    const s = scene(); const pick = { rarity: 'purple' as const, source: 'qa' };
    s['choose'](pick, 0, 'alan'); s['choose'](pick, 0, 'alan');
    expect(h.pickers).toHaveLength(1); expect(h.claim).not.toHaveBeenCalled();
    h.pickers[0].onCancel(); s['choose'](pick, 0, 'alan');
    expect(h.pickers).toHaveLength(2);
    h.pickers[1].onConfirm('knight'); h.pickers[1].onConfirm('knight');
    expect(h.claim).toHaveBeenCalledOnce(); expect(h.commit).toHaveBeenCalledOnce();
  });
});
