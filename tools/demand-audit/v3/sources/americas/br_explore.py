import pandas as pd, sys
f=sys.argv[1]
df=pd.read_csv(f,sep=';',skiprows=1,encoding='utf-8-sig',dtype=str,low_memory=False)
print(df.shape)
df['ANO']=df['ANO'].astype(int)
d=df[df.ANO>=2023].copy()
for c in ['PASSAGEIROS_PAGOS','PASSAGEIROS_GRATIS','DECOLAGENS','ASSENTOS']:
    d[c]=pd.to_numeric(d[c].str.replace(',','.'),errors='coerce').fillna(0)
d['pax']=d.PASSAGEIROS_PAGOS+d.PASSAGEIROS_GRATIS
print(d.groupby(['ANO','NATUREZA','GRUPO_DE_VOO'])[['PASSAGEIROS_PAGOS','PASSAGEIROS_GRATIS','DECOLAGENS']].sum())
print(d.groupby('ANO').MES.unique())
z=d[(d.DECOLAGENS==0)&(d.pax>0)]
print('rows pax>0 dec=0',len(z), z.pax.sum())
print(z.head(10)[['EMPRESA_SIGLA','ANO','MES','AEROPORTO_DE_ORIGEM_SIGLA','AEROPORTO_DE_DESTINO_SIGLA','pax','DECOLAGENS','NATUREZA','GRUPO_DE_VOO']])
d.to_pickle(sys.argv[2])
