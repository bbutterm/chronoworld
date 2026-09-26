#!/usr/bin/env python3
"""Single visual QA sheet: center frame of every v2 animation, gray, x2 nearest."""
import argparse,json
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
def make(output):
 data=json.loads((ROOT/'assets/sprites/sprites.json').read_text());sprites=data['sprites']
 tw,th=528,546;canvas=Image.new('RGB',(6*tw,len(sprites)*th),'#696d73');draw=ImageDraw.Draw(canvas)
 for row,s in enumerate(sprites):
  cls=data['classes'][s['class']];cw,ch=cls['cell']
  src=Image.open(ROOT/'assets'/s['file']).convert('RGBA')
  for col,anim in enumerate(cls['anims']):
   conf=dict(data['anims'][anim]);conf.update(data.get('animOverrides',{}).get(s['class'],{}).get(anim,{}))
   index=conf['frames']//2
   frame=src.crop((index*cw,col*ch,(index+1)*cw,(col+1)*ch))
   bigger=frame.resize((cw*2,ch*2),resample=Image.Resampling.NEAREST)
   x=col*tw+(tw-cw*2)//2;y=row*th+27+(512-ch*2)//2
   canvas.paste(bigger,(x,y),bigger)
   draw.text((col*tw+8,row*th+7),f'{s["id"]} / {anim} / {index}',fill='white')
   draw.rectangle((col*tw,row*th,(col+1)*tw-1,(row+1)*th-1),outline='#979b9f',width=1)
 output.parent.mkdir(parents=True,exist_ok=True);canvas.save(output,optimize=True)
 print(output,canvas.size,output.stat().st_size)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=Path('/root/artifacts/chronoworld-art/v2-contact.png'))
 a=p.parse_args();make(a.output)
