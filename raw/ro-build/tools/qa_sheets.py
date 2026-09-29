"""Validate staging sheets with the same rules as chronoworld tools/check_sprites.py
(origin/main 9e5589691) and render QA previews (contact sheet x2 on grey, GIFs)."""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from build_sheets import ANIMS, GRID, expected_indices

ROOT = '/root/ro-client-extraction-2/staging/ro-extract'
ASSETS = os.path.join(ROOT, 'assets')
QA = os.path.join(ROOT, 'qa')


def check(entries):
    errors = []
    fail = errors.append
    for s in entries:
        sid, kind = s['id'], s['class']
        (cw, ch), (ax, ay), columns = GRID[kind]
        with Image.open(os.path.join(ASSETS, s['file'])) as raw:
            if raw.mode not in ('RGBA', 'P'):
                fail(f'{sid} not RGBA/indexed')
            if raw.size != (cw * columns, ch * len(ANIMS)) or max(raw.size) > 2048:
                fail(f'{sid} wrong sheet size {raw.size}'); continue
            img = raw.convert('RGBA')
        used = set()
        for row, (anim, _, n, _) in enumerate(ANIMS):
            chosen = s['sourceFrameIndices'][anim]; total = s['sourceFrameCounts'][anim]
            if anim in s.get('samplingExceptions', {}):
                if any(not 0 <= i < total for i in chosen) or chosen != sorted(chosen):
                    fail(f'{sid}:{anim} exception indices bad {chosen}')
            elif chosen != expected_indices(total, n, anim == 'death'):
                fail(f'{sid}:{anim} sampling differs from spec')
            boxes = []
            for c in range(columns):
                cell = np.asarray(img.crop((c * cw, row * ch, (c + 1) * cw, (row + 1) * ch)))
                ys, xs = np.nonzero(cell[:, :, 3])
                b = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else None
                if c < n:
                    if b is None:
                        fail(f'{sid}:{anim} frame {c} empty'); continue
                    boxes.append(b)
                    if b[0] <= 0 or b[1] <= 0 or b[2] >= cw or b[3] >= ch:
                        fail(f'{sid}:{anim} frame {c} touches cell edge {b}')
                    sb = s['sourceFrameBboxes'][anim][c]
                    if b != (sb[0] + ax, sb[1] + ay, sb[2] + ax, sb[3] + ay):
                        fail(f'{sid}:{anim} frame {c} ACT origin/bbox mismatch {b} vs {sb}')
                    used.update(int(v) for v in np.unique(cell[:, :, 3]) if 0 < v < 255)
                elif b is not None:
                    fail(f'{sid}:{anim} extra nonempty cell {c}')
            if boxes:
                union = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
                if s['bbox'][anim] != union:
                    fail(f'{sid}:{anim} bbox metadata mismatch')
        hit = s['hitFrames'].get('attack', 3)
        if not 0 <= hit < 6:
            fail(f'{sid} invalid hitFrame')
        if used - set(s['sourceAlphaValues']):
            fail(f'{sid} semi-transparent alpha not in source')
    return errors


def previews(entries):
    os.makedirs(os.path.join(QA, 'gif'), exist_ok=True)
    tiles = []
    for s in entries:
        (cw, ch), (ax, ay), columns = GRID[s['class']]
        sheet = Image.open(os.path.join(ASSETS, s['file'])).convert('RGBA')
        row_tiles = []
        for row, (anim, _, n, ms) in enumerate(ANIMS):
            c = n // 2
            row_tiles.append(sheet.crop((c * cw, row * ch, (c + 1) * cw, (row + 1) * ch)))
        tiles.append((s['id'], s['class'], row_tiles, (cw, ch)))
        # GIF: all rows in sequence, grey background, x2 nearest
        frames, durs = [], []
        for row, (anim, _, n, ms) in enumerate(ANIMS):
            for c in range(n):
                cell = sheet.crop((c * cw, row * ch, (c + 1) * cw, (row + 1) * ch))
                bg = Image.new('RGBA', (cw, ch + 14), (128, 128, 128, 255)); bg.alpha_composite(cell, (0, 14))
                d = ImageDraw.Draw(bg); d.text((3, 1), f'{s["id"]} {anim} {c}{" HIT" if anim == "attack" and c == s["hitFrames"]["attack"] else ""}', fill=(255, 255, 255, 255))
                d.line([(ax - 3, ay + 14), (ax + 3, ay + 14)], fill=(255, 0, 0, 255)); d.line([(ax, ay + 11), (ax, ay + 17)], fill=(255, 0, 0, 255))
                frames.append(bg.resize((cw * 2, (ch + 14) * 2), Image.NEAREST).convert('RGB')); durs.append(ms)
        frames[0].save(os.path.join(QA, 'gif', s['id'] + '.gif'), save_all=True, append_images=frames[1:], duration=durs, loop=0)
    # contact sheet: one middle frame per anim, x2 on grey, cells scaled to 128x128 view windows around anchor
    rows = []
    for sid, cls, rt, (cw, ch) in tiles:
        (ax, ay) = GRID[cls][1]
        crops = [t.crop((ax - 80, ay - 140, ax + 80, ay + 30)) for t in rt]   # window around feet, same for all
        rows.append((sid, cls, crops))
    per_col = (len(rows) + 1) // 2
    img = Image.new('RGB', (2 * (180 + 5 * 164), per_col * 176 + 20), (128, 128, 128))
    d = ImageDraw.Draw(img)
    for k, (sid, cls, crops) in enumerate(rows):
        ox = (k // per_col) * (180 + 5 * 164)
        oy = 20 + (k % per_col) * 176
        d.text((ox + 4, oy + 70), f'{sid}\n[{cls}]', fill=(255, 255, 255))
        for j, c in enumerate(crops):
            img.paste(c.convert('RGB'), (ox + 180 + j * 164, oy), c)
    d.text((4, 4), 'idle | walk | attack | hurt | death (middle frame, x1, window 160x170 around ACT origin)', fill=(255, 255, 0))
    img.save(os.path.join(QA, 'contact_sheet.png'))


def main():
    frag = json.load(open(os.path.join(ASSETS, 'sprites', 'sprites.fragment.json'), encoding='utf-8'))
    errs = check(frag['sprites'])
    for e in errs:
        print('FAIL', e)
    print(f"{len(frag['sprites'])} sheets checked, {len(errs)} failures, build errors: {frag['errors']}")
    if '--no-preview' not in sys.argv:
        previews(frag['sprites'])
    sys.exit(1 if errs or frag['errors'] else 0)


if __name__ == '__main__':
    main()
