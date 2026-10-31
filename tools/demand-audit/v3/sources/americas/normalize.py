# Usage: python3 -I normalize.py <americas_dir> <scratch_dir>
import sys, os, csv, pandas as pd, numpy as np
sys.path.insert(0, os.path.join(sys.argv[1], 'scripts'))
from mx_citymap import lookup
A=sys.argv[1]; S=sys.argv[2]
game=pd.read_csv(f'{A}/raw/game_airports.csv',names=['code','cc'])
GAME=set(game.code)

# ---------- OurAirports ICAO -> IATA ----------
ap=pd.read_csv(f'{A}/raw/ourairports/airports.csv',dtype=str,keep_default_na=False)
ap_iata=ap[ap.iata_code.str.len()==3]
icao2iata={}
for col in ['gps_code','icao_code','ident']:   # later columns override -> ident wins
    for k,v in zip(ap_iata[col],ap_iata.iata_code):
        if k: icao2iata[k]=v
# SBCO Canoas AB has no IATA code; it handled Porto Alegre's airline traffic while POA was closed by floods (May-Oct 2024)
icao2iata['SBCO']='POA'
iata_country=dict(zip(ap_iata.iata_code,ap_iata.iso_country))

def write_norm(df,name):
    df=df[['source','origin_iata','dest_iata','year','month','passengers','measure','direction']]
    df=df.sort_values(['year','month','origin_iata','dest_iata'])
    df.to_csv(f'{A}/normalized_{name}.csv',index=False)
    return df

summary={}
# ---------- BRAZIL ----------
d=pd.read_pickle(f'{S}/br.pkl')
d=d[d.ANO.between(2023,2025)&d.GRUPO_DE_VOO.isin(['REGULAR','NÃO REGULAR'])].copy()
d['o']=d.AEROPORTO_DE_ORIGEM_SIGLA.fillna('').str.strip(); d['dd']=d.AEROPORTO_DE_DESTINO_SIGLA.fillna('').str.strip()
d['oi']=d.o.map(icao2iata); d['di']=d.dd.map(icao2iata)
d['MES']=d.MES.astype(int)
br_dom_tot=d[d.NATUREZA=='DOMÉSTICA'].groupby('ANO')[['PASSAGEIROS_PAGOS','PASSAGEIROS_GRATIS','pax']].sum()
br_int_tot=d[d.NATUREZA=='INTERNACIONAL'].groupby('ANO')[['PASSAGEIROS_PAGOS','PASSAGEIROS_GRATIS','pax']].sum()
um=d[d.oi.isna()|d.di.isna()]
unm=pd.concat([um[um.oi.isna()][['o','AEROPORTO_DE_ORIGEM_NOME','AEROPORTO_DE_ORIGEM_PAIS','pax']].set_axis(['code','name','country','pax'],axis=1),
               um[um.di.isna()][['dd','AEROPORTO_DE_DESTINO_NOME','AEROPORTO_DE_DESTINO_PAIS','pax']].set_axis(['code','name','country','pax'],axis=1)])
unm=unm.groupby(['code','name','country'],dropna=False).pax.sum().reset_index().sort_values('pax',ascending=False)
unm.rename(columns={'pax':'passengers_on_rows_touching_it_2023_2025'}).to_csv(f'{A}/unmapped_anac_br.csv',index=False)
m=d[d.oi.notna()&d.di.notna()&(d.oi!=d.di)]
nat=m.groupby(['oi','di','ANO','MES']).NATUREZA.first()
g=m.groupby(['oi','di','ANO','MES']).pax.sum().reset_index()
g=g[g.pax>0]
g.columns=['origin_iata','dest_iata','year','month','passengers']
g['passengers']=g.passengers.round().astype(int)
g['source']='anac_br'; g['measure']='segment'; g['direction']='one-way'
br=write_norm(g,'anac_br')
summary['br']=dict(rows=len(br),dom=br_dom_tot,intl=br_int_tot,
   unmapped_pax=d[d.oi.isna()|d.di.isna()].groupby('ANO').pax.sum(),
   selfpair_pax=d[(d.oi==d.di)&d.oi.notna()].groupby('ANO').pax.sum(),
   total_pax=d.groupby('ANO').pax.sum())

# ---------- MEXICO ----------
x=pd.read_csv(f'{S}/mx_long.csv',keep_default_na=False)
x['passengers']=pd.to_numeric(x.passengers)
x['oi']=[lookup(c,k) for c,k in zip(x.o_city,x.o_country)]
x['di']=[lookup(c,k) for c,k in zip(x.d_city,x.d_country)]
um=x[x.oi.isna()|x.di.isna()]
unm=pd.concat([um[um.oi.isna()][['o_city','o_country','passengers']].set_axis(['city','country','p'],axis=1),
               um[um.di.isna()][['d_city','d_country','passengers']].set_axis(['city','country','p'],axis=1)])
unm.groupby(['city','country']).p.sum().reset_index().rename(columns={'p':'passengers_2023_2025'}).sort_values('passengers_2023_2025',ascending=False).to_csv(f'{A}/unmapped_afac_mx.csv',index=False)
mm=x[x.oi.notna()&x.di.notna()&(x.oi!=x.di)]
g=mm.groupby(['oi','di','year','month']).passengers.sum().reset_index()
g=g[g.passengers>0]
g.columns=['origin_iata','dest_iata','year','month','passengers']
g['passengers']=g.passengers.round().astype(int)
g['source']='afac_mx'; g['measure']='segment'; g['direction']='one-way'
mx=write_norm(g,'afac_mx')
summary['mx']=dict(rows=len(mx),bysheet=x.groupby(['year','sheet']).passengers.sum().unstack(),
   unmapped_pax=x[x.oi.isna()|x.di.isna()].groupby('year').passengers.sum(),
   selfpair=x[(x.oi==x.di)&x.oi.notna()].groupby('year').passengers.sum(),
   foreign_foreign=x[(x.o_country!='Mexico')&(x.d_country!='Mexico')].groupby('year').passengers.sum())

# ---------- COVERAGE ----------
def cov(df,cc):
    df=df.copy()
    df['oc']=df.origin_iata.map(iata_country); df['dc']=df.dest_iata.map(iata_country)
    df['dom']=(df.oc==cc)&(df.dc==cc)
    df['both']=df.origin_iata.isin(GAME)&df.dest_iata.isin(GAME)
    out=[]
    for y,gg in df.groupby('year'):
        for scope,sel in [('domestic',gg.dom),('international',~gg.dom)]:
            h=gg[sel]; t=h.passengers.sum()
            out.append(dict(year=y,scope=scope,passengers=int(t),pairs=h.groupby(['origin_iata','dest_iata']).ngroups,
                 pax_both_in_game=int(h.passengers[h.both].sum()),share_both_in_game=round(h.passengers[h.both].sum()/t,4) if t else None))
    return pd.DataFrame(out), df
cb,brx=cov(br,'BR'); cm,mxx=cov(mx,'MX')
cb.insert(0,'source','anac_br'); cm.insert(0,'source','afac_mx')
cov_all=pd.concat([cb,cm]); cov_all.to_csv(f'{A}/coverage_summary.csv',index=False)
# airports with big traffic missing from the game
def missing(df,cc,name):
    a=pd.concat([df[['origin_iata','passengers']].set_axis(['a','p'],axis=1),df[['dest_iata','passengers']].set_axis(['a','p'],axis=1)])
    a=a.groupby('a').p.sum().reset_index(); a=a[~a.a.isin(GAME)]
    a['country']=a.a.map(iata_country); a=a.sort_values('p',ascending=False)
    a.rename(columns={'a':'iata','p':'enplaned_plus_deplaned_2023_2025'}).to_csv(f'{A}/not_in_game_{name}.csv',index=False)
    return a
mb=missing(br,'BR','anac_br'); mmx=missing(mx,'MX','afac_mx')
pd.set_option('display.width',250)
print(cov_all.to_string())
for k,v in summary.items():
    print('=====',k)
    for kk,vv in v.items(): print('--',kk); print(vv)
print('BR not in game top:'); print(mb.head(25).to_string())
print('MX not in game top:'); print(mmx.head(25).to_string())
