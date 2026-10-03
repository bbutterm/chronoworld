#!/usr/bin/env python3
"""Pixel-level regression checks for the first approved four-hero detail batch."""
import hashlib,json
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
IDS=['hero_kai_magician_details_v2','hero_bran_first_profession_detail_v1','hero_greta_merchant_detail_v2','hero_alan_first_profession_detail_v1']
ANIMS=['idle','walk','attack','cast','hurt','death'];COUNTS=[4,8,6,6,3,4]
def check():
 m=json.loads((ROOT/'assets/sprites/sprites.json').read_text());p=json.loads((ROOT/'assets/sprites/sprites.provenance.json').read_text())['sprites']
 for sid in IDS:
  s=next(x for x in m['sprites'] if x['id']==sid);raw=(ROOT/'assets'/s['file']).read_bytes();im=Image.open(ROOT/'assets'/s['file']).convert('RGBA')
  assert hashlib.sha256(raw).hexdigest()==p[sid]['source']['sheetSha256']
  assert im.size==(1792,1152)
  for row,(name,count) in enumerate(zip(ANIMS,COUNTS)):
   bbs=[]
   for col in range(8):
    f=im.crop((col*224,row*192,(col+1)*224,(row+1)*192));b=f.getchannel('A').getbbox()
    if col>=count:assert b is None;continue
    assert b and 0<b[0]<b[2]<224 and 0<b[1]<b[3]<192
    bb=s['bbox'][name];crop=f.crop(bb);back=Image.new('RGBA',(224,192));back.paste(crop,bb[:2]);assert back.getchannel('A').tobytes()==f.getchannel('A').tobytes()
    bg=Image.new('RGBA',f.size,'black');assert Image.alpha_composite(bg,back).tobytes()==Image.alpha_composite(bg,f).tobytes();bbs.append(b)
   assert s['bbox'][name]==[min(b[0] for b in bbs),min(b[1] for b in bbs),max(b[2] for b in bbs),max(b[3] for b in bbs)]
  portrait=Image.open(ROOT/'assets'/s['portrait']).convert('RGBA');assert portrait.tobytes()==im.crop((72,56,136,120)).resize((256,256),Image.Resampling.NEAREST).tobytes()
  for rel in [s['file'],s['portrait']]:
   png=Image.open(ROOT/'assets'/rel).convert('RGBA');webp=Image.open(ROOT/'assets-webp'/rel.replace('.png','.webp')).convert('RGBA');assert png.size==webp.size and png.tobytes()==webp.tobytes(),rel
  print('PASS',sid,'31/17 cells, unclipped bounds, idle0 portrait, PNG/WebP exact RGBA')
if __name__=='__main__':check()
