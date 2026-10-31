#!/bin/bash
cd /home/claude/v3data/eurostat
for c in at be bg ch cy cz de dk ee el es fi fr hr hu ie is it lt lu lv me mk mt nl no pl pt ro rs se si sk tr uk; do
  for y in 2023 2024 2025; do
    f="${c}_${y}.json"
    [ -s "$f" ] && continue
    curl -s --max-time 300 "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/avia_par_${c}?format=JSON&lang=EN&unit=PAS&tra_meas=PAS_CRD&sinceTimePeriod=${y}-01&untilTimePeriod=${y}-12&freq=M" -o "$f"
    echo "$c $y $(stat -c %s $f)"
  done
done
echo DONE
