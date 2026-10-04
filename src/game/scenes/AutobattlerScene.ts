import Phaser from 'phaser';
import { buildUnit } from '../../core/heroes/card';
import { abandonAutobattlerRun, autobattlerBattle, autobattlerConfig, autobattlerHeroState, autobattlerSaleValue, autobattlerStars, autobattlerStatus, AutobattlerError, buyAutobattlerOffer, rerollAutobattlerShop, sellAutobattlerHero, setAutobattlerBranch, setAutobattlerSquad, startAutobattlerRun, trainAutobattlerRun, type AutobattlerHero, type AutobattlerRewards, type AutobattlerRun, type AutobattlerSave } from '../../core/autobattler';
import { AUTOBATTLER_LAYOUT as L, autobattlerCopiesLabel, autobattlerDailyReward, autobattlerTrainingLabel } from '../autobattlerView';
import { GAME } from '../content';
import { heroSprite, ROLE_NAMES } from '../flow';
import { GAME_W } from '../layout';
import { bottomSheet, confirm, cta, portrait, screen } from '../screen';
import { commit, session, today } from '../session';
import { portraitKey } from '../sprites';
import { plural } from '../skillFacts';
import { COLOR, R, S, T, TOUCH_COMFORT } from '../theme';
import { button, ellipsize, infoButton, plate, pressable, SURFACE, text, toast } from '../ui';

export interface AutobattlerSceneData {
  fight?: { round: number; won: boolean; lives: number; ended: boolean; rewards: AutobattlerRewards; income?: number; wins?: number };
}

/** Short resumable drafting matches. Every preparation action is immediately saved. */
export class AutobattlerScene extends Phaser.Scene {
  private busy = false;

  constructor() { super('Autobattler'); }

  create(data: AutobattlerSceneData = {}): void {
    this.sys.settings.data = {};
    this.busy = false;
    screen(this, 'Арена товарищей', 'Adventure', { to: 'Adventure' });
    const status = autobattlerStatus(session.save, GAME);
    if (!status.unlocked) {
      text(this, GAME_W / 2, 770, 'Арена откроется после первой главы', T.heading, COLOR.textSecondary, { wordWrap: { width: 850 } });
      cta(this, GAME_W / 2, L.go, 'В кампанию', () => this.scene.start('Campaign'));
      return;
    }
    if (status.run) this.preparation(status.run);
    else this.lobby();
    if (data.fight?.ended) this.summarySheet();
    else if (data.fight) toast(this, data.fight.won ? `Раунд ${data.fight.round}: победа` : `Раунд ${data.fight.round}: поражение · жизней ${data.fight.lives}`, data.fight.won ? COLOR.positive : COLOR.warning);
  }

  private act(fn: () => AutobattlerSave): void {
    if (this.busy) return;
    this.busy = true;
    try {
      commit(fn());
      this.scene.restart();
    } catch (e) {
      this.busy = false;
      if (e instanceof AutobattlerError) toast(this, e.message, COLOR.negative);
      else throw e;
    }
  }

  private lobby(): void {
    const cfg = autobattlerConfig(GAME);
    const status = autobattlerStatus(session.save, GAME);
    this.rulesButton(GAME_W - S.l - 48, L.status);
    text(this, GAME_W / 2, 370, `Собери команду · ${cfg.rounds} ${plural(cfg.rounds, 'раунд', 'раунда', 'раундов')}`, T.heading, COLOR.title, { wordWrap: { width: 850 } });
    text(this, GAME_W / 2, 468, `Общий уровень · ${cfg.lives} ${plural(cfg.lives, 'жизнь', 'жизни', 'жизней')}`, T.body, COLOR.textSecondary);
    const companions = cfg.startingTeam.map((templateId, i): AutobattlerHero => ({ id: `ab_preview_${i}`, templateId, copies: 1, paidCopies: 0 }));
    const previewRun = { training: 0 } as AutobattlerRun;
    companions.forEach((hero, i) => {
      const x = 270 + i * 270;
      this.companionPortrait(hero, previewRun, x, 716, 200);
      text(this, x, 866, GAME.content.heroes[hero.templateId].name, T.heading, COLOR.textPrimary);
    });
    text(this, GAME_W / 2, 1030, `Лучший результат: ${status.bestWins} / ${cfg.rounds}`, T.heading, COLOR.title);
    const daily = autobattlerDailyReward(session.save, today(), cfg);
    text(this, GAME_W / 2, 1146, `Алмазы сегодня: ${daily.earned} / ${daily.maximum}`, T.body, daily.canImprove ? COLOR.gem : COLOR.textSecondary).setName('autobattlerReward');
    if (status.last) {
      const last = status.last;
      const reason = last.reason === 'abandoned' ? 'Матч завершён досрочно' : `${last.wins} побед из ${last.rounds} раундов`;
      button(this, GAME_W / 2, 1322, 840, TOUCH_COMFORT, '', reason, () => this.summarySheet(), T.body, { variant: 'secondary' }).container.setName('autobattlerLast');
    }
    cta(this, GAME_W / 2, L.go, 'Начать матч', () => this.act(() => startAutobattlerRun(session.save, today(), GAME)), { w: 820 }).container.setName('autobattlerStart');
  }

  private preparation(run: AutobattlerRun): void {
    const cfg = autobattlerConfig(GAME);
    const preview = autobattlerBattle(session.save, GAME);
    const training = cfg.training[run.training];
    text(this, S.l, L.status, `Раунд ${run.round}/${cfg.rounds}`, T.heading, COLOR.title).setOrigin(0, 0.5);
    text(this, 494, L.status, `Жизни ${run.lives}`, T.body, COLOR.positive);
    text(this, 760, L.status, `Монеты ${run.gold}`, T.body, COLOR.gold).setName('autobattlerGold');
    this.rulesButton(GAME_W - S.l - 36, L.status);
    const foe = text(this, GAME_W / 2, L.opponent, preview.cohort.name, T.heading, COLOR.textPrimary);
    ellipsize(foe, GAME_W - S.xxl * 2);
    preview.enemies.forEach((u, slot) => { if (u) portrait(this, 280 + slot * 130, L.opponentPortraits, portraitKey(u.visual.sprite), 78); });
    text(this, GAME_W / 2, L.opponent + 44, 'Состав соперника', T.caption, COLOR.textSecondary);
    button(this, GAME_W - S.l - TOUCH_COMFORT / 2, L.opponent + 44, TOUCH_COMFORT, TOUCH_COMFORT, '', '›', () => this.opponentSheet(), T.heading, { variant: 'ghost' }).container.setName('autobattlerOpponent');
    text(this, S.l, L.front - 72, 'Фронт', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    text(this, S.l, L.back - 72, 'Тыл', T.caption, COLOR.textSecondary).setOrigin(0, 0.5);
    for (let slot = 0; slot < 5; slot++) {
      const x = slot < 2 ? 370 + slot * 340 : 260 + (slot - 2) * 280;
      const y = slot < 2 ? L.front : L.back;
      const box = this.add.container(x, y).setSize(215, 188).setName(`autobattlerSlot${slot}`);
      box.add(plate(this, 0, 0, 182, 144, { ...SURFACE.sunken, r: R.m }));
      const hero = run.heroes.find((h) => h.id === run.squad[slot]);
      if (hero) {
        box.add(this.companionPortrait(hero, run, 0, -8, 126));
        const name = text(this, 0, 88, `${GAME.content.heroes[hero.templateId].name} ${'★'.repeat(autobattlerStars(hero))}`, T.caption, COLOR.textPrimary);
        ellipsize(name, 215);
        box.add(name);
      } else box.add(text(this, 0, 0, '+', T.title, COLOR.textSecondary));
      pressable(this, box, 215, 188, () => this.slotSheet(slot));
    }
    const active = preview.synergies.filter((s) => s.active);
    const synergies = this.add.container(282, L.synergies).setSize(436, TOUCH_COMFORT).setName('autobattlerSynergies');
    const synergiesLabel = text(this, 0, 0, active.length ? active.map((s) => s.name).join(' · ') : 'Связки команды', T.body, active.length ? COLOR.positive : COLOR.textSecondary);
    ellipsize(synergiesLabel, 420);
    synergies.add(synergiesLabel);
    pressable(this, synergies, 436, TOUCH_COMFORT, () => this.synergySheet());
    const onField = run.squad.filter(Boolean).length;
    button(this, 797, L.synergies, 436, TOUCH_COMFORT, '', `Товарищи · ${onField}/${training.capacity}`, () => this.reserveSheet(), T.body, { variant: 'secondary' }).container.setName('autobattlerReserve');
    text(this, S.l, L.shopTitle, 'Лавка матча', T.heading, COLOR.title).setOrigin(0, 0.5);
    text(this, GAME_W - S.l, L.shopTitle, `Ур. ${training.level} · мест ${training.capacity}`, T.caption, COLOR.textSecondary).setOrigin(1, 0.5);
    run.shop.forEach((templateId, i) => {
      const x = 220 + i * 320;
      plate(this, x, 1234, 280, 360, { ...SURFACE.raised, r: R.l });
      if (!templateId) { text(this, x, L.shopName, 'Забран', T.body, COLOR.textTertiary); return; }
      const template = GAME.content.heroes[templateId];
      const hero: AutobattlerHero = run.heroes.find((h) => h.templateId === templateId) ?? { id: `ab_offer_${i}`, templateId, copies: 1, paidCopies: 1, branch: run.branchChoices[templateId] };
      this.companionPortrait(hero, run, x, L.shopPortrait, 100);
      text(this, x, L.shopName, template.name, T.body, COLOR.textPrimary);
      const current = run.heroes.find((h) => h.templateId === templateId);
      text(this, x, L.shopName + 48, current ? autobattlerCopiesLabel(current) : ROLE_NAMES[buildUnit(autobattlerHeroState(hero, run, GAME), GAME).role], T.caption, COLOR.textSecondary);
      const b = button(this, x, L.shopBuy, 250, TOUCH_COMFORT, '', `Взять · ${cfg.heroCost}`, () => this.act(() => buyAutobattlerOffer(session.save, i, GAME)), T.body, { variant: 'secondary' });
      b.container.setName(`autobattlerOffer${i}`);
      b.setEnabled(run.gold >= cfg.heroCost && (!current || current.copies < 9) && (!!current || run.heroes.length < cfg.reserveLimit));
    });
    const reroll = button(this, 282, L.economy, 436, TOUCH_COMFORT, '', `Обновить · ${cfg.rerollCost}`, () => this.act(() => rerollAutobattlerShop(session.save, GAME)), T.body, { variant: 'secondary' });
    reroll.container.setName('autobattlerReroll');
    reroll.setEnabled(run.gold >= cfg.rerollCost);
    const upgrade = button(this, 797, L.economy, 436, TOUCH_COMFORT, '', autobattlerTrainingLabel(run, cfg), () => this.trainingSheet(), T.body, { variant: 'secondary' });
    upgrade.container.setName('autobattlerTrain');
    upgrade.setEnabled(!!cfg.training[run.training + 1]);
    cta(this, GAME_W / 2, L.go, `В бой · раунд ${run.round}`, () => {
      if (this.busy) return;
      this.busy = true;
      this.scene.start('Battle', { mode: 'autobattler' });
    }, { w: 850, enabled: onField > 0 }).container.setName('autobattlerGo');
  }

  private companionPortrait(hero: AutobattlerHero, run: AutobattlerRun, x: number, y: number, size: number): Phaser.GameObjects.Image {
    return portrait(this, x, y, portraitKey(heroSprite(autobattlerHeroState(hero, run, GAME), GAME)), size);
  }

  /** Размер значка прежний; цель комфортного касания — 44 CSS px при ширине 360. */
  private rulesButton(x: number, y: number): void {
    const info = infoButton(this, x, y, () => this.rulesSheet()).setName('autobattlerInfo');
    info.setSize(TOUCH_COMFORT, TOUCH_COMFORT);
    if (info.input) info.input.hitArea = new Phaser.Geom.Rectangle(0, 0, TOUCH_COMFORT, TOUCH_COMFORT);
  }

  private rulesSheet(): void {
    const cfg = autobattlerConfig(GAME);
    const paragraphs = [
      `Раундов: ${cfg.rounds}. Лимит поражений: ${cfg.lives}. Между боями здоровье и энергия восстанавливаются.`,
      `Уровни и снаряжение кампании здесь не усиливают бойцов. Начальная команда и ${cfg.startingGold} монет доступны каждому. Знакомые герои расширяют лавку.`,
      'Три копии одного товарища дают две звезды, девять — три. Вторая профессия открывается с подготовкой III; ветку можно свободно менять внутри матча.',
      `После раунда: ${cfg.income} монет, ещё ${cfg.winIncome} за победу. За каждые ${cfg.interestEvery} сохранённых монет — одна дополнительная, не больше ${cfg.interestCap}.`,
      'Подготовка повышает общий уровень и число мест. Запасные товарищи не участвуют в связках. Фронт и тыл меняют доступность целей.',
      `Награда зависит от числа побед, начиная с ${cfg.rewards.minWins}. За день начала матча можно получить до ${cfg.rewards.gems} алмазов. Новый лучший результат выдаёт только недостающую часть. Досрочное завершение не приносит наград.`,
      'Матч сохраняется после каждого выбора. Можно выйти и продолжить с того же раунда.',
    ];
    bottomSheet(this, 'Правила Арены', (content, width) => {
      let y = 0;
      for (const paragraph of paragraphs) {
        const t = text(this, 0, y, paragraph, T.body, COLOR.textSecondary, { wordWrap: { width }, align: 'left' }).setOrigin(0, 0);
        content.add(t);
        y += t.height + S.m;
      }
      if (autobattlerStatus(session.save, GAME).run) {
        const abandon = button(this, width / 2, y + TOUCH_COMFORT / 2, width, TOUCH_COMFORT, '', 'Завершить матч без награды', () => confirm(this, 'Завершить матч без награды?', 'Завершить', () => this.act(() => abandonAutobattlerRun(session.save, GAME)), { danger: true }), T.body, { variant: 'secondary' });
        abandon.container.setName('autobattlerAbandon');
        content.add(abandon.container);
        y += TOUCH_COMFORT + S.m;
      }
      return y;
    });
  }

  private opponentSheet(): void {
    const preview = autobattlerBattle(session.save, GAME);
    bottomSheet(this, preview.cohort.name, (content, width) => {
      const hint = text(this, 0, 0, preview.cohort.hint, T.body, COLOR.textSecondary, { wordWrap: { width }, align: 'left' }).setOrigin(0, 0);
      content.add(hint);
      let y = hint.height + 100;
      preview.enemies.forEach((u, slot) => {
        if (!u) return;
        content.add(portrait(this, 76, y, portraitKey(u.visual.sprite), 112));
        content.add(text(this, 165, y - 22, `${u.name} · ${ROLE_NAMES[u.role]}`, T.body, COLOR.textPrimary).setOrigin(0, 0.5));
        content.add(text(this, 165, y + 36, slot < 2 ? 'Фронт' : 'Тыл', T.caption, COLOR.textSecondary).setOrigin(0, 0.5));
        y += 155;
      });
      return y;
    });
  }

  private synergySheet(): void {
    const synergies = autobattlerBattle(session.save, GAME).synergies;
    bottomSheet(this, 'Связки команды', (content, width) => {
      let y = 0;
      for (const s of synergies) {
        content.add(text(this, 0, y, `${s.name} · ${s.count}/${s.need}`, T.heading, s.active ? COLOR.positive : COLOR.textPrimary).setOrigin(0, 0));
        const detail = text(this, 0, y + 70, s.description, T.body, COLOR.textSecondary, { wordWrap: { width }, align: 'left' }).setOrigin(0, 0);
        content.add(detail);
        y += 70 + detail.height + S.xl;
      }
      return y;
    });
  }

  private trainingSheet(): void {
    const run = autobattlerStatus(session.save, GAME).run;
    if (!run) return;
    const cfg = autobattlerConfig(GAME);
    const next = cfg.training[run.training + 1];
    if (!next) return;
    bottomSheet(this, 'Подготовка команды', (content, width) => {
      content.add(text(this, width / 2, 48, `Уровень ${cfg.training[run.training].level} → ${next.level}`, T.heading, COLOR.title));
      content.add(text(this, width / 2, 144, `Мест на поле: ${next.capacity}`, T.body, COLOR.textPrimary));
      if (next.rarity === 'purple' && cfg.training[run.training].rarity !== 'purple') content.add(text(this, width / 2, 232, 'Откроются вторые профессии', T.body, COLOR.positive));
      const b = button(this, width / 2, 366, width - 80, TOUCH_COMFORT, '', `Подготовить · ${next.cost} монет`, () => this.act(() => trainAutobattlerRun(session.save, GAME)), T.heading, { variant: 'primary' });
      b.container.setName('autobattlerTrainConfirm');
      b.setEnabled(run.gold >= next.cost);
      content.add(b.container);
      return 454;
    });
  }

  private slotSheet(slot: number): void {
    const run = autobattlerStatus(session.save, GAME).run;
    if (!run) return;
    bottomSheet(this, slot < 2 ? 'Товарищ на фронт' : 'Товарищ в тыл', (content, width, close) => {
      let y = 0;
      if (run.squad[slot]) {
        const remove = button(this, width / 2, TOUCH_COMFORT / 2, width, TOUCH_COMFORT, '', 'В резерв', () => { close(); this.act(() => setAutobattlerSquad(session.save, run.squad.map((id, i) => i === slot ? null : id), GAME)); }, T.body, { variant: 'secondary' });
        content.add(remove.container);
        y = TOUCH_COMFORT + S.m;
      }
      for (const hero of run.heroes) {
        const unit = buildUnit(autobattlerHeroState(hero, run, GAME), GAME);
        content.add(this.companionPortrait(hero, run, 66, y + 68, 100));
        const select = button(this, (width + 122) / 2, y + TOUCH_COMFORT / 2, width - 156, TOUCH_COMFORT, '', `${unit.name} · ${ROLE_NAMES[unit.role]}`, () => {
          close();
          const squad = [...run.squad];
          const previous = squad.indexOf(hero.id);
          if (previous >= 0) squad[previous] = squad[slot];
          squad[slot] = hero.id;
          this.act(() => setAutobattlerSquad(session.save, squad, GAME));
        }, T.body, { variant: 'secondary' });
        select.container.setName(`autobattlerPick_${hero.templateId}`);
        content.add(select.container);
        y += 156;
      }
      return y;
    });
  }

  private reserveSheet(): void {
    const run = autobattlerStatus(session.save, GAME).run;
    if (!run) return;
    bottomSheet(this, 'Товарищи матча', (content, width, close) => {
      let y = 0;
      for (const hero of run.heroes) {
        const unit = buildUnit(autobattlerHeroState(hero, run, GAME), GAME);
        content.add(this.companionPortrait(hero, run, 66, y + 68, 100));
        const b = button(this, (width + 122) / 2, y + TOUCH_COMFORT / 2, width - 156, TOUCH_COMFORT, '', `${unit.name} · ${autobattlerCopiesLabel(hero)}`, () => { close(); this.heroSheet(hero.id); }, T.body, { variant: 'secondary' });
        b.container.setName(`autobattlerReserve_${hero.templateId}`);
        content.add(b.container);
        y += 156;
      }
      return y;
    });
  }

  private heroSheet(heroId: string): void {
    const run = autobattlerStatus(session.save, GAME).run;
    const hero = run?.heroes.find((h) => h.id === heroId);
    if (!run || !hero) return;
    const cfg = autobattlerConfig(GAME);
    const template = GAME.content.heroes[hero.templateId];
    const unit = buildUnit(autobattlerHeroState(hero, run, GAME), GAME);
    bottomSheet(this, template.name, (content, width, close) => {
      content.add(this.companionPortrait(hero, run, 116, 106, 168));
      content.add(text(this, 260, 65, `${ROLE_NAMES[unit.role]} · ${autobattlerCopiesLabel(hero)}`, T.heading, COLOR.title).setOrigin(0, 0.5));
      content.add(text(this, 260, 145, `Ур. ${cfg.training[run.training].level}`, T.body, COLOR.textSecondary).setOrigin(0, 0.5));
      content.add(text(this, 0, 248, 'Вторая профессия · подготовка III', T.body, COLOR.textSecondary).setOrigin(0, 0));
      template.branches.forEach((branch, i) => {
        const job = GAME.content.jobs[branch.job];
        const title = template.gender === 'f' ? job.nameF ?? job.name : job.name;
        const selected = hero.branch === branch.job;
        const b = button(this, width / 2, 372 + i * 180, width, TOUCH_COMFORT, '', `${selected ? '✓ ' : ''}${title} · ${ROLE_NAMES[branch.role]}`, () => this.act(() => setAutobattlerBranch(session.save, heroId, branch.job, GAME)), T.body, { variant: 'secondary' });
        b.container.setName(`autobattlerBranch_${branch.job}`);
        b.setEnabled(!selected);
        content.add(b.container);
        const ult = branch.ult ? GAME.content.skills[branch.ult] : null;
        if (ult) {
          const label = text(this, width / 2, 462 + i * 180, ult.name, T.caption, COLOR.textSecondary);
          ellipsize(label, width - 2 * S.m);
          content.add(label);
        }
      });
      const value = autobattlerSaleValue(hero, cfg);
      const sell = button(this, width / 2, 782, width - 80, TOUCH_COMFORT, '', `Отпустить · ${value} монет`, () => {
        close();
        confirm(this, `Отпустить ${template.name} из этого матча?`, 'Отпустить', () => this.act(() => sellAutobattlerHero(session.save, heroId, GAME)), { danger: true });
      }, T.body, { variant: 'secondary' });
      sell.setEnabled(run.heroes.length > 1);
      sell.container.setName('autobattlerSell');
      content.add(sell.container);
      return 876;
    });
  }

  private summarySheet(): void {
    const last = autobattlerStatus(session.save, GAME).last;
    if (!last) return;
    bottomSheet(this, last.reason === 'completed' ? 'Матч завершён' : last.reason === 'defeated' ? 'Команда возвращается' : 'Матч окончен досрочно', (content, width, close) => {
      content.add(text(this, width / 2, 74, `${last.wins} побед · ${last.rounds} раундов`, T.title, COLOR.title));
      const rewards = last.rewards;
      const lines = rewards.gems || rewards.gold || rewards.heroExp ? [`Алмазы +${rewards.gems}`, `Золото +${rewards.gold}`, `Опыт +${rewards.heroExp}`] : [last.reason === 'abandoned' ? 'Досрочное завершение без награды' : 'Результат не увеличил награду дня'];
      lines.forEach((line, i) => content.add(text(this, width / 2, 206 + i * 88, line, T.body, i === 0 && rewards.gems ? COLOR.gem : COLOR.textSecondary)));
      const ok = button(this, width / 2, 550, width - 100, TOUCH_COMFORT, '', 'Готово', close, T.heading, { variant: 'primary' });
      ok.container.setName('autobattlerSummaryOk');
      content.add(ok.container);
      return 656;
    });
  }
}
