#!/usr/bin/env python3
"""Extract original RO third/fourth jobs for the existing 12 heroes, assets only.

No game data, skills, effects, or runtime integration. Raw APNG stays outside Git.
Job IDs: rAthena src/common/mmo.hpp; visuals: ragassets /image.
"""
from __future__ import annotations
import argparse, concurrent.futures, io, json, sys
from pathlib import Path
import requests
from PIL import Image, ImageDraw, ImageFont
import build_sprites_v2 as base
import fetch_sprites_v2 as fetcher

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path.home()/'.cache/chronoworld/jobs-3-4'
QA = Path.home()/'artifacts/chronoworld-jobs-3-4'
# second-job stem, third ID/stem/name, fourth ID/stem/name, legal gender
LINES = [
 ('knight',4054,'rune_knight','Rune Knight',4252,'dragon_knight','Dragon Knight','both'),
 ('crusader',4066,'royal_guard','Royal Guard',4258,'imperial_guard','Imperial Guard','both'),
 ('hunter',4056,'ranger','Ranger',4257,'windhawk','Windhawk','both'),
 ('bard',4068,'minstrel','Minstrel',4263,'troubadour','Troubadour','male'),
 ('dancer',4069,'wanderer','Wanderer',4264,'trouvere','Trouvere','female'),
 ('wizard',4055,'warlock','Warlock',4255,'arch_mage','Arch Mage','both'),
 ('sage',4067,'sorcerer','Sorcerer',4261,'elemental_master','Elemental Master','both'),
 ('assassin',4059,'guillotine_cross','Guillotine Cross',4254,'shadow_cross','Shadow Cross','both'),
 ('rogue',4072,'shadow_chaser','Shadow Chaser',4260,'abyss_chaser','Abyss Chaser','both'),
 ('priest',4057,'archbishop','Archbishop',4256,'cardinal','Cardinal','both'),
 ('monk',4070,'sura','Sura',4262,'inquisitor','Inquisitor','both'),
 ('blacksmith',4058,'mechanic','Mechanic',4253,'meister','Meister','both'),
 ('alchemist',4071,'genetic','Genetic',4259,'biolo','Biolo','both'),
]
FAMILIES = {
 'knight':('alan','iris'), 'crusader':('alan','iris'),
 'hunter':('bran','meilin'), 'bard':('bran','meilin'), 'dancer':('bran','meilin'),
 'wizard':('kai','lira'), 'sage':('kai','lira'),
 'assassin':('dorn','zara'), 'rogue':('dorn','zara'),
 'priest':('teo','vika'), 'monk':('teo','vika'),
 'blacksmith':('otto','greta'), 'alchemist':('otto','greta'),
}
NAMES: dict[str, str] = dict(zip(('alan','iris','bran','meilin','kai','lira','dorn','zara','teo','vika','otto','greta'),
                ('Алан','Ирис','Бран','Мэйлин','Кай','Лира','Дорн','Зара','Тео','Вика','Отто','Грета')))
# Keep named-story identity where available; other heroes inherit an existing form.
IDENTITY = {'alan':'hero_alan_swordman','iris':'knight_f','bran':'hero_bran_archer',
 'meilin':'hunter_f','kai':'wizard_m','lira':'wizard_f','dorn':'hero_dorn_thief',
 'zara':'assassin_f','teo':'priest_m','vika':'hero_vika_acolyte','otto':'blacksmith_m','greta':'blacksmith_f'}


def roster():
    old = base.sprites_manifest.load(base.OUT/'sprites.json')
    entries = {x['id']:x for x in old['sprites']}
    result = []
    for parent,j3,s3,n3,j4,s4,n4,legal in LINES:
        for suffix,gender,idx in [('m','male',0),('f','female',1)]:
            if legal not in ('both',gender): continue
            hero = FAMILIES[parent][idx]
            previous = entries[f'{parent}_{suffix}']['source']
            identity_source = IDENTITY[hero]
            hair = entries[identity_source]['source']['hair']
            for stage,job,stem,name in [(3,j3,s3,n3),(4,j4,s4,n4)]:
                result.append(dict(id=f'{stem}_{suffix}',stage=stage,job=job,name=name,gender=gender,
                    hero=hero,heroName=NAMES[hero],parent=f'{parent}_{suffix}',identitySource=identity_source,
                    head=hair['style'],palette=hair['palette'],weapon=previous['weaponView'],
                    shield=previous['shieldView'],item=previous['itemId'],shieldItem=previous['shieldItemId'],
                    weaponName=previous.get('weaponItemName')))
    assert len(result)==48 and len({x['id'] for x in result})==48
    return result


def configure(items):
    # The live manifest can contain newer boss/NPC classes absent from the generic builder.
    contract = base.sprites_manifest.load(base.OUT/'sprites.json')
    base.CLASSES = contract['classes']
    base.ANIMS = contract['anims']
    base.OVERRIDES = contract['animOverrides']
    base.HEROES = {x['id']:(x['job'],x['name'],x['gender'],x['weapon'],x['shield'],x['item'],x['shieldItem']) for x in items}
    base.HERO_APPEARANCE = {x['id']:(x['head'],x['palette']) for x in items}
    base.CARD_HEROES = tuple(base.HEROES)
    base.CARD_WEAPON_NAMES = {x['id']:x['weaponName'] for x in items}
    base.MONSTERS = {}
    fetcher.HEROES = base.HEROES
    fetcher.HERO_APPEARANCE = base.HERO_APPEARANCE
    fetcher.MONSTERS = {}


def get_source(task):
    name,params = task
    dest = CACHE/name
    if dest.exists():
        with Image.open(dest) as im:
            if im.size==(512,640) and im.convert('RGBA').getbbox(): return name,'cached'
    r = requests.get(fetcher.URL,params=params,timeout=70)
    r.raise_for_status()  # do not retry rate limits or missing source resources
    with Image.open(io.BytesIO(r.content)) as im:
        if im.size!=(512,640) or not im.convert('RGBA').getbbox():
            raise ValueError('Empty or invalid original image: '+name)
    temp = dest.with_suffix('.part');temp.write_bytes(r.content);temp.replace(dest)
    return name,'downloaded'


def main():
    p=argparse.ArgumentParser();p.add_argument('--workers',type=int,default=3)
    args=p.parse_args();CACHE.mkdir(parents=True,exist_ok=True);QA.mkdir(parents=True,exist_ok=True)
    items=roster();configure(items)
    (QA/'roster.json').write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n')
    sources=fetcher.sources();errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures={ex.submit(get_source,t):t[0] for t in sources.items()}
        count=0
        for future in concurrent.futures.as_completed(futures):
            count+=1
            try:
                name,state=future.result()
                if count%12==0: print('SOURCE',count,'/',len(futures),name,state,flush=True)
            except Exception as e:
                errors.append({'file':futures[future],'error':str(e)})
                print('SOURCE_FAIL',futures[future],str(e),flush=True)
                if isinstance(e,requests.HTTPError) and e.response.status_code==429:
                    for f in futures:f.cancel()
                    raise RuntimeError('Rate limited: stopped, no retries') from e
    failed_files={e['file'] for e in errors}
    complete=[];blocked=[]
    for x in items:
        needed=list(fetcher.sources(x['id']))
        if any(n in failed_files or not (CACHE/n).exists() for n in needed):
            blocked.append({'id':x['id'],'reason':'One or more original actions unavailable'});continue
        try:
            base.build(CACHE,Path('/nonexistent/oxipng'),only=x['id'])
            m=base.sprites_manifest.load(base.OUT/'sprites.json')
            entry=next(s for s in m['sprites'] if s['id']==x['id'])
            entry['source'].update(heroId=x['hero'],heroName=x['heroName'],jobStage=x['stage'],
                                   previousForm=x['parent'],identitySource=x['identitySource'])
            entry['sourceLimitations']['cast']='Original generic RO action 102, not individual skill VFX.'
            entry['portraitSource']='Nearest-neighbor 4x enlargement of a native 64x64 ready-pose crop.'
            base.sprites_manifest.save(m,base.OUT/'sprites.json')
            complete.append(x['id'])
        except Exception as e:
            blocked.append({'id':x['id'],'reason':str(e)})
            print('BUILD_FAIL',x['id'],str(e),flush=True)
            # Failed builder can leave a portrait before it detects later overflow.
            portrait=base.OUT/'portraits'/f"{x['id']}.png"
            if portrait.exists():portrait.unlink()
    report={'requested':len(items),'completed':complete,'blocked':blocked,'sourceErrors':errors}
    (QA/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    md=['# Третьи и четвёртые профессии — запас ассетов','',
        'Исходные RO-кадры, без AI-перерисовки. Только 12 героев текущего ростера и обе их ветки.',
        'Мужские и женские формы; музыкальная ветка сохраняет ограничения пола оригинального RO.',
        'Расширенные классы Ninja/Taekwon/Gunslinger/Summoner не входят в текущий ростер.',
        'Это подготовленные ассеты: навыки, баланс, данные профессий и подключение в игру не добавлены.',
        'Родной масштаб x1, клетки 224×192, якорь (104,144), 8 колонок, шесть анимаций.',
        'Портреты 256×256. Причёски наследуются от сохранённых сюжетных/базовых форм.',
        'Источник визуала: https://assets.latam-tools.com.br/image',
        'Job ID: https://github.com/rathena/rathena/blob/master/src/common/mmo.hpp',
        'Оружие унаследовано от ветки второй профессии; renderer может скрывать его в отдельных позах.',
        'Raw APNG и контактные листы находятся вне Git. Игровые тесты/build не запускались.', '',
        '| ID | Герой | Этап | RO job | Пол | Причёска / палитра | Статус |',
        '| --- | --- | --- | --- | --- | --- | --- |']
    for x in items:
        md.append(f"| `{x['id']}` | {x['heroName']} | {x['stage']} | {x['job']} | {x['gender']} | {x['head']} / {x['palette']} | {'готово' if x['id'] in complete else 'недоступно'} |")
    if blocked:
        md.extend(['','## Не собраны']+[f"- `{b['id']}`: {b['reason']}" for b in blocked])
    (ROOT/'docs/art').mkdir(parents=True,exist_ok=True)
    (ROOT/'docs/art/RO_JOBS_3_4.md').write_text('\n'.join(md)+'\n')
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',13)
    for stage in (3,4):
        subset=[x for x in items if x['stage']==stage]
        canvas=Image.new('RGB',(960,6*255),(32,38,48));draw=ImageDraw.Draw(canvas)
        for i,x in enumerate(subset):
            left=(i%4)*240;top=(i//4)*255
            if x['id'] in complete:
                with Image.open(base.OUT/'heroes'/f"{x['id']}.png") as sheet:
                    frame=sheet.convert('RGBA').crop((0,0,224,192))
                    canvas.paste(frame,(left+8,top+4),frame)
            draw.text((left+8,top+193),x['id'],font=font,fill='white')
            draw.text((left+8,top+214),x['heroName']+f" / {x['head']}:{x['palette']}",font=font,fill=(170,200,220))
        canvas.save(QA/f'jobs-{stage}-preview.jpg',quality=88,optimize=True)
    print('FINAL',json.dumps(report,ensure_ascii=False),flush=True)
    return 0 if not blocked else 2

if __name__=='__main__':sys.exit(main())
