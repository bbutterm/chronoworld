#!/usr/bin/env python3
"""Validate native-resolution v2 RO sheets; --source-cache adds pixel-perfect source proof."""
from __future__ import annotations
import argparse,json,subprocess,sys
from pathlib import Path
import numpy as np
from PIL import Image
from build_sprites_v2 import FIRST_HEROES,STORY_HEROES,CARD_HEROES
import sprites_manifest

ROOT=Path(__file__).resolve().parents[1]
DEFAULT=ROOT/'assets/sprites/sprites.json'
EXPECTED={
 'hero':('idle','walk','attack','cast','hurt','death'),
 'monster':('idle','walk','attack','hurt','death'),
  'boss':('idle','walk','attack','hurt','death'),
 'monster_xl':('idle','walk','attack','hurt','death'),
 'boss_xl':('idle','walk','attack','hurt','death'),
 'boss_xxl':('idle','walk','attack','hurt','death'),
 # story NPCs (speaker portraits): rows idle south, idle east, walk south, walk east; no battle anims, no source proof
 'npc':('idle','idle_e','walk_s','walk'),
}
NO_PROOF={'npc'}
REQUIRED={'novice','merchant','swordman','swordman_m','magician','archer_first','acolyte','thief',
          'knight_m','crusader_m','hunter_m','hunter_f','bard_m','dancer_f',
          'wizard_f','sage_f','assassin_m','rogue_m','rogue_f','priest_f',
          'monk_m','blacksmith_m','blacksmith_f','alchemist_m',
          'guard','warrior','assassin','archer','mage','priest','melee','ranged','tank','fast','elite','boss1','boss2',
          'drops','poporing','fabre','lunatic','mandragora','rocker','mastering',
          # converted from legacy assets/ro v1 sheets (tools/ro_v1_to_v2.py)
          'blacksmith','monk','sage','rogue','alchemist','bard',
          'raydric','mimic','gargoyle','dark_priest','mistress','osiris','moonlight_flower','drake','dark_lord',
          'mummy','sandman','marduk','scorpion','verit','isis',
          'bongun','munak','horong','smokie','nine_tail','sohee',
          'pirate_skel','kukre','marse','swordfish','hydra','obeaune',
          'dullahan','gibbet','banshee','bloody_murderer','loli_ruri','quve',
          # scRO client extraction (raw/ro-build, docs/RO_SCRO_IMPORT.md): chapters 1-3, 7, 8, 10
          'marin','pupa','thief_bug_male','thief_bug_female','thief_bug','thief_bug_egg','plankton','tarou','familiar',
          'orc_lord','orc_warrior','high_orc','orc_archer','orc_lady','orc_skeleton','orc_zombie','steel_chonchon',
          'ancient_mummy','owl_duke','clock','rideword','punk','elder','evil_druid','ghoul','eclipse','vocal','elder_willow',
          'lord_of_death','bloody_knight','owl_baron','alarm','abysmal_knight','clock_tower_manager',
          # chapter 9 (Labyrinth Forest): registered ahead of its units
          'baphomet_jr','ghostring','vagabond_wolf','hunter_fly','side_winder','mantis','stem_worm','killer_mantis','deviruchi',
          # story NPC speakers (data/story portrait "npc_<name>")
          'npc_kafra'}
REQUIRED.update(FIRST_HEROES+STORY_HEROES+CARD_HEROES)
GRID={'hero':([224,192],[104,144],8),'monster':([240,224],[100,120],8),
      'boss':([256,256],[112,216],8),'monster_xl':([272,330],[167,280],6),
      # boss_xl: Lord of Death, Bloody Knight, Owl Baron, Alarm; boss_xxl: Abysmal Knight, Clock Tower Manager
      # (native x1 frames wider than monster_xl; 6 columns keep the sheet <= 2048)
      'boss_xl':([296,296],[96,218],6),'boss_xxl':([340,376],[170,300],6),
      'npc':([240,224],[100,120],8)}
EXCEPTIONS={'tank':[0,1,2,3,21],'fast':[0,2,4,6,16],
            'drops':[0,2,4,6,16],'poporing':[0,2,4,6,16]}

BUDGET=3_000_000

def used_files():
 """Files the build copies to dist (scripts/lib/used-assets.ts); None when node/tsx is unavailable."""
 tsx=ROOT/'node_modules/.bin/tsx'
 if not tsx.is_file():return None
 code="import {collectUsedAssets} from './scripts/lib/used-assets.ts';console.log(JSON.stringify(collectUsedAssets(process.cwd()).files))"
 try:out=subprocess.run([str(tsx),'-e',code],cwd=ROOT,check=True,capture_output=True,text=True).stdout
 except (OSError,subprocess.CalledProcessError):return None
 return set(json.loads(out.strip().splitlines()[-1]))

def delivered_payload(delivered_bytes):
 """(budgeted bytes, bytes of everything on disk, scope): sheets/portraits under assets/sprites that reach dist
 (WebP copy when fresh, else PNG) + sprites.json as bundled (compact JSON, provenance is not bundled)."""
 pngs=[p for p in (ROOT/'assets/sprites').rglob('*.png') if p.is_file()]
 manifest=len(json.dumps(json.loads(sprites_manifest.RUNTIME.read_text()),separators=(',',':'),ensure_ascii=False).encode())
 total=sum(p.stat().st_size for p in pngs)+sprites_manifest.RUNTIME.stat().st_size+sprites_manifest.provenance_path().stat().st_size
 used=used_files()
 if used is None:return sum(delivered_bytes(p) for p in pngs)+manifest,total,'all sheets (used-assets unavailable)'
 dist=[p for p in pngs if p.relative_to(ROOT/'assets').as_posix() in used]
 return sum(delivered_bytes(p) for p in dist)+manifest,total,f'{len(dist)}/{len(pngs)} PNG in dist'

def expected_indices(total,target,death):
 if total>=target:return [round(i*(total-1)/(target-1)) for i in range(target)]
 if death:return list(range(total))+[total-1]*(target-total)
 return [i%total for i in range(target)]

def count_and_bbox(rgba):
 a=np.asarray(rgba.convert('RGBA'))[:,:,3]
 y,x=np.nonzero(a)
 return (int(x.min()),int(y.min()),int(x.max())+1,int(y.max())+1) if len(x) else None

def check(path=DEFAULT,source_cache=None,only=None):
 data=sprites_manifest.load(Path(path));errors=[]
 def fail(msg):errors.append(msg)
 if data.get('schema')!=2 or data.get('columns')!=8:fail('schema=2 and columns=8 required')
 sprites=data.get('sprites',[])
 if {s['id'] for s in sprites}!=REQUIRED or len(sprites)!=len(REQUIRED):fail('missing/duplicate/extra sprite ids')
 if only and only not in {s['id'] for s in sprites}:fail(f'unknown sprite id: {only}')
 for kind,anims in EXPECTED.items():
  cls=data['classes'].get(kind,{})
  if tuple(cls.get('anims',[]))!=anims:fail(f'{kind} animation order mismatch')
  expected_cell,expected_anchor,expected_columns=GRID[kind]
  if (cls.get('cell'),cls.get('anchor'),cls.get('columns',8))!=(expected_cell,expected_anchor,expected_columns):fail(f'{kind} cell/anchor/columns mismatch against native x1 grid')
  cell=cls.get('cell',[]);anchor=cls.get('anchor',[]);columns=cls.get('columns',8)
  if len(cell)!=2 or len(anchor)!=2 or not all(isinstance(n,int) for n in cell+anchor):fail(f'{kind} bad cell/anchor');continue
  if cell[0]*columns>2048 or cell[1]*len(anims)>2048:fail(f'{kind} sheet >2048')
  if not (0<anchor[0]<cell[0] and 0<anchor[1]<cell[1]):fail(f'{kind} origin outside cell')
 for s in sprites:
  sid=s['id'];kind=s['class'];cfg=data['classes'][kind];cw,ch=cfg['cell'];ax,ay=cfg['anchor'];anims=cfg['anims'];columns=cfg.get('columns',8)
  if only and sid!=only:continue
  png=ROOT/'assets'/s['file'];portrait=s.get('portrait')
  if not png.is_file():fail(f'{sid} missing {png}');continue
  with Image.open(png) as raw:
   if raw.mode not in ('RGBA','P'):fail(f'{sid} not RGBA/indexed PNG')
   if raw.size!=(cw*columns,ch*len(anims)):fail(f'{sid} wrong sheet size {raw.size} expected {(cw*columns,ch*len(anims))}');continue
   if max(raw.size)>2048:fail(f'{sid} exceeds 2048')
   img=raw.convert('RGBA')
  used_alpha=set()
  for row,anim in enumerate(anims):
   conf=dict(data['anims'][anim]);conf.update(data.get('animOverrides',{}).get(kind,{}).get(anim,{}));n=conf['frames']
   if n>8 or n<1 or conf['ms']<=0:fail(f'{sid}:{anim} invalid frames/ms');continue
   bboxes=[]
   src_boxes=s.get('sourceFrameBboxes',{}).get(anim,[])
   chosen=s.get('sourceFrameIndices',{}).get(anim,[])
   if kind in NO_PROOF:total=None
   else:
    if len(src_boxes)!=n or len(chosen)!=n:fail(f'{sid}:{anim} source proof length != {n}')
    total=s.get('sourceFrameCounts',{}).get(anim,0)
   if total is None:pass
   elif not isinstance(total,int) or total<1:fail(f'{sid}:{anim} invalid source frame count')
   else:
    if anim in s.get('samplingExceptions',{}) and sid not in EXCEPTIONS:
     # Documented skip of oversized FX frames: indices must stay in range and chronological.
     if any(not 0<=i<total for i in chosen) or chosen!=sorted(chosen):fail(f'{sid}:{anim} exception indices out of range/order: {chosen}')
    else:
     expected=EXCEPTIONS[sid] if anim=='death' and sid in EXCEPTIONS else expected_indices(total,n,anim=='death')
     if chosen!=expected:fail(f'{sid}:{anim} source sampling indices differ: {chosen} vs {expected}')
   for c in range(columns):
    frame=img.crop((c*cw,row*ch,(c+1)*cw,(row+1)*ch));b=count_and_bbox(frame)
    if c<n:
     if b is None:fail(f'{sid}:{anim} frame {c} is empty');continue
     bboxes.append(b)
     if b[0]<=0 or b[1]<=0 or b[2]>=cw or b[3]>=ch:fail(f'{sid}:{anim} frame {c} touches cell edge: {b}')
     if c<len(src_boxes):
      expected=(src_boxes[c][0]+ax,src_boxes[c][1]+ay,src_boxes[c][2]+ax,src_boxes[c][3]+ay)
      if b!=expected:fail(f'{sid}:{anim} frame {c} ACT origin/native bbox mismatch: {b} vs {expected}')
     used_alpha.update(int(v) for v in np.unique(np.asarray(frame)[:,:,3]) if 0<int(v)<255)
     if source_cache and c<len(chosen) and 'sourceCacheFiles' in s:  # v1-converted sheets have no APNG cache
      source_file=Path(source_cache)/s['sourceCacheFiles'][anim]
      if not source_file.is_file():fail(f'{sid}:{anim} source missing {source_file}')
      else:
       with Image.open(source_file) as src:
        if chosen[c]>=getattr(src,'n_frames',1):fail(f'{sid}:{anim} source frame index {chosen[c]} out of range')
        else:
         src.seek(chosen[c]);full=src.convert('RGBA')
         # Source diagnostic canvas has fixed ACT origin (256,480).
         ox,oy=256-ax,480-ay
         original=full.crop((ox,oy,ox+cw,oy+ch))
         if not np.array_equal(np.asarray(original),np.asarray(frame)):
          fail(f'{sid}:{anim} frame {c} pixels differ from original x1 source')
    elif b is not None:fail(f'{sid}:{anim} extra nonempty cell {c}')
   if bboxes:
    union=[min(b[0] for b in bboxes),min(b[1] for b in bboxes),max(b[2] for b in bboxes),max(b[3] for b in bboxes)]
    if s.get('bbox',{}).get(anim)!=union:fail(f'{sid}:{anim} bbox metadata mismatch')
   hit=s.get('hitFrames',{}).get(anim,conf.get('hitFrame'))
   if anim in ('attack','cast') and (not isinstance(hit,int) or hit<0 or hit>=n):fail(f'{sid}:{anim} invalid hitFrame')
  if kind not in NO_PROOF and used_alpha-set(s.get('sourceAlphaValues',[])):fail(f'{sid} new semi-transparent alpha not present in source: {used_alpha-set(s.get("sourceAlphaValues",[]))}')
  if portrait:
   p=ROOT/'assets'/portrait
   if not p.is_file():fail(f'{sid} missing portrait')
   else:
    with Image.open(p) as portrait_im:
     expected_portrait=(256,256) if sid in FIRST_HEROES+STORY_HEROES+CARD_HEROES else (64,64)
     if portrait_im.size!=expected_portrait or portrait_im.mode not in ('RGBA','P'):fail(f'{sid} invalid portrait')
 runtime_index=ROOT/'assets-webp/index.json'
 webp_index=json.loads(runtime_index.read_text()) if runtime_index.is_file() else {}
 def delivered_bytes(p):
  rel=p.relative_to(ROOT/'assets').as_posix();record=webp_index.get(rel)
  webp=ROOT/'assets-webp'/(rel[:-4]+'.webp') if rel.endswith('.png') else None
  if record and record.get('webp') and webp is not None and webp.is_file():return record['webp']
  return p.stat().st_size
 size,total,scope=delivered_payload(delivered_bytes)
 if size>BUDGET:fail(f'assets/sprites delivered payload {size} bytes exceeds 3 MB (WebP/PNG of sheets in dist + bundled sprites.json)')
 print(f'v2 sprites: {len(sprites)} entries; {size} delivered bytes ({scope}; all assets/sprites on disk: {total}); source pixel check: {bool(source_cache)}')
 for e in errors:print('FAIL',e)
 if errors:raise SystemExit(1)
 print('PASS all sprite dimensions, frames, edges, ACT origin/native pixels, alpha and size')

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,default=DEFAULT);p.add_argument('--source-cache',type=Path)
 p.add_argument('--only',help='Limit source/pixel validation to one sprite (manifest inventory is still checked)')
 a=p.parse_args();check(a.manifest,a.source_cache,a.only)
