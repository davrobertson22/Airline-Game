"""Build normalized_india_dgca.csv from DGCA FY city-pair (domestic) and quarterly Table 4 (international)."""
import sys, glob, csv, json, re, collections, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, '/home/claude/v3data/asia_uk/scripts')
from oa import *
import openpyxl
BASE = '/home/claude/v3data/asia_uk/'; RAW = BASE + 'raw/india/'
# label -> (IATA, note). Labels are DGCA city names (upper-cased, stripped).
M = {
'ADAMPUR':'AIP','AGARTALA':'IXA','AGATTI ISLAND':'AGX','AGRA':'AGR','AHMEDABAD':'AMD','AIZAWL':'AJL','ALIGARH AIRPORT':'HRH','ALLAHABAD':'IXD','ALLAHABAD (PRAYAGRAJ)':'IXD','PRAYAGRAJ':'IXD','AMBIKAPUR':'AHA','AMBIKAPUR AIRPORT':'AHA','AMRAVATI':'AVR','AMRITSAR':'ATQ','AURANGABAD':'IXU','AYODHYA':'AYJ','AYODHYA INTERNATIONAL AIRPORT':'AYJ','AZAMGARH AIRPORT':'AZH','BAGDOGRA':'IXB','BAREILLY':'BEK','BATHINDA':'BUP','BHATINDA':'BUP','BELGAUM':'IXG','BENGALURU':'BLR','BHAVNAGAR':'BHU','BHOPAL':'BHO','BHUBANESWAR':'BBI','BHUJ':'BHJ','BIDAR':'IXX','BIKANER':'BKB','BILASPUR':'PAB','CHANDIGARH':'IXC','CHENNAI':'MAA','CHITRAKOOT AIRPORT':'CWK','COIMBATORE':'CJB','COOCH BEHAR':'COH','CUDDAPAH':'CDP','CUDDAPAH (KADAPA)':'CDP','DABOLIM':'GOI','DARBHANGA':'DBR','DATIA':'DPP','DEHRADUN':'DED','DELHI':'DEL','DEOGHAR':'DGH','DHARAMSALA':'DHM','DIBRUGARH':'DIB','DIMAPUR':'DMU','DIU':'DIU','DURGAPUR':'RDP','GAYA':'GAY','GHAZIABAD':'HDO','HINDON AIRPORT':'HDO','GOA (DABOLIM, SOUTH GOA)':'GOI','GOA (MOPA, NORTH GOA)':'GOX','GONDIA':'GDB','GORAKHPUR':'GOP','GULBARGA':'GBI','KALABURAGI':'GBI','GUWAHATI':'GAU','GWALIOR':'GWL','HIRASAR (RAJKOT)':'HSR','RAJKOT INTERNATIONAL AIRPORT':'HSR','RAJKOT':'RAJ','HISAR':'HSS','HUBLI':'HBX','HYDERABAD':'HYD','IMPHAL':'IMF','INDORE':'IDR','ITANAGAR':'HGI','JABALPUR':'JLR','JAGDALPUR':'JGB','JAIPUR':'JAI','JAISALMER':'JSA','JALGAON':'JLG','JAMMU':'IXJ','JAMNAGAR':'JGA','JAMSHEDPUR':'IXW','JEYPORE':'PYB','JHARSUGUDA':'JRG','JODHPUR':'JDH','JORHAT':'JRH','KANDLA':'IXY','KANNUR':'CNN','KANPUR':'KNU','KESHOD':'IXK','KHAJURAHO':'HJR','KISHANGARH':'KQH','KOCHI':'COK','KOLHAPUR':'KLH','KOLKATA':'CCU','KOZHIKODE':'CCJ','KULLU':'KUU','KURNOOL':'KJB','KUSHINAGAR':'KBK','LEH':'IXL','LILABARI':'IXI','LUCKNOW':'LKO','LUDHIANA':'LUH','MADURAI':'IXM','MALVAN':'SDW','MANGALORE':'IXE','MANGALORE (MANGALURU)':'IXE','MORADABAD AIRPORT':'MZS','MUMBAI':'BOM','MUMBAI (MUMBAI)':'BOM','MUMBAI (NAVI MUMBAI)':'NMI','MYSORE':'MYQ','NAGPUR':'NAG','NANDED':'NDC','NASHIK':'ISK','NASIK':'ISK','PAKYONG':'PYG','PANTNAGAR':'PGH','PASIGHAT':'IXT','PATHANKOT':'IXP','PATNA':'PAT','PONDICHERRY':'PNY','PONDICHERRY (PUDUCHERRY)':'PNY','PORBANDAR':'PBD','PORT BLAIR':'IXZ','PUNE':'PNQ','RAIPUR':'RPR','RAJAHMUNDRY':'RJA','RANCHI':'IXR','REWA':'REW','ROURKELA':'RRK','RUPSI':'RUP','SALEM':'SXV','SHILLONG':'SHL','SHIMLA':'SLV','SIMLA':'SLV','SHIRDI':'SAG','SHIVAMOGGA':'RQY','SHIVAMOGGA AIRPORT':'RQY','SHRAVASTI AIRPORT':'VSV','SILCHAR':'IXS','SOLAPUR':'SSE','SRINAGAR':'SXR','SURAT':'STV','TEZPUR':'TEZ','TEZU':'TEI','THIRUVANANTHAPURAM':'TRV','TRIVANDRUM':'TRV','TIRUCHIRAPALLY':'TRZ','TIRUCHIRAPPALLI':'TRZ','TIRUPATI':'TIR','TUTICORIN':'TCR','UDAIPUR':'UDR','UTKELA':'UKE','VADODARA':'BDQ','VARANASI':'VNS','VIDYANAGAR':'VDY','VIJAYAWADA':'VGA','VIJAYWADA':'VGA','VISAKHAPATNAM':'VTZ','VISHAKHAPATNAM (VISAKHAPATNAM)':'VTZ','ZIRO':'ZER',
'PURNEA':'','PITHORAGARH':'','UTTARLAI':'',  # no IATA code in OurAirports (ICAO VEPU, VIDF, VIUT)
# foreign cities (international table)
'ABUDHABI':'AUH','ADDIS ABABA':'ADD','ADEN':'ADE','AL AIN':'AAN','ALEXANDRIA':'HBE','ALMATY':'ALA','AMMAN':'AMM','AMSTERDAM':'AMS','ASHGABAT':'ASB','ATHENS':'ATH','BAGHDAD':'BGW','BAHRAIN':'BAH','BAKU':'GYD','BANDAR SERI BEGAWAN':'BWN','BANGKOK':'BKK','BIRMINGHAM':'BHX','BISHKEK':'BSZ','CAIRO':'CAI','CHENGDU':'TFU','CHICAGO':'ORD','CHITTAGONG':'CGP','COLOGNE':'CGN','COLOMBO':'CMB','COPENHAGEN':'CPH','DA NANG':'DAD','DAMMAM':'DMM','DAR ES SALAM':'DAR','DENPASAR':'DPS','DHAKA':'DAC','DOHA':'DOH','DON MUEANG':'DMK','DON MUEANG, BANGKOK':'DMK','DUBAI':'DXB','DUSHANBE':'DYU','ENTEBBE':'EBB','FRANKFURT':'FRA','FUJAIRAH':'FJR','GELEPHU':'GLU','GUANGZHOU':'CAN','HAA DHAALU ATOLL':'HDK','HANOI':'HAN','HELNSKI':'HEL','HO CHI MINH CITY':'SGN','HONG KONG':'HKG','ISTANBUL':'IST','JAFFNA':'JAF','JEDDAH':'JED','KABUL':'KBL','KATHMANDU':'KTM','KIGALI':'KGL','KRABI':'KBV','KUALALUMPUR':'KUL','KUNMING':'KMG','KUTAISI':'KUT','KUWAIT':'KWI','LANGKAWI':'LGK','LEIPZIG':'LEJ','LIEGE':'LGG','LONDON':'LHR','LUXEMBOURG':'LUX','MALE':'MLE','MALPENSA':'MXP','MANCHESTER':'MAN','MANILA':'MNL','MEDINA':'MED','MELBOURNE':'MEL','MILAN':'MXP','MILAN BERGAMO':'BGY','MINSK':'MSQ','MONTREAL':'YUL','MOSCOW':'SVO','MUENCHEN':'MUC','MUNICH':'MUC','MUSCAT':'MCT','NAIROBI':'NBO','NAJF':'NJF','NARITA':'NRT','NEW YORK':'JFK','NEWARK':'EWR','NEWARK, NEW YORK':'EWR','NOTTIMGHAM':'EMA','NOVOSIBIRSK':'OVB','OSAKA':'KIX','OSH':'OSS','PARIS':'CDG','PARO':'PBH','PENANG':'PEN','PHNOM PENH':'KTI','PHU QUOC ISLAND':'PQC','PHUKET':'HKT','PORT LOUIS':'MRU','PORT LOUIS,MAURITIUS':'MRU','RANGOON':'RGN','RAS AL-KHAIMAH':'RKT','REUNION':'RUN','ST-DENIS, REUNION':'RUN','RIYADH':'RUH','ROME':'FCO','SALALAH':'SLL','SAN FRANCISCO':'SFO','SEOUL':'ICN','SEYCHELLES':'SEZ','SHANGHAI':'PVG','SHARJAH':'SHJ','SHENZHEN':'SZX','SHYAMKENT':'CIT','SIEM REAP':'SAI','SINGAPORE':'SIN','SYDNEY':'SYD','TAIPAE':'TPE','TANGERANG':'CGK','TASHKENT':'TAS','TBILISI':'TBS','TEHRAN':'IKA','TELAVIV':'TLV','TOKYO':'HND','TORONTO':'YYZ','VANCOUVER':'YVR','VERONA':'VRN','VIENNA':'VIE','WARSAW':'WAW','WASHINGTON, DC':'IAD','YEKATERINBURG':'SVX','ZURICH':'ZRH',
}
# 'GOA' depends on table: domestic files list DABOLIM separately so 'GOA' = Mopa (GOX); international table is city-level (GOI assumed).
CITY_LEVEL = {'LONDON':'LHR+LGW (city total; LHR assigned)','MOSCOW':'SVO/DME/VKO (SVO assigned)','NEW YORK':'JFK (EWR listed separately)','TOKYO':'HND (NARITA listed separately)','BANGKOK':'BKK (DON MUEANG listed separately)','MILAN':'MXP (BERGAMO/MALPENSA also listed)','PARIS':'CDG','SHANGHAI':'PVG','OSAKA':'KIX','CHENGDU':'TFU/CTU (TFU assigned)','PHNOM PENH':'KTI (Techo, opened Sep-2025; earlier PNH)','GOA':'intl: GOI/GOX city level (GOI assigned); domestic: GOX (Dabolim listed separately)','DELHI':'DEL','MUMBAI':'BOM (+NMI listed separately from FY2025-26)','ROME':'FCO','SEOUL':'ICN','TEHRAN':'IKA','WASHINGTON, DC':'IAD','CHICAGO':'ORD','DUBAI':'DXB (DWC not separated)','NOTTIMGHAM':'EMA (East Midlands, Nottingham)'}
oa = load_oa(); IATA = by_iata(oa); G = game()
def n(x):
    try: return int(round(float(x)))
    except: return 0
def rows(f):
    wb = openpyxl.load_workbook(f, data_only=True)
    for ws in wb.worksheets:
        for r in ws.iter_rows(values_only=True):
            if len(r) >= 5 and isinstance(r[0], (int, float)) and isinstance(r[1], str) and isinstance(r[2], str):
                yield r
used = {}; unm = collections.Counter(); out = []; checks = {}
def code(lbl, ctx):
    l = re.sub(r'\s+', ' ', lbl.strip().upper())
    if l == 'GOA': c = 'GOX' if ctx == 'dom' else 'GOI'
    else: c = M.get(l)
    if c is None: c = ''
    used[(l, ctx)] = c
    return c, l
for f in sorted(glob.glob(RAW + 'citypair_FY*.xlsx')):
    fy = int(re.search(r'FY(\d{4})', f).group(1))
    tot = 0
    for r in rows(f):
        a, al = code(r[1], 'dom'); b, bl = code(r[2], 'dom')
        for p, o, d, ol, dl in ((n(r[3]), a, b, al, bl), (n(r[4]), b, a, bl, al)):
            if p <= 0: continue
            tot += p
            if not o: unm[ol] += p
            if not d: unm[dl] += p
            out.append(['IN_DGCA_DOM_FY', o or 'UNMAPPED:' + ol, d or 'UNMAPPED:' + dl, fy, 0, p, 'segment', 'one-way'])
    checks[f'dom FY{fy}-{fy+1-2000}'] = tot
qsum = collections.defaultdict(lambda: collections.Counter()); qn = collections.defaultdict(set)
for f in sorted(glob.glob(RAW + 'intl/*_4.xlsx')):
    k = f.split('/')[-1][:6]; y = int(k[:4])
    qn[y].add(k)
    for r in rows(f):
        a, al = code(r[1], 'intl'); b, bl = code(r[2], 'intl')
        qsum[y][(a or 'UNMAPPED:' + al, b or 'UNMAPPED:' + bl)] += n(r[3])
        qsum[y][(b or 'UNMAPPED:' + bl, a or 'UNMAPPED:' + al)] += n(r[4])
        if not a: unm[al] += n(r[3]) + n(r[4])
        if not b: unm[bl] += n(r[3]) + n(r[4])
for y in sorted(qsum):
    if len(qn[y]) != 4:
        print('skip incomplete year', y, sorted(qn[y])); continue
    checks[f'intl CY{y}'] = sum(qsum[y].values())
    for (o, d), p in sorted(qsum[y].items()):
        if p > 0: out.append(['IN_DGCA_INTL', o, d, y, 0, p, 'segment', 'one-way'])
with open(BASE + 'normalized_india_dgca.csv', 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['source','origin_iata','dest_iata','year','month','passengers','measure','direction']); w.writerows(out)
with open(BASE + 'mappings/india_dgca_city_map.csv', 'w', newline='') as fh:
    w = csv.writer(fh); w.writerow(['dgca_label','table','iata','oa_name','in_game','note'])
    for (l, ctx), c in sorted(used.items()):
        w.writerow([l, ctx, c, IATA.get(c, {}).get('name', '') if c else '', c in G, CITY_LEVEL.get(l, '' if c else 'no IATA code found')])
json.dump(unm.most_common(), open(BASE + 'mappings/india_unmapped.json', 'w'), indent=0)
print('rows', len(out)); print(checks); print('unmapped', unm.most_common()); print('bad codes', sorted({c for c in used.values() if c and c not in IATA}))
