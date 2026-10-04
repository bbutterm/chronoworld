"""Original Chronoworld veteran skill atlases, not captures of RO effects.
Deterministic antialiased RGBA, 24 independently rendered temporal frames.
Usage: python3 tools/build_veteran_fx.py [--register]
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math,json,sys
ROOT=Path(__file__).resolve().parents[1]
S,N,COLS,AA=128,24,6,3
COLORS={'lord_knight':(255,186,82),'paladin':(255,226,151),'sniper':(141,220,249),'clown':(134,184,255),'gypsy':(232,124,195),'high_wizard':(239,138,87),'professor':(93,220,201),'assassin_cross':(197,135,249),'stalker':(132,194,156),'high_priest':(244,227,181),'champion':(247,171,75),'whitesmith':(251,160,77),'creator':(139,224,126)}
def frame(job,i):
 t=(i+.5)/N;p=math.sin(math.pi*t);col=COLORS[job];im=Image.new('RGBA',(S*AA,S*AA));d=ImageDraw.Draw(im)
 def rgba(c=col,a=210):return (*c,int(a*p))
 def pt(x,y):return (round(x*AA),round(y*AA))
 def line(points,c=col,w:float=2,a=200):d.line([pt(*q) for q in points],fill=rgba(c,a),width=max(1,round(w*AA)),joint='curve')
 def ellipse(x,y,rx,ry=None,c=col,w:float=1,a=190,fill=False):
  ry=ry or rx;box=[*pt(x-rx,y-ry),*pt(x+rx,y+ry)]
  if fill:d.ellipse(box,fill=rgba(c,a))
  else:d.ellipse(box,outline=rgba(c,a),width=max(1,round(w*AA)))
 def polygon(points,c=col,a=220):d.polygon([pt(*q) for q in points],fill=rgba(c,a))
 def orbit(n,r,ang=0,cy=64,ry=None):return [(64+math.cos(ang+k*math.tau/n)*r,cy+math.sin(ang+k*math.tau/n)*(ry or r)) for k in range(n)]
 white=(255,245,218);phase=t*math.tau
 if job=='lord_knight':
  # Keep the entire lance/trail and glow inside the shared frame crop.
  x=50+34*t;y=90-54*t
  for k in range(3):line([(x-29-k*6,y+22+k*3),(x+16,y-13)],w=4-k,a=190-k*40)
  polygon([(x+23,y-20),(x+10,y-18),(x+20,y-7)],white)
  ellipse(64,72,12+31*t,8+17*t,w=1.5,a=150)
 elif job=='paladin':
  pts=[(64,21),(92,34),(88,74),(64,102),(40,74),(36,34)];line(pts+[pts[0]],w=3);line([(64,34),(64,78)],white,3);line([(49,50),(79,50)],white,3)
  ellipse(64,75,25+24*t,8+8*t,w=1,a=100)
 elif job=='sniper':
  y=30+45*t;span=18+22*p
  line([(64-span,y+12),(64-13,y-4),(64,y+7),(77,y-4),(64+span,y+12)],white,3)
  line([(64-span,y+12),(64-8,y+9),(64,y+20),(72,y+9),(64+span,y+12)],w=2)
  ellipse(64,82,15+10*(1-t),6,w=1.5,a=160)
  for x in [43,64,85]:line([(x,103-25*t),(x,83-25*t)],w=1,a=130)
 elif job=='clown':
  for k,(x,y) in enumerate(orbit(5,27+9*p,phase*.2,70,12)):
   ellipse(x,y,4,2.5,fill=True);line([(x+3,y),(x+3,y-17),(x+11,y-13)],w=2)
  for k in range(3):ellipse(64,74,20+23*t+k*5,7+9*t+k*2,w=1,a=150-k*30)
 elif job=='gypsy':
  for sign in [-1,1]:
   pts=[(64+sign*math.sin(k*.12+phase)*((k/50)*30+6),24+k*1.6) for k in range(51)];line(pts,w=3,a=180);line([(x+sign*3,y) for x,y in pts],white,1,a=160)
  ellipse(64,99,30,9,w=1,a=160)
 elif job=='high_wizard':
  for k,c in enumerate([(245,130,79),(117,191,246),(215,181,249)]):
   ang=phase+k*math.tau/3;x=64+math.cos(ang)*(33*(1-t)+9);y=64+math.sin(ang)*(33*(1-t)+9)
   ellipse(x,y,7+3*p,fill=True,c=c,a=170);line([(64+math.cos(ang-.4)*40,64+math.sin(ang-.4)*40),(x,y),(64,64)],c,2,a=180)
  ellipse(64,64,10+20*t,w=2,a=150);ellipse(64,64,5,fill=True,c=white,a=170)
 elif job=='professor':
  outer=orbit(6,31,phase*.12);inner=orbit(6,15,-phase*.12);line(outer+[outer[0]],w=2);line(inner+[inner[0]],white,1.5)
  for k in range(6):line([outer[k],inner[k]],w=1,a=150);ellipse(*outer[k],2,fill=True)
  ellipse(64,64,43,w=1,a=110)
 elif job=='assassin_cross':
  ext=24+14*p;line([(64-ext,64+ext),(64+ext,64-ext)],w=4,a=200);line([(64-ext,64-ext),(64+ext,64+ext)],white,2,a=190)
  for k in range(4):
   ang=k*math.pi/2+math.pi/4;r=12+34*t;line([(64+math.cos(ang)*r,64+math.sin(ang)*r),(64+math.cos(ang)*(r-9),64+math.sin(ang)*(r-9))],w=2,a=160)
 elif job=='stalker':
  pts=orbit(9,30+6*p,phase*.15,67,24)
  for k,(x,y) in enumerate(pts):ellipse(x,y,5,3,w=2,a=190)
  line([(42,62),(54,55),(63,68),(78,56),(88,64)],white,2);line([(64,43),(59,50),(70,55)],w=2,a=200)
 elif job=='high_priest':
  ellipse(64,93,32,10,w=2,a=170)
  for k in range(5):
   x=42+k*11;h=25+40*p;line([(x,89),(x,89-h)],white,1.5,a=150);ellipse(x,89-h,2,fill=True,c=white,a=170)
  line([(64,28),(64,63)],w=3);line([(51,41),(77,41)],w=3);ellipse(64,45,23,w=1,a=100)
 elif job=='champion':
  r=32*(1-t)+8
  for k,(x,y) in enumerate(orbit(5,r,phase,64)):ellipse(x,y,4+3*p,fill=True,a=200);ellipse(x,y,9,w=1,a=100)
  ellipse(64,64,6+39*t,w=2,a=160);line([(48,64),(80,64)],white,2,a=200)
 elif job=='whitesmith':
  y=27+39*min(1,t*2);polygon([(44,y),(80,y),(80,y+13),(44,y+13)],(198,192,170),180);line([(64,y+11),(64,y+29)],w=5,a=170)
  for k in range(9):
   ang=k*math.tau/9;r=9+33*t;line([(64+math.cos(ang)*r,75+math.sin(ang)*r*.6),(64+math.cos(ang)*(r-7),75+math.sin(ang)*(r-7)*.6)],white,2,a=210)
  ellipse(64,82,15+28*t,6+7*t,w=1.5,a=150)
 elif job=='creator':
  for k,(x,y) in enumerate(orbit(6,10+28*t,phase*.1,65,22)):
   ellipse(x,y,3+4*p,fill=True,a=150,c=col if k%2 else (200,156,244));line([(x,y-7),(x,y+8)],w=1,a=100)
  ellipse(64,66,9+20*p,w=2);ellipse(64,89,20+15*t,7,w=1,a=160)
 # Sparse angular sparks; no opaque background or rectangular halo.
 for k in range(7):
  ang=k*2.399+phase*.2;r=27+19*t;x=64+math.cos(ang)*r;y=65+math.sin(ang)*r*.8
  line([(x-1,y),(x+1,y)],white,1,a=105)
 glow=im.filter(ImageFilter.GaussianBlur(2.5*AA));glow.putalpha(glow.getchannel('A').point(lambda v:int(v*.28)))
 return Image.alpha_composite(glow,im).resize((S,S),Image.Resampling.LANCZOS)
def main():
 out=ROOT/'assets/effects';out.mkdir(parents=True,exist_ok=True);rows=[]
 for job in COLORS:
  frames=[frame(job,i) for i in range(N)];assert len({im.tobytes() for im in frames})==N
  atlas=Image.new('RGBA',(S*COLS,S*math.ceil(N/COLS)))
  for i,im in enumerate(frames):atlas.paste(im,(i%COLS*S,i//COLS*S))
  ident=f'fx_job_veteran_{job}';path=out/f'{ident}.png';atlas.save(path,optimize=True)
  rows.append({'id':ident,'file':f'effects/{ident}.png','cell':[S,S],'columns':COLS,'frames':N,'ms':35,'loop':False,'delayMs':0,'blend':'normal','anchor':[64,64],'attach':'target','scale':2.2,'alpha':.85,'source':{'kind':'original','renderer':'Chronoworld deterministic vector raster','seed':0,'note':'Original veteran signature; authored temporal geometry, not a captured Ragnarok effect.'}})
 if '--register' in sys.argv:
  p=out/'effects.json';cat=json.loads(p.read_text());newids={r['id'] for r in rows};cat['effects']=[x for x in cat['effects'] if x['id'] not in newids]+rows;p.write_text(json.dumps(cat,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'originalAtlases':len(rows),'framesEach':N,'pngBytes':sum((out/Path(r['file']).name).stat().st_size for r in rows),'distinctFramesVerified':True}))
if __name__=='__main__':main()
