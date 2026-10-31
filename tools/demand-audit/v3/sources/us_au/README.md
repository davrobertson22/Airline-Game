# US and Australia airport-pair passenger data (2023-2025): international plus domestic

These are real monthly airport-pair passenger counts, normalized to calibrate the Tailwinds demand model and its
seasonality. They cover:
- international pairs touching the US or Australia;
- US domestic and Australian domestic pairs.

Downloaded 2026-10-30. Every year from 2023 to 2025 has all 12 months in every file.

## Files

| File | Source | Rows | Measure | Direction |
|---|---|---|---|---|
| `normalized_bts_t100i.csv` | BTS T-100 International Segment, All Carriers (**primary US international**) | 123,518 | segment | one-way |
| `normalized_bts_intl_report.csv` | DOT "International_Report_Passengers" (Socrata) | 70,303 | segment | both |
| `normalized_bitre_city_pairs.csv` | BITRE International Airlines: Traffic by city pairs | 11,826 | segment (uplift/discharge, see caveats) | one-way |
| `normalized_t100_domestic.csv` | BTS T-100 Domestic Segment, All Carriers | 356,164 | segment | one-way |
| `normalized_bitre_domestic.csv` | BITRE Domestic Airlines: Top Routes | 2,239 | segment | both |
| `unmapped_codes.csv` | Codes or names not confirmed as IATA, with passengers | 357 | | |
| `summary.json` | Per-year totals, game-list coverage, and the top airports missing from the game list | | | |
| `scripts/download_t100.py` | Re-downloads one T-100 year from TranStats (see the usage note below) | | | |
| `scripts/normalize.py` | Rebuilds all outputs from `raw/` | | | |
| `raw/` | Every raw download, untouched | | | |

Usage for the download script: `python3 -I scripts/download_t100.py 2024 out.zip [FJE|GEE]`. FJE is the
international table and GEE is the domestic table.

Every CSV has the header `source,origin_iata,dest_iata,year,month,passengers,measure,direction`.
- `month` runs from 1 to 12. All sources are monthly.
- Rows are summed over carriers and, for T-100, over service classes.
- Rows with zero passengers are dropped.
- For `direction=both` files, the meaning of origin and destination depends on the file:
  - `bts_intl_report`: origin is the US airport and destination is the foreign airport.
  - `bitre_domestic`: BITRE's City1 and City2, which are in alphabetical order.

## Sources (exact URLs and ids)

### 1. BTS T-100 International Segment (All Carriers): `normalized_bts_t100i.csv`
- TranStats table `T_T100I_SEGMENT_ALL_CARRIER`.
- Download form: `https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=FJE&QO_fu146_anzr=Nv4%20Pn44vr45`.
  The script POSTs with cboYear=YYYY, cboPeriod=All and cboGeography=All. Fields requested: PASSENGERS, SEATS,
  DEPARTURES_PERFORMED, UNIQUE_CARRIER, CARRIER_GROUP, ORIGIN, ORIGIN_COUNTRY, ORIGIN_AIRPORT_ID, DEST, DEST_COUNTRY,
  DEST_AIRPORT_ID, YEAR, MONTH, CLASS, DISTANCE.
- Raw files are `raw/bts_t100i_segment_{2023,2024,2025}.zip`, unzipped into `raw/t100i/<year>/`.
- The page says "Latest Available Data: July 2026".
- Rows are **directional**: one row per ORIGIN to DEST per month.
  - Every row has exactly one US end, and there are no foreign-to-foreign segments.
  - US territories such as PR, GU and VI count as "US" in BTS, so, for example, SJU to a foreign airport is included.
- Service classes:
  - F (scheduled) and L (non-scheduled/charter) carry essentially all the passengers.
  - P (military charter) carries under 1,000 a year, and G (all-cargo) carries none.
  - All classes are summed.

### 2. DOT International Report Passengers: `normalized_bts_intl_report.csv`
- Socrata dataset **`xgub-n9bw`** ("International_Report_Passengers"), found via
  `https://data.transportation.gov/api/catalog/v1?q=international%20passengers`.
- Downloaded from `https://data.transportation.gov/resource/xgub-n9bw.csv?$where=year >= 2023&$limit=500000`.
  - Saved as `raw/bts_xgub-n9bw_2023plus_raw.csv`, with 118,909 rows. That matches the API's per-year counts.
  - Coverage runs through June 2026.
- The dataset has **no direction**. Each row is both directions summed: usg_apt and fg_apt per carrier per month.
- It comes from the same T-100 segment reports as source 1. Totals are 0.2-1.3% lower than the TranStats table.
  Use it as a cross-check, and **never add it to the T-100 international file**.

### 3. BITRE International Airlines: Traffic by city pairs (`normalized_bitre_city_pairs.csv`)
- data.gov.au CKAN package **`international-airlines-traffic-by-city-pairs`**, found via
  `https://data.gov.au/data/api/3/action/package_search?q=international%20airline%20activity`.
- CSV URL: `https://data.gov.au/data/dataset/d9fbffaa-836f-4f52-80e8-324249ff269f/resource/ebcafd83-9514-4f72-a995-fe7ee90cb9da/download/city_pairs.csv`.
  - Covers January 1985 to June 2026.
  - Saved as `raw/bitre_city_pairs.csv`, with the notes in `raw/bitre_citypairsnotes.txt`.
- Use the `Year` and `Month_num` columns. `Month` changes to an Excel serial number in recent rows.
- Each source row becomes two output rows:
  - Passengers_Out is the Australian port to the foreign port.
  - Passengers_In is the foreign port to the Australian port.

### 4. BTS T-100 Domestic Segment (All Carriers): `normalized_t100_domestic.csv`
- TranStats table `T_T100D_SEGMENT_ALL_CARRIER`.
- Download form: `https://www.transtats.bts.gov/DL_SelectFields.aspx?gnoyr_VQ=GEE&QO_fu146_anzr=Nv4%20Pn44vr45`.
  The POST is the same as source 1. The country fields don't exist in this table; ORIGIN_STATE_ABR and
  DEST_STATE_ABR are included instead.
- Raw files are `raw/bts_t100d_segment_{2023,2024,2025}.zip`, unzipped into `raw/t100d/<year>/`.
- Latest available data is July 2026.
- Rows are directional and cover all US points, including Alaska bush routes and US territories such as
  SJU-STT and GUM-SPN.
- All service classes are included.
- 210,056 passengers on same-airport rows (sightseeing or return-to-origin flights) over the three years were
  dropped.

### 5. BITRE Domestic Airlines: Top Routes (`normalized_bitre_domestic.csv`)
- data.gov.au package **`domestic-airlines-top-routes-and-totals`**, found via
  `https://data.gov.au/data/api/3/action/package_search?q=domestic%20airline%20activity`.
  It covers Regular Public Transport (RPT) services.
- Top-routes CSV: `https://data.gov.au/data/dataset/c5029f2a-39b3-4aef-8ae1-73e7962f6170/resource/677d307f-6a1f-4de4-9b85-5e1aa7074423/download/dom_citypairs_web.csv`.
  - Saved as `raw/bitre_dom_citypairs_web.csv`.
  - Covers January 1984 to July 2026, with 43 cities and about 67 city pairs in 2023-2025.
- Industry totals: `https://data.gov.au/data/dataset/c5029f2a-39b3-4aef-8ae1-73e7962f6170/resource/c8c5774c-bfbc-498b-83b6-154a6545b1ca/download/dom_totals_web.csv`.
  Saved as `raw/bitre_dom_totals_web.csv`.
- `Passenger_Trips` for City1-City2 counts both directions combined.
- **This is a top-routes file, not every domestic route.** The listed routes carry 88.4% (2023), 88.4% (2024) and
  88.9% (2025) of BITRE's industry total of 57.2M, 59.2M and 60.4M. Smaller regional routes are missing.
- BITRE's own month-level industry totals are in the raw file if a national seasonality curve is needed.

### Code mapping
- OurAirports `https://davidmegginson.github.io/ourairports-data/airports.csv`, saved as
  `raw/ourairports_airports.csv`.
- BTS 3-character codes are nearly all IATA. Each one was checked against OurAirports, by IATA code and country.
  The overrides in `normalize.py` are:
  - PBI stays PBI. OurAirports now lists it as DJT, but the game uses PBI.
  - CSL becomes CSW.
  - HOW becomes BLB.
  - MLH becomes BSL.
  - CAT (New Bight, Bahamas) becomes TBI.
  - PT1 becomes CAT.
  - HIK becomes HNL.
  - SXF becomes BER.
- BITRE gives **city names**. These were mapped by hand (`AU_PORTS`, `FOREIGN_PORTS` and `AU_DOM` in
  `normalize.py`). Multi-airport cities were assigned to one airport:
  - Tokyo to HND. In reality Tokyo traffic is split roughly evenly between HND and NRT.
  - London to LHR, Paris to CDG, New York to JFK, Chicago to ORD.
  - Seoul to ICN, Shanghai to PVG, Beijing to PEK, Osaka to KIX, Taipei to TPE.
  - Bangkok to BKK, though some traffic actually uses DMK.
  - Jakarta to CGK, Chengdu to TFU, Dallas to DFW, Houston to IAH, Rome to FCO, Istanbul to IST, Toronto to YYZ.
  - Domestic MELBOURNE to MEL, which also absorbs Avalon (AVV).
- `unmapped_codes.csv` holds tiny BTS-assigned codes: seaplane docks, GA and military fields, and "ZZZ" for an
  unknown point.
  - International: under 7,000 passengers over 3 years.
  - Domestic: about 454,000 over 3 years (0.02%). The largest are RBN Fort Jefferson (Dry Tortugas, 120k), JRV
    Ceiba PR (119k) and 1G4 Grand Canyon West (60k).
  - These are kept as the raw BTS code.
- Every BITRE name was mapped.

## Totals and coverage against the game list

The game list is the 2,140 codes in `/home/claude/twm/src/data/airports.js` (`AIRPORTS`). "In game" means both
airports are in that list.

| Source | Year | Rows | Passengers | Both ends in game |
|---|---|---|---|---|
| bts_t100i | 2023 | 39,367 | 237,714,253 | 99.77% |
| bts_t100i | 2024 | 41,474 | 259,150,571 | 99.52% |
| bts_t100i | 2025 | 42,677 | 259,898,867 | 99.52% |
| bts_intl_report | 2023 | 22,444 | 237,323,485 | 99.77% |
| bts_intl_report | 2024 | 23,506 | 255,796,111 | 99.52% |
| bts_intl_report | 2025 | 24,353 | 258,650,354 | 99.52% |
| bitre_city_pairs | 2023 | 3,553 | 35,778,040 | 100.00% |
| bitre_city_pairs | 2024 | 4,050 | 41,357,825 | ~100% |
| bitre_city_pairs | 2025 | 4,223 | 44,848,534 | ~100% |
| t100_domestic | 2023 | 115,777 | 829,094,478 | 99.01% |
| t100_domestic | 2024 | 118,410 | 859,442,843 | 98.98% |
| t100_domestic | 2025 | 121,977 | 848,502,491 | 98.90% |
| bitre_domestic | 2023 | 752 | 50,597,136 | 94.42% |
| bitre_domestic | 2024 | 735 | 52,363,661 | 94.62% |
| bitre_domestic | 2025 | 752 | 53,676,950 | 94.44% |

Undirected pairs over 2023-2025, and how many are fully in the game:

| Source | Pairs | In game |
|---|---|---|
| T-100 international | 10,482 | 7,180 |
| BITRE international | 214 | 213 |
| T-100 domestic | 23,167 | 13,126 |
| BITRE domestic | 67 | 51 |

The pairs outside the game are numerous but mostly tiny.

Biggest airports missing from the game list, by 2023-2025 passengers (from `summary.json`):

- **US international (T-100):**
  - TQO Tulum 1.03M, ZIH Ixtapa 412k, CUU Chihuahua 391k, LTO Loreto 266k.
  - NLU Mexico City Felipe Angeles 227k, UPN Uruapan 60k.
  - LKE Kenmore Air Harbor (seaplane) 55k, YWH Victoria Harbour (seaplane) 55k.
  - FXE Fort Lauderdale Executive 51k, OCJ Ocho Rios 42k, CSW Cabo San Lucas 41k, YAP 38k, ACA Acapulco 37k.
- **US domestic (T-100):**
  - ECP Panama City Beach 5.4M, STT St Thomas 4.6M, STX St Croix 1.5M.
  - TTN Trenton 1.4M, BLV Belleville/St Louis MidAmerica 1.0M, LCK Columbus Rickenbacker 0.9M.
  - USA Concord NC 0.9M, ILG Wilmington DE 0.8M, SCC Deadhorse 0.6M, XWA Williston 0.6M.
  - MKK Molokai 0.5M, SCK Stockton 0.4M, PSM Portsmouth 0.4M.
- **Australian international:** only MUA Munda (2.7k).
- **Australian domestic:**
  - BNK Ballina 1.5M, ZNE Newman 1.2M, PPP Proserpine/Whitsunday 0.85M, GLT Gladstone 0.66M.
  - EMD Emerald 0.56M, PLO Port Lincoln 0.51M, PQQ Port Macquarie 0.50M, WGA Wagga Wagga 0.48M.
  - MQL Mildura 0.48M, ISA Mount Isa 0.44M, BDB Bundaberg 0.40M, DPO Devonport 0.39M.
  - MOV Moranbah 0.32M, AYQ Ayers Rock 0.14M, ARM Armidale 0.09M.

## Caveats

1. **Everything is segment-based, not O&D.**
   - T-100 counts passengers on board each nonstop leg. A passenger flying LHR-JFK-LAX appears as LHR-JFK in the
     international file and as JFK-LAX in the domestic file. Hubs are therefore heavily inflated relative to true
     origin-destination demand.
   - US international O&D (DB1B) does not cover foreign carriers, so no O&D source was used. DB1B would be the
     domestic O&D option if ever needed.
2. **BITRE international uses "uplift/discharge within a flight number."**
   - On a through flight number, passengers are recorded at their actual boarding and alighting points. For
     example, QF1 SYD-SIN-LHR records SYD-LHR.
   - Flight numbers usually change at the carrier's home hub, so hub ports (Singapore, Dubai, Doha, Auckland) are
     overstated with beyond traffic.
   - Only scheduled carriers are included, with no charters, and the counts are revenue passengers.
   - The file is labelled `segment` because it is not traveller O&D.
3. **BITRE domestic** is RPT revenue passengers on city-pair direct services, with both directions combined.
   City-level data merges MEL with AVV. It is a top-routes subset covering about 88% of the national total.
4. **Double counting:**
   - In the one-way files, A-to-B and B-to-A are separate rows. Sum them to get a two-way market.
   - `bts_intl_report` duplicates `bts_t100i`. Never add the two together.
   - AU-US pairs (SYD-LAX, MEL-LAX, BNE-LAX, BNE-SFO, SYD-DFW, SYD-HNL and so on) appear in **both** T-100
     international and BITRE international. In 2024 the two sources agree within about 1-10%:

     | Pair (2024) | T-100 | BITRE |
     |---|---|---|
     | SYD-LAX | 775k | 803k |
     | SFO-SYD | 250k | 248k |
     | DFW-SYD | 138k | 133k |
     | BNE-LAX | 137k | 129k |

     Deduplicate these before combining the two files.
5. **Confidentiality and suppression:**
   - T-100 segment passenger data is public with no cell suppression. The confidentiality rules apply to T-100
     market and O&D detail, not to segment totals.
   - BITRE publishes every international city pair and every top domestic route. Its notes flag historical
     estimates for a few carriers. No suppression was seen in 2023-2025.
   - Small rows are real data, not noise.
6. The T-100 international TranStats table is about 0.2-1.3% above Socrata `xgub-n9bw`, which comes down to how the
   carriers are cut and when each release was made. The 2024 totals (about 259M international and 859M domestic
   segment passengers) are in line with published BTS totals.
7. City-level BITRE mapping loses the split between airports in multi-airport cities, most notably Tokyo HND/NRT
   and Bangkok BKK/DMK.
8. 2026 partial data exists but was deliberately left out:
   - T-100 international and domestic: January to July 2026.
   - Socrata and BITRE international: to June 2026.
   - BITRE domestic: to July 2026.

   To add it, change `YEARS` in `normalize.py` and run one more TranStats download per table.
