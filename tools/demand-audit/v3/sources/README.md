# Demand v3 data sources

How the files in `tools/demand-audit/data/v3/normalized_*.csv` were built
(that folder is gitignored, like the rest of `data/`). Every file has the header
`source,origin_iata,dest_iata,year,month,passengers,measure,direction`.

| Folder | Sources | Output files |
|---|---|---|
| `eurostat/` | Eurostat `avia_par_*` (passengers carried per airport pair, monthly, 2023–24; every EU/EEA reporter plus CH, TR, RS, ME, MK; the Czech report is not published) | `normalized_eurostat.csv` |
| `us_au/` | US BTS T-100 international and domestic segments; Australia BITRE international city pairs and domestic top routes | `normalized_bts_t100i.csv`, `normalized_t100_domestic.csv`, `normalized_bitre_city_pairs.csv`, `normalized_bitre_domestic.csv` |
| `americas/` | Brazil ANAC `Dados_Estatisticos.csv`; Mexico AFAC SASE workbooks (Canada publishes no pair data since 2018) | `normalized_anac_br.csv`, `normalized_afac_mx.csv` |
| `asia_uk/` | UK CAA airport data tables 12.1/12.2; India DGCA domestic (fiscal years) and international city pairs; Japan MLIT route statistics (domestic only) | `normalized_uk_caa.csv`, `normalized_india_dgca.csv`, `normalized_japan_mlit.csv` |

Each folder's README has the exact URLs, how the source counts passengers, totals
and caveats. The scripts were run in a scratch directory (`/home/claude/v3data/…`
in their paths): point them at a scratch folder, run them, then copy the
`normalized_*.csv` files into `tools/demand-audit/data/v3/`. All counts are
passengers on nonstop flights (segment), not true O&D — see `../real-data.mjs`
for how the fit turns them into O&D.

Then, from the repo root:

    node tools/demand-audit/v3/fit-v3.mjs            (writes src/data/demandV3Factors.js)
    node tools/demand-audit/v3/fit-v3-seasons.mjs    (writes src/data/demandV3Seasons.js)
    node tools/generate-airport-markets.mjs
