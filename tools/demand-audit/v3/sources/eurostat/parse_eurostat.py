import json, glob, csv, collections, os
icao2iata = {}
for r in csv.DictReader(open('ref/airports.csv', encoding='utf-8')):
    ic = (r['icao_code'] or r['gps_code'] or r['ident']).strip()
    ia = r['iata_code'].strip()
    if ic and ia and len(ia) == 3:
        icao2iata.setdefault(ic, ia)
        if r['ident']: icao2iata.setdefault(r['ident'], ia)
agg = collections.defaultdict(dict)   # (a,b,year,month) -> {reporter: pax}
unmapped = collections.Counter()
for f in sorted(glob.glob('eurostat/*.json')):
    d = json.load(open(f))
    if 'value' not in d: continue
    dims = d['id']; size = d['size']
    cats = {k: d['dimension'][k]['category']['index'] for k in dims}
    inv = {k: {v: kk for kk, v in cats[k].items()} for k in dims}
    # strides
    strides = []; s = 1
    for n in reversed(size): strides.insert(0, s); s *= n
    rep = os.path.basename(f).split('_')[0]
    for idx, val in d['value'].items():
        i = int(idx); coords = {}
        for k, st, n in zip(dims, strides, size):
            coords[k] = inv[k][(i // st) % n]
        pr = coords['airp_pr']; t = coords['time']
        parts = pr.split('_')
        if len(parts) != 4: continue
        ca, ia, cb, ib = parts
        A, B = icao2iata.get(ia), icao2iata.get(ib)
        if not A: unmapped[ia] += val; continue
        if not B: unmapped[ib] += val; continue
        y, m = t.split('-')
        key = tuple(sorted([A, B])) + (int(y), int(m))
        agg[key][rep + ':' + ia] = val
rows = []
for (a, b, y, m), reps in agg.items():
    rows.append((a, b, y, m, max(reps.values()), len(reps)))
with open('eurostat/normalized_eurostat.csv', 'w', newline='') as fo:
    w = csv.writer(fo); w.writerow(['source','origin_iata','dest_iata','year','month','passengers','measure','direction'])
    for a, b, y, m, p, n in sorted(rows): w.writerow(['eurostat', a, b, y, m, int(p), 'segment', 'both'])
print(len(rows), 'pair-months')
tot = collections.Counter()
for a,b,y,m,p,n in rows: tot[y] += p
print(dict(tot))
print('unmapped top', unmapped.most_common(10))
