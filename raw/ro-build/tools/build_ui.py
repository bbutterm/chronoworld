"""Item icons / collection art / illustrations (BMP, magenta key) -> PNG, damage-number
atlases from SPR, and NPC stance + portrait sheets. Reads staging/ro-extract/raw/ro only."""
import csv, json, os
import numpy as np
from PIL import Image
from ro_spr_act import Spr, Act, render_frame, bbox_rel
from build_sheets import save_png

ROOT = '/root/ro-client-extraction-2/staging/ro-extract'
RAW = os.path.join(ROOT, 'raw', 'ro')
ASSETS = os.path.join(ROOT, 'assets')


def bmp_to_png(src, dst):
    im = Image.open(src).convert('RGBA')
    a = np.asarray(im).copy()
    key = (a[:, :, 0] >= 0xFE) & (a[:, :, 1] <= 0x03) & (a[:, :, 2] >= 0xFE)   # RO magenta key #FF00FF
    a[key] = 0
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    save_png(Image.fromarray(a, 'RGBA'), dst)
    return im.size, int(key.sum())


def items():
    out = []
    with open(os.path.join(ROOT, 'raw', 'manifest.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if r['group'] != 'item':
                continue
            our_id, _, item_id = r['note'].partition(' item_db ')
            kind = 'icons' if '\\item\\' in r['source'] else 'collection'
            size, keyed = bmp_to_png(os.path.join(ROOT, r['output']), os.path.join(ASSETS, 'ui', kind, f'item_{our_id}.png'))
            out.append(dict(id=our_id, itemDb=int(item_id), kind=kind, source=r['source'], size=list(size),
                            file=f'ui/{kind}/item_{our_id}.png', transparentPixels=keyed))
    return out


def atlas(name, spr, act=None):
    """Horizontal strip of raw SPR frames (1 px gap) + Phaser JSON-hash atlas."""
    imgs = [(i, Image.fromarray(spr.image(i, 0).astype(np.uint8), 'RGBA')) for i in range(len(spr.indexed))]
    imgs += [(f'rgba{i}', Image.fromarray(spr.image(i, 1).astype(np.uint8), 'RGBA')) for i in range(len(spr.rgba))]
    w = sum(im.size[0] + 1 for _, im in imgs) + 1
    h = max(im.size[1] for _, im in imgs) + 2
    sheet = Image.new('RGBA', (w, h)); frames = {}; x = 1
    for key, im in imgs:
        sheet.alpha_composite(im, (x, 1))
        frames[f'{name}_{key}'] = dict(frame=dict(x=x, y=1, w=im.size[0], h=im.size[1]), rotated=False, trimmed=False,
                                       spriteSourceSize=dict(x=0, y=0, w=im.size[0], h=im.size[1]),
                                       sourceSize=dict(w=im.size[0], h=im.size[1]))
        x += im.size[0] + 1
    d = os.path.join(ASSETS, 'fx', 'damage'); os.makedirs(d, exist_ok=True)
    save_png(sheet, os.path.join(d, f'{name}.png'))
    meta = dict(image=f'{name}.png', size=dict(w=w, h=h), scale='1')
    if act is not None:
        meta['act'] = [[{'layers': [(L['idx'], L['x'], L['y'], L['mirror']) for L in fr['layers']],
                         'delayMs': act.delay_ms(a)} for fr in frames_] for a, frames_ in enumerate(act.actions)]
    with open(os.path.join(d, f'{name}.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(frames=frames, meta=meta), f, ensure_ascii=False, indent=1)
    return len(imgs)


def damage():
    E = os.path.join(RAW, 'sprite', 'effect')
    rd = lambda n: open(os.path.join(E, n), 'rb').read()
    res = {}
    res['numbers'] = atlas('numbers', Spr(rd('숫자.spr')), Act(rd('숫자.act')))
    res['msg'] = atlas('msg', Spr(rd('msg.spr')), Act(rd('msg.act')))
    res['bluemsg'] = atlas('bluemsg', Spr(rd('bluemsg.spr')))     # client has no bluemsg.act; frames match msg.act
    return res


NPC_CELL, NPC_ANCHOR, NPC_COLS = (240, 224), (100, 120), 8


def npcs():
    D = os.path.join(RAW, 'sprite', 'npc'); out = []
    for fn in sorted(os.listdir(D)):
        if not fn.endswith('.spr'):
            continue
        name = fn[:-4]
        spr = Spr(open(os.path.join(D, fn), 'rb').read()); act = Act(open(os.path.join(D, name + '.act'), 'rb').read())
        rows = [('idle_s', 0), ('idle_e', 6)] + ([('walk_s', 8), ('walk_e', 14)] if len(act.actions) >= 16 else [])
        (cw, ch), (ax, ay) = NPC_CELL, NPC_ANCHOR
        sheet = Image.new('RGBA', (cw * NPC_COLS, ch * len(rows))); info = {}
        for r, (anim, a) in enumerate(rows):
            frames = act.actions[a][:NPC_COLS]; boxes = []
            for c, fr in enumerate(frames):
                img, ox, oy = render_frame(spr, fr)
                if img is None:
                    boxes.append(None); continue
                sheet.alpha_composite(img, (c * cw + ax - ox, r * ch + ay - oy)); boxes.append(bbox_rel(img, ox, oy))
            info[anim] = dict(action=a, frames=len(frames), sourceFrameCount=len(act.actions[a]), delayMs=act.delay_ms(a), sourceFrameBboxes=boxes)
        d = os.path.join(ASSETS, 'sprites', 'npcs'); os.makedirs(d, exist_ok=True)
        save_png(sheet, os.path.join(d, name + '.png'))
        # portrait: 64x64 x1 head-and-shoulders from idle (south) frame 0
        img, ox, oy = render_frame(spr, act.actions[0][0]); b = bbox_rel(img, ox, oy)
        cx = (b[0] + b[2]) // 2 + ox; top = b[1] + oy
        por = Image.new('RGBA', (64, 64)); por.alpha_composite(img.crop((cx - 32, top - 2, cx + 32, top + 62)))
        pd = os.path.join(ASSETS, 'sprites', 'portraits'); os.makedirs(pd, exist_ok=True)
        save_png(por, os.path.join(pd, f'npc_{name}.png'))
        out.append(dict(id=f'npc_{name}', file=f'sprites/npcs/{name}.png', portrait=f'sprites/portraits/npc_{name}.png',
                        cell=list(NPC_CELL), anchor=list(NPC_ANCHOR), columns=NPC_COLS, rows=[r for r, _ in rows], anims=info,
                        actions=len(act.actions), sounds=act.sounds))
    size, _ = bmp_to_png(os.path.join(RAW, 'texture', 'illust', 'kafra_01.bmp'), os.path.join(ASSETS, 'ui', 'illust', 'kafra_01.png'))
    return out, size


def main():
    it = items()
    dm = damage()
    np_, ill = npcs()
    with open(os.path.join(ASSETS, 'ui_fx_npc.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(items=it, damage=dm, npcs=np_, illust=dict(file='ui/illust/kafra_01.png', size=list(ill))), f, ensure_ascii=False, indent=1)
    print('items', len(it), 'damage', dm, 'npcs', [(n['id'], n['rows'], n['actions']) for n in np_], 'illust', ill)
    bad = [i for i in it if i['kind'] == 'icons' and i['size'] != [24, 24]]
    print('non-24x24 icons:', [(b['id'], b['size']) for b in bad])


if __name__ == '__main__':
    main()
