# Synthetic Tower UI acceptance scenarios

These fixtures are synthetic, created offline with the exact PR132 core and balance-player helper. They are not an ordinary-playthrough achievement or balance evidence. Load only with an explicitly labelled control on the isolated QA preview. Never import into production or silently into a live account.

After loading a fixture, enter the game, select Adventures, then Tower. For persistence checks reload the game normally and reopen Tower. Do not press the loader again during a persistence check, because that intentionally resets the fixture.

## 1. cap3-four-choices

Initial deck: golden_bug, baphomet, mistress, pupa, deviruchi. MVP 3/3. Offers: osiris, orc_hero, dark_lord, drake. Two rerolls remain.

- Verify all four options, reroll, and Keep are readable and reachable at the normal desktop viewport, then at a phone-size viewport if supported.
- Click Osiris. Verify comparison UI appears, all three current MVP replacement choices are available, and confirmation is disabled until an outgoing MVP is selected.
- Select Golden Bug. Inspect lost/gained family and effect descriptions. Press Back. Verify original four offers are restored and current deck remains unchanged.
- Reload normally and reopen Tower. The offer should still be pending and the original five-card deck unchanged.
- Enter comparison again, choose Golden Bug, confirm. Exactly Golden Bug leaves and Osiris enters; Pupa and Deviruchi remain, MVP stays 3/3. Reload and verify accepted deck persisted with no pending repeat.
- Reload the fixture for a separate Keep test. Click Keep. Verify original deck unchanged and offer resolved; reload and verify no repeat offer.
- Optional reroll test: reinitialize fixture, reroll once, then Keep. Deck stays intact; rerolls decrease to one and do not refund after reload.

## 2. scribe-event-cap3

Same deck, event pending is Scribe.

- Verify event promises replacement of an MVP and explicitly preserves Deviruchi.
- Choose replacement option. It should create a pending draft, not remove Deviruchi or an MVP immediately.
- Back from comparison, reload normally, inspect preservation. Then Keep: all original cards remain and event reward resolves.

## 3. scribe-pending-cap3

Prepared through resolveTowerEvent; four MVP options are then intentionally substituted for deterministic maximum-layout coverage. Source escrow is Deviruchi, mode mvpReplacement.

- Inspect comparison preservation wording for Deviruchi.
- Replace Golden Bug with Osiris. Only the selected MVP is charged. Deviruchi remains. MVP count stays three.
- Independent Back/Keep/reload check must preserve Deviruchi and all three MVPs before commit.

## 4. osiris-first-acquisition

At cap with one fallen hero; Osiris immediate acquisition effect has not been consumed.

- Open Osiris comparison, select Golden Bug, Back. Fallen status must remain unchanged.
- Confirm the replacement. Fallen hero revives, consumedImmediateCards gains Osiris, and incoming MVP is committed exactly once.
- Reload normally: revival remains applied once, draft is resolved.

## 5. osiris-already-spent

Same fallen setup, but consumedImmediateCards already contains Osiris.

- Comparison should explicitly say acquisition revival is already used. It must still describe the separate once-per-battle revive effect.
- Confirm replacement. Fallen hero remains fallen, while Osiris is in the deck and its combat revive effect remains available.
- Reload: no delayed or repeated acquisition revival.

## 6. empty-exchange-pool

Pending synthetic exhausted exchange for Deviruchi.

- Verify a clear exhausted message, no unusable reroll, and explicit Keep available.
- Keep preserves all cards including Deviruchi and resolves pending state.

## 7. legacy-over-cap

Legacy run has no draftRules; it starts with four MVPs and offers another.

- Verify no new cap is retroactively enforced. Legacy selection behavior remains available.
- This fixture tests compatibility behavior only, not the new cap UI.

## Evidence boundaries

Screenshots and actions on these fixtures verify rendering and UI state transitions only. Earlier natural preview playthrough separately verified chapter 1 completion, Tower unlock, floor-5 three-choice draft, Keep persistence, and a run ending at floor 10. Phone layout, four-choice layout, cap replacement, and Scribe/Osiris browser flows require the synthetic checks above before claiming them verified.
