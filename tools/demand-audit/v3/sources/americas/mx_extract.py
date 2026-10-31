# Parse AFAC SASE workbooks -> long table (year, month, service, origin_city, origin_country, dest_city, dest_country, passengers)
import openpyxl,sys,re,csv
out=csv.writer(open(sys.argv[1],'w',newline=''))
out.writerow(['year','month','sheet','o_city','o_country','d_city','d_country','passengers','flights'])
for f in sys.argv[2:]:
    year=int(re.search(r'(20\d\d)',f.split('/')[-1]).group(1))
    wb=openpyxl.load_workbook(f,read_only=True,data_only=True)
    for sh in ['REG NAC','REG INT','FLET NAC','FLET INT']:
        rows=list(wb[sh].iter_rows(values_only=True))
        hi=[i for i,r in enumerate(rows) if r[0] and str(r[0]).startswith('ORIGEN')][0]
        hdr=rows[hi]; intl='INT' in sh
        fcol=4 if intl else 2   # first flights month column
        pcol=fcol+13            # first passengers month column (after 12 months + Total)
        assert 'Ene' in str(hdr[pcol]) and 'Total' in str(hdr[pcol-1]), (f,sh,hdr)
        n=0;tot=0
        for r in rows[hi+1:]:
            if r[0] is None: continue
            if 'T O T A L' in str(r[0]) or str(r[0]).startswith('FUENTE'): break
            oc,occ=(r[0],r[1]) if intl else (r[0],'Mexico')
            dc,dcc=(r[2],r[3]) if intl else (r[1],'Mexico')
            for m in range(12):
                p=r[pcol+m] or 0; fl=r[fcol+m] or 0
                if p or fl:
                    out.writerow([year,m+1,sh,str(oc).strip(),str(occ).strip(),str(dc).strip(),str(dcc).strip(),p,fl]); tot+=p
            n+=1
        print(year,sh,n,'pairs',tot,'pax',file=sys.stderr)
