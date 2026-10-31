# Americas airport-pair passenger data (Brazil, Canada, Mexico)

Collected 2026-10-30 to calibrate the Tailwinds demand model. All numbers come straight from official sources. Nothing is estimated or filled in.

| Country | Source | Pair-level output | Years | Granularity |
|---|---|---|---|---|
| Brazil | ANAC, Dados Estatísticos do Transporte Aéreo | `normalized_anac_br.csv` | 2023–2025 (Jan–Sep 2026 also in raw) | monthly, airport pair, directional |
| Mexico | AFAC (SICT), Estadística operacional por origen-destino ("SASE") | `normalized_afac_mx.csv` | 2023–2025 (Jan–Sep 2026 also in raw) | monthly, city pair mapped to airport, directional |
| Canada | **No public airport-pair or city-pair passenger data exists for any post-COVID year** (see below) | none | – | – |

Schema of both normalized files:
`source,origin_iata,dest_iata,year,month,passengers,measure,direction`. Every row has `measure=segment` and `direction=one-way` (origin→dest only; the reverse direction is a separate row). The files have no domestic/international flag. To get one, look up both airports' countries (OurAirports `iso_country`). `coverage_summary.csv` was built that way.

## Files

- `normalized_anac_br.csv`: 44,264 rows (2023: 14,729 / 2024: 14,777 / 2025: 14,758). 2,704 directional pairs.
- `normalized_afac_mx.csv`: 44,255 rows (2023: 14,041 / 2024: 14,820 / 2025: 15,394). 2,255 directional pairs.
- `coverage_summary.csv`: passengers, pair count and share on game-airport pairs, by source, year and domestic/international.
- `not_in_game_anac_br.csv`, `not_in_game_afac_mx.csv`: airports in the data that are missing from `twm/src/data/airports.js`, ranked by 2023–2025 enplaned+deplaned passengers.
- `unmapped_anac_br.csv`, `unmapped_afac_mx.csv`: codes or city labels that could not be mapped to IATA.
- `scripts/`: `build.sh` rebuilds everything from `raw/`. `br_test.py` holds the segment/O&D diagnostics. `mx_citymap.py` holds the hand-built AFAC city→IATA table.
- `work/`: intermediates and logs (safe to delete).
- `raw/`: original downloads, unmodified. Also contains `raw/game_airports.csv` (2,140 codes pulled from airports.js).

## Exact URLs used

Brazil (ANAC):
- https://sistemas.anac.gov.br/dadosabertos/Voos%20e%20opera%C3%A7%C3%B5es%20a%C3%A9reas/Dados%20Estat%C3%ADsticos%20do%20Transporte%20A%C3%A9reo/Dados_Estatisticos.csv (361 MB; "Atualizado em: 2026-10-30"; covers 2000 to Sep 2026; `;`-separated, UTF-8 BOM, the first line is a date stamp)

Mexico (AFAC):
- Index pages: https://www.gob.mx/afac/acciones-y-programas/estadisticas-280404 and https://www.gob.mx/afac/acciones-y-programas/estadistica-mensual-operativa-monthly-traffic-statistics
- https://www.gob.mx/cms/uploads/attachment/file/1052816/sase-diciembre-2023-28012026.xlsx
- https://www.gob.mx/cms/uploads/attachment/file/1052818/sase-diciembre-2024-28012026.xlsx
- https://www.gob.mx/cms/uploads/attachment/file/1055167/sase-diciembre-2025-05022026h.xlsx
- https://www.gob.mx/cms/uploads/attachment/file/1112830/sase-septiembre-2026-27102026.xlsx (2026 YTD, raw only, not normalized)
- Methodology: https://www.gob.mx/cms/uploads/attachment/file/843705/descripcion-variables-metodologia-24072023.pdf
- Bulletins (for sanity checks): https://www.gob.mx/cms/uploads/attachment/file/981350/boletin-es-dic-2024-04032025.pdf and https://www.gob.mx/cms/uploads/attachment/file/1055166/boletin-es-dic-2025-05022026h.pdf
- Note: the 2023 and 2024 workbooks were re-issued on 2026-01-28 with revisions. The sheet "Historial de revisiones" lists them, e.g. foreign carriers' operations added.

Canada (searched; nothing at pair level):
- StatCan WDS cube list: https://www150.statcan.gc.ca/t1/wds/rest/getAllCubesListLite (saved as `raw/canada/cubes.json`)
- StatCan table 23-10-0253 (airport-level, not pairs): https://www150.statcan.gc.ca/n1/tbl/csv/23100253-eng.zip → `raw/canada/23100253.csv`
- Transport Canada addendum tables: https://tdih-cdit.tc.canada.ca/sites/default/files/addendum-tables/2023/A13-en.pdf (top-25 domestic markets, **seats** not passengers) and .../2024/A14-en.pdf (airport totals)
- open.canada.ca CKAN search (`package_search`) for "air passenger origin destination", "airport pair passengers", "city pair air" and "domestic air passengers"
- StatCan survey 2702 "Air Passenger Origin and Destination, Domestic": https://www150.statcan.gc.ca/n1/en/surveys/2702

Airport codes: https://davidmegginson.github.io/ourairports-data/airports.csv (`raw/ourairports/airports.csv`, fetched 2026-10-30).

## Processing

Brazil:
- `passengers = PASSAGEIROS_PAGOS + PASSAGEIROS_GRATIS` (revenue plus free/non-revenue passengers carried).
- Kept `GRUPO_DE_VOO` values REGULAR and NÃO REGULAR (charter). Dropped IMPRODUTIVO (positioning/unproductive flights, about 0.15M pax/yr).
- Rows were summed across airlines.
- ICAO→IATA mapping uses OurAirports `ident`, `icao_code` and `gps_code`. One manual mapping: SBCO (Canoas air base, no IATA code) → POA. During the 2024 Rio Grande do Sul floods, Porto Alegre's airline traffic ran through Canoas while POA was closed (May–Oct 2024). That is 435,502 pax in 2024.
- Unmapped after that: 383 pax over 3 years (SNOB, SDVZ, LIRG, ZWTP).
- International rows cover flights to/from Brazil by both Brazilian and foreign carriers.

Mexico:
- Parsed sheets REG NAC, REG INT, FLET NAC and FLET INT (scheduled and charter, domestic and international). Used the 12 monthly PASAJEROS columns.
- Parsed totals match each sheet's own "T O T A L" row exactly (e.g. REG NAC 2024 = 61,533,816).
- AFAC labels are **city names**. They were mapped by hand to the principal airport (`scripts/mx_citymap.py`):
  - Mexico City: MEXICO→MEX. Santa Lucía (NLU) and Toluca (TLC) are reported separately.
  - NUEVA YORK→JFK (Newark is reported separately as NEWARK). CHICAGO→ORD (may include MDW). HOUSTON→IAH (may include HOU). WASHINGTON→IAD (BWI separate). DALLAS→DAL, DALLAS-FORT WORTH→DFW.
  - LONDRES→LHR, PARIS→CDG, TOKYO→NRT, SAO PAULO→GRU, BUENOS AIRES→EZE, SHANGHAI→PVG, SEOUL→ICN.
  - "Los Cabos" (a small secondary label, about 119k pax over 3 years) and "SAN JOSÉ DEL CABO" → SJD.
- Unmapped: PACHUCA (47 pax) plus a handful of US military/GA fields with 0 passengers.
- No rows have both endpoints outside Mexico.

## Measure: segment vs O&D (read this before calibrating)

**Neither source is true itinerary O&D.** Both are *on-flight origin–destination* (ICAO "OFOD"; ANAC "etapa combinada"): each passenger is counted once per flight number, from the point where they board to the point where they get off. I labelled both `segment` because:
- A connection between two flights (GRU→BSB→MAO, or YYZ→MEX→CUN) is counted on **each** flight. Hub pairs therefore include connecting traffic, and the passenger's true O&D (GRU-MAO) does not appear.
- Only *through* passengers on a multi-stop flight with the same flight number appear at their real board/alight pair.
  - Brazil evidence: rows with zero departures but positive passengers are these through-flight OD pairs. Examples: GOL BSB→MCP, ETH ADD→EZE via GRU. They carry about 0.24% of domestic pax.
  - Across the rest, RPK/pax matches great-circle distance (median ratio 0.988), and flown km per departure matches great-circle distance (median 1.000). So in practice the data behaves like flight-stage traffic. See `work/br_segment_test.log`.
- Mexico workbooks are titled "ESTADISTICA OPERACIONAL ORIGEN-DESTINO / AVIATION STATISTICS BY OFOD". The methodology PDF does not define the term further.

Implications:
- Summing a year's domestic rows gives total domestic passenger boardings (one-way). That matches the national headline figures (below).
- Hub-to-hub and hub-spoke pairs are inflated by connecting passengers compared with true O&D demand. Spoke-to-spoke pairs without non-stop service are mostly missing.
- Each direction is a separate row (`one-way`). Directional balance is close to 1 (median A→B / B→A ratio = 1.00 in both files). To get two-way market size, add the A→B and B→A rows. Do not double them.

Suppression: neither source suppresses small cells. Pairs with 1-digit monthly passenger counts are present.

## Sanity check vs national totals (one-way domestic passengers, sum of normalized rows)

| Year | Brazil domestic (paid+free) | of which paid only | Brazil intl | Mexico domestic (reg+charter) | Mexico intl |
|---|---|---|---|---|---|
| 2023 | 93.42 M | 91.46 M | 21.92 M | 63.69 M | 55.28 M |
| 2024 | 95.21 M | 93.38 M | 26.00 M | 61.73 M | 58.28 M |
| 2025 | 103.09 M | 101.25 M | 29.63 M | 63.63 M | 59.09 M |

- **Brazil:** ANAC's headline 2024 domestic figure is about 93.4 M paid passengers, which matches the paid-only column. 2025 is a record year above 100 M. The "~100M+/yr" expectation holds for 2025. 2023–2024 are just under 100 M on a paid basis.
- **Mexico:** the scheduled-domestic sheet totals are 63.62 M (2023), 61.53 M (2024) and 63.53 M (2025). The AFAC Dec-2024 bulletin shows domestic scheduled traffic down 3.2% in 2024 vs 2023, consistent with these files. International covers Mexican and foreign carriers, both directions.
- **Canada (context only, not pairs):** StatCan 23-10-0253 domestic-sector enplaned+deplaned passengers are 85.8 M (2023), 85.9 M (2024) and 88.4 M (2025), roughly 43–44 M one-way domestic passengers per year. Transborder: 28.8 / 31.9 / 29.4 M. Other international: 36.1 / 39.1 / 41.1 M.

## Coverage against the game's airport list (2,140 airports)

Share of passengers on pairs where both airports are in `AIRPORTS`:

| Source | Year | Domestic | International |
|---|---|---|---|
| ANAC BR | 2023 | 94.6% | 91.5% |
| ANAC BR | 2024 | 94.9% | 92.3% |
| ANAC BR | 2025 | 95.1% | 90.0% |
| AFAC MX | 2023 | 79.8% | 98.9% |
| AFAC MX | 2024 | 74.8% | 97.5% |
| AFAC MX | 2025 | 74.4% | 97.4% |

The biggest airports missing from the game (enplaned+deplaned passengers summed over 2023–2025):
- **Mexico:** NLU Santa Lucía/AIFA 15.3 M, CJS Ciudad Juárez 6.4 M, CUU Chihuahua 5.6 M, TGZ Tuxtla Gutiérrez 5.1 M, TLC Toluca 4.7 M, LAP La Paz 3.5 M, TQO Tulum 2.5 M, ACA Acapulco 2.1 M, ZIH Ixtapa 1.9 M, REX Reynosa 1.5 M. These explain why Mexican domestic coverage is only about 75%. AIFA's growth is why coverage falls after 2023.
- **Brazil:** VIX Vitória 9.6 M (about 3.2 M/yr, the largest gap), AEP Buenos Aires-Aeroparque 6.7 M (the Brazil–Argentina flows), then JJD Jericoacoara, CKS Carajás, IZA Zona da Mata, JJG Jaguaruna, ATM Altamira (each under 0.71 M).

## Canada: what was tried, and why there is no normalized file

- **Statistics Canada:** the full WDS cube list has no domestic O&D or airport-pair passenger table at all.
  - The only O&D tables are *transborder* (Canada–US) city-pair tables 23-10-0245/0249/0255/0256/0257/0263. Their reference period ends in **2018**.
  - The domestic O&D product (survey 2702; publication 51-204-X, "Air Passenger Origin and Destination, Domestic Report") is archived. No post-2018 data has been released.
  - The post-COVID air tables are airport-level only: 23-10-0253 (annual enplaned+deplaned by sector, 2008–2025, saved in raw) and 23-10-0312 (screened passengers). Carrier-level operating statistics have no pair dimension.
- **Transport Canada:** the "Transportation in Canada" statistical addendum has airport-level passenger tables (A14/A15). Table A13 ranks the top-25 domestic markets by **daily seats** (capacity), not passengers. It is saved in raw for reference but not converted, because seats are not passenger counts.
- **open.canada.ca:** the only matches are the same StatCan tables and 2006 NRCan route maps.
- **Partial substitutes already in this folder:**
  - Canada–Mexico pairs from AFAC: 217 directional pairs, 4.8 / 5.3 / 6.2 M pax in 2023 / 2024 / 2025.
  - Canada–Brazil pairs from ANAC: 13 pairs, about 0.32–0.34 M pax/yr.
  - Canada–US transborder segments would be in US BTS T-100 International Segment, which covers all carriers on flights touching the US. That is not fetched here.
  - Canadian domestic airport-pair passenger counts are not publicly available for 2019 or later.
