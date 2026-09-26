#!/usr/bin/env python3
"""Validate native-resolution v2 RO sheets; --source-cache adds pixel-perfect source proof."""
from __future__ import annotations
import argparse,json,sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
DEFAULT=ROOT/'assets/sprites/sprites.json'
EXPECTED={
 'hero':('idle','walk','attack','cast','hurt','death'),
 'monster':('idle','walk','attack','hurt','death'),
 'boss':('idle','walk','attack','hurt','death'),
}
REQUIRED={'guard','warrior','assassin','archer','mage','priest','melee','ranged','tank','fast','elite','boss1','boss2'}
GRID={'hero':([224,192],[104,144]),'monster':([240,224],[100,120]),'boss':([256,256],[112,216])}
EXCEPTIONS={'tank':[0,1,2,3,21],'fast':[0,2,4,6,16]}

def expected_indices(total,target,death):
 if total>=target:return [round(i*(total-1)/(target-1)) for i in range(target)]
 if death:return list(range(total))+[total-1]*(target-total)
 return [i%total for i in range(target)]

def count_and_bbox(rgba):
 a=np.asarray(rgba.convert('RGBA'))[:,:,3]
 y,x=np.nonzero(a)
 return (int(x.min()),int(y.min()),int(x.max())+1,int(y.max())+1) if len(x) else None

def check(path=DEFAULT,source_cache=None):
 data=json.loads(Path(path).read_text());errors=[]
 def fail(msg):errors.append(msg)
 if data.get('schema')!=2 or data.get('columns')!=8:fail('schema=2 and columns=8 required')
 sprites=data.get('sprites',[])
 if {s['id'] for s in sprites}!=REQUIRED or len(sprites)!=len(REQUIRED):fail('missing/duplicate/extra sprite ids')
 for kind,anims in EXPECTED.items():
  cls=data['classes'].get(kind,{})
  if tuple(cls.get('anims',[]))!=anims:fail(f'{kind} animation order mismatch')
  if (cls.get('cell'),cls.get('anchor'))!=GRID[kind]:fail(f'{kind} cell/anchor mismatch against approved native x1 grid')
  cell=cls.get('cell',[]);anchor=cls.get('anchor',[])
  if len(cell)!=2 or len(anchor)!=2 or not all(isinstance(n,int) for n in cell+anchor):fail(f'{kind} bad cell/anchor');continue
  if cell[0]*8>2048 or cell[1]*len(anims)>2048:fail(f'{kind} sheet >2048')
  if not (0<anchor[0]<cell[0] and 0<anchor[1]<cell[1]):fail(f'{kind} origin outside cell')
 for s in sprites:
  sid=s['id'];kind=s['class'];cfg=data['classes'][kind];cw,ch=cfg['cell'];ax,ay=cfg['anchor'];anims=cfg['anims']
  png=ROOT/'assets'/s['file'];portrait=s.get('portrait')
  if not png.is_file():fail(f'{sid} missing {png}');continue
  with Image.open(png) as raw:
   if raw.mode not in ('RGBA','P'):fail(f'{sid} not RGBA/indexed PNG')
   if raw.size!=(cw*8,ch*len(anims)):fail(f'{sid} wrong sheet size {raw.size} expected {(cw*8,ch*len(anims))}');continue
   if max(raw.size)>2048:fail(f'{sid} exceeds 2048')
   img=raw.convert('RGBA')
  used_alpha=set()
  for row,anim in enumerate(anims):
   conf=dict(data['anims'][anim]);conf.update(data.get('animOverrides',{}).get(kind,{}).get(anim,{}));n=conf['frames']
   if n>8 or n<1 or conf['ms']<=0:fail(f'{sid}:{anim} invalid frames/ms');continue
   bboxes=[]
   src_boxes=s.get('sourceFrameBboxes',{}).get(anim,[])
   chosen=s.get('sourceFrameIndices',{}).get(anim,[])
   if len(src_boxes)!=n or len(chosen)!=n:fail(f'{sid}:{anim} source proof length != {n}')
   total=s.get('sourceFrameCounts',{}).get(anim,0)
   if not isinstance(total,int) or total<1:fail(f'{sid}:{anim} invalid source frame count')
   else:
    expected=EXCEPTIONS[sid] if anim=='death' and sid in EXCEPTIONS else expected_indices(total,n,anim=='death')
    if chosen!=expected:fail(f'{sid}:{anim} source sampling indices differ: {chosen} vs {expected}')
   for c in range(8):
    frame=img.crop((c*cw,row*ch,(c+1)*cw,(row+1)*ch));b=count_and_bbox(frame)
    if c<n:
     if b is None:fail(f'{sid}:{anim} frame {c} is empty');continue
     bboxes.append(b)
     if b[0]<=0 or b[1]<=0 or b[2]>=cw or b[3]>=ch:fail(f'{sid}:{anim} frame {c} touches cell edge: {b}')
     if c<len(src_boxes):
      expected=(src_boxes[c][0]+ax,src_boxes[c][1]+ay,src_boxes[c][2]+ax,src_boxes[c][3]+ay)
      if b!=expected:fail(f'{sid}:{anim} frame {c} ACT origin/native bbox mismatch: {b} vs {expected}')
     used_alpha.update(int(v) for v in np.unique(np.asarray(frame)[:,:,3]) if 0<int(v)<255)
     if source_cache and c<len(chosen):
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
  if used_alpha-set(s.get('sourceAlphaValues',[])):fail(f'{sid} new semi-transparent alpha not present in source: {used_alpha-set(s.get("sourceAlphaValues",[]))}')
  if portrait:
   p=ROOT/'assets'/portrait
   if not p.is_file():fail(f'{sid} missing portrait')
   else:
    with Image.open(p) as portrait_im:
     if portrait_im.size!=(64,64) or portrait_im.mode not in ('RGBA','P'):fail(f'{sid} invalid portrait')
 size=sum(p.stat().st_size for p in (ROOT/'assets/sprites').rglob('*') if p.is_file())
 if size>3_000_000:fail(f'assets/sprites size {size} exceeds 3 MB')
 print(f'v2 sprites: {len(sprites)} entries; {size} bytes; source pixel check: {bool(source_cache)}')
 for e in errors:print('FAIL',e)
 if errors:raise SystemExit(1)
 print('PASS all sprite dimensions, frames, edges, ACT origin/native pixels, alpha and size')

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,default=DEFAULT);p.add_argument('--source-cache',type=Path)
 a=p.parse_args();check(a.manifest,a.source_cache)
