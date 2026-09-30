"""Effect sprites (data/sprite/이팩트/*.spr + .act) -> effect sheets in the game format, appended to a part fragment.

  python3 build_spr_fx.py --part 5 [--root /root/ro-client-extraction-2/fxwork]

Action 0, every frame, native ACT timing and x1 pixels (our SPR/ACT renderer, tools/ro_spr_act.py); anchor = ACT origin,
which the RO client places at the target's feet. SPR pixels carry real alpha, so blend "normal" is exact here.
"""
import argparse, json, math, os
from PIL import Image
from grf import GRF
from ro_spr_act import Spr, Act, render_frame, bbox_rel

# key, role, sprite name in data/sprite/이팩트/, suggested RO skill (None = exact RO match)
JOBS = [('job_alchemist_demonstration', 'ground', '데몬스트레이션', None),   # AM_DEMONSTRATION groundEffectId 302 -> SPR
        ('mob_boss1_quake', 'ground', '어스퀘이크', 'NPC_EARTHQUAKE')]       # NPC_EARTHQUAKE 666 -> SPR
ATTACH = {'hit': 'target', 'debuff': 'target', 'buff': 'target', 'cast': 'caster', 'ground': 'ground'}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--part', type=int, default=5)
    ap.add_argument('--root', default='/root/ro-client-extraction-2/fxwork'); a = ap.parse_args()
    out = f'{a.root}/out/p{a.part}'; fx_dir = f'{out}/assets/effects'; os.makedirs(fx_dir, exist_ok=True)
    frag_p = f'{out}/effects.fragment.json'
    frag = json.load(open(frag_p)) if os.path.exists(frag_p) else dict(schema=1, part=a.part, effects=[], skills={}, suggestedSkills={}, results=[])
    g = GRF()
    for key, role, name, suggested in JOBS:
        base = f'data\\sprite\\이팩트\\{name}'
        spr, act = Spr(g.read(base + '.spr')), Act(g.read(base + '.act'))
        frames = [render_frame(spr, f) for f in act.actions[0]]
        boxes = [bbox_rel(*f) for f in frames if f[0] is not None]
        x0 = min(b[0] for b in boxes) - 2; y0 = min(b[1] for b in boxes) - 2
        x1 = max(b[2] for b in boxes) + 2; y1 = max(b[3] for b in boxes) + 2
        cw, ch = x1 - x0 + (x1 - x0) % 2, y1 - y0 + (y1 - y0) % 2
        cols = max(1, min(8, 2048 // cw, len(frames))); rows = math.ceil(len(frames) / cols)
        sheet = Image.new('RGBA', (cols * cw, rows * ch))
        for i, (img, ox, oy) in enumerate(frames):
            if img is None:
                continue
            r, c = divmod(i, cols)
            sheet.alpha_composite(img, (c * cw - x0 - ox, r * ch - y0 - oy))
        fx_id = f'fx_{key}'
        sheet.save(f'{fx_dir}/{fx_id}.png', optimize=True)
        entry = {'id': fx_id, 'file': f'effects/{fx_id}.png', 'cell': [cw, ch], 'columns': cols, 'frames': len(frames),
                 'ms': act.delay_ms(0), 'loop': False, 'delayMs': 0, 'blend': 'normal', 'anchor': [-x0, -y0], 'attach': ATTACH[role],
                 'source': {'roEffectId': f'sprite {name}', 'renderer': 'tools/ro_spr_act.py (SPR+ACT, action 0, native x1)',
                            'scale': 1, 'note': f'scRO client data/sprite/이팩트/{name}.spr/.act'}}
        frag['effects'] = [e for e in frag['effects'] if e['id'] != fx_id] + [entry]
        if suggested:
            frag.setdefault('suggestedSkills', {}).setdefault(key, {'roSkill': suggested})[role] = fx_id
        else:
            frag.setdefault('skills', {}).setdefault(key, {})[role] = fx_id
        frag['results'] = [r for r in frag['results'] if r.get('id') != fx_id] + [dict(key=key, role=role, ro=f'sprite {name}', id=fx_id,
                           status='built', frames=len(frames), cell=[cw, ch], sheet=list(sheet.size))]
        print(fx_id, len(frames), [cw, ch], sheet.size, entry['ms'], 'ms')
    json.dump(frag, open(frag_p, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
