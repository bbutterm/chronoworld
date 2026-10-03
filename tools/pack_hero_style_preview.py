#!/usr/bin/env python3
"""Technical atlas import for image-generated Alan/Vika preview. No painted pixels.
Splits the supplied 8x6 atlas, removes sub-16 alpha export noise, uniformly
normalizes figure scale, aligns feet, and writes existing manifest/proof formats.
Original production PNGs remain unchanged. Run with Alan and Vika input paths.
"""
import hashlib,json,sys
from pathlib import Path
from PIL import Image
import sprites_manifest
ROOT=Path(__file__).resolve().parents[1]
ANIMS=['idle','walk','attack','cast','hurt','death']; COUNTS=[4,8,6,6,3,4]
def box(im): return im.getchannel('A').getbbox()
def main(paths):
 data=sprites_manifest.load()
 for sid,source in zip(['hero_alan_swordman','hero_vika_acolyte'],paths):
  raw=Path(source).read_bytes(); src=Image.open(source).convert('RGBA')
  cells=[]
  for row,n in enumerate(COUNTS):
   poses=[]
   for col in range(n):
    frame=src.crop((round(col*src.width/8),round(row*src.height/6),round((col+1)*src.width/8),round((row+1)*src.height/6)))
    frame.putalpha(frame.getchannel('A').point(lambda a:a if a>=16 else 0))
    assert box(frame), (sid,row,col)
    poses.append(frame)
   cells.append(poses)
  # One scale for all poses; idle including boots is 89 px, matching the existing world.
  idle_height=max(box(f)[3]-box(f)[1] for f in cells[0]); scale=89/idle_height
  out=Image.new('RGBA',(1792,1152)); boxes={}; proofs={}; alpha=set()
  for row,(name,frames) in enumerate(zip(ANIMS,cells)):
   bbs=[]
   for col,frame in enumerate(frames):
    b=box(frame); cut=frame.crop(b)
    cut=cut.resize((round(cut.width*scale),round(cut.height*scale)),Image.Resampling.LANCZOS)
    # Source body centre follows the original grid anchor; never centre on weapon/FX bounds.
    sx=104*src.width/1792
    x=round(104+(b[0]-sx)*scale)
    y=(161 if name=='death' else 149)-cut.height
    normalized=Image.new('RGBA',(224,192)); normalized.paste(cut,(x,y))
    bb=box(normalized); assert bb and 0<bb[0]<bb[2]<224 and 0<bb[1]<bb[3]<192
    assert sum(normalized.getchannel('A').getdata())==sum(cut.getchannel('A').getdata()),'clipped pixels'
    bbs.append(bb);alpha.update(normalized.getchannel('A').getdata())
    out.paste(normalized,(col*224,row*192))
   boxes[name]=[min(b[0] for b in bbs),min(b[1] for b in bbs),max(b[2] for b in bbs),max(b[3] for b in bbs)]
   proofs[name]=[[b[0]-104,b[1]-144,b[2]-104,b[3]-144] for b in bbs]
  rel=f'sprites/heroes/{sid}_style_preview.png';out.save(ROOT/'assets'/rel,optimize=True)
  entry=next(s for s in data['sprites'] if s['id']==sid)
  old={k:v for k,v in entry.items() if k not in sprites_manifest.RUNTIME_KEYS}
  for k in old:del entry[k]
  entry.update(file=rel,bbox=boxes);entry.pop('portrait',None)
  entry.update(source={'gender':old['source']['gender'],'renderer':'Image generation, then technical grid/scale normalization','sha256':hashlib.sha256(raw).hexdigest()},sourceFrameBboxes=proofs,sourceFrameIndices={a:list(range(n)) for a,n in zip(ANIMS,COUNTS)},sourceFrameCounts=dict(zip(ANIMS,COUNTS)),sourceAlphaValues=sorted(alpha-{0,255}),sourceLimitations=['Style preview: independently generated poses, not final hand-tweened production animation.'],originalProductionProof=old,previewNormalization={'inputSize':list(src.size),'scale':scale,'standingHeight':89,'alphaNoiseThreshold':16,'feetBottom':149,'deathBottom':161})
  print(sid,rel,boxes)
 sprites_manifest.save(data)
if __name__=='__main__':main(sys.argv[1:])
