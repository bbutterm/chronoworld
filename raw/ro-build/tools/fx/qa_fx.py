"""QA preview for a delivery part: per effect, frames 0 / mid / last over dark and light backgrounds with a
reference monster (orc_warrior idle, x1) standing at the effect anchor. Part 2 adds the current main sheet's
middle frame first, for comparison.

  python3 qa_fx.py --part N [--root /root/ro-client-extraction-2/fxwork]
Writes <root>/out/p<N>/qa/effects_<k>.png (9 effects per image).
"""
import argparse, json, os
from PIL import Image, ImageDraw

SPR = '/root/ro-client-extraction-2/staging/ro-extract/assets'
TILE = 300


def reference():
    frag = json.load(open(f'{SPR}/sprites/sprites.fragment.json'))
    s = next(x for x in frag['sprites'] if x['id'] == 'orc_warrior')
    (cw, ch), anchor = frag['classes'][s['class']]['cell'], frag['classes'][s['class']]['anchor']
    return Image.open(f"{SPR}/{s['file']}").convert('RGBA').crop((0, 0, cw, ch)), anchor


def frame_of(sheet_path, e, fi):
    sheet = Image.open(sheet_path).convert('RGBA')
    cw, ch = e['cell']; rr, cc = divmod(fi, e['columns'])
    return sheet.crop((cc * cw, rr * ch, (cc + 1) * cw, (rr + 1) * ch))


def tile(frame, e, ref, ranchor, bg, with_ref):
    t = Image.new('RGBA', (TILE, TILE), bg + (255,))
    fx, fy = TILE // 2, int(TILE * 0.72)
    if with_ref:
        t.alpha_composite(ref, (fx - ranchor[0], fy - ranchor[1]))
    cw, ch = e['cell']; k = 1.0
    if max(cw, ch) > TILE * 1.6:
        k = TILE * 1.6 / max(cw, ch)
        frame = frame.resize((max(1, int(cw * k)), max(1, int(ch * k))), Image.NEAREST)
    ax, ay = e['anchor']
    big = Image.new('RGBA', (TILE * 5, TILE * 5))
    big.alpha_composite(frame, (int(TILE * 2 + fx - ax * k), int(TILE * 2 + fy - ay * k)))
    t.alpha_composite(big.crop((TILE * 2, TILE * 2, TILE * 3, TILE * 3)))
    return t.convert('RGB'), k < 1


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--part', type=int, required=True)
    ap.add_argument('--root', default='/root/ro-client-extraction-2/fxwork'); a = ap.parse_args()
    out = f'{a.root}/out/p{a.part}'
    frag = json.load(open(f'{out}/effects.fragment.json'))
    main_fx = {e['id']: e for e in json.load(open(f'{a.root}/main/assets/effects/effects.json'))['effects']}
    ref, ranchor = reference()
    os.makedirs(f'{out}/qa', exist_ok=True)
    effects = frag['effects']; role = {r.get('id'): r['role'] for r in frag['results']}
    cols = 7 if a.part == 2 else 6
    for k0 in range(0, len(effects), 9):
        chunk = effects[k0:k0 + 9]
        img = Image.new('RGB', (TILE * cols, 24 + TILE * len(chunk)), (90, 90, 90)); d = ImageDraw.Draw(img)
        d.text((6, 6), ('main mid | ' if a.part == 2 else '') + 'scRO frames 0 / mid / last on dark+light; orc_warrior x1 at anchor', fill=(255, 255, 0))
        for row, e in enumerate(chunk):
            with_ref = role.get(e['id']) != 'projectile'
            c0 = 0
            if a.part == 2 and e['id'] in main_fx:
                m = main_fx[e['id']]
                t, _ = tile(frame_of(f"{a.root}/main/assets/{m['file']}", m, m['frames'] // 2), m, ref, ranchor, (32, 32, 40), with_ref)
                img.paste(t, (0, 24 + row * TILE)); c0 = 1
            scaled = False
            for j, fi in enumerate([0, e['frames'] // 2, e['frames'] - 1]):
                fr = frame_of(f"{out}/assets/{e['file']}", e, fi)
                for b, bg in enumerate([(32, 32, 40), (200, 200, 190)]):
                    t, sc = tile(fr, e, ref, ranchor, bg, with_ref); scaled |= sc
                    img.paste(t, ((c0 + j * 2 + b) * TILE, 24 + row * TILE))
            d.text((4, 28 + row * TILE), f"{e['id']} RO {e['source']['roEffectId']} {e['cell'][0]}x{e['cell'][1]}x{e['frames']} {e['attach']}"
                   + (' (view scaled down)' if scaled else ''), fill=(255, 255, 255))
        img.save(f'{out}/qa/effects_{k0 // 9}.png')
        print(f'{out}/qa/effects_{k0 // 9}.png', img.size)


if __name__ == '__main__':
    main()
