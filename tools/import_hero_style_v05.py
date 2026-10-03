#!/usr/bin/env python3
"""Import approved, globally normalized 1792x1152 character sheets without moving pixels.
No per-pose translations, scales, resizing, or frame reordering. Only alpha<16
export noise is made transparent. Production and previous-preview art stay intact.
"""
import hashlib,sys
from pathlib import Path
from PIL import Image
import sprites_manifest
ROOT=Path(__file__).resolve().parents[1]
ANIMS=['idle','walk','attack','cast','hurt','death'];COUNTS=[4,8,6,6,3,4]
def sha(raw):return hashlib.sha256(raw).hexdigest()
def main(paths):
 assert len(paths)==2,'Provide Alan and Vika input paths'
 data=sprites_manifest.load()
 for sid,source in zip(['hero_alan_swordman','hero_vika_acolyte'],paths):
  raw=Path(source).read_bytes();src=Image.open(source).convert('RGBA');assert src.size==(1792,1152)
  out=src.copy();out.putalpha(src.getchannel('A').point(lambda a:a if a>=16 else 0))
  # RGB and all visible alpha values remain exact, at the same global coordinates.
  assert out.convert('RGB').tobytes()==src.convert('RGB').tobytes()
  boxes={};proofs={};alphas=set()
  for row,(name,count) in enumerate(zip(ANIMS,COUNTS)):
   bbs=[]
   for col in range(8):
    frame=out.crop((col*224,row*192,(col+1)*224,(row+1)*192));b=frame.getchannel('A').getbbox()
    if col>=count:assert b is None,(sid,name,col,'nonempty unused cell');continue
    assert b and b[0]>0 and b[1]>0 and b[2]<224 and b[3]<192,(sid,name,col,b)
    bbs.append(b);alphas.update(frame.getchannel('A').getdata())
   boxes[name]=[min(b[0] for b in bbs),min(b[1] for b in bbs),max(b[2] for b in bbs),max(b[3] for b in bbs)]
   proofs[name]=[[b[0]-104,b[1]-144,b[2]-104,b[3]-144] for b in bbs]
  rel=f'sprites/heroes/{sid}_style_v05.png';dest=ROOT/'assets'/rel;out.save(dest,optimize=True)
  e=next(s for s in data['sprites'] if s['id']==sid)
  original=e.get('originalProductionProof',{k:v for k,v in e.items() if k not in sprites_manifest.RUNTIME_KEYS})
  gender=e['source']['gender']
  for k in list(e):
   if k not in sprites_manifest.RUNTIME_KEYS:del e[k]
  e.update(file=rel,bbox=boxes);e.pop('portrait',None)
  e.update(source={'gender':gender,'renderer':'Image generation; approved globally normalized atlas imported without per-frame transforms','inputSha256':sha(raw),'processedSha256':sha(dest.read_bytes())},sourceFrameBboxes=proofs,sourceFrameIndices={a:list(range(n)) for a,n in zip(ANIMS,COUNTS)},sourceFrameCounts=dict(zip(ANIMS,COUNTS)),sourceAlphaValues=sorted(alphas-{0,255}),sourceLimitations=['Style preview, user-selected iteration 5. Original grid, anchor, frame ordering, motion positions and inherited hit timing preserved.'],originalProductionProof=original,previewNormalization={'inputSize':list(src.size),'perFrameTransform':False,'scale':1,'translation':[0,0],'alphaNoiseThreshold':16})
  print(sid,rel,boxes,sha(dest.read_bytes()))
 sprites_manifest.save(data)
if __name__=='__main__':main(sys.argv[1:])
