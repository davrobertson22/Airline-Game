import { cargoCityPairDemand, cargoReferenceYield, cargoReferenceRevenuePerTonne, getCargoMass, routeDistance } from './src/utils/market.js';
const routes = [
  ['HKG','LAX'], ['PVG','LAX'], ['HKG','FRA'], ['ICN','LAX'], ['NRT','LAX'],
  ['PVG','FRA'], ['HKG','ANC'], ['ANC','LAX'], ['DXB','FRA'], ['HKG','SIN'],
  ['BOG','MIA'], ['NBO','AMS'], ['UIO','MIA'], ['SCL','MIA'],
  ['FRA','LHR'], ['LAX','ORD'], ['HKG','NRT'], ['SIN','SYD'],
  ['LAS','MCO'], ['NCE','CDG'], ['CUN','MIA'],
];
const fmt = n => n.toLocaleString('en-US');
console.log('route        dist(km)  massO   massD  tonnes/wk  yield$/tkm   $/tonne   $/kg');
for (const [o,d] of routes) {
  const dist = routeDistance(o,d);
  const t = cargoCityPairDemand(o,d);
  const y = cargoReferenceYield(o,d);
  const rpt = cargoReferenceRevenuePerTonne(o,d);
  console.log(
    (o+'-'+d).padEnd(11),
    String(fmt(dist)).padStart(8),
    getCargoMass(o).toFixed(0).padStart(6),
    getCargoMass(d).toFixed(0).padStart(6),
    String(fmt(t)).padStart(9),
    y.toFixed(3).padStart(11),
    String(fmt(rpt)).padStart(9),
    (rpt/1000).toFixed(2).padStart(6),
  );
}
