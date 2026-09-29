# Re-capturing skill effects from the scRO client

1. `python3 ro_remote_client.py --port 8765` (needs grf.py; client path CLIENT in grf.py) — local remote client from the GRF.
2. roBrowserLegacy: put `capture-scro.html` and `capture-scro-1600.html` into `applications/browser-examples/`, run
   `npx vite --host 127.0.0.1 --port 5173` (dev server: calibration imports `/src/Renderer/Camera.js`).
3. `npm i playwright@1.58.2` next to `capture_effect.mjs`; a browser: an Electron build (`ELECTRON=.../electron`, under `xvfb-run`)
   or Chrome (`CHROME=...`). Do not run `playwright install` (see CLAUDE.md).
4. `./run_jobs.sh jobs_partN.json <raw>/pN <log>` — resumable; edge-touching effects are re-captured on 1600×1200 at zoom 250/375.
5. `python3 build_fx.py --part N --root <workdir>` (expects `<workdir>/main` = checkout of main, `<workdir>/cap` = these files),
   then `python3 qa_fx.py --part N`.
