#!/usr/bin/env python3
"""Normalize US (BTS) and Australian (BITRE) international passenger data.

Run from anywhere with:  python3 -I /home/claude/v3data/us_au_intl/scripts/normalize.py
Reads raw/ files, writes normalized_*.csv, unmapped_codes.csv, summary.json in the folder root.
"""
import csv, json, os, re, collections

ROOT = '/home/claude/v3data/us_au_intl'
RAW = os.path.join(ROOT, 'raw')
GAME_JS = '/home/claude/twm/src/data/airports.js'
YEARS = (2023, 2024, 2025)
HEADER = ['source', 'origin_iata', 'dest_iata', 'year', 'month', 'passengers', 'measure', 'direction']

# ---------------------------------------------------------------- game list
src = open(GAME_JS, encoding='utf-8').read()
block = src[src.index('export const AIRPORTS'):src.index('export function getAirport')]
GAME = set(re.findall(r"code:\s*'([A-Z0-9]{3})'", block))

# ---------------------------------------------------------------- OurAirports IATA index
OA = collections.defaultdict(list)
for r in csv.DictReader(open(os.path.join(RAW, 'ourairports_airports.csv'), encoding='utf-8', errors='replace')):
    if r['iata_code']:
        OA[r['iata_code']].append((r['name'], r['iso_country'], r['type']))
US_TERR = {'US', 'PR', 'VI', 'GU', 'MP', 'AS', 'UM'}
# BTS country codes that differ from ISO (OurAirports)
BTS_CTRY_ALIAS = {'KV': 'XK'}

# BTS codes -> IATA where BTS uses a non-IATA / legacy / BTS-assigned code.
BTS_OVERRIDES = {
    'PBI': 'PBI',  # Palm Beach; OurAirports now lists it as DJT (2026 rename); game list uses PBI
    'CSL': 'CSW',  # Cabo San Lucas Intl (BTS CSL; IATA CSW per OurAirports)
    'HOW': 'BLB',  # Panama Pacifico (ex-Howard AFB)
    'MLH': 'BSL',  # EuroAirport Basel-Mulhouse (shared code; BSL is the game-list code)
    'CAT': 'TBI',  # New Bight, Bahamas (BTS CAT clashes with Cascais IATA CAT); IATA TBI
    'HIK': 'HNL',  # Hickam / Daniel K Inouye (military side of HNL)
    'PT1': 'CAT',  # Cascais, Portugal
    'SXF': 'BER',  # BTS labels Berlin Brandenburg with legacy Schoenefeld code
}

lookup_desc = {r['Code']: r['Description'] for r in
               csv.DictReader(open(os.path.join(RAW, 'bts_L_AIRPORT_ID.csv'), encoding='latin-1'))}

unmapped = {}  # (source, raw_code) -> dict


def note_unmapped(source, raw, desc, pax, reason):
    k = (source, raw)
    u = unmapped.setdefault(k, {'source': source, 'raw_code_or_name': raw, 'description': desc,
                                'reason': reason, 'passengers_2023_2025': 0.0})
    u['passengers_2023_2025'] += pax


def map_bts(code, ctry, apt_id, pax, source):
    """Return IATA code for a BTS 3-char airport code (validated against OurAirports)."""
    if code in BTS_OVERRIDES:
        return BTS_OVERRIDES[code]
    o = OA.get(code)
    desc = lookup_desc.get(apt_id, '')
    if not o:
        note_unmapped(source, code, desc, pax, 'BTS code not an IATA code in OurAirports; kept as-is')
        return code
    if ctry:
        c = BTS_CTRY_ALIAS.get(ctry, ctry)
        ctries = {x[1] for x in o}
        if c not in ctries and not (c == 'US' and ctries & US_TERR) and \
           not (c == 'GB' and ctries & {'JE', 'GG', 'IM'}):
            note_unmapped(source, code, desc, pax, f'IATA code exists but in {sorted(ctries)} not {ctry}; kept as-is')
    return code


summary = {}


def finish(source_key, rows, fname, note=''):
    rows.sort(key=lambda r: (r[3], r[4], r[1], r[2]))
    with open(os.path.join(ROOT, fname), 'w', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(HEADER)
        for r in rows:
            w.writerow(r[:5] + [int(round(r[5]))] + r[6:])
    per_year = collections.defaultdict(lambda: {'rows': 0, 'passengers': 0, 'both_in_game': 0,
                                                 'months': set()})
    pair_tot = collections.Counter()
    pair_in = {}
    for r in rows:
        y = per_year[r[3]]
        y['rows'] += 1
        y['passengers'] += r[5]
        y['months'].add(r[4])
        inn = r[1] in GAME and r[2] in GAME
        if inn:
            y['both_in_game'] += r[5]
        key = tuple(sorted((r[1], r[2])))
        pair_tot[key] += r[5]
        pair_in[key] = inn
    out = {'file': fname, 'rows': len(rows), 'note': note, 'years': {}}
    for yr, y in sorted(per_year.items()):
        out['years'][yr] = {'rows': y['rows'], 'passengers': int(round(y['passengers'])),
                            'passengers_both_in_game': int(round(y['both_in_game'])),
                            'share_both_in_game': round(y['both_in_game'] / y['passengers'], 4) if y['passengers'] else None,
                            'months': sorted(y['months'])}
    tot = sum(pair_tot.values())
    out['all_years'] = {'passengers': int(round(tot)),
                        'share_both_in_game': round(sum(v for k, v in pair_tot.items() if pair_in[k]) / tot, 4),
                        'distinct_pairs_undirected': len(pair_tot),
                        'distinct_pairs_both_in_game': sum(1 for k in pair_tot if pair_in[k])}
    missing = collections.Counter()
    for k, v in pair_tot.items():
        if not pair_in[k]:
            for c in k:
                if c not in GAME:
                    missing[c] += v
    out['top_airports_missing_from_game'] = [[c, int(round(v))] for c, v in missing.most_common(40)]
    summary[source_key] = out


# ================================================================ 1. BTS T-100 International Segment (directional)
agg = collections.Counter()
for y in YEARS:
    fn = os.path.join(RAW, 't100i', str(y), 'T_T100I_SEGMENT_ALL_CARRIER.csv')
    for r in csv.DictReader(open(fn, encoding='latin-1')):
        p = float(r['PASSENGERS'])
        if p <= 0:
            continue
        o = map_bts(r['ORIGIN'], r['ORIGIN_COUNTRY'], r['ORIGIN_AIRPORT_ID'], p, 'bts_t100i')
        d = map_bts(r['DEST'], r['DEST_COUNTRY'], r['DEST_AIRPORT_ID'], p, 'bts_t100i')
        agg[(o, d, int(r['YEAR']), int(r['MONTH']))] += p
rows = [['bts_t100i', o, d, y, m, p, 'segment', 'one-way'] for (o, d, y, m), p in agg.items()]
finish('bts_t100i', rows, 'normalized_bts_t100i.csv',
       'BTS T-100 International Segment (All Carriers), table T_T100I_SEGMENT_ALL_CARRIER; all service classes')

# ================================================================ 2. BTS International Report Passengers (Socrata xgub-n9bw, both directions)
agg = collections.Counter()
for r in csv.DictReader(open(os.path.join(RAW, 'bts_xgub-n9bw_2023plus_raw.csv'), encoding='latin-1')):
    y = int(r['year'])
    if y not in YEARS or r['type'] != 'Passengers':
        continue
    p = float(r['total'])
    if p <= 0:
        continue
    o = map_bts(r['usg_apt'], None, r['usg_apt_id'], p, 'bts_intl_report')
    d = map_bts(r['fg_apt'], None, r['fg_apt_id'], p, 'bts_intl_report')
    agg[(o, d, y, int(r['month']))] += p
rows = [['bts_intl_report', o, d, y, m, p, 'segment', 'both'] for (o, d, y, m), p in agg.items()]
finish('bts_intl_report', rows, 'normalized_bts_intl_report.csv',
       'DOT International_Report_Passengers (Socrata xgub-n9bw); origin=US airport, dest=foreign airport; both directions summed')

# ================================================================ 3. BITRE International Airlines - Traffic by city pairs
AU_PORTS = {
    'Sydney': 'SYD', 'Melbourne': 'MEL', 'Brisbane': 'BNE', 'Perth': 'PER', 'Adelaide': 'ADL',
    'Gold Coast': 'OOL', 'Cairns': 'CNS', 'Darwin': 'DRW', 'Sunshine Coast': 'MCY', 'Canberra': 'CBR',
    'Hobart': 'HBA', 'Newcastle': 'NTL', 'Broome': 'BME', 'Norfolk Island': 'NLK',
    'Toowoomba Wellcamp': 'WTB', 'Avalon': 'AVV', 'Townsville': 'TSV', 'Port Hedland': 'PHE',
}
# City-level foreign ports -> main IATA airport. '*' marks a multi-airport city where a choice was made.
FOREIGN_PORTS = {
    'Singapore': 'SIN', 'Auckland': 'AKL', 'Denpasar': 'DPS', 'Dubai': 'DXB', 'Hong Kong': 'HKG',
    'Kuala Lumpur': 'KUL', 'Tokyo': 'HND*', 'Doha': 'DOH', 'Bangkok': 'BKK*', 'Los Angeles': 'LAX',
    'Nadi': 'NAN', 'Christchurch': 'CHC', 'Ho Chi Minh City': 'SGN', 'Guangzhou': 'CAN', 'Seoul': 'ICN*',
    'Queenstown': 'ZQN', 'Manila': 'MNL', 'Shanghai': 'PVG*', 'Wellington': 'WLG', 'San Francisco': 'SFO',
    'Taipei': 'TPE*', 'Abu Dhabi': 'AUH', 'Vancouver': 'YVR', 'Jakarta': 'CGK*', 'London': 'LHR*',
    'New Delhi': 'DEL', 'Honolulu': 'HNL', 'Xiamen': 'XMN', 'Santiago': 'SCL', 'Colombo': 'CMB',
    'Phuket': 'HKT', 'Osaka': 'KIX*', 'Beijing': 'PEK*', 'Dallas': 'DFW*', 'Port Moresby': 'POM',
    'Johannesburg': 'JNB', 'Chengdu': 'TFU*', 'Hanoi': 'HAN', 'Port Vila': 'VLI', 'Noumea': 'NOU',
    'Haikou': 'HAK', 'Bangalore': 'BLR', 'Istanbul': 'IST*', 'Bandar Seri Begawan': 'BWN', 'Apia': 'APW',
    'Shenzhen': 'SZX', 'Nanjing': 'NKG', 'Qingdao': 'TAO', 'Mauritius': 'MRU', 'Rarotonga': 'RAR',
    'Hangzhou': 'HGH', 'Houston': 'IAH*', 'Honiara': 'HIR', 'Hamilton': 'HLZ', 'Dili': 'DIL', 'Wuhan': 'WUH',
    'Paris': 'CDG*', 'New York': 'JFK*', 'Bombay': 'BOM', 'Rome': 'FCO*', 'Toronto': 'YYZ*',
    'Tongatapu': 'TBU', 'Nauru': 'INU', 'Zhengzhou': 'CGO', 'Chongqing': 'CKG', 'Jinan': 'TNA',
    'Dunedin': 'DUD', "Xi'an": 'XIY', 'Cebu': 'CEB', 'Espiritu Santo': 'SON', 'Sapporo': 'CTS',
    'Palau': 'ROR', 'Tianjin': 'TSN', 'Fuzhou': 'FOC', 'Munda': 'MUA', 'Taiyuan': 'TYN', 'Tarawa': 'TRW',
    'Chicago': 'ORD*', 'Cincinnati': 'CVG', 'Anchorage': 'ANC', 'Louisville': 'SDF', 'Almaty': 'ALA',
    'Lombok': 'LOP', 'Macau': 'MFM', 'Baku': 'GYD', 'Da Nang': 'DAD', 'Surabaya': 'SUB',
    'Kota Kinabalu': 'BKI', 'Gimhae': 'PUS', 'Al-Fujairah': 'FJR', 'Gaborone': 'GBE', 'Cologne': 'CGN',
    'Bahrain': 'BAH', 'Dhaka': 'DAC', 'Oakland': 'OAK', 'Phnom Penh': 'PNH', 'Kuching': 'KCH',
    'Brussels': 'BRU', 'Riyadh': 'RUH', 'Luzon Island': 'CRK*',
}
multi_city_choices = {}
agg = collections.Counter()
for r in csv.DictReader(open(os.path.join(RAW, 'bitre_city_pairs.csv'), encoding='utf-8-sig', errors='replace')):
    y = int(r['Year'])
    if y not in YEARS:
        continue
    pin = float(r['Passengers_In'] or 0)
    pout = float(r['Passengers_Out'] or 0)
    au = AU_PORTS.get(r['AustralianPort'])
    fp = FOREIGN_PORTS.get(r['ForeignPort'])
    if au is None:
        note_unmapped('bitre_city_pairs', r['AustralianPort'], 'Australian port', pin + pout, 'no IATA mapping')
        au = r['AustralianPort']
    if fp is None:
        note_unmapped('bitre_city_pairs', r['ForeignPort'], r['Country'], pin + pout, 'no IATA mapping')
        fp = r['ForeignPort']
    elif fp.endswith('*'):
        fp = fp[:-1]
        multi_city_choices[r['ForeignPort']] = fp
    m = int(r['Month_num'])
    if pout > 0:
        agg[(au, fp, y, m)] += pout   # outbound from Australia
    if pin > 0:
        agg[(fp, au, y, m)] += pin    # inbound to Australia
rows = [['bitre_city_pairs', o, d, y, m, p, 'segment', 'one-way'] for (o, d, y, m), p in agg.items()]
finish('bitre_city_pairs', rows, 'normalized_bitre_city_pairs.csv',
       'BITRE International Airlines - Traffic by city pairs (data.gov.au); uplift/discharge within flight number; scheduled carriers only')
summary['bitre_city_pairs']['multi_airport_city_choices'] = multi_city_choices

# ================================================================ 4. BTS T-100 Domestic Segment (directional)
agg = collections.Counter()
same_airport = 0.0
for y in YEARS:
    fn = os.path.join(RAW, 't100d', str(y), 'T_T100D_SEGMENT_ALL_CARRIER.csv')
    for r in csv.DictReader(open(fn, encoding='latin-1')):
        p = float(r['PASSENGERS'])
        if p <= 0:
            continue
        o = map_bts(r['ORIGIN'], None, r['ORIGIN_AIRPORT_ID'], p, 't100_domestic')
        d = map_bts(r['DEST'], None, r['DEST_AIRPORT_ID'], p, 't100_domestic')
        if o == d:   # sightseeing / return-to-origin flights
            same_airport += p
            continue
        agg[(o, d, int(r['YEAR']), int(r['MONTH']))] += p
rows = [['t100_domestic', o, d, y, m, p, 'segment', 'one-way'] for (o, d, y, m), p in agg.items()]
finish('t100_domestic', rows, 'normalized_t100_domestic.csv',
       'BTS T-100 Domestic Segment (All Carriers), table T_T100D_SEGMENT_ALL_CARRIER; all service classes')
summary['t100_domestic']['dropped_same_airport_passengers'] = int(same_airport)

# ================================================================ 5. BITRE Domestic Airlines - Top Routes (both directions)
AU_DOM = {
    'ADELAIDE': 'ADL', 'ALBURY': 'ABX', 'ALICE SPRINGS': 'ASP', 'ARMIDALE': 'ARM', 'AYERS ROCK': 'AYQ',
    'BALLINA': 'BNK', 'BRISBANE': 'BNE', 'BROOME': 'BME', 'BUNDABERG': 'BDB', 'CAIRNS': 'CNS',
    'CANBERRA': 'CBR', 'COFFS HARBOUR': 'CFS', 'DARWIN': 'DRW', 'DEVONPORT': 'DPO', 'DUBBO': 'DBO',
    'EMERALD': 'EMD', 'GERALDTON': 'GET', 'GLADSTONE': 'GLT', 'GOLD COAST': 'OOL', 'HAMILTON ISLAND': 'HTI',
    'HOBART': 'HBA', 'KALGOORLIE': 'KGI', 'KARRATHA': 'KTA', 'LAUNCESTON': 'LST', 'MACKAY': 'MKY',
    'MELBOURNE': 'MEL', 'MILDURA': 'MQL', 'MORANBAH': 'MOV', 'MOUNT ISA': 'ISA', 'NEWCASTLE': 'NTL',
    'NEWMAN': 'ZNE', 'ORANGE': 'OAG', 'PERTH': 'PER', 'PORT HEDLAND': 'PHE', 'PORT LINCOLN': 'PLO',
    'PORT MACQUARIE': 'PQQ', 'PROSERPINE': 'PPP', 'ROCKHAMPTON': 'ROK', 'SUNSHINE COAST': 'MCY',
    'SYDNEY': 'SYD', 'TAMWORTH': 'TMW', 'TOWNSVILLE': 'TSV', 'WAGGA WAGGA': 'WGA',
}
agg = collections.Counter()
for r in csv.DictReader(open(os.path.join(RAW, 'bitre_dom_citypairs_web.csv'), encoding='utf-8-sig', errors='replace')):
    y = int(r['Year'])
    if y not in YEARS:
        continue
    p = float(r['Passenger_Trips'] or 0)
    if p <= 0:
        continue
    ends = []
    for c in (r['City1'], r['City2']):
        code = AU_DOM.get(c)
        if code is None:
            note_unmapped('bitre_domestic', c, 'Australian domestic city', p, 'no IATA mapping')
            code = c
        ends.append(code)
    agg[(ends[0], ends[1], y, int(r['Month_num']))] += p
rows = [['bitre_domestic', o, d, y, m, p, 'segment', 'both'] for (o, d, y, m), p in agg.items()]
finish('bitre_domestic', rows, 'normalized_bitre_domestic.csv',
       'BITRE Domestic Airlines - Top Routes (data.gov.au); RPT services; City1/City2 both directions combined')
ind = collections.Counter()
for r in csv.DictReader(open(os.path.join(RAW, 'bitre_dom_totals_web.csv'), encoding='utf-8-sig', errors='replace')):
    if int(r['Year']) in YEARS:
        ind[int(r['Year'])] += float(r['Passenger_Trips'])
for y, v in ind.items():
    yy = summary['bitre_domestic']['years'][y]
    yy['industry_total_passengers'] = int(v)
    yy['top_routes_share_of_industry'] = round(yy['passengers'] / v, 4)

# sanity: every mapped code should be a real IATA code
bad_fp = [v.rstrip('*') for v in list(FOREIGN_PORTS.values()) + list(AU_PORTS.values()) + list(AU_DOM.values())
          if v.rstrip('*') not in OA]
summary['bitre_mapping_codes_not_in_ourairports'] = bad_fp

# ---------------------------------------------------------------- unmapped list
with open(os.path.join(ROOT, 'unmapped_codes.csv'), 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=['source', 'raw_code_or_name', 'description', 'reason', 'passengers_2023_2025'])
    w.writeheader()
    for u in sorted(unmapped.values(), key=lambda u: (u['source'], -u['passengers_2023_2025'])):
        u = dict(u)
        u['passengers_2023_2025'] = int(round(u['passengers_2023_2025']))
        w.writerow(u)
summary['game_airport_count'] = len(GAME)
summary['unmapped_count'] = len(unmapped)
json.dump(summary, open(os.path.join(ROOT, 'summary.json'), 'w'), indent=1)
print(json.dumps(summary, indent=1)[:6000])
