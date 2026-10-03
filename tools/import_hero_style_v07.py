#!/usr/bin/env python3
"""Import final 1792x1152 controlled-reskin atlases byte-for-byte.
No pixel processing, translations, resizing, palette changes or frame reordering.
Production and previous-preview art stay intact.
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
  out=src
  # The importer never modifies any pixel or position.
  assert out.tobytes()==src.tobytes()
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
  rel=f'sprites/heroes/{sid}_style_v07.png';dest=ROOT/'assets'/rel;dest.write_bytes(raw)
  e=next(s for s in data['sprites'] if s['id']==sid)
  original=e.get('originalProductionProof',{k:v for k,v in e.items() if k not in sprites_manifest.RUNTIME_KEYS})
  gender=e['source']['gender']
  for k in list(e):
   if k not in sprites_manifest.RUNTIME_KEYS:del e[k]
  e.update(file=rel,bbox=boxes);e.pop('portrait',None)
  e.update(source={'gender':gender,'renderer':'Image-generated controlled pose reskin with frozen palette; supplied final atlas copied byte-for-byte','inputSha256':sha(raw),'processedSha256':sha(dest.read_bytes())},sourceFrameBboxes=proofs,sourceFrameIndices={a:list(range(n)) for a,n in zip(ANIMS,COUNTS)},sourceFrameCounts=dict(zip(ANIMS,COUNTS)),sourceAlphaValues=sorted(alphas-{0,255}),sourceLimitations=['Controlled-reskin style preview. Original grid, anchor, frame ordering and inherited hit timing preserved. No source alpha mask applied by importer.'],originalProductionProof=original,previewNormalization={'inputSize':list(src.size),'perFrameTransform':False,'scale':1,'translation':[0,0],'pixelProcessing':'none','byteExactCopy':True})
  print(sid,rel,boxes,sha(dest.read_bytes()))
 sprites_manifest.save(data)
if __name__=='__main__':main(sys.argv[1:])
