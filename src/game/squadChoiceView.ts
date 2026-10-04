import type Phaser from 'phaser';
import { drawHeroCard } from './heroCard';
import { bottomSheet } from './screen';
import { session } from './session';
import { formatNumber } from './flow';
import { COLOR, S, T } from './theme';
import { BTN, button, text } from './ui';
import type { SquadOption } from './squadChoice';

/** Opens without changing the squad; only an explicit option applies it. */
export function showSquadChoices(scene: Phaser.Scene, options: SquadOption[], apply: (option: SquadOption) => void, onClose: () => void): void {
  let chosen = false;
  const sheet = bottomSheet(scene, 'Один слот — два варианта', (content, width, close) => {
    const intro = text(scene, 0, 0, 'В обоих вариантах — те же четыре героя. Выберите пятого.', T.body, COLOR.textSecondary, { align: 'left', wordWrap: { width } }).setOrigin(0, 0);
    content.add(intro);
    let y = intro.height + S.l;
    for (const option of options) {
      const hero = session.save.heroes.find((h) => h.id === option.heroId)!;
      const row = scene.add.container(0, y).setName(`squadOption_${option.id}`);
      row.add(drawHeroCard(scene, 96, 130, hero, { w: 170, glow: false }));
      const x = 212;
      row.add(text(scene, x, 6, `${option.title} · ${option.heroName}`, T.body, COLOR.title, { fontStyle: 'bold', align: 'left' }).setOrigin(0, 0));
      row.add(text(scene, x, 62, option.detail, T.caption, COLOR.textSecondary, { align: 'left', wordWrap: { width: width - x } }).setOrigin(0, 0));
      row.add(text(scene, x, 122, `Мощь отряда: ${formatNumber(option.power)}`, T.caption, COLOR.textPrimary).setOrigin(0, 0));
      const select = button(scene, x + (width - x) / 2, 216, width - x, BTN.m, '', `Выбрать: ${option.heroName}`, () => {
        if (chosen || sheet.layer.getData('closing') || !scene.sys.isActive()) return;
        chosen = true;
        apply(option);
        close();
      }, T.body, { variant: 'secondary' });
      select.container.setName(`chooseSquad_${option.id}`);
      row.add(select.container);
      content.add(row);
      y += 310;
    }
    const note = text(scene, 0, y, 'Мощь не учитывает пользу лечения. Состав можно менять перед каждым боем.', T.caption, COLOR.textSecondary, { align: 'left', wordWrap: { width } }).setOrigin(0, 0);
    content.add(note);
    return y + note.height;
  }, { onClose });
}
