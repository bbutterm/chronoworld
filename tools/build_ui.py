#!/usr/bin/env python3
"""Export tested 9-slice UI components from Kenney UI Pack RPG Expansion (CC0)."""
import hashlib
import io
import json
import os
from pathlib import Path
import zipfile
import requests
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets'/'ui'
URL='https://kenney.nl/media/pages/assets/ui-pack-rpg-expansion/7ec4a46657-1677661824/kenney_ui-pack-rpg-expansion.zip'
SHA='c69c30c09d74df542842e4ec811735b6d260cd6c9e2ee261d7b894d259a6adb4'
CACHE=Path(os.environ.get('CHRONOWORLD_KENNEY_CACHE','/root/artifacts/chronoworld-art/kenney_ui-pack-rpg-expansion.zip'))
FONT=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')

def source():
    if not CACHE.exists():
        r=requests.get(URL,timeout=40);r.raise_for_status()
        CACHE.parent.mkdir(parents=True,exist_ok=True);CACHE.write_bytes(r.content)
    data=CACHE.read_bytes()
    if hashlib.sha256(data).hexdigest()!=SHA:raise ValueError('Kenney source ZIP checksum changed')
    z=zipfile.ZipFile(io.BytesIO(data))
    if 'License (CC0)' not in z.read('license.txt').decode('utf-8'):raise ValueError('CC0 license missing')
    return z

def get(z,name):
    return Image.open(io.BytesIO(z.read('PNG/'+name+'.png'))).convert('RGBA')

def save(im,name):
    if im.mode!='RGBA' or im.getbbox() is None:raise ValueError(name)
    p=OUT/name;p.parent.mkdir(parents=True,exist_ok=True);im.save(p,optimize=True)
    return str(p.relative_to(ROOT))

def nine_slice(src,size,edge):
    # Stretch only the center and edge middles; corners remain untouched.
    w,h=size;e=edge;sw,sh=src.size
    out=Image.new('RGBA',size)
    for y0,y1,oy0,oy1 in ((0,e,0,e),(e,sh-e,e,h-e),(sh-e,sh,h-e,h)):
        for x0,x1,ox0,ox1 in ((0,e,0,e),(e,sw-e,e,w-e),(sw-e,sw,w-e,w)):
            crop=src.crop((x0,y0,x1,y1))
            out.alpha_composite(crop.resize((ox1-ox0,oy1-oy0),Image.Resampling.NEAREST),(ox0,oy0))
    return out

def bar(z,color):
    left=get(z,'bar'+color+'_horizontalLeft');mid=get(z,'bar'+color+'_horizontalMid');right=get(z,'bar'+color+'_horizontalRight')
    w,h=256,18
    out=Image.new('RGBA',(w,h));out.alpha_composite(left,(0,0));out.alpha_composite(mid.resize((w-left.width-right.width,h),Image.Resampling.NEAREST),(left.width,0));out.alpha_composite(right,(w-right.width,0))
    return out

def glyph(im,text,color,size):
    if not FONT.exists():raise FileNotFoundError('DejaVuSans-Bold font with Cyrillic glyphs is required')
    d=ImageDraw.Draw(im);font=ImageFont.truetype(str(FONT),size)
    box=d.textbbox((0,0),text,font=font)
    d.text(((im.width-(box[2]-box[0]))//2-box[0],(im.height-(box[3]-box[1]))//2-box[1]),text,font=font,fill=color)


def main():
    z=source();files=[];slices={}
    for filename,color in [('ui_hp_player.png','Green'),('ui_hp_enemy.png','Red'),('ui_energy.png','Yellow'),('ui_bar_base.png','Back')]:
        files.append(save(bar(z,color),filename));slices[filename]={'left':9,'right':9,'top':0,'bottom':0,'repeat':'stretch','source':'Kenney bar'+color}
    empty=nine_slice(get(z,'panel_brown'),(200,200),12)
    files.append(save(empty,'ui_slot_empty.png'))
    occupied=empty.copy();sword=get(z,'cursorSword_gold').resize((90,90),Image.Resampling.NEAREST);occupied.alpha_composite(sword,((200-90)//2,(200-90)//2))
    files.append(save(occupied,'ui_slot_occupied.png'))
    selected=occupied.copy();ImageDraw.Draw(selected).rectangle((5,5,194,194),outline='#F8D28B',width=5)
    files.append(save(selected,'ui_slot_selected.png'))
    for name,source_name,label in [
      ('ui_button_primary.png','buttonLong_brown',None),('ui_button_secondary.png','buttonLong_blue',None),
      ('ui_button_speed.png','buttonLong_beige','1×'),('ui_button_speed_2x.png','buttonLong_beige','2×'),
      ('ui_button_skip.png','buttonLong_brown','Пропуск')]:
        im=get(z,source_name)
        if label:glyph(im,label,'#382d28',18)
        files.append(save(im,name));slices[name]={'left':12,'right':12,'top':12,'bottom':12,'repeat':'stretch','source':'Kenney '+source_name}
    for name,source_name,label,text_color in [
      ('ui_result_victory.png','panel_beigeLight','ПОБЕДА','#6C4926'),
      ('ui_result_defeat.png','panel_blue','ПОРАЖЕНИЕ','#E9EDF5')]:
        src=get(z,source_name).resize((400,400),Image.Resampling.NEAREST)
        im=nine_slice(src,(900,400),48)
        glyph(im,label,text_color,88)
        files.append(save(im,name));slices[name]={'left':48,'right':48,'top':48,'bottom':48,'repeat':'stretch','source':'Kenney '+source_name}
    sheet='kenney_uipack_rpg_sheet.png'
    (OUT/sheet).write_bytes(z.read('Spritesheet/uipack_rpg_sheet.png'))
    (OUT/'kenney_uipack_rpg_sheet.xml').write_bytes(z.read('Spritesheet/uipack_rpg_sheet.xml'))
    (OUT/'KENNEY_LICENSE.txt').write_text(z.read('license.txt').decode('utf-8').replace('\r\n','\n'))
    files.append(str((OUT/sheet).relative_to(ROOT)))
    (OUT/'manifest.json').write_text(json.dumps({'source_url':URL,'source_zip_sha256':SHA,'license':'CC0, bundled in KENNEY_LICENSE.txt','assets':files,'nine_slice':slices,'original_atlas':sheet,'original_atlas_metadata':'kenney_uipack_rpg_sheet.xml'},ensure_ascii=False,indent=2)+'\n')
    print('DONE UI',len(files),'PNG,',len(slices),'stretchable pieces')

if __name__=='__main__':main()
