import { gameReducer, freshState } from './src/store/GameContext.jsx';
import { AIRCRAFT_TYPES } from './src/data/aircraft.js';
let st={...freshState(),cash:1e9,phase:'playing',hub:'SFO',airlineName:'T'};
const t=AIRCRAFT_TYPES.find(x=>!x.freighter);
st=gameReducer(st,{type:'LEASE_AIRCRAFT',typeId:t.id});
st=gameReducer(st,{type:'ADVANCE_WEEK'});
console.log('smoke: week',st.week,'fleet',st.fleet.length,'phase',st.phase);
