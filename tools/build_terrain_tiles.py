#!/usr/bin/env python3
"""Deterministic original 128px seamless overhead ground tiles for Chronoworld.

Textures are authored with toroidal noise/stone cells and wrapped strokes. No
source artwork from the game/RO is used; tile PNGs are opaque RGBA for compositing.
"""
from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SIZE = 128
OUT = Path(__file__).resolve().parents[1] / 'assets/tiles'
OUT.mkdir(parents=True, exist_ok=True)
Y, X = np.mgrid[:SIZE, :SIZE]

def noise(seed: int, cutoff: float) -> np.ndarray:
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((SIZE, SIZE))
    fx = np.fft.fftfreq(SIZE)[None, :]
    fy = np.fft.fftfreq(SIZE)[:, None]
    filter_ = np.exp(-0.5 * (fx*fx + fy*fy) / cutoff**2)
    field = np.fft.ifft2(np.fft.fft2(white)*filter_).real
    return (field-field.mean()) / (field.std()+1e-8)

def rgb_field(seed: int, base, amplitude: float=1.0) -> Image.Image:
    broad=noise(seed, .023); mid=noise(seed+17,.085); fine=noise(seed+33,.29)
    shade=amplitude*(8*broad+5*mid+2*fine)
    arr=np.empty((SIZE,SIZE,4),dtype=np.uint8)
    for i,color in enumerate(base):arr[:,:,i]=np.clip(color+shade*(1 if i!=1 else 1.10),0,255).astype('uint8')
    arr[:,:,3]=255
    return Image.fromarray(arr,'RGBA')

def wrapped_lines(im, strokes):
    """Draw same grass/pebbles beyond four edges for actual repeating motifs."""
    layer=Image.new('RGBA',im.size,(0,0,0,0)); d=ImageDraw.Draw(layer)
    for points,color,width in strokes:
        for dx in (-SIZE,0,SIZE):
            for dy in (-SIZE,0,SIZE):
                d.line([(int(x+dx),int(y+dy)) for x,y in points],fill=color,width=width,joint='curve')
    return Image.alpha_composite(im,layer)

def grass(seed, base, density, dry=False):
    rng=np.random.default_rng(seed)
    im=rgb_field(seed,base,1)
    strokes=[]
    for i in range(density):
        x,y=rng.integers(0,SIZE,2); length=int(rng.integers(4,11))
        shade=rng.choice(['dark','mid','bright'],p=[.36,.43,.21])
        palette=({'dark':(42,76,53,205),'mid':(93,138,75,225),'bright':(153,175,99,210)} if not dry
                 else {'dark':(92,95,61,215),'mid':(161,157,91,225),'bright':(196,178,119,205)})
        color=palette[shade]
        # Paired tapered blades, short diagonal strokes distinguish foliage from noise.
        strokes.append(([(x-2,y+2),(x-1,y),(x+int(rng.integers(-3,4)),y-length)],color,1))
        if i%3==0:
            strokes.append(([(x+1,y+2),(x+2,y),(x+int(rng.integers(2,6)),y-length//2)],color,1))
        if i%11==0:strokes.append(([(x-3,y+2),(x+3,y+2)],(34,66,51,125),2))
    im=wrapped_lines(im,strokes)
    if not dry:
        # Tiny light florets are sparse, not an entire dotted checkerboard.
        flowers=[]
        for _ in range(9 if density>120 else 4):
            x,y=rng.integers(0,SIZE,2); c=(224,210,140,225) if rng.random()<.7 else (187,177,204,205)
            flowers += [([(x,y),(x+1,y)],c,1), ([(x,y+1),(x,y+2)],(42,86,59,220),1)]
        im=wrapped_lines(im,flowers)
    return im

def dirt(seed):
    rng=np.random.default_rng(seed)
    im=rgb_field(seed,(122,104,78),1.55)
    strokes=[]
    for i in range(160):
        x,y=rng.integers(0,SIZE,2);r=int(rng.integers(1,4))
        color=(59,59,54,140) if i%3 else (184,153,104,153)
        strokes.append(([(x,y),(x+r,y+int(rng.integers(-1,2)))],color,1))
    # Shallow organic furrows, deliberately sparse so repeated seams do not become roads.
    for i in range(13):
        x,y=rng.integers(0,SIZE,2)
        strokes.append(([(x,y),(x+6,y-2),(x+11,y-1)],(82,72,59,90),1))
    return wrapped_lines(im,strokes)

def stone(seed):
    rng=np.random.default_rng(seed)
    pts=rng.uniform(0,SIZE,(43,2))
    dx=np.abs(X[:,:,None]-pts[:,0]);dy=np.abs(Y[:,:,None]-pts[:,1]);dx=np.minimum(dx,SIZE-dx);dy=np.minimum(dy,SIZE-dy)
    dist=dx*dx+dy*dy
    indices=np.argpartition(dist,2,axis=2)[:,:,:2]
    close=np.take_along_axis(dist,indices,axis=2)
    order=np.argsort(close,axis=2)
    ids=np.take_along_axis(indices,order,axis=2)[:,:,0]
    dd=np.take_along_axis(close,order,axis=2)
    gap=(np.sqrt(dd[:,:,1])-np.sqrt(dd[:,:,0]))<2.9
    grain=5*noise(seed+49,.20)+3*noise(seed+55,.048)
    variation=rng.integers(-18,19,43)
    brightness=grain+variation[ids]
    color=np.array((105,113,110))[None,None,:]+brightness[:,:,None]*np.array((1.0,1.02,1.04))[None,None,:]
    color[gap]=np.clip(color[gap]*.55,0,255)
    result=np.empty((SIZE,SIZE,4),dtype=np.uint8)
    result[:,:,:3]=np.clip(color,0,255).astype('uint8');result[:,:,3]=255
    im=Image.fromarray(result,'RGBA')
    # Tiny lichen patches visually bridge arena stone and grass edges.
    strokes=[]
    for i in range(20):
        x,y=rng.integers(0,SIZE,2)
        if gap[y,x]:strokes.append(([(x,y),(x+2,y-1)],(82,126,93,145),1))
    return wrapped_lines(im,strokes)

def main():
    tiles={
      'tile_grass_01':grass(1204,(73,111,73),174),
      'tile_grass_02':grass(9021,(68,105,74),140),
      'tile_grass_dry':grass(344,(123,130,78),115,True),
      'tile_dirt':dirt(560),
      'tile_stone':stone(707),
    }
    for key,im in tiles.items():
        path=OUT/f'{key}.png';im.save(path,optimize=True)
        print(path.relative_to(OUT.parents[1]),im.size,path.stat().st_size)

if __name__=='__main__':main()
