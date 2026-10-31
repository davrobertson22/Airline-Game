"""Aggregate rows whose keys collide after name->IATA mapping (e.g. two DGCA labels for one airport)."""
import pandas as pd
B = '/home/claude/v3data/asia_uk/'
K = ['source','origin_iata','dest_iata','year','month','measure','direction']
for f in ['normalized_india_dgca.csv','normalized_japan_mlit.csv','normalized_japan_mlit_flow.csv','normalized_uk_caa.csv']:
    d = pd.read_csv(B + f, keep_default_na=False)
    n0, p0 = len(d), d.passengers.sum()
    d = d.groupby(K, as_index=False, sort=False).passengers.sum()
    d = d[['source','origin_iata','dest_iata','year','month','passengers','measure','direction']].sort_values(['source','year','month','origin_iata','dest_iata'])
    assert d.passengers.sum() == p0
    d.to_csv(B + f, index=False)
    print(f, n0, '->', len(d))
