import { baseCityPairDemand, referencePrice, routeDistance } from './src/utils/market.js';
import { buildRouteMarket, computeMarketShare, getRouteClassDemandShares, ELASTICITY, priceChokeFactor } from './src/models/demand.js';

const O='MSP', D='BJI';
console.log('dist', routeDistance(O,D));
console.log('base one-way demand', baseCityPairDemand(O,D));
console.log('refPrice', referencePrice(O,D));
console.log('class shares', getRouteClassDemandShares(O,D));

const market = buildRouteMarket(O,D,{week:10,month:7},1);
console.log('market', market);

// Player offer: 3x ATR72-600, 7x freq each, ~78 seats. seats/wk shown 546 => per aircraft 546? 
// Screenshot: each aircraft 546 seats/wk, 7x freq => ~78 seats. 3 aircraft.
const seatsPerAircraftWeek = 546;
const nAircraft = 3;
const totalSeats = seatsPerAircraftWeek*nAircraft; // economy
const offer = {
  airlineId:'player', origin:O, destination:D,
  economyPrice: 309, businessPrice: null,
  weeklyFrequency: 21, seatsPerFlight: 78,
  economySeats: totalSeats, businessSeats: 0, totalSeats,
  qualityScore: 50, connectivityBonus: 0,
};
const res = computeMarketShare(market, [offer]);
console.log('result', res);
const r=res[0];
console.log('load%', (r.totalPax/totalSeats*100).toFixed(1));

// sweep price
console.log('\nPrice sweep (monopoly):');
for (const p of [120,150,200,250,309,360,400]) {
  const o2={...offer, economyPrice:p};
  const rr=computeMarketShare(market,[o2])[0];
  console.log(`  $${p}: pax=${rr.totalPax} load=${(rr.totalPax/totalSeats*100).toFixed(1)}% rev=$${(rr.totalRevenue/1000).toFixed(0)}k`);
}
