import pandas as pd, numpy as np, sys
d=pd.read_pickle(sys.argv[1]); ap=pd.read_csv(sys.argv[2],dtype=str,keep_default_na=False)
ap=ap[ap.ident!=''].set_index('ident')[['latitude_deg','longitude_deg']].astype(float)
for c in ['RPK','DISTANCIA_VOADA_KM']:
    d[c]=pd.to_numeric(d[c].str.replace(',','.'),errors='coerce')
x=d[(d.ANO==2024)&(d.NATUREZA=='DOMÉSTICA')&(d.pax>0)].copy()
x=x.join(ap,on='AEROPORTO_DE_ORIGEM_SIGLA').join(ap,on='AEROPORTO_DE_DESTINO_SIGLA',rsuffix='_d')
la1,lo1,la2,lo2=[np.radians(x[c]) for c in ['latitude_deg','longitude_deg','latitude_deg_d','longitude_deg_d']]
x['gc']=6371*2*np.arcsin(np.sqrt(np.sin((la2-la1)/2)**2+np.cos(la1)*np.cos(la2)*np.sin((lo2-lo1)/2)**2))
x['rpk_per_pax']=x.RPK/x.pax
x['r']=x.rpk_per_pax/x.gc
x['stage']=x.DISTANCIA_VOADA_KM/x.DECOLAGENS
print(x.r.describe(percentiles=[.05,.25,.5,.75,.95,.99]))
w=(x.r>1.15)
print('pax share with rpk/pax >1.15*gc:', x.pax[w].sum()/x.pax.sum())
print('rows dec=0:', (x.DECOLAGENS==0).sum(), x.pax[x.DECOLAGENS==0].sum())
print((x.stage/x.gc).describe(percentiles=[.05,.5,.95]))
