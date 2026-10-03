# Synthetic Tower QA preview — never merge

This branch is a test harness layered on exact PR #132 commit `74744a6df40b6784769a95ea94e2b91ffc2f550d`. It is not a feature, cheat entry point for production, or natural-progression/balance evidence. Do not open a merge PR or merge this branch.

Only `qa.html`, `qa/` and the Vite multi-page input addition are permitted differences. Core, game UI, gameplay data, and index.html must remain byte-identical to the base commit.

## Visible browser procedure

1. Use this QA branch's unique preview origin. Do not log in or use a production save.
2. Open `/qa.html`, read the synthetic-save warning and tick the consent box.
3. Click one explicitly labelled `Load synthetic Tower scenario` button. This calls normal application `deserialize` and `commit`; it does not use DevTools or browser automation hidden-state injection.
4. Follow **Открыть игру**, then **Приключения → Башня** in the ordinary game UI.
5. Verify actual visible choices, Back, comparison, keep, confirm, scroll, reload, and narrow/mobile layout.
6. Return to `/qa.html` to inspect the visible saved Tower summary or choose another scenario.

Fixtures cover cap-three/four choices, Scribe event and exchange, fresh and spent Osiris with a fallen hero, exhausted exchange, and an old over-cap run. Fixture assertions verify save decoding, references, squad/floor validity, replacement/keep, Scribe escrow, and Osiris semantics; they do not replace real browser QA.

Stable controls: `qa-consent`, `qa-load-<fixture-id>`, `qa-open-game`, `qa-inspect`, `qa-status`, `qa-summary`.

Build uses the ordinary application build with two HTML inputs. The normal game entry has no import of the QA loader. All synthetic fixtures remain confined to the QA entry bundle.
