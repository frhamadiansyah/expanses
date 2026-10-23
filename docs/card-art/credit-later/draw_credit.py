import json, sys, math, random
W,H=340,214; INSET=22
F="font-family=\"-apple-system,'SF Pro Text',system-ui\""
def chip(x,y,kind,id,w=40,h=31):
    a,b,c=(('#f6e3a1','#cfa449','#8a6424') if kind=='gold' else ('#f2f4f6','#b4bac2','#6b7280'))
    return f'''<g transform="translate({x},{y})"><defs><linearGradient id="ch{id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{a}"/><stop offset=".5" stop-color="{b}"/><stop offset="1" stop-color="{a}"/></linearGradient></defs>
<rect width="{w}" height="{h}" rx="5.5" fill="url(#ch{id})" stroke="{c}" stroke-opacity=".5" stroke-width=".7"/>
<path d="M0 {h*.33:.1f}H{w*.3:.1f}M0 {h*.66:.1f}H{w*.3:.1f}M{w*.7:.1f} {h*.33:.1f}H{w}M{w*.7:.1f} {h*.66:.1f}H{w}M{w*.3:.1f} 0V{h}M{w*.7:.1f} 0V{h}" stroke="{c}" stroke-opacity=".55" stroke-width=".8" fill="none"/>
<rect x="{w*.3:.1f}" y="{h*.22:.1f}" width="{w*.4:.1f}" height="{h*.56:.1f}" rx="3" fill="none" stroke="{c}" stroke-opacity=".55" stroke-width=".8"/></g>'''
def contactless(x,y,col):
    return f'<g transform="translate({x},{y})" fill="none" stroke="{col}" stroke-width="1.7" stroke-linecap="round" opacity=".9"><path d="M2 6c2 2.6 2 7.4 0 10"/><path d="M7 3c3.6 4.4 3.6 11.6 0 16"/><path d="M12 0c5 6 5 16 0 22"/></g>'
def network(kind, ink):
    x=W-INSET; y=H-INSET
    if kind=='visa': return f'<text x="{x}" y="{y}" text-anchor="end" font-family="-apple-system,system-ui" font-size="24" font-weight="900" font-style="italic" letter-spacing="-.5" fill="{ink}">VISA</text>'
    if kind=='mastercard': return f'<g transform="translate({x-46},{y-26})"><circle cx="14" cy="14" r="14" fill="#eb001b"/><circle cx="32" cy="14" r="14" fill="#f79e1b"/><path d="M23 3.3A14 14 0 0 1 23 24.7A14 14 0 0 1 23 3.3Z" fill="#ff5f00"/></g>'
    if kind=='jcb': return f'<text x="{x}" y="{y}" text-anchor="end" font-family="-apple-system,system-ui" font-size="20" font-weight="900" letter-spacing="1" fill="{ink}">JCB</text>'
    return ''
def card(id, defs, art, bank, product, ink, chipk, net, bank_col=None, product_col=None, edge='rgba(255,255,255,.35)'):
    return f'''<svg viewBox="0 0 {W} {H}" width="{W}" height="{H}" style="border-radius:15px;box-shadow:0 10px 22px rgba(0,0,0,.2),0 2px 4px rgba(0,0,0,.1);display:block">
<defs>{defs}<clipPath id="cl{id}"><rect width="{W}" height="{H}" rx="15"/></clipPath>
<linearGradient id="sh{id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".1"/></linearGradient></defs>
<g clip-path="url(#cl{id})">{art}<rect width="{W}" height="{H}" fill="url(#sh{id})"/></g>
<rect x=".5" y=".5" width="{W-1}" height="{H-1}" rx="14.5" fill="none" stroke="{edge}"/>
<text x="{INSET}" y="{INSET+14}" {F} font-size="18" font-weight="700" letter-spacing=".3" fill="{bank_col or ink}">{bank}</text>
<text x="{W-INSET}" y="{INSET+13}" {F} font-size="13" font-weight="600" text-anchor="end" fill="{product_col or ink}" opacity=".95">{product}</text>
{chip(INSET,round(H*.37),chipk,id)}
{contactless(INSET+50,round(H*.37)+5,ink)}
<text x="{INSET}" y="{H-INSET-14}" {F} font-size="15" letter-spacing="2.6" fill="{ink}">•••• 0391</text>
<text x="{INSET}" y="{H-INSET+1}" {F} font-size="9.5" letter-spacing="1.3" fill="{ink}" opacity=".85">CARDHOLDER</text>
{network(net, ink)}
</svg>'''
c={}
# 1 Jenius Platinum — deep teal-black, a fine sheen, the Jenius orange band along the bottom edge
c['jenius-platinum']=card('j1','<linearGradient id="j1b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f3b44"/><stop offset=".6" stop-color="#0a2b33"/><stop offset="1" stop-color="#061d23"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#j1b)"/>'+''.join(f'<path d="M{-40+i*16} 214 L{120+i*16} 0" stroke="#5fd6c8" stroke-opacity=".05"/>' for i in range(30))+
 '<rect x="0" y="207" width="340" height="7" fill="#f04e23"/><rect x="138" y="207" width="44" height="7" fill="#ff6a33"/><rect x="182" y="207" width="24" height="7" fill="#9c1016"/>',
 'Jenius','Platinum','#ffffff','silver','visa',bank_col='#ff7a45')
# 2 DBS Live Fresh — fresh pink-violet-teal flow on the right half only, the left kept calm for the text
c['dbs-live-fresh-visa']=card('d1','<linearGradient id="d1b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a1745"/><stop offset="1" stop-color="#160c2a"/></linearGradient><linearGradient id="d1w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4fa3"/><stop offset=".5" stop-color="#a45bff"/><stop offset="1" stop-color="#2fd4c8"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#d1b)"/>'
 '<path d="M190 -10 C 240 40 200 100 260 140 C 300 168 330 150 360 170 V-10 Z" fill="url(#d1w)" fill-opacity=".85"/>'
 '<path d="M220 -10 C 270 50 230 110 290 150 C 320 170 340 160 360 176" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.4"/>'
 '<path d="M170 -10 C 220 40 180 110 236 150 C 270 176 300 188 360 196" fill="none" stroke="url(#d1w)" stroke-opacity=".6" stroke-width="6"/>',
 'DBS','live fresh','#ffffff','silver','visa',bank_col='#ff3b3b')
# 3 UOB TMRW — the TMRW debit's look, so both TMRW cards match
c['uob-tmrw']=card('t1','''<linearGradient id="t1y" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe12e"/><stop offset="1" stop-color="#ffd000"/></linearGradient>
<linearGradient id="t1r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff2f8f"/><stop offset=".55" stop-color="#d42bb0"/><stop offset="1" stop-color="#6a3fc8"/></linearGradient>''',
 f'<rect width="{W}" height="{H}" fill="url(#t1y)"/>'
 '<path d="M140 0 H340 V92 C 300 70 262 54 226 70 C 196 84 170 44 140 0 Z" fill="#23308f"/>'
 '<path d="M120 214 C 150 150 190 130 236 120 C 282 110 300 70 340 40 V150 C 300 170 268 176 240 196 C 222 208 214 214 210 214 Z" fill="url(#t1r)"/>',
 'UOB','TMRW','#1d1d3a','silver','mastercard',product_col='#ffffff')
# 4 Permata Shopping Card — champagne gold, crisp low-poly facets, dark type for contrast
random.seed(2); facets=''
for i in range(18):
    x=random.uniform(-20,360); y=random.uniform(-20,234); r=random.uniform(40,100); a=random.uniform(0,6.28)
    pts=' '.join(f'{x+r*math.cos(a+k*2.1):.1f},{y+r*math.sin(a+k*2.1):.1f}' for k in range(3))
    facets+=f'<polygon points="{pts}" fill="{random.choice(["#ffffff","#8a6a3a"])}" fill-opacity="{random.uniform(.06,.14):.3f}"/>'
c['permata-shopping-card']=card('p1','<linearGradient id="p1b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9d7b0"/><stop offset=".5" stop-color="#d6bd8a"/><stop offset="1" stop-color="#c2a36c"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#p1b)"/>{facets}','Permata','Shopping Card','#3b2c14','gold','mastercard',edge='rgba(255,255,255,.6)')
# 5 Maybank Manchester United — club red, a darker red sweep, faint pitch lines in a corner
c['maybank-manchester-united']=card('m1','<linearGradient id="m1b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e0161f"/><stop offset=".6" stop-color="#c00d16"/><stop offset="1" stop-color="#8a0710"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#m1b)"/>'
 '<path d="M160 214 C 220 150 280 120 360 110 V214 Z" fill="#000000" fill-opacity=".22"/>'
 '<g fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="1.4"><rect x="220" y="40" width="160" height="110"/><circle cx="220" cy="95" r="26"/><rect x="300" y="70" width="80" height="50"/></g>'
 '<path d="M0 0 L60 0 L0 60 Z" fill="#ffd200" fill-opacity=".9"/>',
 'Maybank','Manchester United','#ffffff','gold','visa')
# 6 Maybank JCB Platinum — black brushed platinum, a large silver ring, Maybank yellow hairline
c['maybank-jcb-platinum']=card('mj','<linearGradient id="mjb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2c30"/><stop offset=".5" stop-color="#16171a"/><stop offset="1" stop-color="#0c0c0e"/></linearGradient><linearGradient id="mjr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f5f7"/><stop offset=".5" stop-color="#9aa0a8"/><stop offset="1" stop-color="#e3e5e8"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#mjb)"/>'+''.join(f'<path d="M0 {y}H340" stroke="#fff" stroke-opacity="{.05 if y%3 else .02}" stroke-width=".5"/>' for y in range(0,214,2))+
 '<circle cx="262" cy="100" r="62" fill="none" stroke="url(#mjr)" stroke-width="6" stroke-opacity=".75"/><circle cx="262" cy="100" r="48" fill="none" stroke="url(#mjr)" stroke-width="1.2" stroke-opacity=".5"/>'
 '<path d="M0 204 H340" stroke="#f7c600" stroke-width="2"/>',
 'Maybank','Platinum','#f0f0f2','silver','jcb')
# 7 UOB Garuda Indonesia — deep navy, a great stylised wing of teal-to-gold feathers sweeping up to the right
feathers=''
for i in range(11):
    a=math.radians(200+i*9); r1=40; r2=150+i*6
    x1=250+r1*math.cos(a); y1=170+r1*math.sin(a); x2=250+r2*math.cos(a+0.08); y2=170+r2*math.sin(a+0.08)
    col=['#2bb3a5','#38c0a6','#5ccaa0','#86d197','#b7d68a','#d9c46a','#e6b24c','#e9a33a','#e8933a','#e2832e','#d97326'][i]
    feathers+=f'<path d="M{x1:.1f} {y1:.1f} Q{(x1+x2)/2+12:.1f} {(y1+y2)/2-10:.1f} {x2:.1f} {y2:.1f}" stroke="{col}" stroke-opacity=".75" stroke-width="{6-i*.3:.1f}" stroke-linecap="round" fill="none"/>'
c['uob-garuda-indonesia']=card('ug','<linearGradient id="ugb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2a44"/><stop offset=".6" stop-color="#0a1e33"/><stop offset="1" stop-color="#061423"/></linearGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#ugb)"/><g transform="translate(30 -30) rotate(-18 250 170)">{feathers}</g>',
 'UOB','Garuda Indonesia','#ffffff','gold','visa')
# 8 Mandiri World Prioritas — the Prioritas debit's black spun metal, so priority cards match
cxm,cym=212,118
spun=''.join(f'<circle cx="{cxm}" cy="{cym}" r="{r}" fill="none" stroke="#ffffff" stroke-opacity="{(0.05 if r%3 else 0.09):.2f}" stroke-width=".6"/>' for r in range(3,260,2))
beams=''.join(f'<path d="M{cxm} {cym} L{cxm+300*math.cos(math.radians(a-3)):.1f} {cym+300*math.sin(math.radians(a-3)):.1f} L{cxm+300*math.cos(math.radians(a+3)):.1f} {cym+300*math.sin(math.radians(a+3)):.1f} Z" fill="url(#mwbeam)"/>' for a in (40,140,220,320))
c['mandiri-world-prioritas']=card('mw','<radialGradient id="mwb" cx=".62" cy=".55" r=".8"><stop offset="0" stop-color="#3a3a3c"/><stop offset=".5" stop-color="#151516"/><stop offset="1" stop-color="#050505"/></radialGradient><radialGradient id="mwbeam" cx="0" cy="0" r="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>',
 f'<rect width="{W}" height="{H}" fill="url(#mwb)"/>{spun}{beams}','mandiri','Prioritas World','#f2f2f4','silver','mastercard')
json.dump(c,open(sys.argv[1],'w'))
