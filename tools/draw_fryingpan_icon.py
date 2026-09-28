#!/usr/bin/env python3
"""Original 24x24 frying-pan skill icon in the game's warm RO-style palette."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'assets/ui/icons/skill_mc_fryingpan.png'
im = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
# Diagonal impact rays behind the pan.
d.polygon([(2, 2), (6, 4), (8, 1), (9, 6), (14, 2), (13, 8),
           (20, 6), (16, 11), (22, 12), (15, 14), (18, 18),
           (11, 16), (7, 21), (6, 15), (1, 15), (5, 11)], fill='#8B4A26')
d.polygon([(3, 3), (7, 6), (9, 3), (10, 8), (16, 5), (14, 10),
           (20, 8), (16, 12), (21, 13), (14, 14), (16, 17),
           (10, 15), (7, 19), (7, 14), (2, 14), (6, 10)], fill='#E5AE67')
for x,y in [(4,5),(10,2),(17,5),(21,10),(4,17),(12,19)]:
    d.point((x,y), fill='#FFF0C1')
# Long iron handle, rim highlights and two attachment rivets.
d.polygon([(12, 12), (14, 10), (23, 19), (23, 22), (20, 22)], fill='#403345')
d.polygon([(14, 11), (15, 10), (23, 18), (23, 20)], fill='#8E8497')
d.line([(17, 13), (22, 18)], fill='#D9C9BA', width=1)
d.polygon([(19, 20), (21, 18), (23, 20), (22, 23)], fill='#241E2D')
# Bowl silhouette: heavy near-black rim, copper underside, cool steel interior.
d.polygon([(2, 7), (4, 4), (8, 3), (13, 5), (16, 8), (15, 12),
           (12, 15), (7, 16), (3, 13), (1, 10)], fill='#4B3335')
d.polygon([(2, 7), (5, 5), (8, 4), (12, 5), (15, 8), (14, 11),
           (11, 14), (7, 15), (4, 13), (2, 10)], fill='#BD774A')
d.polygon([(3, 7), (5, 5), (9, 5), (12, 6), (14, 8), (13, 11),
           (10, 13), (7, 13), (4, 11)], fill='#E9C49E')
d.polygon([(4, 7), (6, 6), (10, 6), (13, 8), (12, 10), (9, 12),
           (6, 11), (4, 9)], fill='#63516A')
d.polygon([(5, 7), (7, 6), (10, 7), (12, 8), (11, 9), (8, 9),
           (5, 9)], fill='#AAA0B5')
d.line([(5, 6), (8, 5), (11, 6)], fill='#FFF3D3')
d.point((6,8), fill='#E7DBD1')
for x,y in [(12,12),(13,11)]:d.point((x,y), fill='#FFF2C2')
OUT.parent.mkdir(parents=True, exist_ok=True)
im.save(OUT, optimize=True)
print(OUT)
