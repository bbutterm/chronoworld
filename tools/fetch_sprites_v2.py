#!/usr/bin/env python3
"""Fetch raw native ACT/APNG actions used by build_sprites_v2.py outside Git.

Usage: python tools/fetch_sprites_v2.py --cache ~/.cache/chronoworld/v2
      python tools/build_sprites_v2.py --cache ~/.cache/chronoworld/v2
      python tools/check_sprites.py --source-cache ~/.cache/chronoworld/v2
"""
from __future__ import annotations
import argparse,io
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
import requests
from PIL import Image
from build_sprites_v2 import HEROES,MONSTERS,CACHE_ALIASES,HERO_ACTION,MON_ACTION
DEFAULT=Path.home()/'.cache/chronoworld/v2'
URL='https://assets.latam-tools.com.br/image'

def sources():
 tasks={}
 for name,(job,_,gender,w,s,_,_) in HEROES.items():
  for anim,action in HERO_ACTION.items():
   if anim=='attack' and name in ('assassin','archer'):
    # Equipped attack variant 2 was fetched as cast_94 in original audit.
    label,action='cast',94
   else:label=anim
   dest=f'{name}_{label}_{action}_w{w}_s{s}.png'
   tasks[dest]={'job':job,'gender':gender,'head':1,'weapon':w,'shield':s,'action':action,
                'enableShadow':'false','canvas':'512x640+256+480'}
 for name,(_,job) in MONSTERS.items():
  for anim,action in MON_ACTION.items():
   dest=f'{CACHE_ALIASES.get(name,name)}_{anim}_{action}_w0_s0.png'
   tasks[dest]={'job':job,'action':action,'enableShadow':'false','canvas':'512x640+256+480'}
 return tasks

def fetch(item,cache):
 name,params=item;dest=cache/name
 if dest.exists():
  try:
   with Image.open(dest) as im:
    if im.size==(512,640) and getattr(im,'n_frames',1)>0:return name,'cached'
  except OSError:pass
 for attempt in range(3):
  try:
   r=requests.get(URL,params=params,timeout=60);r.raise_for_status()
   with Image.open(io.BytesIO(r.content)) as im:
    if im.size!=(512,640) or getattr(im,'n_frames',1)<1:raise ValueError(f'bad source {name}')
   tmp=dest.with_suffix('.tmp');tmp.write_bytes(r.content);tmp.replace(dest)
   return name,'downloaded'
  except (requests.RequestException,OSError,ValueError):
   if attempt==2:raise
 raise RuntimeError(name)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--cache',type=Path,default=DEFAULT)
 p.add_argument('--workers',type=int,default=6);args=p.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
 results=[]
 with ThreadPoolExecutor(max_workers=args.workers) as ex:
  jobs={ex.submit(fetch,item,args.cache):item[0] for item in sources().items()}
  for future in as_completed(jobs):
   try:results.append(future.result())
   except Exception as e:print('FAIL',jobs[future],e,flush=True);raise SystemExit(1)
 print(f'validated {len(results)} source APNG files ({sum(s=="downloaded" for _,s in results)} downloaded), cache={args.cache}')
