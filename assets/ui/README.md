# Battle UI: Kenney RPG Expansion (CC0)

[Original pack](https://kenney.nl/assets/ui-pack-rpg-expansion) · bundled [license](KENNEY_LICENSE.txt) · [atlas](kenney_uipack_rpg_sheet.png) · [atlas XML](kenney_uipack_rpg_sheet.xml) · [manifest](manifest.json).

15 actual transparent PNGs: the original 512×512 atlas; four 256×18 HP/energy/background bars, three 200×200 squad-slot states, five 190×49 buttons (including `ui_button_speed.png` = 1× and `ui_button_speed_2x.png` = 2×), two 900×400 Russian-language result panels. `manifest.json` lists 9-slice pixel insets for bars, buttons and panels. Keep corners intact and stretch the middle; use a clipping mask over HP/energy bars to show the current percentage. Button speed labels represent states, not clickable logic.

These are clean reusable components but use Kenney's simpler UI style, not native Ragnarok GUI graphics. No battle screen or gameplay code exists in this repository; visual fit/FPS in the running game has not been tested. Regenerate using `python tools/build_ui.py` (Pillow + requests). The source archive SHA-256 and license are checked before export; cached ZIP is outside this repository.
