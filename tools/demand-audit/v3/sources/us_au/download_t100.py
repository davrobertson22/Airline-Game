import re,sys,requests,os
# usage: download_t100i.py YEAR OUT.zip [TABLE]  TABLE: FJE = T-100 International Segment (default), GEE = T-100 Domestic Segment
year=sys.argv[1]; out=sys.argv[2]; table=sys.argv[3] if len(sys.argv)>3 else "FJE"
url="https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=%s&QO_fu146_anzr=Nv4%%20Pn44vr45"%table
s=requests.Session(); s.verify=os.environ.get('REQUESTS_CA_BUNDLE','/root/.ccr/ca-bundle.crt')
h=s.get(url,timeout=120).text
def hv(n): return re.search(r'id="%s" value="([^"]*)"'%n,h).group(1)
data={'__EVENTTARGET':'','__EVENTARGUMENT':'','__LASTFOCUS':'','__VIEWSTATE':hv('__VIEWSTATE'),'__VIEWSTATEGENERATOR':hv('__VIEWSTATEGENERATOR'),'__EVENTVALIDATION':hv('__EVENTVALIDATION'),
 'cboGeography':'All','cboYear':year,'cboPeriod':'All','btnDownload':'Download'}
fields=['PASSENGERS','SEATS','DEPARTURES_PERFORMED','UNIQUE_CARRIER','CARRIER_GROUP','ORIGIN','ORIGIN_COUNTRY','ORIGIN_STATE_ABR','ORIGIN_AIRPORT_ID','DEST','DEST_COUNTRY','DEST_STATE_ABR','DEST_AIRPORT_ID','YEAR','MONTH','CLASS','DISTANCE']
h_ids=set(re.findall(r'<input id="([A-Z_]+)" type="checkbox"',h))
for f in fields:
    if f in h_ids: data[f]='on'
r=s.post(url,data=data,timeout=600,stream=True)
print(r.status_code,r.headers.get('content-type'),r.headers.get('content-disposition'))
with open(out,'wb') as fh:
    for c in r.iter_content(1<<16): fh.write(c)
print(os.path.getsize(out))
