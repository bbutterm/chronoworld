#!/usr/bin/env python3
"""Build original, transparent priority-1 UI and *static* combat FX PNGs.

Draw at 2x/3x resolution and downsample for smooth alpha. No third-party art.
The background is separately authored; this script never overwrites it.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import math

ROOT = Path(__file__).resolve().parents[1] / 'assets'
GOLD = '#e8bd66'; GOLD_DARK = '#79512d'; INK = '#263343'

def canvas(size, scale=3):
    im = Image.new('RGBA', (size*scale,size*scale), (0,0,0,0))
    return im, ImageDraw.Draw(im), scale

def poly(d, points, s, fill, outline=None, width=2):
    pts=[(round(x*s),round(y*s)) for x,y in points]
    d.polygon(pts, fill=fill)
    if outline:d.line(pts+[pts[0]], fill=outline,width=width*s,joint='curve')

def ellipse(d, box, s, fill, outline=None, width=2):
    d.ellipse(tuple(round(z*s) for z in box), fill=fill, outline=outline,width=width*s)

def line(d,points,s,fill,width=2):
    d.line([(round(x*s),round(y*s)) for x,y in points],fill=fill,width=width*s,joint='curve')

def save(im, relative, size):
    p=ROOT/relative;p.parent.mkdir(parents=True,exist_ok=True)
    if im.size!=(size,size):im=im.resize((size,size),Image.Resampling.LANCZOS)
    im.save(p,optimize=True)
    return p

def nav(name,active):
    im,d,s=canvas(128)
    if active:
        ellipse(d,(9,9,119,119),s,'#344b5a',INK,2)
        ellipse(d,(17,17,111,111),s,'#596a69','#8fbcad',1)
        ellipse(d,(26,26,102,102),s,'#374954',GOLD_DARK,2)
        fg='#ffdf91';shadow='#724a31'
    else:
        ellipse(d,(19,19,109,109),s,'#5d6673',INK,2)
        ellipse(d,(23,23,105,105),s,'#9197a2','#c5c6c5',1)
        ellipse(d,(29,29,99,99),s,'#535e6e','#313d4c',2)
        fg='#d9dacb';shadow='#384453'
    if name=='campaign':
        # Rolled map, route and destination diamond.
        poly(d,[(36,40),(55,34),(76,40),(94,34),(94,86),(76,92),(56,86),(36,92)],s,'#d6c092' if active else '#b5b7b4',shadow,3)
        line(d,[(56,36),(56,85),(76,91),(76,40)],s,shadow,2)
        line(d,[(44,77),(50,67),(61,66),(67,55),(79,52)],s,shadow,3)
        poly(d,[(82,42),(91,52),(82,62),(73,52)],s,fg,shadow,2)
    elif name=='heroes':
        # Helmet with plume, rigid visor and paired pauldrons.
        poly(d,[(34,83),(41,71),(50,67),(52,47),(62,36),(76,39),(85,51),(81,67),(92,76),(93,85)],s,fg,shadow,3)
        poly(d,[(52,50),(68,44),(84,51),(82,61),(57,61)],s,'#8bacc0' if active else '#9aabb1',shadow,2)
        line(d,[(50,68),(82,68)],s,shadow,3)
        line(d,[(61,72),(71,72)],s,shadow,3)
        poly(d,[(63,35),(69,22),(82,31),(76,39)],s,'#c97660' if active else '#abb0ae',shadow,2)
    else: # home: guild hall / camp lodge
        poly(d,[(28,58),(64,29),(100,58),(92,64),(87,87),(40,87),(36,64)],s,fg,shadow,3)
        poly(d,[(29,58),(64,29),(100,58),(95,66),(64,43),(33,66)],s,'#b96f57' if active else '#84949b',shadow,2)
        d.rectangle((47*s,63*s,81*s,87*s),fill='#6c5447',outline=shadow,width=2*s)
        poly(d,[(58,87),(58,69),(70,69),(70,87)],s,'#cfb98f',shadow,2)
        ellipse(d,(76,73,80,77),s,fg)
    save(im,f'ui/ui_nav_{name}{"_active" if active else ""}.png',128)

def currency(gem=False):
    im,d,s=canvas(96,4)
    if gem:
        poly(d,[(23,39),(37,19),(60,15),(77,36),(73,60),(49,82),(24,62)],s,'#316083',INK,3)
        poly(d,[(23,39),(37,19),(49,43),(24,62)],s,'#75e4ec')
        poly(d,[(37,19),(60,15),(77,36),(49,43)],s,'#b4f9ef')
        poly(d,[(49,43),(77,36),(73,60),(49,82)],s,'#287fb8')
        poly(d,[(24,62),(49,43),(49,82)],s,'#46bcd1')
        line(d,[(23,39),(37,19),(60,15),(77,36),(73,60),(49,82),(24,62),(23,39)],s,INK,3)
        line(d,[(49,43),(37,19)],s,'#e5fff1',2)
    else:
        ellipse(d,(12,12,84,84),s,'#8f5a28',INK,3)
        ellipse(d,(17,16,78,77),s,'#eac16f','#ffebaa',3)
        ellipse(d,(24,23,71,70),s,'#d89b42',GOLD_DARK,2)
        poly(d,[(45,30),(55,30),(55,40),(63,40),(63,50),(54,50),(54,59),(44,59),(44,50),(35,50),(35,41),(45,41)],s,'#ffdfa0',GOLD_DARK,2)
        line(d,[(29,30),(40,24),(59,24)],s,'#fff4bb',2)
    save(im,'ui/ui_icon_gem.png' if gem else 'ui/ui_icon_gold.png',96)

def chest(state):
    im,d,s=canvas(300,3)
    ellipse(d,(30,253,270,277),s,(13,20,30,76))
    # thick wooden back and side; all states share exact base silhouette
    poly(d,[(51,130),(236,130),(256,150),(255,241),(229,255),(56,252),(41,231),(41,152)],s,'#51372f',INK,4)
    poly(d,[(50,144),(225,145),(247,156),(247,232),(228,243),(51,241)],s,'#995e39',INK,4)
    for x in (75,210):
        d.rounded_rectangle((x*s,149*s,(x+17)*s,241*s),radius=4*s,fill='#cc984e',outline=GOLD_DARK,width=2*s)
    line(d,[(57,222),(233,224)],s,'#c78143',4)
    # lid pivots upward for full; empty lid visibly open too
    if state=='empty':
        poly(d,[(44,134),(62,87),(227,80),(257,136),(239,150),(55,152)],s,'#5a3a30',INK,4)
        poly(d,[(65,90),(224,84),(241,129),(59,135)],s,'#a06b43',INK,3)
        ellipse(d,(80,161,219,211),s,'#2c2830')
    elif state=='filling':
        poly(d,[(43,136),(57,101),(223,99),(256,138),(239,155),(54,155)],s,'#a96a3d',INK,4)
        poly(d,[(60,106),(220,105),(239,136),(57,136)],s,'#c28a4d',GOLD_DARK,3)
        ellipse(d,(84,138,218,170),s,'#664432')
        poly(d,[(91,159),(109,139),(126,161)],s,'#e3b55f',GOLD_DARK,2)
        poly(d,[(137,155),(154,131),(172,160)],s,'#e3b55f',GOLD_DARK,2)
    else:
        # Rays and coins are behind an open golden lid, no detached placeholder shine.
        for angle in range(0,360,45):
            a=math.radians(angle);cx,cy=150,119
            line(d,[(cx+75*math.cos(a),cy+75*math.sin(a)),(cx+98*math.cos(a),cy+98*math.sin(a))],s,'#f9d880',3)
        for x,y in [(91,135),(125,119),(160,122),(197,137),(115,149),(182,148)]:
            ellipse(d,(x-17,y-11,x+17,y+11),s,'#edbf58',GOLD_DARK,2)
            line(d,[(x-7,y-4),(x+8,y-4)],s,'#ffe7a1',2)
        poly(d,[(44,137),(58,82),(224,72),(255,138),(235,149),(54,150)],s,'#aa7044',INK,4)
        poly(d,[(62,87),(220,79),(239,129),(59,132)],s,'#cb9557',GOLD_DARK,3)
        ellipse(d,(80,151,219,184),s,'#794c30')
        # Visible overflowing treasure in front of the lid, not hidden behind it.
        for x,y in [(83,153),(108,160),(133,151),(160,158),(185,151),(211,161),(114,179),(175,177)]:
            ellipse(d,(x-15,y-11,x+15,y+10),s,'#f1c865',GOLD_DARK,2)
            line(d,[(x-8,y-5),(x+4,y-6)],s,'#fff0ad',2)
        for x,y in [(91,118),(198,113),(70,171),(224,180)]:
            poly(d,[(x,y-8),(x+4,y),(x,y+8),(x-4,y)],s,'#fff6b6')
    # iron-gold bands, lock and staple belong to all three
    line(d,[(42,148),(256,148)],s,'#ddac5d',8)
    line(d,[(43,148),(255,148)],s,'#694936',2)
    d.rounded_rectangle((131*s,139*s,169*s,194*s),radius=5*s,fill='#edc571',outline=INK,width=3*s)
    ellipse(d,(143,151,157,168),s,'#735132',INK,2)
    poly(d,[(148,164),(152,164),(157,180),(143,180)],s,'#735132')
    if state=='filling':
        ellipse(d,(117,195,184,213),s,'#715235',INK,2)
        d.rounded_rectangle((121*s,199*s,153*s,209*s),radius=3*s,fill='#f0c364')
    if state=='full':
        poly(d,[(145,47),(151,30),(157,47),(171,51),(157,56),(150,72),(145,56),(130,51)],s,'#fff1a4','#ac793e',1)
    save(im,f'ui/ui_chest_{state}.png',300)

# FX are deliberately separate static decals; no implied frame count or temporal animation.
def fx(name,size):
    im,d,s=canvas(size,3);c=size/2
    if name=='arrow':
        poly(d,[(6,37),(38,32),(45,24),(56,31),(47,36),(57,41),(45,47),(39,39),(6,44)],s,'#b57b43',INK,2)
        poly(d,[(48,29),(56,22),(54,34),(58,39),(50,42),(43,37)],s,'#e0e9db',INK,2)
        line(d,[(9,40),(50,36)],s,'#ffe5a6',2)
        for a in [16,22,28]:line(d,[(a,37),(a-8,29)],s,'#c3dec8',2)
    elif name=='hit':
        for i in range(12):
            a=2*math.pi*i/12;r=105 if i%2==0 else 73
            line(d,[(c+26*math.cos(a),c+26*math.sin(a)),(c+r*math.cos(a),c+r*math.sin(a))],s,'#db744b',5 if i%2 else 8)
        poly(d,[(c+math.cos(i*math.pi/8)*(70 if i%2==0 else 32),c+math.sin(i*math.pi/8)*(70 if i%2==0 else 32)) for i in range(16)],s,'#f3c476','#963d36',2)
        ellipse(d,(c-24,c-24,c+24,c+24),s,'#fff2d0')
    elif name=='magic':
        for radius,color,width in [(92,'#6054ba',5),(74,'#9a6ae2',3),(47,'#b4c3ff',4)]:
            ellipse(d,(c-radius,c-radius,c+radius,c+radius),s,None,color,width)
        poly(d,[(c,c-65),(c+60,c),(c,c+65),(c-60,c)],s,(91,89,196,115),'#d9c7ff',3)
        for i in range(8):
            a=i*math.pi/4;xx,yy=c+95*math.cos(a),c+95*math.sin(a)
            ellipse(d,(xx-5,yy-5,xx+5,yy+5),s,'#e0d7ff')
        ellipse(d,(c-18,c-18,c+18,c+18),s,'#f8ecff')
    elif name=='heal':
        for r in (77,52):ellipse(d,(c-r,c-r,c+r,c+r),s,None,'#80dca6',4)
        for i in range(8):
            a=i*math.pi/4;xx,yy=c+92*math.cos(a),c+92*math.sin(a)
            ellipse(d,(xx-7,yy-7,xx+7,yy+7),s,'#bcf4be')
        poly(d,[(c-16,c-53),(c+16,c-53),(c+16,c-16),(c+53,c-16),(c+53,c+16),(c+16,c+16),(c+16,c+53),(c-16,c+53),(c-16,c+16),(c-53,c+16),(c-53,c-16),(c-16,c-16)],s,'#e8fff1','#338e83',3)
        line(d,[(c-10,c-43),(c+8,c-43)],s,'#ffffff',3)
    elif name=='shield':
        poly(d,[(c,c-100),(c+78,c-70),(c+72,c+29),(c+49,c+69),(c,c+105),(c-49,c+69),(c-72,c+29),(c-78,c-70)],s,(65,144,180,125),'#9ce7ed',6)
        poly(d,[(c,c-78),(c+56,c-55),(c+50,c+23),(c+33,c+53),(c,c+77),(c-33,c+53),(c-50,c+23),(c-56,c-55)],s,(123,192,196,60),'#d7f9e8',2)
        poly(d,[(c-20,c-9),(c,c-53),(c+20,c-9),(c+13,c+32),(c,c+46),(c-13,c+32)],s,'#dbf9e8','#4b99ac',3)
    elif name=='death':
        # Violet embers around a dissolving skull; transparent between particles.
        for i in range(14):
            a=2*math.pi*i/14;r=55+18*(i%3);x=c+r*math.cos(a);y=c+r*math.sin(a)
            ellipse(d,(x-6,y-6,x+6,y+6),s,'#9a80b3' if i%2 else '#6d608c')
        ellipse(d,(c-48,c-66,c+48,c+40),s,(100,81,136,170),'#c5a8d2',3)
        poly(d,[(c-31,c+22),(c+31,c+22),(c+23,c+63),(c-23,c+63)],s,(107,83,132,160),'#c5a8d2',2)
        ellipse(d,(c-29,c-19,c-7,c+4),s,'#34304d')
        ellipse(d,(c+7,c-19,c+29,c+4),s,'#34304d')
        poly(d,[(c,c+4),(c+8,c+20),(c-8,c+20)],s,'#34304d')
        for x in (-13,0,13):line(d,[(c+x,c+37),(c+x,c+53)],s,'#d6bfd9',2)
    else:raise ValueError(name)
    save(im,f'fx/fx_{name}.png',size)

if __name__=='__main__':
    for item in ('campaign','heroes','home'):
        for active in (False,True):nav(item,active)
    for is_gem in (False,True):currency(is_gem)
    for state in ('empty','filling','full'):chest(state)
    for name,size in [('hit',256),('arrow',64),('magic',256),('heal',256),('shield',256),('death',256)]:fx(name,size)
    print('Built 17 transparent UI/FX PNGs in',ROOT)
