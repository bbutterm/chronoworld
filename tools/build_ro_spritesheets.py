#!/usr/bin/env python3
"""Render RO APNG actions into fixed-grid RGBA PNG sprite sheets.

The caller must have rights to the original game art; licenses for renderer code
and rAthena metadata do not grant rights to client artwork. All source downloads
are cached OUTSIDE the repository and only verified derivatives are committed.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import math
import os
from pathlib import Path
import time

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get('CHRONOWORLD_RO_CACHE', '/root/artifacts/chronoworld-art/ro-render-cache'))
BASE = 'https://assets.latam-tools.com.br'
OUT = ROOT / 'assets' / 'ro'
HEROES = [
 ('guard','Crusader',14,'male',251,0),('warrior','Knight',7,'male',5,0),
 ('assassin','Assassin',12,'male',136,0),('archer','Hunter',11,'male',46,0),
 ('mage','Wizard',9,'male',19,0),('priestess','Priest',8,'female',28,0),
 ('blacksmith','Blacksmith',10,'male',None,2),('monk','Monk',15,'male',None,2),
 ('sage','Sage',16,'male',None,2),('rogue','Rogue',17,'male',None,2),
 ('alchemist','Alchemist',18,'male',None,2),('bard','Bard',19,'male',None,2),
]
MOBS = [
 ('melee','Orc Warrior',1023,1),('ranged','Archer Skeleton',1016,1),
 ('tank','Elder Willow',1033,1),('fast','Poring',1002,1),
 ('boss_ch1','Mistress',1059,1),('boss_ch2','Osiris',1038,1),('boss_ch3','Baphomet',1039,1),
 ('armored','Raydric',1163,2),('ambusher','Mimic',1191,2),
 ('flying','Gargoyle',1253,2),('dark_caster','Dark Priest',1198,2),
 ('boss_ch4','Moonlight Flower',1150,2),('boss_ch5','Drake',1112,2),
 ('boss_ch6','Dark Lord',1272,2),
]
# Direction 6 = east/right. Action indexes are validated by decoding real APNGs.
PLAYER_ACTIONS = {'idle': 6, 'ready': 38, 'attack': 46, 'hurt': 54, 'death': 70}
MOB_ACTIONS = {'idle': 6, 'walk': 14, 'attack': 22, 'hurt': 30, 'death': 38}
PNG_MAGIC = b'\x89PNG\r\n\x1a\n'


def fetch(kind, job, action=None, gender=None):
    if kind == 'image':
        params = {'job': job}
        if gender:
            params.update(gender=gender, head=1)
        if action is not None:
            params['action'] = action
        url = str(requests.Request('GET', BASE+'/image', params=params).prepare().url)
        target = CACHE/f'{kind}_{job}_{gender or "monster"}_{action}.png'
    else:
        url = f'{BASE}/icons/skill/{job}.png'
        target = CACHE/f'icon_skill_{job}.png'
    if target.is_file():
        data=target.read_bytes()
        if data.startswith(PNG_MAGIC):
            try:
                im=Image.open(io.BytesIO(data));im.verify()
                return data,url
            except Exception: target.unlink()
    last=None
    for attempt in range(3):
        try:
            r=requests.get(url,timeout=32)
            r.raise_for_status()
            data=r.content
            if not data.startswith(PNG_MAGIC) or len(data)>8_000_000:
                raise ValueError(f'not a bounded PNG: {len(data)} bytes')
            im=Image.open(io.BytesIO(data)); im.verify()
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(data)
            return data,url
        except Exception as e:
            last=e
            if attempt<2: time.sleep(1.5*(attempt+1))
    raise RuntimeError(f'{url}: {last}')


def frames(data):
    im=Image.open(io.BytesIO(data))
    count=getattr(im,'n_frames',1)
    if count<1 or count>64: raise ValueError(f'bad frame count {count}')
    out=[]; durations=[]
    for i in range(count):
        im.seek(i)
        frame=im.convert('RGBA').copy()
        out.append(frame)
        durations.append(round(float(im.info.get('duration',100))))
    if not any(f.getbbox() is not None for f in out):
        raise ValueError('entire action is transparent')
    return out,durations


def atlas(name,kind,job,gender,phase):
    actions=PLAYER_ACTIONS if kind=='hero' else MOB_ACTIONS
    sources={}; urls={}; checksums={}
    def get_one(item):
        label,number=item
        data,url=fetch('image',job,number,gender)
        sequence,durations=frames(data)
        return label,{'frames':sequence,'durations_ms':durations,'action':number},url,hashlib.sha256(data).hexdigest()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for label,seq,url,digest in pool.map(get_one,actions.items()):
            sources[label]=seq;urls[label]=url;checksums[label]=digest
    tile=480 if name.startswith('boss_') else 320
    margin=6
    # Select gameplay scale from the primary standing pose, NOT the widest attack/death FX.
    # Each action row may be downscaled separately to preserve its full effect envelope.
    primary='ready' if kind=='hero' else 'idle'
    normal=sources[primary]['frames']
    widest=max(f.width for f in normal); tallest=max(f.height for f in normal)
    scale=max(1,min((tile-2*margin)//widest,(tile-2*margin)//tallest))
    cols=max(len(v['frames']) for v in sources.values())
    if cols>48:raise ValueError(f'{name}: implausible {cols} columns')
    ordered=list(actions)
    sheet=Image.new('RGBA',(cols*tile,len(ordered)*tile),(0,0,0,0))
    frame_meta={}; nonidentical={}
    for row,label in enumerate(ordered):
        seq=sources[label]
        hashes=[]
        frame_width=max(f.width for f in seq['frames'])
        frame_height=max(f.height for f in seq['frames'])
        action_scale=min(scale,(tile-2*margin)/frame_width,(tile-2*margin)/frame_height)
        if action_scale>=1:action_scale=math.floor(action_scale)
        for col,frame in enumerate(seq['frames']):
            hashes.append(hashlib.sha256(frame.tobytes()).hexdigest())
            scaled=frame.resize((max(1,round(frame.width*action_scale)),max(1,round(frame.height*action_scale))),Image.Resampling.NEAREST)
            # Stable per-action source canvas and shared foot baseline. Do not recrop per frame.
            x=col*tile+(tile-scaled.width)//2
            y=row*tile+tile-margin-scaled.height
            sheet.alpha_composite(scaled,(x,y))
        nonidentical[label]=len(set(hashes))
        frame_meta[label]={'row':row,'frame_count':len(seq['frames']),
                           'duration_ms':seq['durations_ms'],'source_action':seq['action'],
                           'source_url':urls[label],'source_sha256':checksums[label],
                           'scale':action_scale,'distinct_rgba_frames':nonidentical[label]}
    if sheet.getbbox() is None:raise ValueError(f'{name}: blank sheet')
    path=OUT/'sheets'/f'{kind}_{name}.png'
    path.parent.mkdir(parents=True,exist_ok=True)
    sheet.save(path,optimize=True)
    # The still derivative is independently usable at the requested 320/480 size.
    still=sheet.crop((0,0,tile,tile)) if kind=='enemy' else sheet.crop((0,tile, tile,2*tile))
    still_name=(f'enemy_{name}.png' if kind=='enemy' else f'hero_{name}_battle.png')
    still_path=OUT/'stills'/still_name
    still_path.parent.mkdir(parents=True,exist_ok=True)
    still.save(still_path,optimize=True)
    result={'key':name,'kind':kind,'phase':phase,'original_name':name,'source_job_id':job,
            'gender':gender,'sheet':str(path.relative_to(ROOT)),'still':str(still_path.relative_to(ROOT)),
            'canvas_px':[sheet.width,sheet.height],'cell_px':[tile,tile], 'columns':cols,
            'rows':ordered,'scale_nearest_integer':scale,'anchor':'bottom-center; padding 6',
            'source_license':'Original Ragnarok Online art; user states they have repository-use rights',
            'actions':frame_meta}
    if kind=='hero':
        # Sprite-derived bust, not newly illustrated portrait: retain pixel provenance.
        frame=sources['idle']['frames'][0]
        bbox=frame.getbbox()
        upper=frame.crop((bbox[0],bbox[1],bbox[2],bbox[1]+max(1,math.ceil((bbox[3]-bbox[1])*.58))))
        portrait=Image.new('RGBA',(256,256))
        factor=max(1,min(240//upper.width,240//upper.height))
        upper=upper.resize((upper.width*factor,upper.height*factor),Image.Resampling.NEAREST)
        portrait.alpha_composite(upper,((256-upper.width)//2,(256-upper.height)//2))
        p=OUT/'portraits'/f'hero_{name}_portrait.png';p.parent.mkdir(parents=True,exist_ok=True);portrait.save(p,optimize=True)
        result['portrait']=str(p.relative_to(ROOT))
        result['portrait_note']='Pixel-enlarged upper half of idle sprite; not a hand-painted portrait'
    print(name,job,'frames', {k:v['frame_count'] for k,v in frame_meta.items()},'distinct',nonidentical,'tile',tile,'scale',scale,flush=True)
    return result


def icon(hero):
    name,_,_,_,skill,_=hero
    if skill is None:return None
    data,url=fetch('skill',skill)
    sequence,_=frames(data)
    src=sequence[0]
    factor=max(1,min(112//src.width,112//src.height))
    icon=src.resize((src.width*factor,src.height*factor),Image.Resampling.NEAREST)
    out=Image.new('RGBA',(128,128));out.alpha_composite(icon,((128-icon.width)//2,(128-icon.height)//2))
    p=OUT/'icons'/f'ui_ult_{name}.png';p.parent.mkdir(parents=True,exist_ok=True);out.save(p,optimize=True)
    return {'file':str(p.relative_to(ROOT)),'hero':name,'skill_id':skill,'url':url,
            'source_sha256':hashlib.sha256(data).hexdigest(),'source_size':list(src.size)}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--phase',choices=['all','0','1','2'],default='all');args=ap.parse_args()
    selected=lambda p:args.phase=='all' or int(args.phase)==p
    records=[];icons=[];errors=[]
    for hero in HEROES:
        name,jobname,job,gender,skill,phase=hero
        if not selected(phase):continue
        try:
            record=atlas(name,'hero',job,gender,phase);record['original_name']=jobname;records.append(record)
            if skill is not None: icons.append(icon(hero))
        except Exception as e:errors.append(f'hero_{name}: {e}');print('ERROR',errors[-1],flush=True)
    for name,mobname,job,phase in MOBS:
        if not selected(phase):continue
        try:
            record=atlas(name,'enemy',job,None,phase);record['original_name']=mobname;records.append(record)
        except Exception as e:errors.append(f'enemy_{name}: {e}');print('ERROR',errors[-1],flush=True)
    OUT.mkdir(parents=True,exist_ok=True)
    manifest=OUT/'manifest.json'
    previous=json.loads(manifest.read_text()) if manifest.is_file() else {'schema':1,'sprites':[],'icons':[]}
    previous['sprites']=[r for r in previous['sprites'] if not selected(r['phase'])]+records
    previous['icons']=[r for r in previous['icons'] if not selected(0)]+icons
    previous['errors']=errors
    previous['source_renderer']='https://github.com/adsonpleal/ragassets'
    previous['layout']='rows are named actions; columns are chronological frames; unused cells fully transparent'
    manifest.write_text(json.dumps(previous,ensure_ascii=False,indent=2)+'\n')
    print('DONE',len(records),'sheets',len(icons),'icons',len(errors),'errors',flush=True)
    if errors: raise SystemExit(1)

if __name__=='__main__':main()
