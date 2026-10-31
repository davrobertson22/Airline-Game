"""Auto-match CAA foreign airport names to IATA via OurAirports; writes candidate file for review."""
import json, sys, collections
sys.path.insert(0, '/home/claude/v3data/asia_uk/scripts')
from oa import *
C = {'ALBANIA':'AL','ALGERIA':'DZ','ANTIGUA AND BARBUDA':'AG','ARGENTINA':'AR','ARMENIA':'AM','ASCENSION ISLAND':'SH','AUSTRALIA':'AU','AUSTRIA':'AT','AZERBAIJAN':'AZ','BAHAMAS':'BS','BAHRAIN':'BH','BANGLADESH':'BD','BARBADOS':'BB','BELARUS':'BY','BELGIUM':'BE','BERMUDA':'BM','BOSNIA-HERZEGOVINA':'BA','BRAZIL':'BR','BRUNEI':'BN','BULGARIA':'BG','CANADA':'CA','CAPE VERDE ISLANDS':'CV','CAYMAN ISLANDS':'KY','CENTRAL AFRICAN REPUBLIC':'CF','CHAD':'TD','CHILE':'CL','CHINA':'CN','COLOMBIA':'CO','COSTA RICA':'CR','CROATIA':'HR','CUBA':'CU','CYPRUS':'CY','CZECH REPUBLIC':'CZ','DENMARK':'DK','DOMINICAN REPUBLIC':'DO','EGYPT':'EG','ESTONIA':'EE','ETHIOPIA':'ET','FAROE ISLANDS':'FO','FINLAND':'FI','FRANCE':'FR','GAMBIA':'GM','GEORGIA':'GE','GERMANY':'DE','GHANA':'GH','GIBRALTAR':'GI','GREECE':'GR','GREENLAND':'GL','GRENADA':'GD','GUYANA':'GY','HONG KONG':'HK','HUNGARY':'HU','ICELAND':'IS','INDIA':'IN','IRAN':'IR','IRAQ':'IQ','IRISH REPUBLIC':'IE','ISLE OF CURACAO NETH.ANTILLES':'CW','ISLE OF DIEGO GARCIA':'IO','ISRAEL':'IL','ITALY':'IT','JAMAICA':'JM','JAPAN':'JP','JORDAN':'JO','KAZAKHSTAN':'KZ','KENYA':'KE','KOSOVO':'XK','KUWAIT':'KW','LATVIA':'LV','LEBANON':'LB','LIBYA':'LY','LITHUANIA':'LT','LUXEMBOURG':'LU','MACEDONIA':'MK','MALAWI':'MW','MALAYSIA':'MY','MALDIVE ISLANDS':'MV','MALTA':'MT','MAURITIUS':'MU','MEXICO':'MX','MOROCCO':'MA','NETHERLANDS':'NL','NIGERIA':'NG','NORWAY':'NO','OMAN':'OM','PAKISTAN':'PK','PERU':'PE','PHILIPPINES':'PH','POLAND':'PL','PORTUGAL(EXCLUDING MADEIRA)':'PT','PORTUGAL(MADEIRA)':'PT','QATAR':'QA','REPUBLIC OF KOREA':'KR','REPUBLIC OF MOLDOVA':'MD','REPUBLIC OF MONTENEGRO':'ME','REPUBLIC OF SERBIA':'RS','REPUBLIC OF SOUTH AFRICA':'ZA','ROMANIA':'RO','RUSSIA':'RU','RWANDA':'RW','SAINT KITTS AND NEVIS':'KN','SAINT VINCENT AND THE GRENADINES':'VC','SAUDI ARABIA':'SA','SENEGAL':'SN','SIERRA LEONE':'SL','SINGAPORE':'SG','SLOVAK REPUBLIC':'SK','SLOVENIA':'SI','SPAIN':'ES','SPAIN(CANARY ISLANDS)':'ES','SRI LANKA':'LK','ST LUCIA':'LC','SUDAN':'SD','SWEDEN':'SE','SWITZERLAND':'CH','TAIWAN':'TW','THAILAND':'TH','TRINIDAD AND TOBAGO':'TT','TUNISIA':'TN','TURKEY':'TR','TURKMENISTAN':'TM','TURKS AND CAICOS ISLANDS':'TC','UGANDA':'UG','UKRAINE':'UA','UNITED ARAB EMIRATES':'AE','USA':'US','UZBEKISTAN':'UZ','VENEZUELA':'VE','VIETNAM':'VN','ZIMBABWE':'ZW'}
STOP = {'AIRPORT','INTERNATIONAL','INTL','INT','AEROPORT','AEROPUERTO','AEROPORTO','FLUGHAFEN','REGIONAL','AIRFIELD','AIR','BASE','THE','DE','DI','DEL','LA','LE','OF','INTERNATIONALE','MAIN'}
def toks(s): return {t for t in norm(s).split() if t not in STOP and len(t) > 1}
oa = load_oa(); g = game()
cands = collections.defaultdict(list)
for r in oa:
    if r['iata_code'] and r['type'] in ('large_airport','medium_airport','small_airport','seaplane_base','heliport'):
        cands[r['iso_country']].append(r)
TYPEW = {'large_airport':3,'medium_airport':2,'small_airport':0.5,'heliport':0,'seaplane_base':0}
def match(country, name):
    iso = C.get(country)
    if not iso: return None, 0, ''
    nt = toks(name)
    best = []
    for r in cands[iso]:
        at = toks(r['name']) | toks(r['municipality']) | toks(r['keywords'].replace(',', ' '))
        mt = toks(r['municipality'])
        inter = nt & at
        if not inter: continue
        sc = len(inter) / len(nt) * 10 + len(nt & mt) * 2 + TYPEW.get(r['type'], 0) + (2 if r['scheduled_service'] == 'yes' else 0) + (3 if r['iata_code'] in g else 0)
        best.append((sc, r))
    best.sort(key=lambda x: -x[0])
    if not best: return None, 0, ''
    sc, r = best[0]
    alt = '; '.join(f"{b[1]['iata_code']}:{b[1]['name']}({b[0]:.1f})" for b in best[1:3])
    return r, sc, alt
if __name__ == '__main__':
    d = json.load(open(sys.argv[1]))
    out = []
    for co, a, p in d:
        r, sc, alt = match(co, a)
        out.append(dict(country=co, name=a, pax=p, iata=r['iata_code'] if r else '', oa_name=r['name'] if r else '', city=r['municipality'] if r else '', score=round(sc, 1), alt=alt))
    json.dump(out, open(sys.argv[2], 'w'), indent=0)
    for o in out: print(f"{o['pax']:>10} {o['country'][:14]:14} | {o['name'][:32]:32} -> {o['iata']:3} {o['oa_name'][:38]:38} [{o['score']}] {o['alt'][:70]}")
