#!/usr/bin/env python3
"""Build native x1 east-facing RO v2 atlases from audited shadowless APNG cache.

The source APNGs are NEVER placed in Git. Every chosen pixel is copied directly
from a fixed canvas with ACT origin (256,480), with no transform or resampling.
"""
from __future__ import annotations
import argparse,json,os,shutil,subprocess,sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/sprites'
DEFAULT_CACHE=Path.home()/'.cache/chronoworld/v2'
HEROES={
 'novice':(0,'Novice','male',0,0,0,0),
 'guard':(14,'Crusader','male',2,1,1101,2101),
 'warrior':(7,'Knight','male',3,0,1151,0),
 'assassin':(12,'Assassin','male',16,0,1252,0),
 'archer':(11,'Hunter','male',11,0,1701,0),
 'mage':(9,'Wizard','male',10,0,1601,0),
 'priest':(8,'Priest','female',8,0,1504,0),
}
MONSTERS={'melee':('Zombie',1015),'ranged':('Archer Skeleton',1016),'tank':('Willow',1010),'fast':('Poring',1002),
          'elite':('Golden Thief Bug',1086),'boss1':('Orc Hero',1087),'boss2':('Baphomet',1039)}
CACHE_ALIASES={'elite':'boss_ch1','boss1':'boss_ch2','boss2':'boss_ch3'}
CLASSES={
 'hero':{'cell':[224,192],'anchor':[104,144],'anims':['idle','walk','attack','cast','hurt','death']},
 'monster':{'cell':[240,224],'anchor':[100,120],'anims':['idle','walk','attack','hurt','death']},
 'boss':{'cell':[256,256],'anchor':[112,216],'anims':['idle','walk','attack','hurt','death']},
}
ANIMS={'idle':{'frames':4,'ms':150,'loop':True},'walk':{'frames':8,'ms':90,'loop':True},
       'attack':{'frames':6,'ms':80,'hitFrame':3},'cast':{'frames':6,'ms':100,'hitFrame':4},
       'hurt':{'frames':3,'ms':100},'death':{'frames':4,'ms':150}}
OVERRIDES={'monster':{'walk':{'frames':6,'ms':100},'death':{'frames':5,'ms':120}},
           'boss':{'walk':{'frames':6,'ms':100},'death':{'frames':5,'ms':120}}}
MON_ACTION={'idle':6,'walk':14,'attack':22,'hurt':30,'death':38}
HERO_ACTION={'idle':38,'walk':14,'attack':86,'cast':102,'hurt':54,'death':70}
# Explicitly approved by owner: omit oversized ACT death FX intermediates while
# retaining original first/last; per-monster exception to uniform sampling.
DEATH_EXCEPTIONS={'tank':[0,1,2,3,21],'fast':[0,2,4,6,16]}

def sample(total,target,death=False):
 if total>=target:return [round(i*(total-1)/(target-1)) for i in range(target)]
 if death:return list(range(total))+[total-1]*(target-total)
 return [i%total for i in range(target)]

def bbox(im):
 arr=np.asarray(im.convert('RGBA'))[:,:,3];ys,xs=np.nonzero(arr)
 if not len(xs):return None
 return [int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1]

def save_lossless(im,path,oxipng):
 assert im.mode=='RGBA'
 colors=im.getcolors(maxcolors=256)
 if colors is not None:
  palette=list(dict.fromkeys(im.getdata()))
  mapping={v:i for i,v in enumerate(palette)}
  idx=Image.frombytes('P',im.size,bytes(mapping[x] for x in im.getdata()))
  rgb=[v for p in palette for v in p[:3]];idx.putpalette(rgb+[0]*(768-len(rgb)))
  idx.info['transparency']=bytes(p[3] for p in palette)
  idx.save(path,optimize=True)
 else:im.save(path,optimize=True)
 if oxipng.is_file():subprocess.run([str(oxipng),'-o','4','--strip','safe',str(path)],check=True,stdout=subprocess.DEVNULL)
 with Image.open(path) as check:
  if not np.array_equal(np.asarray(check.convert('RGBA')),np.asarray(im)):
   raise RuntimeError(f'lossy PNG conversion: {path}')

def build(cache:Path,oxipng:Path,only=None):
 # oxipng is optional; Pillow's lossless indexed PNG remains under budget.
 for kind in ('heroes','monsters','bosses','portraits'):(OUT/kind).mkdir(parents=True,exist_ok=True)
 data={'schema':2,'columns':8,'classes':CLASSES,'anims':ANIMS,'animOverrides':OVERRIDES,'sprites':[],
       'notes':['All frames rendered at native x1 with enableShadow=false and ACT (0,0) at the per-class anchor.',
                'Class cells and anchors expanded with user approval to avoid ACT-origin clipping.',
                'Willow/Poring death indices skip oversized ACT explosion effects (exception to uniform sampling).',
                'Ordinary weapon items omit item_db View; weaponView here is renderer weapon-type ID. Guard shield item View 1.']}
 specs=[]
 for name,(job,jobname,gender,weapon,shield,item,shielditem) in HEROES.items():
  specs.append((name,'hero',job,jobname,gender,weapon,shield,item,shielditem))
 for name,(mobname,mobid) in MONSTERS.items():
  specs.append((name,'boss' if name.startswith('boss') else 'monster',mobid,mobname,None,0,0,0,0))
 if only:
  specs=[spec for spec in specs if spec[0]==only]
  if not specs:raise ValueError(f'unknown sprite id: {only}')
  manifest=OUT/'sprites.json'
  if not manifest.is_file():raise FileNotFoundError(f'--only requires existing {manifest}')
  data=json.loads(manifest.read_text())
  data['sprites']=[s for s in data['sprites'] if s['id']!=only]
 for name,kind,job,jobname,gender,weapon,shield,item,shielditem in specs:
  cfg=CLASSES[kind];cw,ch=cfg['cell'];ax,ay=cfg['anchor'];rows=cfg['anims']
  sheet=Image.new('RGBA',(cw*8,ch*len(rows)))
  entry={'id':name,'class':kind,'file':f'sprites/{"heroes" if kind=="hero" else "bosses" if kind=="boss" else "monsters"}/{name}.png',
         'source':{'job':jobname,'jobId':job,'gender':gender or 'none','head':1 if gender else 0,
                   'weaponView':weapon,'shieldView':shield,'itemId':item,'shieldItemId':shielditem,
                   'renderer':'ragassets /image; ACT direction 6; shadow=false; native x1'},
         'hitFrames':{'attack':3,**({'cast':4} if kind=='hero' else {})},
         'bbox':{},'sourceFrameBboxes':{},'sourceFrameIndices':{},'sourceFrameCounts':{},'sourceCacheFiles':{},'sourceActions':{},'sourceAlphaValues':[]}
  alphas=set();exception_rows={}
  for row,anim in enumerate(rows):
   act=(HERO_ACTION if kind=='hero' else MON_ACTION)[anim]
   if kind=='hero' and name in ('assassin','archer') and anim=='attack':act=94
   # Assassin/Hunter need variant-2 equipped attack, but cast remains skill=102.
   actual_label='cast' if kind=='hero' and name in ('assassin','archer') and anim=='attack' else anim
   cached=cache/f'{CACHE_ALIASES.get(name,name)}_{actual_label}_{act}_w{weapon}_s{shield}.png'
   if not cached.is_file():raise FileNotFoundError(cached)
   src=Image.open(cached)
   conf=dict(ANIMS[anim]);conf.update(OVERRIDES.get(kind,{}).get(anim,{}));n=conf['frames']
   indices=DEATH_EXCEPTIONS[name] if anim=='death' and name in DEATH_EXCEPTIONS else sample(getattr(src,'n_frames',1),n,death=(anim=='death'))
   assert len(indices)==n,(name,anim)
   bounds=[];source_bounds=[]
   for col,index in enumerate(indices):
    src.seek(index);full=src.convert('RGBA')
    native=bbox(full)
    if not native:raise RuntimeError(f'{name}:{anim} source frame {index} blank')
    if native[0]<=0 or native[1]<=0 or native[2]>=512 or native[3]>=640:raise RuntimeError(f'{name}:{anim} frame {index} diagnostic canvas clipped {native}')
    native=[native[0]-256,native[1]-480,native[2]-256,native[3]-480]
    target=[native[0]+ax,native[1]+ay,native[2]+ax,native[3]+ay]
    if target[0]<=0 or target[1]<=0 or target[2]>=cw or target[3]>=ch:
     raise RuntimeError(f'{name}:{anim} frame {index} cannot fit {cw}x{ch} at ({ax},{ay}): {target}')
    frame=full.crop((256-ax,480-ay,256-ax+cw,480-ay+ch))
    if bbox(frame)!=target:raise RuntimeError(f'{name}:{anim} frame {index} source was cropped')
    sheet.alpha_composite(frame,(col*cw,row*ch));bounds.append(target);source_bounds.append(native)
    alphas.update(int(v) for v in np.unique(np.asarray(frame)[:,:,3]) if 0<int(v)<255)
   entry['bbox'][anim]=[min(x[0] for x in bounds),min(x[1] for x in bounds),max(x[2] for x in bounds),max(x[3] for x in bounds)]
   entry['sourceFrameBboxes'][anim]=source_bounds;entry['sourceFrameIndices'][anim]=indices
   entry['sourceCacheFiles'][anim]=cached.name;entry['sourceActions'][anim]=act;entry['sourceFrameCounts'][anim]=getattr(src,'n_frames',1)
   if anim=='death' and name in DEATH_EXCEPTIONS:exception_rows[anim]='Oversized FX frames skipped with owner approval; x1 source indices recorded.'
   if anim=='idle' and kind=='hero':
    # Native 64x64 head and shoulders of first ready pose; no resize.
    src.seek(indices[0]);raw=src.convert('RGBA')
    portrait=raw.crop((256-32,480-88,256+32,480-24))
    out=OUT/'portraits'/f'{name}.png';save_lossless(portrait,out,oxipng)
    entry['portrait']=f'sprites/portraits/{name}.png'
  if exception_rows:entry['samplingExceptions']=exception_rows
  if name=='novice':entry['sourceLimitations']={'cast':'RO action 102 is visually identical to ready/idle','death':'RO action 70 has one source frame; held to fill the v2 death row'}
  entry['sourceAlphaValues']=sorted(alphas)
  png=ROOT/'assets'/entry['file'];save_lossless(sheet,png,oxipng);data['sprites'].append(entry)
  print(name,kind,png.stat().st_size,'bytes',flush=True)
 (OUT/'sprites.json').write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
 print('OUTPUT',OUT,'bytes',sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file()))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=DEFAULT_CACHE)
 p.add_argument('--oxipng',type=Path,default=Path(os.environ.get('OXIPNG',shutil.which('oxipng') or '/root/artifacts/chronoworld-art/bin/oxipng')))
 p.add_argument('--only',help='Build/upsert a single ID without replacing the other manifest entries')
 a=p.parse_args();build(a.cache,a.oxipng,a.only)
