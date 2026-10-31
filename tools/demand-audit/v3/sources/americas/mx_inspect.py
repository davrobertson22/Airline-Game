import openpyxl,sys
for f in sys.argv[1:]:
    wb=openpyxl.load_workbook(f,read_only=True,data_only=True)
    print('FILE',f,[ws.title for ws in wb.worksheets])
    for ws in wb.worksheets:
        rows=list(ws.iter_rows(values_only=True))
        print(' SHEET',ws.title,len(rows))
        for r in rows[1:6]: print('  ',r)
        print('  LAST', rows[-3:])
