# Asia + UK real airport-pair passenger data (demand-model calibration)

Collected 2026-10-30. Everything here is official published data. Nothing is estimated or interpolated.
`raw/` holds the original downloads. `scripts/` rebuilds every output from `raw/`:
`build_uk.py`, `build_india.py`, `build_japan.py`, then `finalize.py` (which sums rows whose keys collide
after mapping), then `coverage.py` (which prints the stats below).

## Output files

All outputs share the header `source,origin_iata,dest_iata,year,month,passengers,measure,direction`.

| File | Rows | `source` values | Period | Granularity |
|---|---|---|---|---|
| `normalized_uk_caa.csv` | 78,893 | `UK_CAA_DOM`, `UK_CAA_INTL` | Jan 2023 – Aug 2026 (2026 is partial: 8 months) | monthly, airport pair, `segment`, `both` |
| `normalized_india_dgca.csv` | 8,559 | `IN_DGCA_DOM_FY`, `IN_DGCA_INTL` | domestic FY2022-23 … FY2025-26; international CY2023–CY2025 | annual (`month=0`), city pair, `segment`, `one-way` |
| `normalized_japan_mlit.csv` | 8,954 | `JP_MLIT_DOM_SEG` | Jan 2023 – Dec 2025 | monthly, airport segment, `segment`, `both` |
| `normalized_japan_mlit_flow.csv` | 1,626 | `JP_MLIT_DOM_FLOW` | CY2023–CY2025 | annual (`month=0`), airport to airport, `segment`, `one-way` |

The Japan flow file is the same traffic as `normalized_japan_mlit.csv`, split by direction and
summed by year. **Do not add the two Japan files together.** Use the monthly file for seasonality and the flow file for
directional imbalance.

Mapping and audit files are in `mappings/`:
- `uk_caa_airport_map.csv`: every CAA airport name with its IATA code, how it was matched (`manual` or `auto(score)`), the OurAirports name and whether the airport is in the game.
- `india_dgca_city_map.csv`: every DGCA city label, per table, with its IATA code and notes on city-level ambiguity.
- `japan_mlit_airport_map.csv`: Japanese airport name to IATA.
- `unmapped_all.csv`: everything that could not be mapped, with passenger totals. In the CSVs these appear as `UNMAPPED:<name>`.

Names were mapped to IATA codes using OurAirports `airports.csv` (`raw/ref/airports.csv`, downloaded from
https://davidmegginson.github.io/ourairports-data/airports.csv). Exceptions:
- Four codes are not in the current OurAirports file but are standard historical IATA codes: DSA (Doncaster, closed), KRH (Redhill), MJV (Murcia San Javier, closed 2019) and PBI (West Palm Beach). OurAirports now lists PBI under the code "DJT"; I kept PBI, which is the code the game list uses.
- For Bishkek, OurAirports gives BSZ, with the old code FRU only as a keyword. I used BSZ.

## Totals per year and sanity check

| Source | 2023 | 2024 | 2025 | Known national figure | Verdict |
|---|---|---|---|---|---|
| UK domestic (CAA Table 12.2, each passenger counted once) | 18.57 M | 19.59 M | 19.27 M | ~20 M. CAA Table 10.2 domestic *terminal* pax is 37.2 / 39.2 / 38.6 M, about 2x because it counts each passenger at both ends | OK |
| UK international (Table 12.1) | 238.3 M | 255.9 M | 263.4 M | CAA annual Table 12.1: 238.5 / 256.1 / 263.5 M | OK (monthly sum within 0.1% of annual) |
| India domestic (DGCA city pair, **fiscal year**: the `year` value is the April start year) | FY23-24 153.7 M | FY24-25 165.5 M | FY25-26 167.4 M (FY22-23: 136.0 M) | ~150-165 M/yr. Totals match the TOTAL row in each DGCA file exactly | OK |
| India international (DGCA Table 4, calendar year from 4 quarters) | 63.9 M | 72.2 M | 78.0 M | Matches the sum of the DGCA quarterly GRAND TOTAL rows exactly. India's international market is roughly 65-75 M | OK |
| Japan domestic (MLIT 第3表, scheduled) | 104.0 M | 107.0 M | 111.8 M | ~100 M+. Matches the 計 row of the matrix in 第9表 exactly for 2023/2024; 2025 第9表 = 111.86 M | OK |

UK 2026 (Jan–Aug only): domestic 13.0 M, international 179.2 M.

## Coverage: share of passengers on pairs where both airports are in the game

The game list is `/home/claude/twm/src/data/airports.js` (2,140 airports).

| Source | 2023 | 2024 | 2025 | Biggest airports missing from the game list (passengers, all years) |
|---|---|---|---|---|
| UK domestic | 94.8% | 95.2% | 95.2% | GCI Guernsey 2.4 M, SYY Stornoway 0.4 M, ACI Alderney, DND, ILY, BEB, MME |
| UK international | 97.9% | 98.0% | 97.9% | RMU Murcia 2.4 M, PIK Prestwick 2.1 M, KUN Kaunas 1.9 M, oil rigs 1.8 M (unmappable), WMI Modlin 1.6 M, RMO Chisinau 1.1 M, MME, SCQ, BZG |
| India domestic (FY starting 2023 / 2024 / 2025) | 96.0% | 95.9% | 94.4% | **GOX Goa-Mopa 14.3 M**, HSR Rajkot (new) 2.9 M, RDP Durgapur 2.1 M, HDO Hindon 1.3 M, NMI Navi Mumbai 0.6 M, HGI Itanagar |
| India international | 99.6% | 99.4% | 98.8% | RKT Ras Al Khaimah 1.4 M, FJR Fujairah 0.15 M, BSZ Bishkek |
| Japan domestic | 86.8% | 86.8% | 86.9% | **UKB Kobe 10.4 M**, IZO Izumo 3.1 M, TKS Tokushima 3.1 M, NKM Nagoya-Komaki 2.7 M, UBJ Yamaguchi-Ube 2.5 M, IBR Ibaraki 2.1 M, YGJ Yonago 1.7 M, OKD Okadama, IWK, HSG, HNA, SHI, SYO, MSJ |

FY2022-23 India domestic coverage is 98.7%. The game list has only 37 Japanese airports. Adding UKB, IZO, TKS and UBJ alone would add roughly 4 percentage points of Japanese coverage.

## How each source counts passengers (caveats)

### United Kingdom: CAA "UK Airport Data"

Tables 12.1 and 12.2, one CSV per month.

- **Table 12.2, domestic route analysis.** Each airport pair appears once per month, and the passenger count covers both directions combined (`direction=both`). Origin/destination order is just the CAA's listing order, so treat the pair as unordered. Each passenger is counted once. This differs from the CAA airport terminal-passenger totals and Table 12.3, which count a domestic passenger at both airports (about 2x). Table 12.3 was downloaded but is deliberately not used.
- **Table 12.1, international route analysis.** UK reporting airport ↔ foreign airport, both directions combined. Counting is done at the UK airport only, so there is no double counting.
- **Measure.** Passengers are attributed to the airport where they joined or left the aircraft (flight-stage based). This is not ticket O&D: someone flying LHR→DOH→SYD appears on LHR–DOH. Labelled `segment`.
- **Scope.** The figures are terminal passengers on air transport movements, scheduled plus charter. Air taxi traffic is excluded. Channel Islands and the Isle of Man are in the domestic table.
- **Unmapped.** "OIL RIGS" (offshore helicopter traffic, about 0.5 M/yr, mostly from Aberdeen) is left as `UNMAPPED:OIL RIGS`.
- **Ambiguous names.** Some CAA names are city-level. "ISTANBUL" maps to IST and Sabiha Gökçen is listed separately. "HOUSTON" maps to IAH. "BEIJING" maps to PEK and Daxing is listed separately. "TAIPEI" maps to TPE. "E T JOSHUA" maps to SVD, the closed Arnos Vale airport whose traffic now goes to Argyle (AXI); it is negligible.
- **Name matching.** All 633 foreign names (country + name) were matched against OurAirports. 543 were matched automatically and reviewed by eye; 58 were fixed or forced by hand (see `scripts/build_uk.py` `OVR`). Very small airfields (total < 2,000 pax) were not individually checked.
- **Revisions.** Monthly sums differ from the annual tables by 0.01–0.1% because of revisions. I used the monthly files throughout.

### India: DGCA (Directorate General of Civil Aviation)

- **Domestic: "City Pair Wise Scheduled Domestic Passenger Traffic Statistics"** (Table 5.01, Air Transport Operating and Traffic Statistics, yearly).
  - **Fiscal year (April–March), annual only.** In the CSV, `year` = the FY start year (2024 = Apr 2024–Mar 2025) and `month=0`.
  - DGCA also publishes monthly airline-level traffic, but city-pair figures are annual only.
  - Each row of the DGCA file is a city pair with "passengers to city 2" and "from city 2". These were split into two `one-way` rows each.
  - Scheduled Indian carriers only. Labelled `segment`: DGCA does not publish true itinerary O&D, so a connecting passenger counts on each flight.
- **International: Quarterly International Traffic Statistics, "Table 4. City-pairwise international passenger and freight statistics (scheduled)"**.
  - Indian and foreign scheduled carriers, flagged provisional (P) by DGCA.
  - Four quarters were summed to a calendar year (`month=0`), `one-way`.
  - 2026 was left out because only Q2 was usable: the Q1 2026 Excel returns HTTP 403 and exists only as PDF.
  - About 2–26k pax/yr are foreign–foreign legs flown by Indian carriers (for example RKT–IST and MED–RKT). They are kept.
- **City-level labels.** DGCA labels by city, so city names were mapped to airports:
  - "GOA" in the domestic table is Mopa (GOX), because Dabolim is listed separately as "DABOLIM". In the international table "GOA" is city-level and was assigned GOI.
  - "RAJKOT" is the old airport (RAJ, closed Sep 2023). "RAJKOT INTERNATIONAL AIRPORT" and "HIRASAR (RAJKOT)" map to HSR.
  - "MUMBAI (NAVI MUMBAI)" maps to NMI, from FY2025-26.
  - International "LONDON" (LHR+LGW), "MOSCOW", "TOKYO" (=HND; NARITA listed separately), "BANGKOK" (=BKK; DON MUEANG separate), "CHENGDU" (=TFU) and "PHNOM PENH" (=KTI, the new Techo airport) are city totals assigned to the main airport. Details are in `india_dgca_city_map.csv`.
- **Unmapped.** Purnea, Pithoragarh and Uttarlai have no IATA code in OurAirports (about 0.18 M pax, almost all FY2025-26).

### Japan: MLIT 航空輸送統計調査 年報 (annual report), files from e-Stat

- **第3表 国内定期航空路線別、区間別、月別運航及び輸送実績.** For each route segment (区間) there are monthly passenger rows for Jan–Dec.
  - The monthly rows are **both directions combined** (`direction=both`). I verified that the 12 monthly values sum to the 暦年計, and that the 暦年 direction split sums to the same total.
  - The 年度 (fiscal-year) rows were skipped to avoid double counting.
  - Scheduled domestic only (幹線 trunk + ローカル線 local sheets). Labelled `segment`.
- **第9表 国内定期航空空港間旅客流動表(暦年).** This is a directional airport×airport matrix, giving `one-way` annual flows.
  - For 2023/2024 its total equals the segment table exactly.
  - For 2025 it is 45,851 pax higher, all on HND–ISG and KIX–ISG. This is a discrepancy inside MLIT's own publication.
- **Airport naming.** 大阪 = Itami (ITM), 名古屋 = Komaki (NKM, FDA flights), 中部 = NGO and 宮古 = Miyako (MMY). The flow table uses official names (小松=KMQ, 百里=IBR, 美保=YGJ, 宮古島=MMY).
- **Unmapped.** The Izu-islands commuter fields have no IATA codes: Chofu, Niijima, Kozushima, and the Toshima/Mikurajima/Aogashima heliports (about 0.12 M pax/yr). They are kept as `UNMAPPED:<Japanese name>`.
- **Not used.** e-Stat's monthly 速報 (preliminary) series exists but was not used. The annual report is final and already monthly.
- **International.** MLIT's route-level international data (国際航空方面別) is by region/direction only, not airport pair, so no Japan international pair data is included.

## Exact URLs used

UK (CAA). Index pages:
- https://www.caa.co.uk/data-and-analysis/uk-aviation-market/airports/uk-airport-data/
- https://www.caa.co.uk/data-and-analysis/uk-aviation-market/airports/uk-airport-data/uk-airport-data-{2023,2024,2025,2026}/{annual,january,...,december}-{YYYY}/ (2026 annual and Sep–Dec 2026 do not exist yet and return 404)

The 188 CSV downloads (`https://www.caa.co.uk/Documents/Download/<id>/<guid>/<n>`, Tables 10.2 / 12.1 / 12.2 / 12.3 per month and year) are listed one per line with titles in `raw/uk/urls.txt` and `raw/uk/manifest.json`. Example:
`https://www.caa.co.uk/Documents/Download/11911/0af1d44e-1648-4fd7-94e3-0b9697934148/17025` (Table 12.2, annual 2024).

India (DGCA). File paths were discovered through the portal menu endpoint `POST https://www.dgca.gov.in/digigov-portal/scan?` (ruleBookId 4267 = yearly, 4268 = quarterly international). The files themselves are served from S3:
- https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/yearly/27/Normal/CITY%20PAIR%20WISE%20SCHEDULED%20DOMESTIC%20PASSENGER%20TRAFFIC%20STATISTICS/CITY%20PAIR%20WISE%20SCHEDULED%20DOMESTIC%20PASSENGER%20TRAFFIC%20STATISTICS.xlsx (FY2022-23)
- https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/dataReports/aviationDataStatistics/airTransport/domestic/yearly/28/Normal/TABLE%205.01%20%28INDIAN%20CITY-WISE%20PASSENGER%20TRAFFIC%29.xlsx (FY2023-24)
- …/domestic/yearly/29/Normal/TABLE%205.01%20%28INDIAN%20CITY-WISE%20PASSENGER%20TRAFFIC%29.xlsx (FY2024-25)
- …/domestic/yearly/30/Normal/TABLE%205.01%20%28INDIAN%20CITY-WISE%20PASSENGER%20TRAFFIC%29.xlsx (FY2025-26)
- https://public-prd-dgca.s3.ap-south-1.amazonaws.com/InventoryList/dataReports/aviationDataStatistics/airTransport/international/quaterly/{23Q1..25Q4,26Q2}_4.xlsx (+ PDFs). The 2023 Q3 PDF is named `Q32023_4.pdf`, and `26Q1_4.xlsx` returns 403.

All exact URLs are in `raw/india/urls.txt`.

Japan (e-Stat, 政府統計コード 00600360). Listings:
- https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&cycle=7&toukei=00600360&tstat=000001018894&tclass1val=0&year={2023,2024,2025}0&month=0

Files:
- 第3表 (route/segment/month): https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040191398&fileKind=0 (2023), …=000040290549 (2024), …=000040471584 (2025)
- 第9表 (airport flow, calendar year): statInfId 000040191404 (2023), 000040290555 (2024), 000040471590 (2025)
- 路線別索引 (route index, reference only): 000040191395, 000040290546, 000040471581

Also listed in `raw/japan/urls.txt`.

## Not available / not done

- India domestic city-pair figures are published only as fiscal-year annual totals. There is no monthly or calendar-year city-pair breakdown on the DGCA site.
- No source here gives true passenger O&D (ticket origin to final destination). All four are flight-segment (on-board) counts.
- Japan international airport-pair passenger counts are not published by MLIT at airport-pair level.
