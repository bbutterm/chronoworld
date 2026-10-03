#!/usr/bin/env python3
"""Import a QA-approved first-profession batch, without changing source sheets.
New hero-specific IDs never replace generic professions or promoted forms.
Portraits follow the existing native 64x64 idle0 bust crop, enlarged 4x nearest.
"""
import hashlib,json,shutil,sys
from pathlib import Path
from PIL import Image
import sprites_manifest
ROOT=Path(__file__).resolve().parents[1]
ANIMS=['idle','walk','attack','cast','hurt','death'];COUNTS=[4,8,6,6,3,4]
def sha(b):return hashlib.sha256(b).hexdigest()
def main(index):
 batch=json.loads(Path(index).read_text());data=sprites_manifest.load();existing={s['id'] for s in data['sprites']}
 selected=[a for a in batch['assets'] if a['hero_id'] in {'alan','kai','bran','greta'}]
 assert len(selected)==4 and {a['hero_id'] for a in selected}=={'alan','kai','bran','greta'},'Expected exactly four distinct authorized heroes'
 assert len({a['new_sprite_id'] for a in selected})==4,'Sprite IDs must be distinct'
 for a in selected:
  sid=a['new_sprite_id'];assert sid not in existing,(sid,'already registered')
  raw=Path(a['sheet']).read_bytes();assert sha(raw)==a['sheet_sha256']
  im=Image.open(a['sheet']).convert('RGBA');assert im.size==(1792,1152)
  draft=json.loads(Path(a['runtime_import']).read_text());draft=draft['sprites'][0] if 'sprites' in draft else draft
  assert draft['id']==sid
  boxes={};proofs={};alphas=set()
  for row,(name,count) in enumerate(zip(ANIMS,COUNTS)):
   bbs=[]
   for col in range(8):
    f=im.crop((col*224,row*192,(col+1)*224,(row+1)*192));b=f.getchannel('A').getbbox()
    if col>=count:assert b is None;continue
    assert b and 0<b[0]<b[2]<224 and 0<b[1]<b[3]<192
    bbs.append(b);alphas.update(f.getchannel('A').getdata())
   boxes[name]=[min(b[0] for b in bbs),min(b[1] for b in bbs),max(b[2] for b in bbs),max(b[3] for b in bbs)]
   proofs[name]=[[b[0]-104,b[1]-144,b[2]-104,b[3]-144] for b in bbs]
  assert boxes==draft['bbox'],sid
  sheet=f'sprites/heroes/{sid}.png';(ROOT/'assets'/sheet).write_bytes(raw)
  portrait=f'sprites/portraits/{sid}.png';im.crop((72,56,136,120)).resize((256,256),Image.Resampling.NEAREST).save(ROOT/'assets'/portrait,optimize=True)
  hp=ROOT/'data/heroes'/f"{a['hero_id']}.json";hero=json.loads(hp.read_text());assert hero['job']==a['job_id']
  prior=hero.get('visual',{}).get('sprite');hero['visual']={'sprite':sid};hp.write_text(json.dumps(hero,ensure_ascii=False,indent=2)+'\n')
  data['sprites'].append({'id':sid,'class':'hero','file':sheet,'portrait':portrait,'hitFrames':{'attack':3,'cast':4},'bbox':boxes,'source':{'gender':{'m':'male','f':'female'}[hero['gender']],'renderer':'QA-approved current detail atlas, copied byte-for-byte','sheetSha256':sha(raw),'sourceSpriteId':a['source_sprite_id'],'heroId':a['hero_id'],'stage':'first'},'sourceFrameBboxes':proofs,'sourceFrameIndices':{n:list(range(c)) for n,c in zip(ANIMS,COUNTS)},'sourceFrameCounts':dict(zip(ANIMS,COUNTS)),'sourceAlphaValues':sorted(alphas-{0,255}),'portraitSource':{'frame':0,'crop':[72,56,136,120],'size':[256,256],'resample':'nearest','sha256':sha((ROOT/'assets'/portrait).read_bytes())},'integration':{'priorFirstProfessionSprite':prior,'genericSourceRetained':True,'promotedFormsUnchanged':True}})
  print(a['hero_id'],sid,sha(raw))
 sprites_manifest.save(data)
if __name__=='__main__':main(sys.argv[1])
