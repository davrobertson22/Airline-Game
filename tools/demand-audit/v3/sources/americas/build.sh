#!/bin/bash
# Rebuild all normalized outputs from raw/ (intermediates go to work/, safe to delete)
set -e
A=$(cd "$(dirname "$0")/.." && pwd); W=$A/work; mkdir -p $W
python3 -I $A/scripts/br_explore.py $A/raw/brazil/Dados_Estatisticos.csv $W/br.pkl > $W/br_explore.log
python3 -I $A/scripts/br_test.py $W/br.pkl $A/raw/ourairports/airports.csv > $W/br_segment_test.log
python3 -I $A/scripts/mx_extract.py $W/mx_long.csv $A/raw/mexico/sase-diciembre-202[345]*.xlsx 2> $W/mx_extract.log
python3 -I $A/scripts/normalize.py $A $W > $W/normalize.log
cat $W/normalize.log | head -14
