/** Легальные действия ускоренного QA-игрока. Правила ресурсов остаются в ядре. */
import {
  actLevelUp, actPlayStage, actTowerFight, actUnequip, actUseFastRewards, arrangeSquad, autoFormation,
  autobattlerHeroState, autobattlerStars, autobattlerUnlocked, bondView, buyAutobattlerOffer,
  buyTowerUpgrade, canChooseCampaignOption, cardsForItem, chooseCampaignOption,
  chooseOption, clearChapterDone, clearHeroFocus, fastRewardsStatus, featureUnlocked, fightAutobattlerRound, fightBondQuest, fightHunt,
  finishCampaignScene, finishEvening, finishPersonalScene, heroCopyUpgradeOptions, heroFocusOptions,
  heroPower, heroResetInfo, heroRole, heroSlots, huntStatus, insertCard, levelUpInfo,
  newEvenings, newGame, ownedCards, queuedScenes, rarityIndex,
  replayAllowance, resetHeroLevel, salvageItems, salvagePlan, setAutobattlerSquad,
  setHeroFocus, setSquad, startAutobattlerRun, sweepHunt, towerUnlocked,
  trainAutobattlerRun, upgradeHeroFromCopy, type FullContext, type HeroState, type SaveState,
} from '../../src/core';
import { BalancePlayer, PLAYER_MODEL, type PlayerModel } from './player-model';
import { prepareModelTower } from './tower-player';

export const NIGHT_MODEL: PlayerModel = {
  ...PLAYER_MODEL,
  firstSessionMinutes: 120,
  sessionMinutes: 120,
  battleSpeed: 2,
  battleOverheadSec: 5,
  storySecPerLine: 0,
  levelUpSec: 0.25,
  summonSec: 3,
  ascendSec: 3,
  refineSec: 0.25,
  fastRewardsPerDay: 10,
  shopExpWhenCapped: false,
  refineReserveLevels: 0,
  seedBase: 1,
  startDate: '2026-10-05',
};

export interface NightAction {
  kind: string;
  target?: string;
  wins?: number;
  gold?: number;
  exp?: number;
}

export class NightPlayer extends BalancePlayer {
  readonly startAt: number;
  actions: NightAction[] = [];
  candidateLevelUps = 0;
  private arenaDays = new Set<string>();
  private questAttempts = new Set<string>();
  readonly naiveMaxFarm: boolean;
  readonly preserveCompanions: boolean;

  constructor(ctx: FullContext, model: PlayerModel = NIGHT_MODEL, naiveMaxFarm = false, preserveCompanions = false) {
    super(ctx, model);
    // Вариация выдач — честно различное время создания аккаунта; ни валюта, ни герои не подменяются.
    this.startAt = Date.parse(`${model.startDate}T00:00:00Z`) + (model.seedBase - 1) * 1_000_003;
    this.now = this.startAt;
    this.save = newGame(ctx, this.startAt, this.dayOf(this.now));
    this.naiveMaxFarm = naiveMaxFarm;
    this.preserveCompanions = preserveCompanions;
    this.syncDay();
  }

  private dayOf(now: number): string { return new Date(now).toISOString().slice(0, 10); }
  syncDay(): void {
    this.day = this.dayOf(this.now);
    this.dayNo = Math.floor((Date.parse(`${this.day}T00:00:00Z`) - Date.parse(`${this.dayOf(this.startAt)}T00:00:00Z`)) / 86_400_000) + 1;
  }
  override get t(): number { return (this.now - this.startAt) / 3_600_000; }
  override spendTime(ms: number): void { super.spendTime(ms); this.syncDay(); }

  /** На потолке редкости премиальная валюта нужнее копиям; бесплатная выдача остаётся. */
  override fastRewards(): boolean {
    const capped = this.save.squad.every((id) => !id || levelUpInfo(this.save, id, this.ctx).blocker === 'max_level');
    if (this.naiveMaxFarm || !capped) return super.fastRewards();
    if (!featureUnlocked(this.save, 'fast_rewards', this.ctx)) return false;
    const status = fastRewardsStatus(this.save, this.day, this.ctx);
    if (status.nextCost !== 0) return false;
    this.step('fast_rewards', actUseFastRewards(this.save, this.day, this.ctx).save);
    return true;
  }

  override develop(): void {
    super.develop();
    if (!this.preserveCompanions) return;
    this.preserveCompanionCopies();
    this.pickBranches();
    this.levelSquad();
  }

  /** Отдельный RPG-профиль: сохранить исходную личность вместо замены её более редким экземпляром. */
  preserveCompanionCopies(): void {
    if (!this.preserveCompanions) return;
    const originals = this.save.heroes.filter((hero) => hero.companion).map((hero) => hero.id);
    for (const heroId of originals) {
      const target = this.save.heroes.find((hero) => hero.id === heroId)!;
      if (this.save.bounties.active.some((expedition) => expedition.heroIds.includes(heroId))) continue;
      const oldCap = this.ctx.cards.rarities.find((rarity) => rarity.id === target.rarity)!.maxLevel;
      const candidates = heroCopyUpgradeOptions(this.save, heroId, this.ctx).sort((a, b) => rarityIndex(b.to) - rarityIndex(a.to) || a.donorLevel - b.donorLevel);
      for (const candidate of candidates) {
        const donor = this.save.heroes.find((hero) => hero.id === candidate.heroId)!;
        // Не обходить замки, пресеты, экспедиции и подаренные уровни; сначала проверить обратимые шаги.
        if (donor.locked || donor.companion || (donor.grantedLevel ?? 1) > oldCap
          || this.save.presets.some((preset) => preset.squad.includes(donor.id))
          || this.save.bounties.active.some((expedition) => expedition.heroIds.includes(donor.id))) continue;
        const refund = heroResetInfo(this.save, donor.id, this.ctx);
        if (!refund.canReset) continue;
        const squad = this.save.squad.map((id) => id === donor.id ? heroId : id);
        // Если оригинал уже в отряде, освободить место копии без дублирования heroId.
        const seen = new Set<string>();
        this.save = setSquad(this.save, squad.map((id) => {
          if (id === null || seen.has(id)) return null;
          seen.add(id);
          return id;
        }));
        if (refund.refund.exp > 0 || refund.refund.gold > 0 || donor.level > oldCap) {
          const reset = resetHeroLevel(this.save, donor.id, this.ctx);
          this.step('heroes', reset.save);
          this.actions.push({ kind: 'reset_training', target: donor.id, gold: reset.refund.gold, exp: reset.refund.exp });
        }
        this.save = clearHeroFocus(this.save, donor.id);
        for (const item of this.save.inventory.items) if (item.equippedBy === donor.id) this.save = actUnequip(this.save, item.id);
        const available = heroCopyUpgradeOptions(this.save, heroId, this.ctx).find((option) => option.heroId === donor.id);
        if (!available?.canUpgrade) throw new Error('Подготовленная копия не прошла правила обмена: ' + available?.blocker);
        const exchange = upgradeHeroFromCopy(this.save, heroId, donor.id, this.ctx);
        this.step('heroes', exchange.save);
        this.actions.push({ kind: 'copy_rarity_upgrade', target: heroId + '/' + donor.id + '/' + exchange.from + '->' + exchange.to });
        // Обмен не переносит ветку или вещи донора; собственную профессию выберет pickBranches.
        this.spendTime(this.model.ascendSec * 1000);
        break;
      }
    }
  }

  /** Только часы вперёд; накопление и суточные лимиты вычисляют обычные игровые действия. */
  advanceTwelveHours(): void {
    this.startExpeditions(this.now + 43_200_000);
    this.now += 43_200_000;
    this.syncDay();
    this.claimExpeditions();
    this.claimOffline();
    this.claimRewards();
    this.prepare();
    this.actions.push({ kind: 'wait_12h' });
  }

  override claimRewards(): void {
    super.claimRewards();
    for (const scene of queuedScenes(this.save, this.ctx)) {
      if (scene.choice && canChooseCampaignOption(this.save, scene.id, this.ctx)) {
        // Первый ответ — явный доступный сюжетный путь; fallback не подменяется после начала боя.
        this.save = chooseCampaignOption(this.save, scene.id, scene.choice.options[0].id, this.ctx);
        this.actions.push({ kind: 'campaign_choice', target: scene.choice.id });
      }
      this.save = finishCampaignScene(this.save, scene.id, this.ctx);
    }
    this.save = clearChapterDone(this.save);
    for (const evening of newEvenings(this.save, this.ctx)) {
      for (const line of evening.steps) {
        if (!('choice' in line) || !line.choice) continue;
        const choice = line.choice;
        const main = new Set(this.save.squad.flatMap((id) => this.save.heroes.filter((h) => h.id === id).map((h) => h.templateId)));
        const option = [...choice.options].sort((a, b) =>
          Object.entries(b.bond).reduce((n, [id, d]) => n + d * (main.has(id) ? 2 : 1), 0)
          - Object.entries(a.bond).reduce((n, [id, d]) => n + d * (main.has(id) ? 2 : 1), 0))[0];
        this.save = chooseOption(this.save, choice.id, option.id, this.ctx).save;
      }
      this.save = finishEvening(this.save, evening.id, this.ctx).save;
      this.actions.push({ kind: 'tavern_evening', target: evening.id });
    }
    for (const hero of this.save.heroes) {
      const view = bondView(this.save, hero.templateId, this.ctx);
      if (view?.scene.open && !view.scene.seen) this.save = finishPersonalScene(this.save, view.scene.id);
    }
  }

  /** Освободить честно оплаченный опыт скамейки, сохранить личности и журналы. */
  private returnBenchTraining(): void {
    const main = new Set(this.save.squad);
    for (const hero of this.save.heroes) {
      if (main.has(hero.id)) continue;
      const info = heroResetInfo(this.save, hero.id, this.ctx);
      if (!info.canReset || (info.refund.exp === 0 && info.refund.gold === 0)) continue;
      const out = resetHeroLevel(this.save, hero.id, this.ctx);
      this.step('heroes', out.save);
      this.actions.push({ kind: 'reset_training', target: hero.id, gold: out.refund.gold, exp: out.refund.exp });
    }
  }

  /** Предметы скамейки можно снять вручную; «Надеть лучшее» снова отдаёт их боевому составу. */
  private transferBenchGear(): void {
    const main = new Set(this.save.squad);
    for (const item of this.save.inventory.items) {
      if (item.equippedBy !== null && !main.has(item.equippedBy)) this.save = actUnequip(this.save, item.id);
    }
    this.autoEquip();
  }

  private focusSquad(): void {
    for (const id of this.save.squad) {
      const hero = this.save.heroes.find((h) => h.id === id);
      if (!hero || this.save.bounties.active.some((b) => b.heroIds.includes(hero.id))) continue;
      const focus = heroRole(hero, this.ctx) === 'tank' ? 'resolve' : 'precision';
      const option = heroFocusOptions(hero, this.ctx).find((f) => f.id === focus);
      if (option?.available && !option.selected) {
        this.save = setHeroFocus(this.save, hero.id, focus, this.ctx);
        this.actions.push({ kind: 'training_focus', target: `${hero.id}/${focus}` });
      }
    }
  }

  private insertMvpCards(): void {
    for (const [cardId, count] of Object.entries(ownedCards(this.save))) {
      for (let n = 0; n < count; n++) {
        let best: { id: string; gain: number } | undefined;
        for (const heroId of this.save.squad) {
          const hero = this.save.heroes.find((h) => h.id === heroId);
          if (!hero) continue;
          for (const slot of Object.values(heroSlots(this.save, hero.id, this.ctx))) {
            if (slot.instance.card || !cardsForItem(this.save, slot.def, this.ctx).some((c) => c.id === cardId)) continue;
            const changed = insertCard(this.save, slot.instance.id, cardId, this.ctx);
            const gain = heroPower(hero, this.ctx, changed) - heroPower(hero, this.ctx, this.save);
            if (!best || gain > best.gain) best = { id: slot.instance.id, gain };
          }
        }
        if (!best || best.gain <= 0) break;
        this.save = insertCard(this.save, best.id, cardId, this.ctx);
        this.actions.push({ kind: 'mvp_card', target: cardId });
      }
    }
  }

  override prepare(): void {
    super.prepare();
    this.returnBenchTraining();
    this.levelSquad();
    this.transferBenchGear();
    this.focusSquad();
    this.insertMvpCards();
    if (this.ctx.equipment.drops.salvage) {
      const plan = salvagePlan(this.save, this.ctx);
      if (plan.instanceIds.length) {
        const out = salvageItems(this.save, plan.instanceIds, this.ctx);
        this.step('shop', out.save);
        this.actions.push({ kind: 'salvage', gold: out.gold });
      }
    }
    this.levelSquad();
  }

  /** Лимитированные награды повторов: лучший ещё безопасно проходимый этап. */
  farmReplays(): void {
    const remaining = replayAllowance(this.save, this.day, this.ctx).remaining;
    const targets = this.ctx.content.stages.filter((s) => this.save.campaign.cleared.includes(s.id)).sort((a, b) => b.rewards.jobExp + b.rewards.gold - a.rewards.jobExp - a.rewards.gold).slice(0, 3);
    for (let i = 0; i < remaining; i++) {
      let won = false;
      for (const target of targets) {
        const out = actPlayStage(this.save, this.day, target.id, this.model.seedBase + this.save.battleSeq, this.ctx, this.now);
        this.step('campaign', out.save);
        this.spendTime(out.result.duration * 500 + 5000);
        this.actions.push({ kind: 'replay', target: target.id, wins: out.result.winner === 'A' ? 1 : 0 });
        if (out.result.winner === 'A') { won = true; break; }
      }
      if (!won) break;
    }
    this.claimRewards();
    this.prepare();
  }

  sideModes(): void {
    if (towerUnlocked(this.save, this.ctx) && this.save.tower.floor < this.ctx.tower.maxFloor) {
      let losses = 0;
      for (let step = 0; step < 80 && losses < 2; step++) {
        if (!this.save.tower.run) {
          for (const upgrade of this.ctx.tower.run?.upgrades ?? []) {
            for (;;) {
              const cost = upgrade.costs[this.save.tower.upgrades?.[upgrade.id] ?? 0];
              if (cost === undefined || (this.save.tower.shards ?? 0) < cost) break;
              this.save = buyTowerUpgrade(this.save, upgrade.id, this.ctx);
            }
          }
        }
        if (!this.save.tower.run?.node) {
          this.save = prepareModelTower(this.save, this.ctx);
          this.spendTime(3000);
          continue;
        }
        const out = actTowerFight(this.save, this.day, this.ctx);
        this.step('tower', out.save);
        this.spendTime(out.result.duration * 500 + 5000);
        this.actions.push({ kind: 'tower', target: String(out.floor), wins: out.result.winner === 'A' ? 1 : 0 });
        if (out.result.winner !== 'A') losses++;
        else this.prepare();
      }
    }
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = huntStatus(this.save, this.day, this.ctx);
      if (!status.unlocked || status.attemptsLeft <= 0) break;
      const out = status.canSweep && status.used > 0 ? sweepHunt(this.save, this.day, this.ctx) : fightHunt(this.save, this.day, this.ctx);
      this.step('hunt', out.save);
      this.spendTime((out.result?.duration ?? 0) * 500 + 5000);
      this.actions.push({ kind: 'hunt', target: String(out.tier) });
    }
    this.playArena();
    this.playBondQuests();
    this.claimRewards();
    this.prepare();
  }

  private playBondQuests(): void {
    for (const id of this.save.squad) {
      const hero = this.save.heroes.find((h) => h.id === id);
      if (!hero) continue;
      const view = bondView(this.save, hero.templateId, this.ctx);
      const key = `${this.day}/${hero.templateId}`;
      if (!view?.quest.open || view.quest.done || !view.quest.stageCleared || this.questAttempts.has(key)) continue;
      this.questAttempts.add(key);
      const out = fightBondQuest(this.save, hero.templateId, this.model.seedBase + this.save.battleSeq, this.ctx);
      this.step('events', out.save);
      this.spendTime(out.result.duration * 500 + 5000);
      this.actions.push({ kind: 'bond_quest', target: hero.templateId, wins: out.goal ? 1 : 0 });
    }
  }

  private playArena(): void {
    if (!autobattlerUnlocked(this.save, this.ctx) || this.arenaDays.has(this.day)) return;
    this.arenaDays.add(this.day);
    this.save = startAutobattlerRun(this.save, this.day, this.ctx);
    const cfg = this.ctx.autobattler!;
    for (let guard = 0; guard < cfg.rounds; guard++) {
      for (let choice = 0; choice < 12; choice++) {
        const run = this.save.autobattler!.run!;
        const next = cfg.training[run.training + 1];
        if (next && run.gold >= next.cost) {
          this.save = trainAutobattlerRun(this.save, this.ctx);
          continue;
        }
        if (run.gold < cfg.heroCost) break;
        const offer = run.shop.map((templateId, index) => {
          const hero = run.heroes.find((h) => h.templateId === templateId);
          const template = templateId ? this.ctx.content.heroes[templateId] : undefined;
          return { index, score: !template || (hero?.copies ?? 0) >= 9 ? -1 : hero ? 10 + ((hero.copies + 1) % 3 === 0 ? 20 : 0) : template.role === 'healer' ? 8 : template.role === 'tank' ? 7 : 5 };
        }).filter((o) => o.score >= 0).sort((a, b) => b.score - a.score)[0];
        if (!offer) break;
        this.save = buyAutobattlerOffer(this.save, offer.index, this.ctx);
      }
      const run = this.save.autobattler!.run!;
      const candidates = run.heroes.map((hero) => ({ hero: autobattlerHeroState(hero, run, this.ctx), stars: autobattlerStars(hero) }));
      const viewed: SaveState = { ...this.save, heroes: candidates.map((c) => c.hero), squad: run.squad, inventory: { items: [] } };
      const rated = [...candidates].sort((a, b) => heroPower(b.hero, this.ctx) * cfg.starMultiplier[b.stars - 1] - heroPower(a.hero, this.ctx) * cfg.starMultiplier[a.stars - 1]);
      let selected = rated.slice(0, cfg.training[run.training].capacity);
      for (const role of ['tank', 'healer'] as const) {
        if (selected.some((c) => heroRole(c.hero, this.ctx) === role)) continue;
        const incoming = rated.find((c) => heroRole(c.hero, this.ctx) === role);
        const outgoing = [...selected].reverse().find((c) => heroRole(c.hero, this.ctx) === 'damage' || heroRole(c.hero, this.ctx) === 'support');
        if (incoming && outgoing) selected = selected.map((c) => c === outgoing ? incoming : c);
      }
      const arranged = autoFormation({ ...viewed, heroes: selected.map((c) => c.hero) }, this.ctx);
      this.save = setAutobattlerSquad(this.save, arranged, this.ctx);
      const out = fightAutobattlerRound(this.save, this.day, this.ctx);
      this.step('events', out.save);
      this.spendTime(out.result.duration * 500 + 5000);
      this.actions.push({ kind: 'arena_round', target: String(out.round), wins: out.won ? 1 : 0 });
      if (out.ended) break;
    }
  }

  /** Кандидаты на замену одной позиции; уровни для реального боя оплачиваются возвратом и actLevelUp. */
  candidateSquads(): (string | null)[][] {
    const current = [...this.save.squad];
    const currentHeroes = current.flatMap((id) => this.save.heroes.filter((h) => h.id === id));
    const templates = new Set(currentHeroes.map((h) => h.templateId));
    const level = currentHeroes.length ? Math.floor(currentHeroes.reduce((n, h) => n + h.level, 0) / currentHeroes.length) : 1;
    const best = Object.keys(this.ctx.content.heroes).map((id) => this.save.heroes.filter((h) => h.templateId === id).sort((a, b) => rarityIndex(b.rarity) - rarityIndex(a.rarity) || b.level - a.level)[0]).filter((h): h is HeroState => !!h && !templates.has(h.templateId));
    best.sort((a, b) => heroPower({ ...b, level: Math.min(level, this.ctx.cards.rarities.find((r) => r.id === b.rarity)!.maxLevel) }, this.ctx) - heroPower({ ...a, level: Math.min(level, this.ctx.cards.rarities.find((r) => r.id === a.rarity)!.maxLevel) }, this.ctx));
    const weakest = [...currentHeroes].sort((a, b) => heroPower(a, this.ctx, this.save) - heroPower(b, this.ctx, this.save));
    const variants: (string | null)[][] = [];
    for (const incoming of best.slice(0, 3)) {
      for (const outgoing of weakest.slice(0, 2)) {
        const changed = current.map((id) => id === outgoing.id ? incoming.id : id);
        variants.push(arrangeSquad(setSquad(this.save, changed), this.ctx));
      }
    }
    // Контроль фокуса первых атак: поменять фронт, затем два места дальнего боя.
    for (const [a, b] of [[0, 1], [2, 4], [3, 4]]) {
      const changed = [...current];
      [changed[a], changed[b]] = [changed[b], changed[a]];
      if (changed.some((id, i) => id !== current[i])) variants.push(changed);
    }
    return variants;
  }

  applyCandidate(squad: (string | null)[]): void {
    this.save = setSquad(this.save, squad);
    this.returnBenchTraining();
    // levelSquad пересобирает состав: здесь сохраняем именно проверяемый вариант.
    const expected = [...squad];
    for (let guard = 0; guard < 1000; guard++) {
      const available = expected.flatMap((id) => this.save.heroes.filter((h) => h.id === id)).filter((h) => this.ctx.cards.rarities.find((r) => r.id === h.rarity)!.maxLevel > h.level).sort((a, b) => a.level - b.level);
      if (!available.length) break;
      const hero = available[0];
      if (!levelUpInfo(this.save, hero.id, this.ctx).canLevel) break;
      this.step('heroes', actLevelUp(this.save, this.day, hero.id, this.ctx).save);
      this.candidateLevelUps++;
      this.spendTime(this.model.levelUpSec * 1000);
    }
    this.save = setSquad(this.save, expected);
    this.transferBenchGear();
    this.focusSquad();
    this.insertMvpCards();
  }

}
