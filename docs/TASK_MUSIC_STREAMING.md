# Task: stream music instead of decoding the whole track into memory

Owner-approved task (2026-09-29). Do it together with (or right after) hooking up the music from `docs/RO_SCRO_IMPORT.md`, step 6.

## Why

`src/game/audio.ts` loads the owner's track via `fetch` → `decodeAudioData` → `AudioBuffer` and loops it
(`AudioBufferSourceNode.loop`). An AudioBuffer holds uncompressed PCM: 48 kHz × 2 channels × 4 bytes ≈ **0.38 MB per second**.
The RO tracks from `raw/ro-build/audio` are 98–273 s long, so one track takes 37–105 MB (Prontera, `home`, ≈ 105 MB).
`keepRecentMusic` keeps two tracks, and during a crossfade the old one is still playing — up to ~200 MB of audio alone,
which is too much for Telegram Mini App on weak phones (the WebView gets killed or the tab reloads).
The cache and the comment "~1.5 МБ на петлю" were written for the synthesized placeholders (10–35 s loops), not for real tracks.

## What to do

Play **music and ambience from files** (`assets/audio/music_*`, `amb_*`) in streaming mode:
`HTMLAudioElement` → `ctx.createMediaElementSource(el)` → the track's `GainNode` → the same bus (`bus.duck` for music,
`bus.sfx` for ambience). The browser decodes the file in chunks; memory is a few MB whatever the track length.
Everything else stays as it is:
- sound effects (`sfx`) — `AudioBuffer` as now (they are short, instant start matters);
- synthesized placeholders for music and ambience (no file) — `AudioBuffer` as now;
- category volumes, ducking under stingers (`duck`), `FADE_S` crossfade, `wantMusic`/`wantAmb`,
  choosing OGG/M4A/MP3 via `fileUrl` — the behaviour visible to the player does not change.

## Implementation notes (file `src/game/audio.ts`)

1. `Track` becomes one of two kinds: `{ kind: 'buffer', src: AudioBufferSourceNode }` or
   `{ kind: 'stream', el: HTMLAudioElement, node: MediaElementAudioSourceNode }`, plus the shared `id` and `gain`.
2. In `music()` / `ambience()`: if `files.map(fileUrl).find(Boolean)` exists and the key is not in `FILES_FAILED` → `startStream`,
   otherwise the current path with `buffer()` and the synth placeholder. A file track must not go through `load()`/`decodeAudioData`.
3. `startStream(key, url, gain, bus)`: `const el = new Audio(url); el.loop = true; el.preload = 'auto';`
   `node = ctx.createMediaElementSource(el)` → `GainNode` (fade in over `FADE_S`, as in `startTrack`) → `bus`; `el.play()`.
   One element can be attached to `createMediaElementSource` only once — a new element for every start.
   Same origin (assets from the same domain), so `crossOrigin` is not needed; if assets move to a CDN — `el.crossOrigin = 'anonymous'`
   and CORS on the CDN, otherwise Web Audio gets silence.
4. `el.play()` returns a promise; before the first touch it is rejected (autoplay). Remember the pending element and call `play()`
   again inside the existing `unlock` (pointerup/touchend handler in `installAudio`).
5. The file failed (`el.onerror`, or `play()` rejected not because of autoplay) → `FILES_FAILED.add(key)` and fall back to the synth placeholder,
   as `load()` does now. Keep the warning text in the log in the same style.
6. `stopTrack` for a stream: fade to 0 over `FADE_S`, then `el.pause()`, `el.removeAttribute('src')`, `el.load()` (releases the decoder and
   network), `node.disconnect()`, `gain.disconnect()`. Do not leave elements hanging: a stopped track must not hold any references.
7. `setMuted` (tab hidden / Telegram minimized): `ctx.suspend()` does not stop the element itself — it keeps decoding and draining
   the battery. Pause the current music and ambience streams on mute (`el.pause()`), resume them on unmute (`el.play()`),
   they continue from the same place.
8. `keepRecentMusic` — only for buffer tracks (placeholders); music from files is not cached (the browser HTTP cache is enough
   for a repeated start). Fix the comment about memory.
9. The loop seam: the RO files are prepared for looping (silence trimmed, 3 ms fades at the ends). `el.loop = true` on
   Chrome/Android loops almost seamlessly; Safari (iOS) may leave a pause of tens to hundreds of ms. If the pause is noticeable on iOS —
   make the loop from two elements of the same track: 0.3 s before the end (`timeupdate`/`currentTime`) start the second
   from 0 and crossfade over 0.3 s, then swap roles. Do this only if the check on iPhone shows a pause.
10. `stats()`: add the number of live stream elements (`streams`) and make sure `buffers` does not contain `music:`/`amb:` keys of file tracks —
    this is used by the tests and `window.__audio` in dev.

## Tests (`tests/game-audio.test.ts`, vitest without Web Audio)

- Extract the choice "file → stream, no file / file failed → buffer placeholder" into a pure function and test it.
- With a fake `AudioContext` (only `createGain`, `createMediaElementSource`, `createBufferSource`, `decodeAudioData` as spies) and a fake
  `Audio`: music with a file does not call `decodeAudioData` and does not end up in `buffers`; changing music `home → battle_meadow → home`
  ×10 leaves ≤ 1 live stream element after the fade; mute pauses the element and unmute resumes it; a file error → placeholder.
- The existing tests (placeholders, "all together — little memory", "the whole battle log plays without sound") must stay green,
  tests must not be weakened (CLAUDE.md).

## Checks before the PR

1. `npm run check`, `npm run build`, `npm run e2e` (e2e opens screens with music).
2. In dev (Chrome): `window.__audio.stats()` after switching Home ↔ Battle ×10 — `buffers` has no music keys, `streams` ≤ 2
   during a fade and 1 after. In DevTools → Performance monitor / `chrome://media-internals`: players are released.
3. By hand in Telegram on Android and iPhone: music starts after the first touch, switches smoothly,
   goes quiet when Telegram is minimized and resumes where it stopped, the "Музыка" volume and the "Без звука" switch work,
   the loop seam can barely be heard. If there is a pause on iOS — step 9.
4. Record the result (memory before/after, whether the seam is audible on iOS) in `docs/qa/` or `docs/PROGRESS.md`.

## Docs

Update `docs/design/audio.md` (how music plays and why it streams), the audio section in `docs/AGENTS.md`,
and the header comment of `src/game/audio.ts`. In `docs/RO_SCRO_IMPORT.md` the note about memory refers to this task.
