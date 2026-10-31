"""Build normalized_uk_caa.csv from CAA monthly Tables 12.1 (international) and 12.2 (domestic)."""
import sys, glob, json, csv, re, collections
sys.path.insert(0, '/home/claude/v3data/asia_uk/scripts')
from oa import *
import uk_match
import pandas as pd
BASE = '/home/claude/v3data/asia_uk/'
RAW = BASE + 'raw/uk/'
UK = {'ABERDEEN':'ABZ','ALDERNEY':'ACI','BARRA':'BRR','BELFAST CITY (GEORGE BEST)':'BHD','BELFAST INTERNATIONAL':'BFS','BEMBRIDGE':'BBP','BENBECULA':'BEB','BIGGIN HILL':'BQH','BIRMINGHAM':'BHX','BLACKPOOL':'BLK','BOURNEMOUTH':'BOH','BRISTOL':'BRS','BRIZE NORTON':'BZZ','CAMBRIDGE':'CBG','CAMPBELTOWN':'CAL','CARDIFF WALES':'CWL','CITY OF DERRY (EGLINTON)':'LDY','COLL':'COL','COLONSAY':'CSA','DONCASTER SHEFFIELD':'DSA','DUNDEE':'DND','EAST MIDLANDS INTERNATIONAL':'EMA','EDAY':'EOI','EDINBURGH':'EDI','EXETER':'EXT','FAIR ISLE':'FIE','FARNBOROUGH':'FAB','FOULA':'FOA','GATWICK':'LGW','GLASGOW':'GLA','GLOUCESTERSHIRE':'GLO','GUERNSEY':'GCI','HAWARDEN':'CEG','HEATHROW':'LHR','HUMBERSIDE':'HUY','INVERNESS':'INV','ISLAY':'ILY','ISLE OF MAN':'IOM','ISLES OF SCILLY (ST.MARYS)':'ISC','JERSEY':'JER','KIRKWALL':'KOI','LANDS END (ST JUST)':'LEQ','LEEDS BRADFORD':'LBA','LERWICK (TINGWALL)':'LWK','LIVERPOOL (JOHN LENNON)':'LPL','LONDON CITY':'LCY','LUTON':'LTN','MANCHESTER':'MAN','MARHAM(KINGS LYNN)':'KNF','NEWCASTLE':'NCL','NEWQUAY':'NQY','NORTH RONALDSAY':'NRL','NORTHOLT':'NHT','NORWICH':'NWI','OBAN (NORTH CONNEL)':'OBN','OXFORD (KIDLINGTON)':'OXF','PAPA WESTRAY':'PPW','PRESTWICK':'PIK','REDHILL':'KRH','SANDAY':'NDY','SHOREHAM':'ESH','SOUTHAMPTON':'SOU','SOUTHEND':'SEN','STANSTED':'STN','STORNOWAY':'SYY','STRONSAY':'SOY','SUMBURGH':'LSI','TEESSIDE INTERNATIONAL AIRPORT':'MME','TIREE':'TRE','WESTRAY':'WRY','WHALSAY':'WHS','WICK JOHN O GROATS':'WIC','WARTON':'WRT'}
# Manual overrides for foreign airport names (checked by hand against OurAirports)
OVR = {'ISTANBUL':'IST','OPORTO (PORTUGAL)':'OPO','VENICE':'VCE','MILAN (LINATE)':'LIN','BALE MULHOUSE':'BSL','SALONIKA':'SKG','WARSAW (MODLIN MASOVIA)':'WMI','HOUSTON':'IAH','BEIJING':'PEK','MAURITIUS':'MRU','MIKONOS':'JMK','TALLIN':'TLL','ANTIGUA':'ANU','HANOVER':'HAJ','SYDNEY':'SYD','LUBLIN (PORT LOTNICZY)':'LUZ','TAIPEI':'TPE','TROMSOE':'TOS','DHAKHA':'DAC','GRENADA':'GND','FEZ':'FEZ','MYTILINI':'MJT','JERBA':'DJE','ST KITTS':'SKB','SAN SEBASTIAN':'EAS','ASHKHABAD':'ASB','PORTO SANTO':'PXO','LEMNOS':'LXS','ARUBA':'AUA','E T JOSHUA':'SVD','BODO':'BOO','BERNE':'BRN','SONDRE STROMFJORD':'SFJ','GURYEV':'GUW','MURCIA SAN JAVIER':'MJV','EGILSSTADIR':'EGS','VILLA CISNEROS W SAHARA':'VIL','SAMEDAN/ST MORITZ':'SMV','ABU DHABI - BATEEN':'AZI','DOHA INTERNATIONAL':'DIA','SEATTLE (BOEING FLD INT)':'BFI','CUIDAD REAL':'CQM','GROSETTO':'GRS','LVOV':'LWO','DIYARBAKIR':'DIY','SIEGERLANDS':'SGE','WESTHAMPTON BEACH (FS GABRESKI)':'FOK','WEST PALM BEACH':'PBI','BENAZIR BHUTTO INTERNATIONAL AIR':'ISB','DAKAR':'DKR','ST ETIENNE':'EBU','CAIRO WEST AFB':'','MULHOUSE HABSHEIM':'','OIL RIGS':'','ZELTWEG (MILITARY)':'','GUYANCOURT':'','SCHWABISCH HALL HESSENTAL':'','EGELSBACH':''}
oa = load_oa(); IATA = by_iata(oa); G = game()
def read_t(path):
    d = pd.read_csv(path, encoding='utf-8-sig', dtype=str)
    d.columns = [c.strip() for c in d.columns]
    return d
def num(x):
    try: return int(float(str(x).replace(',', '')))
    except: return 0
man = json.load(open(RAW + 'manifest.json'))
rows = []; fmap = {}; unm = collections.Counter()
def fmatch(country, name):
    k = (country, name)
    if k in fmap: return fmap[k]
    nm = name.strip()
    if nm in OVR: code, how = OVR[nm], 'manual'
    else:
        r, sc, alt = uk_match.match(country, nm)
        code, how = (r['iata_code'], f'auto(score={sc:.1f})') if r and sc >= 9 else ('', 'unmatched')
    if code and code not in IATA: how += ' [code not in OurAirports]'
    fmap[k] = (code, how)
    return fmap[k]
for m in man:
    if m['month'] == 0: continue  # use monthly files; annual files kept for checks
    if m['table'] not in ('12_1', '12_2'): continue
    d = read_t(RAW + m['file'])
    y, mo = m['year'], m['month']
    if m['table'] == '12_1':
        uc = 'UK_airport' if 'UK_airport' in d.columns else 'uk_apt'
        fc = 'foreign_airport' if 'foreign_airport' in d.columns else 'foreign_apt'
        pc = 'total_pax_this_period' if 'total_pax_this_period' in d.columns else 'ty_t_pax'
        per = d['this_period'].iloc[0] if 'this_period' in d.columns else d['report_period'].iloc[0]
        assert str(per) == f'{y}{mo:02d}', (m['file'], per)
        for _, r in d.iterrows():
            p = num(r[pc])
            if p == 0: continue
            u = UK.get(r[uc].strip(), '')
            fcode, how = fmatch(r['foreign_country'].strip(), r[fc].strip())
            if not u: unm[('UK', r[uc].strip())] += p
            if not fcode: unm[(r['foreign_country'].strip(), r[fc].strip())] += p
            rows.append(dict(source='UK_CAA_INTL', o=u, d=fcode, y=y, m=mo, p=p, on=r[uc].strip(), dn=r[fc].strip()))
    else:
        a1 = 'airport_1_name' if 'airport_1_name' in d.columns else 'apt1_apt_name'
        a2 = 'airport_2_name' if 'airport_2_name' in d.columns else 'apt2_apt_name'
        pc = 'total_pax_this_period' if 'total_pax_this_period' in d.columns else 'total_pax_tp'
        assert str(d['this_period'].iloc[0]) == f'{y}{mo:02d}', (m['file'], d['this_period'].iloc[0])
        for _, r in d.iterrows():
            p = num(r[pc])
            if p == 0: continue
            o, de = UK.get(r[a1].strip(), ''), UK.get(r[a2].strip(), '')
            for c, n in ((o, r[a1]), (de, r[a2])):
                if not c: unm[('UK', n.strip())] += p
            rows.append(dict(source='UK_CAA_DOM', o=o, d=de, y=y, m=mo, p=p, on=r[a1].strip(), dn=r[a2].strip()))
with open(BASE + 'normalized_uk_caa.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['source','origin_iata','dest_iata','year','month','passengers','measure','direction'])
    for r in rows:
        w.writerow([r['source'], r['o'] or 'UNMAPPED:' + r['on'], r['d'] or 'UNMAPPED:' + r['dn'], r['y'], r['m'], r['p'], 'segment', 'both'])
with open(BASE + 'mappings/uk_caa_airport_map.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['caa_country','caa_name','iata','method','oa_name','in_game'])
    for n, c in sorted(UK.items()): w.writerow(['UK', n, c, 'manual', IATA.get(c, {}).get('name', '?'), c in G])
    for (co, n), (c, how) in sorted(fmap.items()): w.writerow([co, n, c, how, IATA.get(c, {}).get('name', '') if c else '', c in G])
json.dump([[k[0], k[1], v] for k, v in unm.most_common()], open(BASE + 'mappings/uk_unmapped.json', 'w'), indent=0)
print('rows', len(rows)); print('unmapped', unm.most_common(20))
bad = [c for c in list(UK.values()) + [v[0] for v in fmap.values()] if c and c not in IATA]; print('codes missing from OA:', bad)
