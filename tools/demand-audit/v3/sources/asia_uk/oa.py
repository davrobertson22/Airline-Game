"""OurAirports helpers."""
import csv, json, re, unicodedata
REF = '/home/claude/v3data/asia_uk/raw/ref/'
def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().upper()
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()
def load_oa():
    rows = []
    with open(REF + 'airports.csv', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            rows.append(r)
    return rows
def by_iata(rows):
    return {r['iata_code']: r for r in rows if r['iata_code']}
def by_icao(rows):
    d = {}
    for r in rows:
        for k in (r['icao_code'], r['gps_code'], r['ident']):
            if k and k not in d: d[k] = r
    return d
def game():
    return {a['code']: a for a in json.load(open(REF + 'game_airports.json'))}
