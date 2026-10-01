"""Контактный лист кадров для просмотра: python3 promo/src/contact.py <out.png> <файлы…> (подписи — имена файлов)."""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

out, files = sys.argv[1], sys.argv[2:]
W, H = 270, 480
cols = min(6, len(files))
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W, rows * (H + 18)), (20, 20, 20))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((W, H))
    x, y = (i % cols) * W, (i // cols) * (H + 18)
    sheet.paste(im, (x, y + 18))
    d.text((x + 3, y + 3), Path(f).stem[-40:], fill=(255, 220, 120))
sheet.save(out)
