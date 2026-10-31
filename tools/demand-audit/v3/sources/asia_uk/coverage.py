import sys, json, pandas as pd
sys.path.insert(0, '/home/claude/v3data/asia_uk/scripts')
from oa import game
G = set(game())
B = '/home/claude/v3data/asia_uk/'
res = {}
for f in ['normalized_india_dgca.csv', 'normalized_japan_mlit.csv', 'normalized_japan_mlit_flow.csv', 'normalized_uk_caa.csv']:
    d = pd.read_csv(B + f, keep_default_na=False)
    d['ing'] = d.origin_iata.isin(G) & d.dest_iata.isin(G)
    d['unm'] = d.origin_iata.str.startswith('UNMAPPED') | d.dest_iata.str.startswith('UNMAPPED')
    print('=====', f, 'rows', len(d))
    g = d.groupby(['source', 'year']).apply(lambda x: pd.Series({'rows': len(x), 'months': x.month.nunique(), 'pax': x.passengers.sum(), 'pax_in_game': x.passengers[x.ing].sum(), 'share_in_game': round(x.passengers[x.ing].sum() / x.passengers.sum() * 100, 1), 'pax_unmapped': x.passengers[x.unm].sum()}), include_groups=False)
    print(g.to_string())
    for s, x in d.groupby('source'):
        x = x[~x.ing]
        x = x.assign(pair=x[['origin_iata', 'dest_iata']].apply(lambda r: '-'.join(sorted(r)), axis=1))
        top = x[x.year == x.year.max() if 'FY' in s else x.year == 2025].groupby('pair').passengers.sum().sort_values(ascending=False).head(12)
        miss = x.groupby('origin_iata').passengers.sum().add(x.groupby('dest_iata').passengers.sum(), fill_value=0)
        miss = miss[[c not in G for c in miss.index]].sort_values(ascending=False).head(15)
        print(' ', s, 'top out-of-game pairs (latest yr):', dict(top))
        print(' ', s, 'airports not in game by pax (all yrs):', {k: int(v) for k, v in miss.items()})
