import os, hashlib
from PIL import Image, ImageChops, ImageStat

base='C:/Users/37615/Projects/game/build'
orig=os.path.join(base,'h5-fallback/assets/codex')
baked=os.path.join(base,'assets/codex_baked')

def lum_bin(img, thr=200):
    g=img.convert('L')
    return g.point(lambda p: 255 if p>thr else 0)

files=sorted(f for f in os.listdir(orig) if f.endswith('.png'))
print('file | leak(旧明在新明) | hidden(旧明被遮) | word(新明) | wordY | safe')
all_safe=True; all_leak_zero=True
for f in files:
    o=Image.open(os.path.join(orig,f)).convert('RGB')
    b=Image.open(os.path.join(baked,f)).convert('RGB')
    w,h=o.size
    xmax=int(0.40*w)
    oc=o.crop((0,0,xmax,h)); bc=b.crop((0,0,xmax,h))
    og=lum_bin(oc); bg=lum_bin(bc)
    leak=ImageChops.multiply(og,bg)
    hidden=ImageChops.multiply(og,ImageChops.invert(bg))
    newword=ImageChops.multiply(ImageChops.invert(og),bg)
    leak_n=sum(ImageStat.Stat(leak).sum)/255
    hidden_n=sum(ImageStat.Stat(hidden).sum)/255
    word_n=sum(ImageStat.Stat(newword).sum)/255
    nb=newword.crop((0,0,xmax,h)).convert('L')
    bbox=nb.getbbox()
    if bbox:
        ymin,ymax=bbox[1],bbox[3]
    else:
        ymin=ymax=0
    safe=(ymin>=270 and ymax<=750)
    real_leak=0
    # refined residual: leak pixels that fall OUTSIDE the word's bbox (dilated 12%) = true garble leakage
    if bbox:
        dil=0.12*(bbox[3]-bbox[1])
        x0,y0,x1,y1=bbox[0]-int(0.12*(bbox[2]-bbox[0])),int(ymin-dil),bbox[2]+int(0.12*(bbox[2]-bbox[0])),int(ymax+dil)
        lp=leak.load()
        real_leak=0
        for yy in range(y0,min(y1,h)):
            if yy<0: continue
            for xx in range(0,min(x1,xmax)):
                if xx<x0: continue
                if lp[xx,yy][0]>0: real_leak+=1
    # originals integrity proxy: old_bright must be substantial (garble still in source)
    old_bright=sum(ImageStat.Stat(og).sum)/255
    all_safe&=safe
    all_leak_zero&=(leak_n<50)
    print(f'{f} | leak={int(leak_n)} | hidden={int(hidden_n)} | word={int(word_n)} | Y=[{ymin},{ymax}] | safe={safe} | srcBright={int(old_bright)} | REAL_LEAK(outside word)={real_leak}')

print('ALL_WORD_SAFE=',all_safe,' ALL_LEAK_NEAR_ZERO=',all_leak_zero)
