import json, sys, random
W,H=340,214
INSET=22
def chip(x,y,kind,id,w=40,h=31):
    a,b,c=(('#f6e3a1','#cfa449','#8a6424') if kind=='gold' else ('#f2f4f6','#b4bac2','#6b7280'))
    return f'''<g transform="translate({x},{y})"><defs><linearGradient id="ch{id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset=".5" stop-color="{b}"/><stop offset="1" stop-color="{a}"/></linearGradient></defs>
<rect width="{w}" height="{h}" rx="5.5" fill="url(#ch{id})" stroke="{c}" stroke-opacity=".5" stroke-width=".7"/>
<path d="M0 {h*.33:.1f}H{w*.3:.1f}M0 {h*.66:.1f}H{w*.3:.1f}M{w*.7:.1f} {h*.33:.1f}H{w}M{w*.7:.1f} {h*.66:.1f}H{w}M{w*.3:.1f} 0V{h}M{w*.7:.1f} 0V{h}" stroke="{c}" stroke-opacity=".55" stroke-width=".8" fill="none"/>
<rect x="{w*.3:.1f}" y="{h*.22:.1f}" width="{w*.4:.1f}" height="{h*.56:.1f}" rx="3" fill="none" stroke="{c}" stroke-opacity=".55" stroke-width=".8"/></g>'''
def contactless(x,y,col):
    return f'<g transform="translate({x},{y})" fill="none" stroke="{col}" stroke-width="1.7" stroke-linecap="round" opacity=".9"><path d="M2 6c2 2.6 2 7.4 0 10"/><path d="M7 3c3.6 4.4 3.6 11.6 0 16"/><path d="M12 0c5 6 5 16 0 22"/></g>'
F="font-family=\"-apple-system,'SF Pro Text',system-ui\""
def card(id, defs, art, bank, product, ink, chipkind, last4, holder='CARDHOLDER NAME', bank_col=None, product_col=None, edge='rgba(255,255,255,.35)', shadow=True):
    ts='filter="url(#ts%s)"'%id if shadow else ''
    return f'''<svg viewBox="0 0 {W} {H}" width="{W}" height="{H}" style="border-radius:15px;box-shadow:0 10px 22px rgba(0,0,0,.2),0 2px 4px rgba(0,0,0,.1);display:block">
<defs>{defs}<clipPath id="cl{id}"><rect width="{W}" height="{H}" rx="15"/></clipPath>
<linearGradient id="sh{id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".1"/></linearGradient>
<filter id="ts{id}" x="-10%" y="-30%" width="120%" height="160%"><feDropShadow dx="0" dy=".8" stdDeviation=".9" flood-color="#000" flood-opacity=".35"/></filter></defs>
<g clip-path="url(#cl{id})">{art}<rect width="{W}" height="{H}" fill="url(#sh{id})"/></g>
<rect x=".5" y=".5" width="{W-1}" height="{H-1}" rx="14.5" fill="none" stroke="{edge}"/>
<text x="{INSET}" y="{INSET+14}" {F} font-size="18" font-weight="700" letter-spacing=".3" fill="{bank_col or ink}" {ts}>{bank}</text>
{chip(INSET,round(H*.37),chipkind,id) if chipkind in ('gold','silver') else ''}
{contactless(INSET+50,round(H*.37)+5,ink) if chipkind in ('gold','silver') else (contactless(INSET,round(H*.37)+5,ink) if chipkind=='nfc' else '')}
<text x="{INSET}" y="{H-INSET-14}" {F} font-size="15" letter-spacing="2.6" fill="{ink}" {ts}>•••• {last4}</text>
<text x="{INSET}" y="{H-INSET+1}" {F} font-size="9.5" letter-spacing="1.3" fill="{ink}" opacity=".85" {ts}>{holder}</text>
</svg>'''
c={}
# MANDIRI — pale full-width band with grey fold, navy body, light sweep
def mandiri_art(id, b0,b1,t0,t1,fold,sw):
    return (f'''<linearGradient id="b{id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{b0}"/><stop offset="1" stop-color="{b1}"/></linearGradient>
<linearGradient id="t{id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{t0}"/><stop offset="1" stop-color="{t1}"/></linearGradient>
<linearGradient id="s{id}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="{sw}"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>''',
 f'''<rect width="{W}" height="{H}" fill="url(#b{id})"/>
<path d="M0 214 C 70 160 170 120 340 120 V214Z" fill="url(#s{id})"/>
<path d="M0 150 C 110 110 230 96 340 92" stroke="#fff" stroke-opacity="{sw*.9:.2f}" stroke-width="18" fill="none"/>
<rect width="{W}" height="62" fill="url(#t{id})"/>
<path d="M0 0 H150 L102 62 H0 Z" fill="{fold}"/>
<path d="M0 62 H340" stroke="#000" stroke-opacity=".12"/>''')
d,a=mandiri_art('m','#163a78','#1f4f9b','#e9edf3','#ffffff','#cfd8e6',.12)
c['mandiri']=card('m',d,a,'mandiri','silver debit','#ffffff','silver','0005',bank_col='#173f86',product_col='#5b6b86',shadow=False)
d,a=mandiri_art('g','#f4b400','#f8c62a','#fbe9a8','#fff7da','#f2d983',.18)
c['gold']=card('g',d,a,'mandiri','gold debit','#ffffff','gold','0005',bank_col='#173f86',product_col='#7a5a00')
d,a=mandiri_art('p','#1e1e20','#5a5a60','#d9dbe0','#f6f7f9','#9fa3ab',.1)
c['plat']=card('p',d,a,'mandiri','mandiri debit','#f2f2f4','silver','7899',bank_col='#173f86',product_col='#44454a')
# CIMB — flat red, chevrons
def chev(x,y,w,h,t,fill,stroke):
    return f'<path d="M{x} {y} L{x+w-t} {y} L{x+w} {y+h/2} L{x+w-t} {y+h} L{x} {y+h} L{x+t} {y+h/2} Z" fill="#fff" fill-opacity="{fill}" stroke="#fff" stroke-opacity="{stroke}" stroke-width="1"/>'
bands=''.join([
  chev(-6,62,62,30,18,0,.38), chev(52,62,62,30,18,0,.3),
  chev(118,52,56,28,17,.12,.18), chev(168,52,56,28,17,.16,.2), chev(214,40,70,38,22,.10,.25), chev(262,40,70,38,22,.14,.28), chev(300,62,56,28,17,0,.3),
  chev(150,86,60,30,18,0,.34), chev(204,92,84,44,26,.13,.22), chev(268,96,84,44,26,.09,.24),
  chev(118,112,46,24,14,.10,.16), chev(330,100,40,24,14,0,.3)])
glow='<radialGradient id="cg" cx=".55" cy=".35" r=".7"><stop offset="0" stop-color="#ff5a50" stop-opacity=".35"/><stop offset="1" stop-color="#ff5a50" stop-opacity="0"/></radialGradient>'
c['cimb']=card('c','<linearGradient id="cb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2261d"/><stop offset="1" stop-color="#cf1a14"/></linearGradient>'+glow,
 f'<rect width="{W}" height="{H}" fill="url(#cb)"/><rect width="{W}" height="{H}" fill="url(#cg)"/>{bands}','CIMB NIAGA','Debit','#ffffff','gold','6789')
# MAYBANK — flat mint, thin U
c['maybank']=card('y','<linearGradient id="yb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a3d6cf"/><stop offset="1" stop-color="#9bd0c9"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#yb)"/><path d="M236 58 V124 a36 36 0 0 0 72 0 V58" stroke="#ffffff" stroke-width="2" fill="none"/>','Maybank','Debit','#17403a','silver','2207',edge='rgba(255,255,255,.6)',shadow=False)
# BCA — blue with rounded squares
random.seed(5)
def blobs_for(light, dark, n=26):
    out=''
    for i in range(n):
        sz=random.choice([34,40,46,52,58]); x=random.uniform(20,330)-sz/2; y=random.uniform(40,190)-sz/2
        tone=light if random.random()<.55 else dark
        out+=f'<rect x="{x:.1f}" y="{y:.1f}" width="{sz}" height="{sz}" rx="{sz*.34:.1f}" fill="{tone}" fill-opacity="{random.uniform(.10,.22):.3f}"/>'
    return out
blobs=blobs_for('#ffffff','#0d5fae')
c['bca']=card('b','<linearGradient id="bb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5cc0f4"/><stop offset=".5" stop-color="#3aa2e8"/><stop offset="1" stop-color="#2a86d6"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#bb)"/>{blobs}','BCA','Paspor blue debit','#ffffff','silver','9359')
random.seed(9)
c['bcagold']=card('bg','<linearGradient id="bgb2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9b46a"/><stop offset=".5" stop-color="#c79d52"/><stop offset="1" stop-color="#a8823e"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#bgb2)"/>'+blobs_for('#fff3d6','#7a5a24'),'BCA','Paspor gold debit','#ffffff','gold','9359')
c['bcaplat']=card('bp','<linearGradient id="bpb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a1b1e"/><stop offset=".55" stop-color="#3b3d42"/><stop offset="1" stop-color="#1f2023"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#bpb)"/><text x="150" y="190" font-family="Snell Roundhand,Apple Chancery,cursive" font-size="230" fill="none" stroke="#ffffff" stroke-opacity=".28" stroke-width="1.6">P</text>','BCA','Paspor platinum debit','#f2f2f4','silver','9359')
# JAGO — magenta-purple with big yellow shapes on the right, cropped off the edge as the card has them
c['jago']=card('j','<linearGradient id="jb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b22bb8"/><stop offset=".55" stop-color="#a11fa8"/><stop offset="1" stop-color="#8e1696"/></linearGradient><linearGradient id="jy" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd22e"/><stop offset="1" stop-color="#f6b600"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#jb)"/>'
 '<circle cx="236" cy="96" r="25" fill="url(#jy)"/>'
 '<path d="M278 64 H336 V160 C336 232 262 262 204 236 L222 196 C254 210 278 196 278 160 Z" fill="url(#jy)"/>',
 'Jago','Debit','#ffffff','silver','4410',product_col='#ffffff')
# BRI — royal blue, low-poly facets, a constellation of white dots and lines, an orange halftone band sweeping up to the top-right, cyan halftone low-left
import math
random.seed(3)
facets=''
for i in range(22):
    x=random.uniform(120,360); y=random.uniform(-20,230); r=random.uniform(40,110); a=random.uniform(0,6.28)
    pts=' '.join(f'{x+r*math.cos(a+k*2.1):.1f},{y+r*math.sin(a+k*2.1):.1f}' for k in range(3))
    facets+=f'<polygon points="{pts}" fill="#7fb2ff" fill-opacity="{random.uniform(.03,.09):.3f}" stroke="#bcd6ff" stroke-opacity=".12" stroke-width=".5"/>'
stars=[(random.uniform(150,335),random.uniform(20,200)) for _ in range(26)]
lines=''.join(f'<path d="M{stars[i][0]:.1f} {stars[i][1]:.1f} L{stars[i+1][0]:.1f} {stars[i+1][1]:.1f}" stroke="#d9e8ff" stroke-opacity=".22" stroke-width=".5"/>' for i in range(0,len(stars)-1,2))
dots=''.join(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{random.choice([.9,1.1,1.5])}" fill="#ffffff" fill-opacity=".85"/>' for x,y in stars)
band=''
for gx in range(0,340,9):
    for gy in range(0,214,9):
        # distance from a curve rising from bottom-left to top-right
        t=gx/340
        cy=196-140*t-24*math.sin(t*3.1)
        d=abs(gy-cy)
        if d<30 and gx>40 and gy>52:
            rr=max(0.6,(1-d/34)*4.2*(0.4+0.6*t))
            band+=f'<circle cx="{gx}" cy="{gy}" r="{rr:.2f}" fill="#ffb02e" fill-opacity="{0.55+0.4*(1-d/34):.2f}"/>'
cyan=''.join(f'<circle cx="{gx}" cy="{gy}" r="{max(0.5,(1-((gx/120)+((214-gy)/90))/2)*3.2):.2f}" fill="#5fd0ff" fill-opacity=".7"/>' for gx in range(0,130,8) for gy in range(130,214,8) if (gx/120)+((214-gy)/90)<1.6)
c['bri']=card('r','<linearGradient id="rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d4fb8"/><stop offset=".5" stop-color="#1f5bc9"/><stop offset="1" stop-color="#173f9c"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#rb)"/>{facets}{cyan}{band}{lines}{dots}','BRI','Debit','#ffffff','gold','9110')
# BNI — ochre batik all over, a riot of coloured batik flowers with white dotted outlines low on the right
random.seed(21)
swirls=''
for gx in range(-10,350,26):
    for gy in range(-10,230,24):
        x=gx+random.uniform(-5,5); y=gy+random.uniform(-5,5); r=random.uniform(5,9)
        swirls+=f'<path d="M{x:.1f} {y:.1f} c{r:.1f} -{r:.1f} {r*2:.1f} 0 {r:.1f} {r:.1f} s-{r*1.4:.1f} {r*.4:.1f} -{r*.6:.1f} -{r*.6:.1f}" fill="none" stroke="#8a5a1c" stroke-opacity=".28" stroke-width=".7"/>'
        swirls+=f'<circle cx="{x+r*1.6:.1f}" cy="{y-r*.3:.1f}" r=".9" fill="#8a5a1c" fill-opacity=".3"/>'
def petal(cx,cy,rx,ry,rot,fill,ring):
    pid=f'p{int(cx)}{int(cy)}{int(rot)}'
    return (f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" transform="rotate({rot} {cx} {cy})" fill="{fill}"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx-3}" ry="{ry-3}" transform="rotate({rot} {cx} {cy})" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-dasharray=".1 3.2" stroke-linecap="round"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx*.55:.1f}" ry="{ry*.55:.1f}" transform="rotate({rot} {cx} {cy})" fill="{ring}"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx*.55-2:.1f}" ry="{ry*.55-2:.1f}" transform="rotate({rot} {cx} {cy})" fill="none" stroke="#ffffff" stroke-width="1.3" stroke-dasharray=".1 2.6" stroke-linecap="round"/>')
flowers=''.join([
  petal(214,214,40,18,-8,'#1f3f8f','#3fa6c8'), petal(250,180,36,20,-30,'#2b8fb3','#f08a24'),
  petal(292,214,46,22,10,'#6a2c8c','#2b8fb3'), petal(318,160,40,18,-60,'#e86a1a','#1f3f8f'),
  petal(338,212,30,16,30,'#1f3f8f','#e2a136'), petal(270,138,22,11,-20,'#c2185b','#ffd06b')])
flow_line='<path d="M150 214 C 190 180 220 170 250 168 S 300 140 340 110" stroke="#ffffff" stroke-width="1.6" stroke-dasharray=".1 3" stroke-linecap="round" fill="none"/>'
c['bni']=card('n','<linearGradient id="nb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dcab62"/><stop offset=".5" stop-color="#d29a4c"/><stop offset="1" stop-color="#c6883a"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#nb)"/>{swirls}{flow_line}{flowers}','BNI','Debit','#2a1c0c','silver','3456',bank_col='#2a1c0c',product_col='#2a1c0c',shadow=False)
# PERMATA — deep green, large faceted shards in lighter and darker greens across the right two thirds, soft green glows at the joins
random.seed(14)
shards=''
for (pts,col,op) in [
  ('170,214 230,130 300,214','#1f8f45',.55), ('230,130 340,96 300,214','#127538',.6), ('230,130 250,40 340,96','#2aa357',.45),
  ('250,40 300,0 340,96','#0d5f2c',.55), ('180,0 250,40 230,130','#0f6a31',.4), ('300,0 340,0 340,96','#1b8a44',.4),
  ('120,214 170,214 200,160','#0d5f2c',.35), ('200,160 230,130 260,214','#2fae5e',.3), ('150,60 180,0 230,130','#1a8040',.25),
  ('290,150 340,130 340,214','#37b866',.35)]:
    shards+=f'<polygon points="{pts}" fill="{col}" fill-opacity="{op}"/>'
glows=''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="url(#pg)"/>' for x,y,r in [(250,40,28),(230,130,32),(300,0,22),(200,160,26),(340,96,24),(150,60,20)])
c['permata']=card('pm','<linearGradient id="pmb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f5a2a"/><stop offset=".55" stop-color="#11692f"/><stop offset="1" stop-color="#0c4f24"/></linearGradient><radialGradient id="pg"><stop offset="0" stop-color="#5fe08c" stop-opacity=".45"/><stop offset="1" stop-color="#5fe08c" stop-opacity="0"/></radialGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#pmb)"/>{shards}{glows}','Permata Bank','Debit','#ffffff','silver','9010')
# OCBC — red, a darker-red ikat of small diamonds and hooks over the left half, a big layered circle low on the right (a plain ring, not the sail emblem)
ikat=''
for row,gy in enumerate(range(6,220,20)):
    for gx in range(-4,200,22):
        x=gx+(11 if row%2 else 0); y=gy
        fade=max(0,1-x/200)
        if fade<=0: continue
        o=.55*fade
        ikat+=f'<path d="M{x} {y-7} L{x+7} {y} L{x} {y+7} L{x-7} {y} Z" fill="none" stroke="#8e0b10" stroke-opacity="{o:.2f}" stroke-width="1.6"/>'
        ikat+=f'<path d="M{x} {y-3} L{x+3} {y} L{x} {y+3} L{x-3} {y} Z" fill="#8e0b10" fill-opacity="{o:.2f}"/>'
        ikat+=f'<path d="M{x+7} {y} h3 M{x-7} {y} h-3 M{x} {y+7} v3 M{x} {y-7} v-3" stroke="#8e0b10" stroke-opacity="{o:.2f}" stroke-width="1.2"/>'
ring=('<circle cx="292" cy="150" r="118" fill="#a80d14" fill-opacity=".55"/>'
      '<circle cx="300" cy="150" r="92" fill="#e5222b"/>'
      '<circle cx="306" cy="150" r="66" fill="#b5121a" fill-opacity=".7"/>'
      '<path d="M186 120 L340 80 V104 L194 140 Z" fill="#ff4b52" fill-opacity=".35"/>'
      '<path d="M190 160 L340 150 V172 L196 180 Z" fill="#ff4b52" fill-opacity=".28"/>')
c['ocbc']=card('oc','<linearGradient id="ocb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e01f28"/><stop offset=".6" stop-color="#d81920"/><stop offset="1" stop-color="#c8141b"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#ocb)"/>{ikat}{ring}','OCBC','Debit','#ffffff','silver','0000')
# DANAMON — an illustrated sunrise: warm sky, sun with rays and rings, a striped lighthouse, green hills with little trees, layered teal sea, film grain
sx,sy=176,92
rays=''.join(f'<path d="M{sx} {sy} L{sx+260*math.cos(math.radians(a)):.1f} {sy+260*math.sin(math.radians(a)):.1f} L{sx+260*math.cos(math.radians(a+4)):.1f} {sy+260*math.sin(math.radians(a+4)):.1f} Z" fill="#fff6c8" fill-opacity=".18"/>' for a in range(180,360,11))
rings=''.join(f'<circle cx="{sx}" cy="{sy}" r="{r}" fill="none" stroke="#fff3b0" stroke-opacity="{.5-r/220:.2f}" stroke-width="1.2"/>' for r in range(18,110,12))
light=(f'<g transform="translate({sx-7} 58)">'
  '<path d="M3 14 L11 14 L13 96 L1 96 Z" fill="#f08a3c"/>'
  '<path d="M2.6 30 L11.4 30 L11.8 40 L2.2 40 Z M2 58 L12 58 L12.4 68 L1.6 68 Z" fill="#f7e2c4"/>'
  '<rect x="2" y="6" width="10" height="9" rx="1.5" fill="#f7e2c4"/><path d="M1 6 L7 0 L13 6 Z" fill="#c8452d"/>'
  '<rect x="0" y="13" width="14" height="2" fill="#c8452d"/></g>')
hills=('<path d="M0 150 C 50 128 100 138 150 132 C 200 126 250 120 340 112 V214 H0 Z" fill="#9cc65a"/>'
       '<path d="M0 160 C 70 146 130 154 190 146 C 250 138 300 136 340 128 V214 H0 Z" fill="#6fae46"/>'
       '<path d="M90 162 C 150 150 220 156 340 140 V214 H90 Z" fill="#4f9a3c" fill-opacity=".9"/>')
trees=''.join(f'<g><rect x="{x-.6}" y="{y}" width="1.2" height="5" fill="#3d6b2a"/><circle cx="{x}" cy="{y-1}" r="3.6" fill="#5fae4a"/></g>' for x,y in [(60,140),(122,136),(250,124),(300,120),(214,132)])
sea=''.join(f'<path d="M-10 {y} C 50 {y-10} 100 {y+8} 160 {y-2} S 280 {y-12} 350 {y-4} V214 H-10 Z" fill="{col}"/><path d="M-10 {y} C 50 {y-10} 100 {y+8} 160 {y-2} S 280 {y-12} 350 {y-4}" fill="none" stroke="#e8fbf6" stroke-opacity=".5" stroke-width="1"/>' for y,col in [(162,'#57c4b6'),(174,'#3fb3a6'),(186,'#2aa39a'),(198,'#1d9089'),(208,'#16807b')])
c['danamon']=card('dn','''<linearGradient id="dsky" x1="0" y1="0" x2="1" y2=".6"><stop offset="0" stop-color="#ffe9b0"/><stop offset=".45" stop-color="#ffd27a"/><stop offset=".8" stop-color="#f6913f"/><stop offset="1" stop-color="#e5532f"/></linearGradient>
<radialGradient id="dsun" cx=".52" cy=".43" r=".45"><stop offset="0" stop-color="#fffbe6"/><stop offset=".35" stop-color="#fff2b0" stop-opacity=".85"/><stop offset="1" stop-color="#fff2b0" stop-opacity="0"/></radialGradient>
<filter id="dgr"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .3  0 0 0 0 .2  0 0 0 0 .1  0 0 0 .14 0"/></filter>''',
 f'<rect width="{W}" height="{H}" fill="url(#dsky)"/>{rays}<rect width="{W}" height="{H}" fill="url(#dsun)"/>{rings}{hills}{trees}{light}{sea}<rect width="{W}" height="{H}" filter="url(#dgr)"/>',
 'Danamon','debit','#173a2c','gold','0000',bank_col='#0e5a3a',product_col='#1c1c1c',shadow=False)
# HSBC Live+ — purple into red into blue, two sheets of white light crossing in an X
c['hsbc']=card('hs','''<linearGradient id="hsb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a1a5e"/><stop offset=".3" stop-color="#a62546"/><stop offset=".5" stop-color="#d63c4a"/><stop offset=".72" stop-color="#7b5a92"/><stop offset="1" stop-color="#1f6cc4"/></linearGradient>
<linearGradient id="hsl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="hsx" cx=".5" cy=".62" r=".22"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>''',
 f'<rect width="{W}" height="{H}" fill="url(#hsb)"/>'
 '<g transform="rotate(-28 170 132)"><rect x="-60" y="126" width="460" height="10" fill="url(#hsl)"/><rect x="-60" y="118" width="460" height="26" fill="url(#hsl)" opacity=".25"/></g>'
 '<g transform="rotate(34 170 132)"><rect x="-60" y="127" width="460" height="7" fill="url(#hsl)" opacity=".8"/><rect x="-60" y="120" width="460" height="22" fill="url(#hsl)" opacity=".2"/></g>'
 '<rect width="340" height="214" fill="url(#hsx)"/>'
 '<path d="M0 132 L170 132 L340 214 V214 H0 Z" fill="#fff" fill-opacity=".04"/>',
 'HSBC','Live+','#ffffff','silver','0123')
# UOB TMRW — sunny yellow, a navy wave across the top-right, a magenta-to-violet ribbon sweeping through, TMRW in chrome
c['uob']=card('ub','''<linearGradient id="uy" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe12e"/><stop offset="1" stop-color="#ffd000"/></linearGradient>
<linearGradient id="ur" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff2f8f"/><stop offset=".55" stop-color="#d42bb0"/><stop offset="1" stop-color="#6a3fc8"/></linearGradient>
<linearGradient id="uc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#d9dcf2"/><stop offset="1" stop-color="#ffffff"/></linearGradient>''',
 f'<rect width="{W}" height="{H}" fill="url(#uy)"/>'
 '<path d="M140 0 H340 V92 C 300 70 262 54 226 70 C 196 84 170 44 140 0 Z" fill="#23308f"/>'
 '<path d="M120 214 C 150 150 190 130 236 120 C 282 110 300 70 340 40 V150 C 300 170 268 176 240 196 C 222 208 214 214 210 214 Z" fill="url(#ur)"/>'
 '<path d="M150 0 C 172 40 196 70 226 70 C 262 54 300 70 340 92" fill="none" stroke="#ff4fa8" stroke-opacity=".55" stroke-width="5"/>'
 '<text x="220" y="160" font-family="-apple-system,system-ui" font-size="30" font-weight="800" letter-spacing="1" fill="url(#uc)" stroke="#9aa0d0" stroke-width=".5">TMRW</text>',
 'UOB','debit','#1d1d3a','silver','1234',bank_col='#1d1d3a',product_col='#ffffff',shadow=False)
# DBS digibank — pearl white, a big chrome four-pointed star (concave sides), a small one near the top-right
def star(cx,cy,r,k,id):
    # astroid-like: four points joined by concave curves
    pts=[(cx,cy-r),(cx+r,cy),(cx,cy+r),(cx-r,cy)]
    d=f'M{pts[0][0]} {pts[0][1]}'
    for i in range(4):
        a=pts[i]; b=pts[(i+1)%4]
        d+=f' Q{cx+(a[0]+b[0]-2*cx)*k:.1f} {cy+(a[1]+b[1]-2*cy)*k:.1f} {b[0]} {b[1]}'
    return d+' Z'
c['dbs']=card('db','''<linearGradient id="dbw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f3f4f6"/><stop offset="1" stop-color="#e6e8ec"/></linearGradient>
<linearGradient id="dbc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdfdfe"/><stop offset=".35" stop-color="#b8bcc4"/><stop offset=".5" stop-color="#eef0f3"/><stop offset=".7" stop-color="#8f949d"/><stop offset="1" stop-color="#d9dce1"/></linearGradient>''',
 f'<rect width="{W}" height="{H}" fill="url(#dbw)"/>'
 f'<g transform="rotate(45 236 132)"><path d="{star(236,132,62,.12,"a")}" fill="url(#dbc)" stroke="#9aa0a9" stroke-width=".6"/></g>'
 f'<g transform="rotate(45 290 64)"><path d="{star(290,64,15,.12,"b")}" fill="url(#dbc)" stroke="#9aa0a9" stroke-width=".4"/></g>',
 'DBS','digibank','#2b2d33','silver','5678',bank_col='#d0021b',edge='rgba(0,0,0,.08)',shadow=False)
# JENIUS — plain white, almost nothing on it, a thin band of oranges and a deep red along the bottom edge
c['jenius']=card('je','<linearGradient id="jew" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1f2f5"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#jew)"/>'
 '<rect x="0" y="207" width="340" height="7" fill="#f04e23"/><rect x="138" y="207" width="44" height="7" fill="#ff6a33"/><rect x="182" y="207" width="24" height="7" fill="#9c1016"/>',
 'Jenius','Debit','#55585f','silver','0412',bank_col='#f04e23',edge='rgba(0,0,0,.08)',shadow=False)
# blu — matte black, an aqua wave breaking across the bottom with a curl and a paler crest
c['blu']=card('bl','''<linearGradient id="blk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2b2e"/><stop offset="1" stop-color="#1b1c1f"/></linearGradient>
<linearGradient id="bla" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fdbe6"/><stop offset="1" stop-color="#3fbfd0"/></linearGradient>''',
 f'<rect width="{W}" height="{H}" fill="url(#blk)"/>'
 '<path d="M0 150 C 40 140 70 156 104 148 C 136 140 150 118 182 120 C 214 122 220 146 250 140 C 280 134 300 110 340 112 V214 H0 Z" fill="url(#bla)"/>'
 '<path d="M150 124 C 170 108 196 110 206 128 C 196 120 180 120 170 130 Z" fill="#b8eef4"/>'
 '<path d="M0 166 C 50 156 90 170 130 162 C 180 152 230 172 340 150 V214 H0 Z" fill="#2fb0c4" fill-opacity=".55"/>'
 '<path d="M0 150 C 40 140 70 156 104 148 C 136 140 150 118 182 120 C 214 122 220 146 250 140 C 280 134 300 110 340 112" fill="none" stroke="#d9f7fa" stroke-opacity=".7" stroke-width="1.4"/>',
 'blu','Debit','#ffffff','silver','7720')
# BSI — one big curved sweep across the card and a small curved corner top-left, in the tier's two colours
CORNER='M0 0 H64 C 36 18 12 50 0 92 Z'
LEFT='M0 52 C 30 16 80 2 132 0 H262 C 232 122 128 200 8 214 H0 Z'
RIGHT='M262 0 H340 V214 H8 C 128 200 232 122 262 0 Z'
def bsi(id, base, sweep, corner, sweep_is_left, ink, product, chipk):
    sweep_path = LEFT if sweep_is_left else RIGHT
    return card(id,'',f'<rect width="{W}" height="{H}" fill="{base}"/><path d="{sweep_path}" fill="{sweep}"/><path d="{CORNER}" fill="{corner}"/>',
      'BSI',product,ink,chipk,'0000',shadow=False,edge='rgba(0,0,0,.08)' if base=='#ffffff' else 'rgba(255,255,255,.35)')
c['bsi']=bsi('bs','#ffffff','#f0b334','#17b8ad',False,'#4d4d4d','Silver debit','gold')
c['bsigold']=bsi('bg2','#fdcb80','#f0b334','#17b8ad',True,'#ffffff','Gold debit','gold')
c['bsiplat']=bsi('bp2','#9b9c9f','#545759','#a9aaad',True,'#ffffff','Platinum debit','gold')
# MUAMALAT — deep purple with a square-kufic maze (nested square spirals) in lighter purple, strongest low on the left
def kufic(x,y,size):
    # a square spiral drawn as one path, the way square-kufic tiles turn inward
    step=size/7; d=f'M{x} {y}'; cx,cy=x,y; L=size; dirs=[(1,0),(0,1),(-1,0),(0,-1)]
    for i in range(10):
        dx,dy=dirs[i%4]
        cx+=dx*L; cy+=dy*L; d+=f' L{cx:.1f} {cy:.1f}'
        if i%2==1: L-=step
        if L<=0: break
    return d
maze=''
for gx in range(-10,220,46):
    for gy in range(40,240,46):
        fade=max(0,1-(gx/220)*0.8-((214-gy)/214)*0.5)
        if fade<.12: continue
        maze+=f'<path d="{kufic(gx,gy,40)}" fill="none" stroke="#a77fd0" stroke-opacity="{.55*fade:.2f}" stroke-width="2.2"/>'
c['muamalat']=card('mu','<linearGradient id="mub" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a3896"/><stop offset=".55" stop-color="#5a2b85"/><stop offset="1" stop-color="#4a2271"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#mub)"/>{maze}','Muamalat','Shar-e Debit','#ffffff','silver','5678')
# SEABANK — warm orange, a big faint coin with rings and a large S on the right, ripples under it
c['seabank']=card('sb','<linearGradient id="sbb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a2a"/><stop offset=".6" stop-color="#f7701a"/><stop offset="1" stop-color="#ee5f0f"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#sbb)"/>'
 '<circle cx="262" cy="92" r="88" fill="#ffffff" fill-opacity=".08"/>'
 '<circle cx="262" cy="92" r="72" fill="none" stroke="#ffffff" stroke-opacity=".16" stroke-width="10"/>'
 '<circle cx="262" cy="92" r="56" fill="#ffffff" fill-opacity=".07"/>'
 '<text x="262" y="122" text-anchor="middle" font-family="-apple-system,system-ui" font-size="86" font-weight="800" fill="#ffffff" fill-opacity=".16">S</text>'
 '<path d="M176 186 C 206 160 318 160 348 186" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="7"/>'
 '<path d="M196 204 C 222 184 302 184 328 204" fill="none" stroke="#ffffff" stroke-opacity=".14" stroke-width="6"/>',
 'SeaBank','Debit','#ffffff','silver','3301')
# BCA PRIORITAS — matte black, a huge script P in a slightly lighter grey across the middle, a gold oval with PRIORITAS top-right
c['bcaprio']=card('bpr','<linearGradient id="bprb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a2c"/><stop offset=".5" stop-color="#1d1d1f"/><stop offset="1" stop-color="#121214"/></linearGradient><linearGradient id="bpro" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#f2c300"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#bprb)"/>'
 '<text x="70" y="214" font-family="Snell Roundhand,Apple Chancery,Zapfino,cursive" font-size="250" fill="#3a3a3d" fill-opacity=".9">P</text>'
 '<ellipse cx="262" cy="34" rx="58" ry="17" fill="url(#bpro)" stroke="#b58a00" stroke-width=".8"/>'
 '<text x="262" y="39" text-anchor="middle" font-family="Times New Roman,serif" font-size="12" font-weight="700" letter-spacing="1.2" fill="#1d3f8f">PRIORITAS</text>',
 'BCA','','#d4d4d8','silver','1000',bank_col='#d4d4d8')
# MANDIRI PRIORITAS — black spun metal: fine rings around a point right of centre, light catching in a cross
cxm,cym=212,118
spun=''.join(f'<circle cx="{cxm}" cy="{cym}" r="{r}" fill="none" stroke="#ffffff" stroke-opacity="{(0.05 if r%3 else 0.09):.2f}" stroke-width=".6"/>' for r in range(3,260,2))
beams=''.join(f'<path d="M{cxm} {cym} L{cxm+300*math.cos(math.radians(a-3)):.1f} {cym+300*math.sin(math.radians(a-3)):.1f} L{cxm+300*math.cos(math.radians(a+3)):.1f} {cym+300*math.sin(math.radians(a+3)):.1f} Z" fill="url(#mpbeam)"/>' for a in (40,140,220,320))
c['mandiriprio']=card('mpr','<radialGradient id="mprb" cx=".62" cy=".55" r=".8"><stop offset="0" stop-color="#3a3a3c"/><stop offset=".5" stop-color="#151516"/><stop offset="1" stop-color="#050505"/></radialGradient><radialGradient id="mpbeam" cx="0" cy="0" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#mprb)"/>{spun}{beams}','mandiri','prioritas · debit','#f2f2f4','silver','0000')
# CIMB PREFERRED — deep burgundy, translucent planes slanting across, a red glow right of centre
planes=''.join(f'<polygon points="{pts}" fill="#ffffff" fill-opacity="{o}"/>' for pts,o in [('0,0 120,0 40,214 0,214','.035'),('90,0 170,0 70,214 20,214','.05'),('150,0 230,0 120,214 80,214','.03'),('0,60 340,20 340,50 0,100','.03'),('180,0 340,0 340,90','.04')])
c['cimbpref']=card('cpf','<linearGradient id="cpfb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a0f14"/><stop offset=".55" stop-color="#5c1219"/><stop offset="1" stop-color="#2f070b"/></linearGradient><radialGradient id="cpfg" cx=".62" cy=".52" r=".45"><stop offset="0" stop-color="#b3202b" stop-opacity=".55"/><stop offset="1" stop-color="#b3202b" stop-opacity="0"/></radialGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#cpfb)"/><rect width="{W}" height="{H}" fill="url(#cpfg)"/>{planes}','CIMB','preferred · world debit','#ffffff','silver','6789')
c['cimbpref']=c['cimbpref'].replace('font-size="13" font-weight="600" text-anchor="end" fill="#ffffff" opacity=".95" >preferred · world debit','font-size="13" font-weight="600" text-anchor="end" fill="#ffffff" opacity=".95" >preferred · world debit')
# ALLO BANK — black, the name set huge in a yellow-to-amber gradient across the lower half, cropped by the edges
c['allo']=card('al','<linearGradient id="alb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f1f21"/><stop offset="1" stop-color="#0e0e10"/></linearGradient><linearGradient id="alg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset=".5" stop-color="#ffc21a"/><stop offset="1" stop-color="#e89a00"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#alb)"/>'
 '<text x="150" y="250" font-family="-apple-system,system-ui" font-size="190" font-weight="800" letter-spacing="-8" fill="url(#alg)">allo</text>',
 'allo bank','Virtual Card','#ffffff','silver','8890',bank_col='#ffc21a')
# KROM — violet, a giant K in a deeper violet across the right two thirds, its diagonal stroke catching the light
c['krom']=card('kr','<linearGradient id="krb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a6af0"/><stop offset=".55" stop-color="#7f4fe0"/><stop offset="1" stop-color="#6a3ccc"/></linearGradient><linearGradient id="krk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b38d6"/><stop offset="1" stop-color="#5a2bbf"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#krb)"/>'
 '<path d="M150 -10 H206 V96 L292 -10 H360 L262 108 L360 224 H292 L206 124 V224 H150 Z" fill="url(#krk)" fill-opacity=".85"/>'
 '<path d="M262 108 L360 224 H330 L240 120 Z" fill="#ffffff" fill-opacity=".08"/>',
 'krom','Debit','#ffffff','silver','2468')
# SUPERBANK — no card in the picture, so drawn from the app: deep green, two lime arcs sweeping from the top-right corner
c['superbank']=card('su','<linearGradient id="sub" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14514b"/><stop offset=".6" stop-color="#0f3f3b"/><stop offset="1" stop-color="#0b312e"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#sub)"/>'
 '<path d="M340 -60 A 230 230 0 0 1 120 214" fill="none" stroke="#b9f000" stroke-width="7"/>'
 '<path d="M360 -40 A 250 250 0 0 1 150 230" fill="none" stroke="#b9f000" stroke-opacity=".55" stroke-width="2.4"/>'
 '<path d="M340 -60 A 230 230 0 0 1 120 214 L340 214 Z" fill="#b9f000" fill-opacity=".06"/>',
 'superbank','Debit','#ffffff','silver','3185',bank_col='#d9ff5a')
# NEO COMMERCE — golden yellow, a lighter panel down the right side, scattered little stars (the cat mascot left out)
def star5(cx,cy,r,col,rot=0):
    pts=[]
    for i in range(10):
        a=math.radians(rot-90+i*36); rr=r if i%2==0 else r*.45
        pts.append(f'{cx+rr*math.cos(a):.1f},{cy+rr*math.sin(a):.1f}')
    return f'<polygon points="{" ".join(pts)}" fill="{col}" stroke="{col}" stroke-linejoin="round" stroke-width="2"/>'
c['neo']=card('ne','<linearGradient id="neb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8b81c"/><stop offset="1" stop-color="#f2a40e"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#neb)"/>'
 '<path d="M250 0 H340 V214 H262 C 250 160 248 60 250 0 Z" fill="#ffd36a" fill-opacity=".55"/>'
 +star5(150,128,9,'#ff7a2a',10)+star5(188,176,7,'#ffe27a',-8)+star5(124,58,5,'#fff1b8',20)+star5(222,82,6,'#ff9a3c',0),
 'Neo Commerce','Neo Card','#3a2a06','silver','3456',bank_col='#3a2a06',product_col='#3a2a06',shadow=False)
# BTN — white top band with a yellow sweep from the top-left, blue body with fine white lines pinching together in the middle, yellow and white sweeps along the bottom
pinch=''
for i in range(-7,8):
    y0=107+i*13; ym=107+i*3.2
    pinch+=f'<path d="M-10 {y0:.1f} C 90 {y0:.1f} 120 {ym:.1f} 170 {ym:.1f} S 250 {y0:.1f} 350 {y0:.1f}" fill="none" stroke="#ffffff" stroke-opacity="{.35-abs(i)*.03:.2f}" stroke-width=".7"/>'
c['btn']=card('bt','<linearGradient id="btb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a7fd4"/><stop offset=".55" stop-color="#1a63bd"/><stop offset="1" stop-color="#114ea3"/></linearGradient><linearGradient id="bty" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd21f"/><stop offset="1" stop-color="#f5b800"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#btb)"/>{pinch}'
 '<path d="M0 0 H340 V46 C 250 40 170 50 0 52 Z" fill="#ffffff"/>'
 '<path d="M0 0 H120 C 90 14 60 30 0 46 Z" fill="url(#bty)"/>'
 '<path d="M0 214 V196 C 70 198 130 190 190 176 C 170 196 150 206 140 214 Z" fill="url(#bty)"/>'
 '<path d="M190 214 C 230 196 280 188 340 186 V214 Z" fill="#ffffff"/>',
 'BTN','','#ffffff','gold','4215',bank_col='#1a4f9e')
# PANIN — brushed silver, a broad diagonal ribbon of slanted blocks rising to the top-right: one red, then blues getting lighter
segs=[('#e2262f',0),('#1d4fb3',1),('#2a63cc',2),('#1a46a0',3),('#3b7fe0',4),('#5a9bef',5)]
ribbon=''
for col,i in segs:
    x0=150+i*36; y0=214-i*30
    ribbon+=f'<polygon points="{x0},{y0} {x0+40},{y0} {x0+76},{y0-30-64} {x0+36},{y0-30-64}" fill="{col}"/>'
ribbon='<g transform="translate(-6 18)">'+''.join(f'<polygon points="{150+i*36},{214-i*28} {194+i*36},{214-i*28} {232+i*36},{150-i*28} {188+i*36},{150-i*28}" fill="{col}"/>' for col,i in segs)+'</g>'
c['panin']=card('pn','<linearGradient id="pnb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9ebee"/><stop offset=".5" stop-color="#d3d6db"/><stop offset="1" stop-color="#c3c7cd"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#pnb)"/>'+''.join(f'<path d="M0 {y} H340" stroke="#ffffff" stroke-opacity=".18" stroke-width=".5"/>' for y in range(0,214,3))+ribbon,
 'PaninBank','','#2f3540','silver','6600',bank_col='#1d4fb3',edge='rgba(255,255,255,.6)',shadow=False)
# SINARMAS — deep red, soft embossed layers of curving ripples, lighter where they crest
rip=''
for i,(cx,cy,r0) in enumerate([(300,40,30),(60,230,40),(330,214,50)]):
    for k in range(8):
        r=r0+k*18
        rip+=f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#ffffff" stroke-opacity="{.07-k*.006:.3f}" stroke-width="7"/>'
        rip+=f'<circle cx="{cx}" cy="{cy}" r="{r+3}" fill="none" stroke="#000000" stroke-opacity="{.08-k*.006:.3f}" stroke-width="2"/>'
c['sinarmas']=card('sm','<linearGradient id="smb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b3172b"/><stop offset=".55" stop-color="#9c1225"/><stop offset="1" stop-color="#7f0d1d"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#smb)"/>{rip}','bank sinarmas','','#ffffff','gold','1234')
# E-WALLETS — no plastic, so no chip and no contactless mark; the brand's colour and one shape from its look, the phone's last four bottom-left
def wallet(id, defs, art, name, ink, last4, bank_col=None):
    return card(id, defs, art, name, '', ink, None, last4, holder='E-WALLET', bank_col=bank_col)
c['ovo']=wallet('ov','<linearGradient id="ovb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a36e6"/><stop offset="1" stop-color="#4f22c4"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#ovb)"/>'
 '<circle cx="272" cy="118" r="92" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="10"/>'
 '<circle cx="272" cy="118" r="70" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="10"/>',
 'OVO','#ffffff','2207')
c['shopeepay']=wallet('sp','<linearGradient id="spb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f45a33"/><stop offset="1" stop-color="#e2431f"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#spb)"/>'
 '<rect x="196" y="58" width="150" height="112" rx="22" fill="#ffffff" fill-opacity=".12"/>'
 '<path d="M206 50 L330 38" stroke="#ffffff" stroke-opacity=".18" stroke-width="9" stroke-linecap="round"/>',
 'ShopeePay','#ffffff','2207')
c['gopay']=wallet('gp','<linearGradient id="gpb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16bde3"/><stop offset="1" stop-color="#00a4cc"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#gpb)"/>'
 '<circle cx="286" cy="128" r="84" fill="#0b2d38" fill-opacity=".14"/>'
 '<rect x="246" y="96" width="80" height="64" rx="18" fill="none" stroke="#ffffff" stroke-opacity=".28" stroke-width="7"/>',
 'gopay','#ffffff','2207')
c['dana']=wallet('da','<linearGradient id="dab" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a9cf0"/><stop offset="1" stop-color="#0b84dc"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#dab)"/>'
 '<circle cx="282" cy="110" r="78" fill="#ffffff" fill-opacity=".16"/>'
 '<path d="M244 92 C 262 80 280 104 318 88 V132 C 282 148 262 122 244 134 Z" fill="#ffffff" fill-opacity=".28"/>',
 'DANA','#ffffff','2207')

# LINKAJA — e-wallet: bright red, a white swoosh underline across the lower right
c['linkaja']=wallet('lk','<linearGradient id="lkb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff3a3a"/><stop offset="1" stop-color="#e81f26"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#lkb)"/><path d="M150 168 C 220 150 290 146 352 148 L352 158 C 290 158 222 164 154 180 Z" fill="#ffffff" fill-opacity=".85"/>'
 '<text x="196" y="130" font-family="-apple-system,system-ui" font-size="64" font-weight="900" font-style="italic" fill="#ffffff" fill-opacity=".12">Aja!</text>',
 'LinkAja','#ffffff','2207')

def emoney(id, defs, art, name, ink, last4, bank_col=None):
    return card(id, defs, art, name, '', ink, 'nfc', last4, holder='E-MONEY', bank_col=bank_col)
# FLAZZ (BCA) — sky blue, yellow signal arcs and a lightning stroke
c['flazz']=emoney('fz','<linearGradient id="fzb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2aa8ee"/><stop offset="1" stop-color="#5cc6f5"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#fzb)"/>'
 '<g fill="none" stroke="#ffd23a" stroke-linecap="round"><path d="M226 92 a40 40 0 0 1 56 0" stroke-width="6"/><path d="M212 76 a60 60 0 0 1 84 0" stroke-width="6"/><path d="M198 60 a80 80 0 0 1 112 0" stroke-width="6" stroke-opacity=".7"/></g>'
 '<path d="M262 104 L246 140 H262 L250 176 L286 128 H268 L280 104 Z" fill="#ffd23a"/>',
 'Flazz','#ffffff','0000')
# JAKCARD (Bank DKI) — red with soft lighter-red sweeps
c['jakcard']=emoney('jk','<linearGradient id="jkb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8242b"/><stop offset="1" stop-color="#c8141c"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#jkb)"/><path d="M180 214 C 220 140 280 100 360 90 V214 Z" fill="#ff5a5f" fill-opacity=".35"/><path d="M230 214 C 260 160 300 130 360 124 V214 Z" fill="#ff7a7e" fill-opacity=".3"/>'
 '<path d="M206 150 a46 46 0 0 0 92 0" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="3"/>',
 'JakCard','#ffffff','0000')
# MANDIRI E-MONEY — maroon to orange, a city skyline along the bottom, orange signal arcs
random.seed(4); sky=''
x=0
while x<350:
    w=random.choice([10,14,18,22]); h=random.choice([20,30,40,52,64,76])
    sky+=f'<rect x="{x}" y="{214-h}" width="{w}" height="{h}" fill="#5a1410" fill-opacity=".55"/>'
    x+=w+random.choice([0,2,4])
c['emoney']=emoney('em','<linearGradient id="emb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a1b2a"/><stop offset=".55" stop-color="#c8401a"/><stop offset="1" stop-color="#f07a1a"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#emb)"/>{sky}'
 '<g fill="none" stroke="#ff9a2a" stroke-linecap="round" stroke-width="5"><path d="M236 70 a30 30 0 0 1 42 0"/><path d="M224 56 a48 48 0 0 1 66 0" stroke-opacity=".7"/></g>',
 'mandiri e-money','#ffffff','0000')
# BRIZZI (BRI) — blue into navy, gold circuit lines, a gold sweep low on the right
circ=''.join(f'<path d="M{x} {y} h{w} l8 -8 h{w2}" fill="none" stroke="#e8b84a" stroke-opacity=".75" stroke-width="1.1"/><circle cx="{x+w+8+w2}" cy="{y-8}" r="2" fill="#e8b84a"/>' for x,y,w,w2 in [(170,96,40,50),(186,110,30,60),(200,124,24,70),(150,138,60,40)])
c['brizzi']=emoney('bz','<linearGradient id="bzb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a6fd0"/><stop offset=".6" stop-color="#173f8f"/><stop offset="1" stop-color="#0d2a66"/></linearGradient><linearGradient id="bzg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c99a2e"/><stop offset="1" stop-color="#f2d27a"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#bzb)"/>{circ}<path d="M200 214 C 260 186 310 176 360 174 V214 Z" fill="url(#bzg)" fill-opacity=".85"/>',
 'BRIZZI','#ffffff','0000')
# TAPCASH (BNI) — orange-gold with fine batik vines
random.seed(8); vines=''
for i in range(14):
    x=random.uniform(0,340); y=random.uniform(0,214); r=random.uniform(8,16)
    vines+=f'<path d="M{x:.1f} {y:.1f} c{r:.1f} -{r:.1f} {r*2:.1f} {r*.4:.1f} {r*.6:.1f} {r:.1f} s-{r:.1f} -{r*.2:.1f} -{r*.2:.1f} -{r*.7:.1f}" fill="none" stroke="#8a4a10" stroke-opacity=".3" stroke-width="1.1"/><circle cx="{x+r*1.8:.1f}" cy="{y:.1f}" r="2.2" fill="#8a4a10" fill-opacity=".25"/>'
c['tapcash']=emoney('tc','<linearGradient id="tcb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6b93a"/><stop offset=".55" stop-color="#ee9a1f"/><stop offset="1" stop-color="#e2801a"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#tcb)"/>{vines}',
 'TapCash','#ffffff','0000')

def paylater(id, defs, art, name, ink, bank_col=None, edge='rgba(255,255,255,.35)'):
    # No number to show: the line that carries a card's last four is left empty, PAYLATER alone at the foot.
    return card(id, defs, art, name, '', ink, None, '····', holder='PAYLATER', bank_col=bank_col, edge=edge).replace('>•••• ····</text>', '></text>')
# KREDIVO — white, two broad strokes crossing on the right: sky blue and orange
c['kredivo']=paylater('kv','<linearGradient id="kvb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef3f7"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#kvb)"/>'
 '<path d="M222 40 L262 40 L262 200 L222 200 Z" fill="#4fbde8"/>'
 '<path d="M262 128 L320 40 L352 40 L282 142 Z" fill="#f4892a"/>'
 '<path d="M262 128 L282 142 L330 214 H296 Z" fill="#4fbde8"/>',
 'Kredivo','#2b3a48',bank_col='#2b9fd4',edge='rgba(0,0,0,.08)')
# AKULAKU — warm red, a big pale ring on the right
c['akulaku']=paylater('ak','<linearGradient id="akb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2463a"/><stop offset="1" stop-color="#e0302a"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#akb)"/><circle cx="276" cy="112" r="70" fill="#ffffff" fill-opacity=".14"/><circle cx="276" cy="112" r="36" fill="none" stroke="#ffffff" stroke-opacity=".3" stroke-width="12"/>',
 'Akulaku','#ffffff')
# SPAYLATER — Shopee orange, a soft shopping-bag shape on the right
c['spaylater']=paylater('spl','<linearGradient id="splb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6a2a"/><stop offset="1" stop-color="#ee4d1f"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#splb)"/><path d="M226 80 H330 L320 196 H236 Z" fill="#ffffff" fill-opacity=".16"/><path d="M254 80 C 254 52 302 52 302 80" fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="7"/>',
 'SPayLater','#ffffff')
# GOPAYLATER — GoPay cyan, a darker drop-shaped circle on the right
c['gopaylater']=paylater('gpl','<linearGradient id="gplb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16bde3"/><stop offset="1" stop-color="#00a4cc"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#gplb)"/><circle cx="282" cy="120" r="74" fill="#0b2d38" fill-opacity=".14"/><path d="M262 98 C 296 92 314 118 300 146 C 290 160 270 158 262 142 Z" fill="#ffffff" fill-opacity=".22"/>',
 'gopaylater','#ffffff')
json.dump(c,open(sys.argv[1],'w'))
