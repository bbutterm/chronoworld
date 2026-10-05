import Phaser from 'phaser';
import { autoParty, busyHeroes, heroPower, withGear, type HeroState } from '../core';
import { adventureModePanel } from './adventureModePanel';
import { GAME } from './content';
import { formatNumber, heroSprite } from './flow';
import { rarityName } from './heroCard';
import { portrait } from './screen';
import { session } from './session';
import { portraitKey } from './sprites';
import { COLOR, S, T } from './theme';
import { button, ellipsize, text, toast } from './ui';

export const EXPEDITION_PARTY_PANEL = 'expeditionPartyPicker';

/** A pending selection is UI state only. Core validates the actual party again when sending. */
export function openExpeditionPartyPicker(scene: Phaser.Scene, locationId: string, initial: readonly string[], onPick: (ids: string[]) => void, onClose: () => void) {
  const loc = GAME.meta.expeditions.locations.find(l => l.id === locationId);
  if (!loc || scene.children.getByName(EXPEDITION_PARTY_PANEL)) return;
  const max = GAME.meta.expeditions.maxHeroes;
  const busy = new Set(busyHeroes(session.save));
  const gctx = withGear(GAME, session.save);
  const heroes = session.save.heroes.filter(h => !busy.has(h.id) && GAME.content.heroes[h.templateId]);
  const power = (h: HeroState) => heroPower(h, gctx);
  heroes.sort((a, b) => Number(session.save.squad.includes(b.id)) - Number(session.save.squad.includes(a.id)) || power(b) - power(a));
  const selected = new Set(initial.filter(id => heroes.some(h => h.id === id)).slice(0, max));
  const panel = adventureModePanel(scene, EXPEDITION_PARTY_PANEL, 'Отряд экспедиции', { footerH: 216, onClose });
  const summary = text(scene, 0, 24, '', T.body, COLOR.textSecondary).setOrigin(0, 0.5).setName('expeditionPartyPower');
  panel.footer.add(summary);
  const auto = button(scene, 166, 126, 332, 132, '', 'Автоподбор', () => {
    selected.clear(); for (const id of autoParty(session.save, locationId, GAME).heroIds) selected.add(id); refresh();
  }, T.body, { variant: 'secondary' });
  auto.container.setName('expeditionPartyAuto');
  const choose = button(scene, (panel.width + 356) / 2, 126, panel.width - 356, 132, 'ui_btn_primary', 'Выбрать отряд', () => {
    // Another action may have changed availability while this modal was open.
    const unavailable = new Set(busyHeroes(session.save));
    const current = [...selected].map(id => session.save.heroes.find(h => h.id === id)).filter((h): h is HeroState => !!h && !unavailable.has(h.id));
    const sum = current.reduce((n, h) => n + heroPower(h, withGear(GAME, session.save)), 0);
    if (!current.length || current.length !== selected.size || current.length > max || sum < loc.power) return void toast(scene, 'Состав изменился. Выберите свободных героев нужной мощи.', COLOR.warning);
    const ids = [...selected]; panel.close(); onPick(ids);
  }, T.body);
  choose.container.setName('expeditionPartyChoose');
  panel.footer.add([auto.container, choose.container]);
  const rows: { hero: HeroState; button: ReturnType<typeof button> }[] = [];
  const refresh = () => {
    const sum = heroes.filter(h => selected.has(h.id)).reduce((n, h) => n + power(h), 0);
    summary.setText(`${selected.size}/${max} героев · ${formatNumber(sum)} / ${formatNumber(loc.power)} мощи`).setColor(sum >= loc.power ? COLOR.positive : COLOR.warning);
    ellipsize(summary, panel.width);
    choose.setEnabled(selected.size > 0 && sum >= loc.power);
    for (const r of rows) r.button.setLabel(`${selected.has(r.hero.id) ? '✓ ' : ''}${GAME.content.heroes[r.hero.templateId].name}`);
  };
  let y = S.xs;
  for (const hero of heroes) {
    const at = y + 80;
    panel.content.add(portrait(scene, 64, at, portraitKey(heroSprite(hero, GAME)), 112));
    const b = button(scene, (panel.width + 144) / 2, at - 10, panel.width - 144, 132, '', GAME.content.heroes[hero.templateId].name, panel.area.tap(() => {
      if (selected.has(hero.id)) selected.delete(hero.id);
      else if (selected.size < max) selected.add(hero.id);
      else return void toast(scene, `В отряде не больше ${max} героев`, COLOR.warning);
      refresh();
    }), T.body, { variant: 'secondary' });
    b.container.setName(`expeditionPartyHero_${hero.id}`);
    const info = text(scene, 164, at + 88, `Ур. ${hero.level} · ${rarityName(hero.rarity)} · ${formatNumber(power(hero))} мощи`, T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    ellipsize(info, panel.width - 164);
    panel.content.add([b.container, info]); rows.push({ hero, button: b }); y += 224;
  }
  if (!heroes.length) panel.content.add(text(scene, panel.width / 2, 90, 'Все герои сейчас в экспедициях', T.body, COLOR.textSecondary));
  panel.setHeight(Math.max(y, 160)); refresh();
  return panel;
}
