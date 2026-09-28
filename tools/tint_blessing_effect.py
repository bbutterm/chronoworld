#!/usr/bin/env python3
"""Grade captured EF_BLESSING cyan light to Chronoworld's gold blessing palette.

Input is the lossless RGBA atlas built from the authentic EffectViewer frames.
Run once on a freshly built sheet; the operation is not idempotent.
"""
import colorsys
from pathlib import Path
from typing import cast
from PIL import Image

PATH = Path(__file__).resolve().parents[1] / 'assets/effects/fx_job_acolyte_blessing.png'
im = Image.open(PATH).convert('RGBA')
for y in range(im.height):
    for x in range(im.width):
        r, g, b, a = cast(tuple[int, int, int, int], im.getpixel((x, y)))
        if a == 0:
            continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        # Retain neutral white sparkle cores; only cyan-blue halo is recolored.
        if .46 <= h <= .73 and s > .12:
            nr, ng, nb = colorsys.hsv_to_rgb(.115, min(.86, max(.48, s)), v)
            im.putpixel((x, y), (round(nr * 255), round(ng * 255), round(nb * 255), a))
im.save(PATH, optimize=True)
print(PATH, im.size)
