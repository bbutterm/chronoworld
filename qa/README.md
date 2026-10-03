# Synthetic expedition art and Monk QA preview, never merge

Base: 58df659c41cb2dd29cac3adddf27737386ab0cd8.
Only qa.html, qa/ files and the Vite multi-page input differ from the base. Game source, gameplay data, assets and the normal index.html are unchanged.

Use the isolated QA origin only. On qa.html, explicitly tick the synthetic-save acknowledgement, load the fixture, then use the normal game link. The fixture goes through the ordinary deserialize and commit application API. No browser hidden-state injection, production account access or save mutation on the shared test origin is used.

Verify all ten cards on first entry, warm re-entry, duration-driven scene restart, expedition-send restart and scrolling. This is rendering/regression evidence only, not normal-play or balance evidence. Return to qa.html only to inspect the saved synthetic summary or deliberately initialize a new case.

Use scenarios sequentially because all tabs of this QA origin share the same disposable save. Close game tabs before loading a different fixture.
