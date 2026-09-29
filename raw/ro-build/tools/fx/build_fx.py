"""Build game effect sheets from scRO EffectViewer captures, per delivery part.

  python3 build_fx.py --part 1|2|3 [--root /root/ro-client-extraction-2/fxwork]

Capture dirs: <root>/raw/p<N>/<key>__<role>__<roEffect>[__L250|__L375] (see fxwork/cap/run_jobs.sh).
Sheets are built by cap/build_effect_sheet.py in alpha mode (blend "normal", like the sheets already in main)
into <root>/out/p<N>/assets/effects/, on top of a copy of main's effects.json; the part's own entries and
skill mapping go to <root>/out/p<N>/effects.fragment.json.
  part 1: new skill effects; id fx_<skill>[_<role>]; mapped to the skill in the game format (hit|buff|debuff|cast|ground);
          projectiles are atlases only (the game has no travelling-projectile hook yet).
  part 2: the 35 effects already in main, re-captured from scRO under the same id and attach (replacement candidates);
          same post-processing as main (gold grade for Blessing, faint-alpha cleanup where main did it).
  part 3: element cast auras fx_cast_<element> (RO EF_BEGINSPELL*), attach caster; not mapped (runtime wiring by element).
"""
import argparse, colorsys, glob, json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image

ATTACH = {'hit': 'target', 'debuff': 'target', 'buff': 'target', 'cast': 'caster', 'ground': 'ground', 'projectile': 'caster'}
# exact RO correspondences to sheets already in main (no new art needed)
REUSE = {'job_wizard_meteor_storm': {'hit': 'fx_job_mage_fire_bolt'},      # WZ_METEOR hitEffectId 49 = EF_FIREHIT
         'job_mage_energy_coat': {'buff': 'fx_shield'},                     # MG_ENERGYCOAT effectId 169 = fx_shield
         'job_assassin_enchant_poison': {'hit': 'fx_job_thief_envenom'}}    # AS_ENCHANTPOISON effectId 20 = EF_PATTACK
ALPHA_FLOOR = {'fx_magic': 24, 'fx_job_mage_thunderstorm': 25}             # as noted for the main sheets


def edge_touch(raw, thr=6, band=3):
    for f in sorted(glob.glob(f'{raw}/frame_*.png')):
        a = np.asarray(Image.open(f).convert('RGB')).max(2) > thr
        if a[:band].any() or a[-band:].any() or a[:, :band].any() or a[:, -band:].any():
            return True
    return False


def pick_raw(base):
    """Default capture unless it touches the edge; then the smallest zoom-out that fits (or the largest tried)."""
    zoomed = sorted(glob.glob(base + '__L*/meta.json'), key=lambda p: int(p.split('__L')[-1].split('/')[0]))
    if zoomed and edge_touch(base):
        for zm in zoomed:
            if not edge_touch(os.path.dirname(zm)):
                return os.path.dirname(zm), False
        return os.path.dirname(zoomed[-1]), True
    return base, edge_touch(base) if os.path.isdir(base) else False


def loop_period(raw, max_frames=54):
    """Capture hit the --max ceiling with content to the end: the effect loops. Return one cycle length or 0."""
    files = sorted(glob.glob(f'{raw}/frame_*.png'))
    if len(files) < max_frames:
        return 0
    fr = [np.asarray(Image.open(f).convert('L').resize((200, 150)), np.float32) for f in files]
    if fr[-1].max() <= 6:
        return 0
    start = next(i for i, f in enumerate(fr) if f.max() > 6)
    tail = fr[start + 8:]
    best = (1e9, 0)
    for p in range(4, min(40, len(tail) // 2)):
        d = np.mean([np.abs(tail[i] - tail[i + p]).mean() for i in range(len(tail) - p)])
        best = min(best, (d, p))
    base = np.mean([f.mean() for f in tail]) + 1e-3
    return best[1] + 8 if best[0] < 0.25 * base else -24     # continuous without a clean cycle: first 2 s


def grade_blessing(png):
    im = Image.open(png).convert('RGBA'); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if not a:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if .46 <= h <= .73 and s > .12:
                nr, ng, nb = colorsys.hsv_to_rgb(.115, min(.86, max(.48, s)), v)
                px[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
    im.save(png, optimize=True)


def alpha_floor(png, floor):
    a = np.asarray(Image.open(png).convert('RGBA')).copy()
    a[a[:, :, 3] < floor] = 0
    Image.fromarray(a, 'RGBA').save(png, optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--part', type=int, required=True, choices=[1, 2, 3])
    ap.add_argument('--root', default='/root/ro-client-extraction-2/fxwork')
    a = ap.parse_args()
    root, part = a.root, a.part
    jobs = json.load(open(f'{root}/cap/jobs_part{part}.json'))
    raw_dir = f'{root}/raw/p{part}'
    out = f'{root}/out/p{part}'
    repo_fx = f'{out}/assets/effects'
    os.makedirs(repo_fx, exist_ok=True)
    main_doc = json.load(open(f'{root}/main/assets/effects/effects.json'))
    main_by_id = {e['id']: e for e in main_doc['effects']}
    shutil.copyfile(f'{root}/main/assets/effects/effects.json', f'{repo_fx}/effects.json')
    roles = {}
    for k, r, _ in jobs:
        roles.setdefault(k, set()).add(r)
    results = []
    for key, role, eff in jobs:
        base = f'{raw_dir}/{key}__{role}__{eff}'
        raw, clipped = pick_raw(base)
        meta_p = f'{raw}/meta.json'
        if not os.path.exists(meta_p):
            skip = open(base + '.skip').read().strip() if os.path.exists(base + '.skip') else 'not run'
            results.append(dict(key=key, role=role, ro=eff, status='not_captured', reason=f'capture exit {skip}')); continue
        meta = json.load(open(meta_p))
        if meta.get('firstContent', -1) < 0:
            results.append(dict(key=key, role=role, ro=eff, status='empty')); continue
        if part == 1:
            fx_id = f'fx_{key}' if len(roles[key]) == 1 and role != 'projectile' else f'fx_{key}_{role}'
            if fx_id in main_by_id:
                fx_id = f'{fx_id}_{role}'
            attach = ATTACH[role]
        elif part == 2:
            fx_id, attach = key, main_by_id[key]['attach']
        else:
            fx_id, attach = key, 'caster'
        note = f'scRO client; RO effect {eff}; role {role}'
        if role == 'projectile':
            note += '; atlas only: no projectile travel hook in game'
        if part == 2:
            note += '; re-capture of the main sheet from the owner client'
        cycle = loop_period(raw)
        extra = ['--keep', str(abs(cycle))] if cycle else []
        if cycle > 0:
            note += f'; looping in RO: one {cycle}-frame cycle kept'
        elif cycle < 0:
            note += f'; continuous in RO: first {-cycle} frames kept'
        p = subprocess.run([sys.executable, f'{root}/cap/build_effect_sheet.py', '--raw', raw, '--repo', out, '--id', fx_id,
                            '--attach', attach, '--mode', 'alpha', '--note', note] + extra, capture_output=True, text=True)
        if p.returncode:
            results.append(dict(key=key, role=role, ro=eff, id=fx_id, status='build_failed', error=p.stderr.strip()[-300:])); continue
        rep = json.loads(p.stdout.strip().splitlines()[-1])
        png = f'{repo_fx}/{fx_id}.png'
        post = []
        if fx_id == 'fx_job_acolyte_blessing':
            grade_blessing(png); post.append('gold grade (tools/tint_blessing_effect.py logic)')
        if fx_id in ALPHA_FLOOR:
            alpha_floor(png, ALPHA_FLOOR[fx_id]); post.append(f'alpha < {ALPHA_FLOOR[fx_id]} cleared')
        results.append(dict(key=key, role=role, ro=eff, id=fx_id, status='built', raw=os.path.relpath(raw, root),
                            zoom=meta.get('zoom'), frames=rep['entry']['frames'], cell=rep['entry']['cell'], sheet=rep['sheet'],
                            bytes=os.path.getsize(png), thinned=rep['thinned'], clipped=clipped, post=post, loopCycle=cycle,
                            mainFrames=main_by_id[fx_id]['frames'] if fx_id in main_by_id else None))
    doc = json.load(open(f'{repo_fx}/effects.json'))
    built = {r['id'] for r in results if r['status'] == 'built'}
    source_note = 'roBrowserLegacy EffectViewer + scRO GRF via tools/ro_remote_client.py (local remote client)'
    for e in doc['effects']:
        if e['id'] in built:
            e['source']['renderer'] = source_note
            for r in results:
                if r.get('id') == e['id'] and r['post']:
                    e['source']['post'] = r['post']
    skills = {}
    if part == 1:
        for r in results:
            if r['status'] == 'built' and r['role'] != 'projectile':
                skills.setdefault(r['key'], {})[r['role']] = r['id']
        for k, m in REUSE.items():
            skills.setdefault(k, {}).update(m)
        for k, m in skills.items():
            doc['skills'].setdefault(k, {}).update(m)
    json.dump(doc, open(f'{repo_fx}/effects.json', 'w'), ensure_ascii=False, indent=2)
    frag = dict(schema=1, part=part, effects=[e for e in doc['effects'] if e['id'] in built], skills=skills, results=results)
    json.dump(frag, open(f'{out}/effects.fragment.json', 'w'), ensure_ascii=False, indent=1)
    for r in results:
        print(r['status'], r.get('id', r['key']), r['role'], r['ro'], r.get('frames', ''), r.get('cell', ''),
              f"main:{r['mainFrames']}" if r.get('mainFrames') else '', 'CLIPPED' if r.get('clipped') else '',
              f"fit{r['thinned']}->{r['frames']}" if r.get('thinned') else '', f"loop{r['loopCycle']}" if r.get('loopCycle') else '', r.get('reason', ''), r.get('error', ''))


if __name__ == '__main__':
    main()
