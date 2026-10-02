import { describe, expect, it, vi } from 'vitest';

// battleFx.ts тянет Phaser (нужен window/canvas): для логики слоя цифр хватает заглушек объектов.
vi.mock('phaser', () => {
  class Obj {
    x = 0;
    y = 0;
    alpha = 1;
    scale = 1;
    visible = true;
    active = true;
    text = '';
    font = '';
    texture = { key: '' };
    displayWidth = 0;
    setPosition(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    }
    setX(x: number) {
      this.x = x;
      return this;
    }
    setScale(s: number) {
      this.scale = s;
      return this;
    }
    setAlpha(a: number) {
      this.alpha = a;
      return this;
    }
    setText(t: string) {
      this.text = t;
      return this;
    }
    setFont(f: string) {
      this.font = f;
      return this;
    }
    setTexture(k: string) {
      this.texture = { key: k };
      return this;
    }
    setVisible(v: boolean) {
      this.visible = v;
      return this;
    }
    setActive(v: boolean) {
      this.active = v;
      return this;
    }
    getTextBounds() {
      return { local: { width: this.text.length * 20 } };
    }
    setOrigin() {
      return this;
    }
    setTint() {
      return this;
    }
    clearTint() {
      return this;
    }
    setDepth() {
      return this;
    }
    setFlipX() {
      return this;
    }
    setBlendMode() {
      return this;
    }
    setDisplaySize(w: number) {
      this.displayWidth = w;
      this.scale = w / 100;
      return this;
    }
  }
  class BitmapText extends Obj {}
  class Text extends Obj {}
  class Image extends Obj {}
  return { default: { GameObjects: { BitmapText, Text, Image, Events: { DESTROY: 'destroy' } }, BlendModes: { ADD: 1, NORMAL: 0 } } };
});

// Растровый шрифт прежних цифр рисуется на canvas — в тесте вместо него готовый ключ.
vi.mock('../src/game/numberFont', async (orig) => ({
  ...(await orig<typeof import('../src/game/numberFont')>()),
  numberFont: () => ({ key: 'numfont_test', size: 40, stroke: 6 }),
}));

const Phaser = (await import('phaser')).default as unknown as { GameObjects: Record<string, new () => object> };
const fx = await import('../src/game/battleFx');
const { RO_HIT, RO_RISE } = fx;

function fakeScene() {
  const G = Phaser.GameObjects;
  return {
    add: {
      text: () => new G.Text(),
      bitmapText: () => new G.BitmapText(),
      image: () => new G.Image(),
    },
    children: { bringToTop: () => {} },
    textures: { exists: (k: string) => k !== 'missing' },
    cache: { bitmapFont: { exists: () => true } },
  } as never;
}

describe('цифры боя: вид по смыслу', () => {
  it('прежние параметры сцены (tint, движение, масштаб) → вид цифры', () => {
    expect(fx.numberKindOf(0xffffff, RO_HIT, 1.15)).toBe('hit');
    expect(fx.numberKindOf(0xff4a3a, RO_HIT, 1.15)).toBe('hurt');
    expect(fx.numberKindOf(0xffd23a, RO_HIT, 1.6)).toBe('crit');
    // Ульта врага по герою — крупная, но красная (золото — только у своих ульт).
    expect(fx.numberKindOf(0xffd23a, RO_HIT, 1.6, -1)).toBe('ouch');
    expect(fx.numberKindOf(0x8cc8ff, RO_HIT, 1.15)).toBe('absorb');
    expect(fx.numberKindOf(0xffffff, RO_HIT, 0.9)).toBe('dot');
    expect(fx.numberKindOf(0x5cff6a, RO_RISE, 1.15)).toBe('heal');
    expect(fx.numberKindOf(0x8cc8ff, RO_RISE, 0.9)).toBe('shield');
  });

  it('иерархия: крит крупнее обычного, обычный крупнее урона со временем; слабость — крупнее, стойкость — мельче', () => {
    const L = fx.NUMBER_LOOK;
    expect(L.crit.scale).toBeGreaterThan(L.heal.scale);
    expect(L.heal.scale).toBeGreaterThan(L.dot.scale);
    expect(L.hit.scale).toBeGreaterThan(L.dot.scale);
    expect(L.crit.pop).toBeGreaterThan(L.hit.pop);
    expect(fx.numberLook('hit', 'weak').scale).toBeGreaterThan(fx.numberLook('hit').scale);
    expect(fx.numberLook('hit', 'resist').scale).toBeLessThan(fx.numberLook('hit').scale);
    expect(fx.numberLook('hit', 'weak').tint).not.toBe(L.hit.tint);
    // Лечение и щит стихией не красятся.
    expect(fx.numberLook('heal', 'weak')).toEqual({ tint: L.heal.tint, scale: L.heal.scale });
  });
});

describe('цифры боя: слияние и лимит', () => {
  it('частые удары по одной цели складываются в одну цифру (MERGE_MS)', () => {
    const layer = new fx.FloatLayer(fakeScene());
    expect(layer.roNumber(500, 900, '10', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1')).toBe(true);
    layer.step(50);
    layer.roNumber(500, 900, '15', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1');
    layer.step(100);
    layer.roNumber(500, 900, '5', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1');
    expect(layer.liveNumbers).toBe(1);
    expect(layer.activeTexts).toBe(1);
    // Другой вид (лечение), другая стихия и другая цель — свои цифры.
    layer.roNumber(500, 900, '7', 0x5cff6a, 1.15, 5000, RO_RISE, 1, 'u1');
    layer.roNumber(500, 900, '8', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1', 'weak');
    layer.roNumber(500, 900, '9', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u2');
    expect(layer.liveNumbers).toBe(4);
    // Окно прошло — новая цифра.
    layer.step(fx.MERGE_MS + 10);
    layer.roNumber(500, 900, '3', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u2');
    expect(layer.liveNumbers).toBe(5);
  });

  it('сумма слитых ударов — в тексте цифры', () => {
    const scene = fakeScene();
    const layer = new fx.FloatLayer(scene);
    layer.roNumber(500, 900, '10', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1');
    layer.roNumber(500, 900, '32', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1');
    const texts: string[] = [];
    // Единственная живая цифра — последняя выданная пулом.
    (layer as unknown as { digits: { active: { text: string }[] } }).digits.active.forEach((t) => texts.push(t.text));
    expect(texts).toEqual(['42']);
  });

  it(`на экране не больше MAX_NUMBERS цифр: лишние гаснут, неважные (урон со временем) — первыми`, () => {
    const layer = new fx.FloatLayer(fakeScene());
    layer.roNumber(100, 900, '1', 0xffffff, 0.9, 5000, RO_HIT, 1, 'dot');
    for (let i = 0; i < fx.MAX_NUMBERS + 4; i++) layer.roNumber(100, 900, String(10 + i), 0xffffff, 1.15, 5000, RO_HIT, 1, `u${i}`);
    expect(layer.liveNumbers).toBe(fx.MAX_NUMBERS);
    // Вытесненные доживают EVICT_MS и уходят.
    layer.step(200);
    expect(layer.activeTexts).toBe(fx.MAX_NUMBERS);
    layer.step(5000);
    expect(layer.activeTexts).toBe(0);
  });

  it('объекты цифр переиспользуются: после разогрева пул не растёт', () => {
    const layer = new fx.FloatLayer(fakeScene());
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 6; i++) layer.roNumber(100, 900, String(i + 1), 0xffffff, 1.15, 5000, RO_HIT, 1, `u${i}`);
      layer.step(5000);
    }
    expect(layer.created).toBe(6);
  });
});

describe('значки статусов над юнитом', () => {
  it('один значок на юнита: тот же не повторяется, новый сменяет прежний', () => {
    const layer = new fx.FloatLayer(fakeScene());
    const a = layer.statusPop(300, 800, 'status_stun', 'u1');
    expect(a).not.toBeNull();
    expect(layer.statusPop(300, 800, 'status_stun', 'u1')).toBe(a);
    const b = layer.statusPop(300, 800, 'status_poison', 'u1');
    expect(b).not.toBe(a);
    layer.step(200);
    // Прежний погас, новый живёт.
    expect(a!.visible).toBe(false);
    expect(b!.visible).toBe(true);
    expect(layer.statusPop(300, 800, 'missing', 'u1')).toBeNull();
    layer.step(2000);
    expect(b!.visible).toBe(false);
  });
});
