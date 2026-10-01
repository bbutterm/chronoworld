// Сценарий промо (35 с). Каждая сцена — окно [a, b) общего таймлайна; координаты оверлеев — % кадра 1080×1920.
import { Count, Glow, Letters, Line, Logo, Plaque, Rays, Scene, Shade, Shot, Slam, Tap, cardUrl, playUrl, TgIcon } from './components.jsx';
import { clamp, easeOut, lerp, prog, sp, useTL } from './timeline.js';

/** Надпись-заголовок по буквам + подзаголовок. */
function Title({ top = 6.5, at, out, text, sub, size = 9.2, subSize = 4.6, cls = 'gold', step }) {
  return (
    <>
      <div className="line tcap" style={{ top: `${top}%`, fontSize: `${size}cqw` }}>
        <Letters text={text} at={at} out={out} cls={cls} step={step} />
      </div>
      {sub && (
        <Line top={top + size * 0.62 + 1.2} size={subSize} at={at + 0.35} out={out} className="white tcap">
          {sub}
        </Line>
      )}
    </>
  );
}

function Hook({ a, b }) {
  return (
    <Scene a={a} b={b} fade={0}>
      <Shot name="battle_intro" a={a} b={b} from={[1.25, 0, 2]} to={[1.1, 0, 0]} blur={5} dim={0.45} fy={0.6} />
      <Rays at={a + 0.85} out={b} y={36} size={150} />
      <Logo at={a + 0.25} top={30} out={b} />
      <Line top={44} size={6.4} at={a + 1.15} out={b} className="white">
        <Letters text="Мир Ragnarok оживает" at={a + 1.15} step={0.025} cls="white" out={b} />
      </Line>
      <Line top={52} size={5} at={a + 1.85} out={b} className="pill">
        idle-RPG прямо в Telegram
      </Line>
    </Scene>
  );
}

function UltAsura({ a, b }) {
  // Касание портрета Вики → ульта → удар (a + 0.75) крупно.
  const hit = a + 0.75;
  return (
    <Scene a={a} b={b} fade={0}>
      <Shot name="battle_ult_asura" a={a} b={b} fx={0.5} fy={0.6} from={[1.0, 0, 0]} to={[1.24, 0, -4]} ease={(k) => easeOut(clamp(k * 1.25))}>
        <Tap x={13} y={31} at={a + 0.4} size={18} />
        <Glow x={1} y={38.5} w={46} h={6} at={a + 0.55} out={b - 0.6} round={1} />
      </Shot>
      <Shade top={0.3} />
      <Title at={a + 0.05} out={b} text="Ульта по касанию" sub="ты решаешь, когда бить" />
      <Slam text="КРИТ!" at={hit} out={hit + 1.1} top={46} size={15} cls="gold" rot={7} />
      <Plaque at={hit + 0.25} out={b} top={78} who="Вика · Монахиня" what="Удар Асуры" />
    </Scene>
  );
}

function UltArea({ a, b, cut }) {
  // Площадная ульта (Владыка Вермилиона) → босс заряжает удар → «Сбито!».
  return (
    <Scene a={a} b={b} fade={0}>
      <Shot name="battle_ult_lord_of_vermillion" a={a} b={cut} fx={0.45} fy={0.62} from={[1.3, 0, -4]} to={[1.0, 0, 0]} ease={easeOut}>
        <Tap x={49} y={31} at={a + 0.15} size={18} />
      </Shot>
      <Shade top={0.3} />
      <Title at={a + 0.05} out={cut} text="Ульта по площади" sub="молнии по всем врагам" />
      <Plaque at={a + 0.5} out={cut} top={78} who="Кай · Волшебник" what="Владыка Вермилиона" side={1} />
      <Scene a={cut} b={b} fade={0}>
        <Shot name="battle_break" a={cut} b={b} fx={0.55} fy={0.66} from={[1.5, -2, -8]} to={[1.3, 0, -6]} />
        <Shade top={0.3} />
        <Title at={cut - 0.12} out={b} text="Сбей заряд босса!" cls="red" size={8.6} step={0.018} />
        <Slam text="СБИТО!" at={cut + 0.05} out={b} top={36} size={21} />
      </Scene>
    </Scene>
  );
}

function Campaign({ a, b }) {
  return (
    <Scene a={a} b={b}>
      <Shot name="home" a={a} b={b} fy={0.4} from={[1.18, 0, 6]} to={[1.02, 0, 0]}>
        <Glow x={2} y={72} w={96} h={13} at={a + 1.5} out={b} round={2} />
        <Tap x={93} y={78.5} at={a + 1.9} size={16} />
      </Shot>
      <Shade top={0.28} />
      <Title at={a + 0.1} out={b} text="10 глав мира RO" sub="Пронтера → Моррок → Нифльхейм" />
      <Line top={88.5} size={4.6} at={a + 1.6} out={b} className="pill">
        Герои бьются и без тебя — сундук ждёт
      </Line>
    </Scene>
  );
}

function Hero({ a, b, mid }) {
  return (
    <Scene a={a} b={b}>
      <Shot name="hero_vika" a={a} b={mid} fy={0.25} from={[1.0, 0, 6]} to={[1.22, 0, 8]}>
        <Glow x={66} y={22.6} w={34} h={4.2} at={a + 0.4} out={mid} round={1.4} />
        <Tap x={63} y={25} at={a + 0.75} size={14} />
      </Shot>
      <Scene a={mid} b={b} fade={0.25}>
        <Shot name="branch_vika" a={mid} b={b} fy={0.5} from={[1.08, 0, 2]} to={[1.0, 0, 0]}>
          <Glow x={10} y={60} w={30} h={17} at={mid + 0.35} out={b} round={2} />
          <Glow x={60} y={60} w={30} h={17} at={mid + 0.6} out={b} round={2} />
        </Shot>
      </Scene>
      <Shade top={0.0} bottom={0.12} />
      <Line top={90} size={5.2} at={a + 0.3} out={mid} className="pill">
        Редкость, ветка, навыки
      </Line>
    </Scene>
  );
}

function Roster({ a, b }) {
  return (
    <Scene a={a} b={b}>
      <Shot name="branch_all_heroes" a={a} b={b} fy={0.55} from={[1.22, 0, 0]} to={[1.0, 0, 0]} ease={(k) => easeOut(k)} />
      <Shade top={0} bottom={0.2} />
      <div className="chips" style={{ top: '78%' }}>
        <Chip at={a + 0.5}>
          <b>
            <Count at={a + 0.5} to={12} />
          </b>{' '}
          героев
        </Chip>
        <Chip at={a + 0.7}>
          <b>
            <Count at={a + 0.7} to={24} />
          </b>{' '}
          ветки
        </Chip>
      </div>
      <Line top={86.5} size={4.4} at={a + 1.1} out={b} className="white">
        6 классов · парень и девушка
      </Line>
    </Scene>
  );
}

function Chip({ at, children }) {
  const ref = useTL((t) => {
    const v = sp(t - at, 340, 15);
    return { opacity: String(clamp(v * 2)), transform: `scale(${lerp(0.2, 1, v)})` };
  });
  return (
    <div ref={ref} className="chip">
      {children}
    </div>
  );
}

function Tavern({ a, b }) {
  const burst = a + 1.1;
  const flare = useTL((t) => {
    const d = t - burst;
    const o = d < 0 ? 0 : Math.max(0, 1 - d / 0.9);
    return { opacity: String(o), transform: `translate(-50%, -50%) scale(${0.3 + easeOut(clamp(d / 0.6)) * 1.6})` };
  });
  return (
    <Scene a={a} b={b}>
      <Shot name="tavern_summon" a={a} b={b} fy={0.5} from={[1.18, 0, 2]} to={[1.05, 0, -2]}>
        <Tap x={74} y={84} at={a + 0.75} size={22} />
        <div ref={flare} className="flare" style={{ left: '50%', top: '50%' }} />
      </Shot>
      <Rays at={burst} out={b} y={47} size={110} color="190,140,255" />
      <Shade top={0.0} bottom={0} />
      <Line top={4.5} size={6.4} at={a + 0.15} out={b} className="pill big tcap">
        Призыв в Таверне
      </Line>
      <Line top={13} size={4.4} at={a + 0.5} out={b} className="pill tcap">
        3 одинаковые карты → редкость выше
      </Line>
    </Scene>
  );
}

const MVPS = [
  ['mvp_dracula', 'Дракула'],
  ['mvp_pharaoh', 'Фараон'],
  ['mvp_baphomet', 'Бафомет'],
];

function Bosses({ a, b }) {
  const step = (b - a) / 3;
  return (
    <Scene a={a} b={b} fade={0}>
      {MVPS.map(([img], i) => (
        <Scene key={img} a={a + i * step} b={a + (i + 1) * step} fade={0}>
          <Shot name={img} a={a + i * step} b={a + (i + 1) * step} fy={0.45} from={[1.35, 0, 3]} to={[1.12, 0, 0]} ease={easeOut} />
        </Scene>
      ))}
      <Shade top={0.3} bottom={0.16} />
      <Title at={a + 0.05} out={b} text="Боссы глав и MVP" cls="red" size={8.6} />
      <div className="chips" style={{ top: '88%' }}>
        {MVPS.map(([img, name], i) => (
          <BossChip key={img} show={a + 0.2 + i * 0.08} at={a + i * step} until={a + (i + 1) * step} out={b} name={name} />
        ))}
      </div>
    </Scene>
  );
}

function BossChip({ show, at, until, out, name }) {
  const ref = useTL((t) => {
    const v = sp(t - show, 400, 16);
    const on = t >= at && t < until;
    return {
      opacity: String(clamp(v * 2) * (1 - prog(t, out - 0.15, out))),
      transform: `scale(${lerp(0.2, on ? 1.12 : 0.92, v)})`,
      filter: on ? 'none' : 'saturate(.3) brightness(.7)',
    };
  });
  return (
    <div ref={ref} className="chip boss">
      {name}
    </div>
  );
}

function McCard({ a, b }) {
  const fly = a + 0.65;
  const card = useTL((t) => {
    const v = sp(t - fly, 170, 15);
    const x = lerp(42, 0, v);
    const y = lerp(17, 0, v);
    const s = lerp(0.18, 1, v);
    const ry = lerp(540, 0, easeOut(clamp((t - fly) / 0.9)));
    const o = t < fly ? 0 : clamp((t - fly) * 8) * (1 - prog(t, b + 0.1, b + 0.3));
    return { opacity: String(o), transform: `translate(calc(-50% + ${x}cqw), calc(-50% + ${y}cqh)) scale(${s}) rotateY(${ry}deg)` };
  });
  return (
    <Scene a={a} b={b}>
      <Shot name="hunt_screen" a={a} b={b} fy={0.6} from={[1.02, 0, 0]} to={[1.1, 0, -2]} dim={0} />
      <DimAfter at={fly} out={b} />
      <Rays at={fly + 0.2} out={b} y={47} size={160} />
      <div ref={card} className="rocard" style={{ left: '50%', top: '47%' }}>
        <img src={cardUrl('card_dracula')} alt="Карта Дракулы" />
      </div>
      <Shade top={0.0} />
      <Line top={5} size={6.2} at={a + 0.1} out={b} className="pill big tcap">
        Карта MVP — в снаряжение
      </Line>
      <Line top={76} size={5.4} at={fly + 0.5} out={b} className="gold-t">
        Карта Дракулы
      </Line>
      <Line top={82.5} size={4.3} at={fly + 0.7} out={b} className="white">
        Плащ ночи: +12% атаки и здоровья
      </Line>
    </Scene>
  );
}

function DimAfter({ at, out }) {
  const ref = useTL((t) => ({ opacity: String(clamp((t - at) * 3) * 0.72 * (1 - prog(t, out, out + 0.3))) }));
  return <div ref={ref} className="fill dim" />;
}

function Story({ a, b, mid }) {
  return (
    <Scene a={a} b={b}>
      <Shot name="tavern_evening_1" a={a} b={mid} fy={0.6} from={[1.05, 0, 0]} to={[1.16, 0, -3]} />
      <Scene a={mid} b={b} fade={0.3}>
        <Shot name="tavern_evening_3" a={mid} b={b} fy={0.6} from={[1.16, 0, -3]} to={[1.06, 0, 0]} />
      </Scene>
      <Shade top={0.26} />
      <Title at={a + 0.1} out={b} text="Вечера в таверне" sub="у каждого героя — своя история" size={8.6} />
    </Scene>
  );
}

const TOWER_CARDS = ['card_osiris', 'card_orc_lord', 'card_baphomet', 'card_pharaoh', 'card_eddga'];

function Tower({ a, b }) {
  return (
    <Scene a={a} b={b}>
      <Shot name="tower_cards" a={a} b={b} fy={0.4} from={[1.12, 0, 4]} to={[1.02, 0, 0]} dim={0.15} />
      <Shade top={0.32} bottom={0.45} />
      <Title at={a + 0.1} out={b} text="Башня-рогалик" sub="карты RO меняют правила забега" size={9} />
      <div className="fan" style={{ top: '80%' }}>
        {TOWER_CARDS.map((c, i) => (
          <FanCard key={c} i={i} n={TOWER_CARDS.length} at={a + 0.45 + i * 0.09} out={b} name={c} />
        ))}
      </div>
    </Scene>
  );
}

function FanCard({ i, n, at, out, name }) {
  const mid = (n - 1) / 2;
  const ref = useTL((t) => {
    const v = sp(t - at, 230, 14);
    const ang = (i - mid) * 13 * v;
    const y = lerp(60, Math.abs(i - mid) * 1.6, v);
    const o = clamp(v * 3) * (1 - prog(t, out - 0.15, out));
    const bob = Math.sin((t - at) * 3 + i) * 0.4 * clamp(v);
    return { opacity: String(o), transform: `translate(-50%, ${y + bob}cqw) rotate(${ang}deg)` };
  });
  return (
    <div ref={ref} className="fancard">
      <img src={cardUrl(name)} alt="" />
    </div>
  );
}

function Final({ a, b }) {
  const btn = useTL((t) => {
    const v = sp(t - a - 1.2, 300, 13);
    const press = t > a + 1.9 && t < a + 2.15 ? 0.94 : 1;
    const pulse = 1 + Math.sin((t - a) * 6) * 0.025 * clamp((t - a - 2.2) * 2);
    return { opacity: String(clamp(v * 2)), transform: `translateX(-50%) scale(${v * press * pulse})` };
  });
  const fade = useTL((t) => ({ opacity: String(prog(t, b - 0.55, b - 0.05)) }));
  return (
    <Scene a={a} b={b} fade={0.2}>
      <Shot name="branch_all_heroes" a={a} b={b} fy={0.5} from={[1.15, 0, 0]} to={[1.3, 0, 0]} blur={7} dim={0.6} />
      <Rays at={a + 0.1} out={b + 1} y={38} size={170} />
      <Logo at={a + 0.05} top={27} size={11.5} />
      <Line top={41} size={7.6} at={a + 0.6} className="white">
        Играй в Telegram
      </Line>
      <Line top={50} size={4.4} at={a + 0.85} className="sub">
        12 героев · 24 ветки · 10 глав · Башня · MVP
      </Line>
      <a ref={btn} className="btn" href={playUrl} target="_blank" rel="noopener" style={{ top: '60%' }} onPointerUp={(e) => e.stopPropagation()}>
        <TgIcon />
        Играть
      </a>
      <Tap x={64} y={66} at={a + 1.95} size={30} />
      <div ref={fade} className="fill black" />
    </Scene>
  );
}

/** Сцены по порядку: id, подпись (для полоски прогресса), окно времени. */
export const SCENES = [
  { id: 'hook', label: 'Логотип', a: 0, b: 3.0, imgs: ['battle_intro'], C: Hook },
  { id: 'asura', label: 'Удар Асуры', a: 3.0, b: 6.4, imgs: ['battle_ult_asura'], C: UltAsura },
  { id: 'area', label: 'Площадная ульта', a: 6.4, b: 9.6, imgs: ['battle_ult_lord_of_vermillion', 'battle_break'], C: (p) => <UltArea {...p} cut={8.25} /> },
  { id: 'map', label: 'Кампания', a: 9.6, b: 12.4, imgs: ['home'], C: Campaign },
  { id: 'hero', label: 'Герой и ветка', a: 12.4, b: 15.4, imgs: ['hero_vika', 'branch_vika'], C: (p) => <Hero {...p} mid={13.7} /> },
  { id: 'roster', label: '12 героев', a: 15.4, b: 17.8, imgs: ['branch_all_heroes'], C: Roster },
  { id: 'tavern', label: 'Таверна', a: 17.8, b: 20.4, imgs: ['tavern_summon'], C: Tavern },
  { id: 'bosses', label: 'Боссы', a: 20.4, b: 24.0, imgs: ['mvp_dracula', 'mvp_pharaoh', 'mvp_baphomet'], C: Bosses },
  { id: 'card', label: 'Карта MVP', a: 24.0, b: 26.0, imgs: ['hunt_screen'], C: McCard },
  { id: 'story', label: 'История', a: 26.0, b: 28.6, imgs: ['tavern_evening_1', 'tavern_evening_3'], C: (p) => <Story {...p} mid={27.3} /> },
  { id: 'tower', label: 'Башня', a: 28.6, b: 31.2, imgs: ['tower_cards'], C: Tower },
  { id: 'final', label: 'Играть', a: 31.2, b: 35.0, imgs: ['branch_all_heroes'], C: Final },
];
