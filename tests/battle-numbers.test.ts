import { describe, expect, it, vi } from 'vitest';

// battleFx.ts тянет Phaser (нужен window/canvas): для логики слоя цифр хватает заглушек объектов.
vi.mock('phaser', () => {
  class Obj {
    x = 0;
    y = 0;
    alpha = 1;
    scale = 1;
    scaleY = 1;
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
    setScale(s: number, sy = s) {
      this.scale = s;
      this.scaleY = sy;
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
    setRotation() { return this; }
    setFrame() { return this; }
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

type LiveNumber = { kind: number; t: number; dur: number; die: number; nw: number; nh: number; obj: { x: number; y: number; text: string; visible: boolean; scale: number }; };
const numbers = (layer: InstanceType<typeof fx.FloatLayer>) => (layer as unknown as { live: LiveNumber[] }).live.filter((r) => r.kind === 0 && r.die < 0);
const overlap = (a: LiveNumber, b: LiveNumber) => Math.abs(a.obj.x - b.obj.x) < (a.nw + b.nw) / 2 && Math.abs(a.obj.y - b.obj.y) < (a.nh + b.nh) / 2;

describe('цифры боя: место занято весь видимый срок', () => {
  it('после прежних 420 мс новая цифра не занимает место ещё видимой, даже у соседней цели', () => {
    const layer = new fx.FloatLayer(fakeScene());
    layer.roNumber(500, 900, '80', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1');
    layer.step(440);
    const old = numbers(layer)[0];
    layer.roNumber(old.obj.x, old.obj.y, '32', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u2');
    const live = numbers(layer);
    expect(live).toHaveLength(2);
    expect(live[0].t).toBe(440);
    expect(overlap(live[0], live[1])).toBe(false);
    expect(live[1].obj.y).toBeLessThan(live[0].obj.y);
    // Длительность самой цифры не меняется: место освобождается при её завершении.
    layer.step(660);
    expect(numbers(layer)).toHaveLength(1);
    layer.step(440);
    expect(numbers(layer)).toHaveLength(0);
    layer.roNumber(500, 900, '9', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1');
    expect(numbers(layer)[0].obj.y).toBe(900);
  });

  it('одновременные урон, лечение и крит разводятся с учётом пика масштаба', () => {
    const layer = new fx.FloatLayer(fakeScene());
    layer.roNumber(500, 900, '123', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1');
    layer.roNumber(500, 900, '80', 0x5cff6a, 1.15, 5000, RO_RISE, 1, 'u1');
    layer.roNumber(500, 900, '1234', 0xffd23a, 1.6, 5000, RO_HIT, 1, 'u2');
    const live = numbers(layer);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) expect(overlap(live[i], live[j])).toBe(false);
    layer.step(0); // Пауза не освобождает место и не меняет таймер.
    expect(numbers(layer).map((r) => r.t)).toEqual([0, 0, 0]);
  });

  it('увеличение суммы при слиянии не обрезает пик цифры на краю экрана', () => {
    const layer = new fx.FloatLayer(fakeScene());
    layer.roNumber(5, 900, '9', 0xffd23a, 1.6, 5000, RO_HIT, -1, 'u1');
    layer.roNumber(5, 900, '991', 0xffd23a, 1.6, 5000, RO_HIT, -1, 'u1');
    const [n] = numbers(layer);
    expect(n.obj.text).toBe('1000');
    expect(n.obj.x - n.nw / 2).toBeGreaterThanOrEqual(8);
    expect(n.obj.x - n.obj.text.length * 20 * n.obj.scale / 2).toBeGreaterThanOrEqual(8);
  });

  it('запасной шрифт тоже занимает место; отмена очищает размещение и пулы переиспользуются', () => {
    const layer = new fx.FloatLayer(fakeScene());
    layer.number(500, 900, '42', 40, '#ffffff', '#000000', 6, 5000, 36, 450, false, 'u1');
    layer.roNumber(500, 900, '80', 0x5cff6a, 1.15, 5000, RO_RISE, 1, 'u2');
    const live = numbers(layer);
    expect(overlap(live[0], live[1])).toBe(false);
    const created = layer.created;
    layer.cancel();
    expect(layer.activeTexts).toBe(0);
    layer.roNumber(500, 900, '10', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u1');
    expect(numbers(layer)[0].obj.y).toBe(900);
    expect(layer.created).toBe(created);
  });
});

describe('белое ядро обычного попадания', () => {
  it('короткое и компактное, при этом цветной рисунок оружия остаётся', async () => {
    const { SkillFx, FX_TEX } = await import('../src/game/skillFx');
    const stub = { glow: vi.fn(), slash: vi.fn(), burst: vi.fn() };
    SkillFx.prototype.strike.call(stub as never, 'slash', { x: 400, y: 850, feet: 1000 }, 1, false, 0xffc0a0);
    const spark = stub.glow.mock.calls.find((args) => args[8] === FX_TEX.spark)!;
    expect(spark).toBeDefined();
    expect(spark[4]).toBeLessThanOrEqual(1.6);
    expect(spark[5]).toBeLessThanOrEqual(100);
    expect(spark[7]).toBeLessThanOrEqual(0.55);
    expect(stub.slash).toHaveBeenCalledOnce();
    expect(stub.burst).toHaveBeenCalledOnce();
  });
});

describe('цифры боя: траектории и границы', () => {
  it('поздний удар не пересекает поднимающееся лечение спустя 700 мс', () => {
    const layer = new fx.FloatLayer(fakeScene());
    layer.roNumber(500, 900, '1000', 0x5cff6a, 1.15, 5000, RO_RISE, 1, 'u1');
    layer.step(400);
    layer.roNumber(500, 900, '1000', 0xffffff, 1.15, 5000, RO_HIT, 1, 'u2');
    for (let i = 0; i < 7; i++) {
      layer.step(100);
      const live = numbers(layer);
      expect(overlap(live[0], live[1])).toBe(false);
    }
  });

  it('плотные криты остаются ниже HUD и внутри экрана на всей траектории', () => {
    const layer = new fx.FloatLayer(fakeScene());
    for (let i = 0; i < 8; i++) layer.roNumber(1040, 520, '9999', 0xffd23a, 1.6, 5000, RO_HIT, 1, `u${i}`);
    for (let i = 0; i < 10; i++) {
      layer.step(100);
      for (const n of numbers(layer)) {
        expect(n.obj.y - n.nh / 2).toBeGreaterThanOrEqual(382);
        expect(n.obj.x - n.nw / 2).toBeGreaterThanOrEqual(8);
        expect(n.obj.x + n.nw / 2).toBeLessThanOrEqual(1072);
      }
    }
  });
});

describe('лечение: столб не выбеливает героя', () => {
  it.each([false, true])('атлас на союзнике приглушён, полный срок 17 кадров сохранён (ульта=%s)', (ult) => {
    const layer = new fx.FloatLayer(fakeScene());
    layer.ult = ult;
    layer.flash(500, 900, 'fx_heal', 182, 0.8, 250, fx.DEPTH.fx, 1100, undefined, undefined, true);
    const live = (layer as unknown as { live: { dur: number; obj: { alpha: number; displayWidth: number; visible: boolean } }[] }).live;
    const effect = live[0];
    expect(effect.obj.alpha).toBeCloseTo(0.8 * 0.45 * (ult ? 0.8 : fx.ALLY_FX_ALPHA));
    expect(effect.obj.displayWidth).toBeCloseTo(182 * 0.8 / (ult ? 1 : fx.SKILL_FX_SIZE));
    expect(effect.dur).toBeCloseTo(17 * 83.33);
    layer.step(effect.dur - 1);
    expect(effect.obj.visible).toBe(true);
    layer.step(1);
    expect(effect.obj.visible).toBe(false);
  });

  it.each([[false, false, 1], [true, false, 1.15], [false, true, 0.6]] as const)('процедурные ядра тонкие, кольцо и 760-мс анимация сохранены (big=%s, small=%s)', async (big, small, k) => {
    const { SkillFx, FX_TEX } = await import('../src/game/skillFx');
    const images: { tex: string; tint: number; node: any }[] = [];
    const runs: { obj: any; dur: number; fn: (q: number, obj: any) => void }[] = [];
    const stub = {
      img: (tex: string, _x: number, _y: number, tint: number) => {
        const node = new Phaser.GameObjects.Image(); images.push({ tex, tint, node }); return node;
      },
      glow: vi.fn(), rise: vi.fn(), n: () => 0,
      crosses: { setParticleTint: vi.fn(), emitParticleAt: vi.fn() },
      run: (obj: any, dur: number, fn: (q: number, obj: any) => void) => runs.push({ obj, dur, fn }),
    };
    SkillFx.prototype.heal.call(stub as never, { x: 400, y: 850, feet: 1000 }, big, small);
    const columns = images.filter((i) => i.tex === FX_TEX.beam);
    expect(columns).toHaveLength(2);
    for (const col of columns) {
      const r = runs.find((r) => r.obj === col.node)!;
      expect(r.dur).toBe(760);
      const white = col.tint === 0xffffff;
      expect(col.node.scaleY * 32).toBeCloseTo((white ? 24 : 100) * k);
      expect(col.node.alpha).toBeCloseTo(white ? 0.22 : 0.35);
      r.fn(0.3, col.node);
      expect(col.node.alpha).toBeCloseTo(white ? 0.22 : 0.35);
      r.fn(1, col.node);
      expect(col.node.alpha).toBeCloseTo(0);
    }
    expect(stub.glow.mock.calls.some((a) => a[8] === FX_TEX.ring && a[5] === 620)).toBe(true);
    expect(stub.rise).toHaveBeenCalledTimes(2);
  });
});
